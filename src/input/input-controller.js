import { CameraController } from './camera-controller.js';
import { ForegroundSegmenter } from './foreground-segmenter.js';
import { PointerInput } from './pointer-input.js';
import { SimulatedCamera } from './simulated-camera.js';
import { CoverageEngine } from '../trigger/coverage-engine.js';
import { hitTestVisualNode } from '../scene/scene-layout.js';

const PROCESSING_WIDTH = 240;
const PROCESSING_HEIGHT = 135;
const VIRTUAL_WIDTH = 180;
const VIRTUAL_HEIGHT = 140;

export class InputController extends EventTarget {
  constructor({ canvas, viewport, video, triggerPlane, calibrationController, settings, visualNodes = [] }) {
    super();
    this.triggerPlane = triggerPlane;
    this.calibrationController = calibrationController;
    this.settings = settings;
    this.visualNodes = visualNodes;
    this.mode = settings.mode;
    this.cameraSource = settings.cameraSource;
    this.pointer = new PointerInput(canvas, viewport, {
      hitTest: (u, v) => hitTestVisualNode(this.visualNodes, viewport.orientation, u, v),
    });
    this.pointer.setEnabled(this.mode === 'pointer');
    this.hardwareCamera = new CameraController(video, PROCESSING_WIDTH, PROCESSING_HEIGHT);
    this.simulatedCamera = new SimulatedCamera(PROCESSING_WIDTH, PROCESSING_HEIGHT);
    this.segmenter = new ForegroundSegmenter(PROCESSING_WIDTH, PROCESSING_HEIGHT, { diffThreshold: settings.diffThreshold });
    this.coverageEngine = new CoverageEngine(triggerPlane);
    this.coverageEngine.rebuild(PROCESSING_WIDTH, PROCESSING_HEIGHT, calibrationController.mapping.cameraToPlane);
    this.coverages = new Float32Array(triggerPlane.count);
    this.virtualMask = new Uint8Array(VIRTUAL_WIDTH * VIRTUAL_HEIGHT);
    this.virtualCellAreas = new Uint32Array(triggerPlane.count);
    this.virtualCellMap = new Int16Array(VIRTUAL_WIDTH * VIRTUAL_HEIGHT);
    this.lastFrame = null;
    this.lastSegmentation = this.segmenter.result();
    this.cameraState = 'idle';
    this.transportState = 'idle';
    this.cameraMessage = '';
    this.reconnectAttempts = 0;
    this.reconnectFailuresTotal = 0;
    this.reconnectSuccesses = 0;
    this.cameraRetryable = false;
    this.cameraPermanentError = false;
    this.reconnectFailuresTotal = 0;
    this.reconnectSuccesses = 0;
    this.sourceGeneration = 0;
    this.autoPaused = settings.autoPaused;
    this.#buildVirtualMap();

    this.hardwareCamera.mirror = settings.mirror;
    this.hardwareCamera.addEventListener('statechange', (event) => {
      if (this.cameraSource !== 'hardware') return;
      this.#applySourceState(event.detail);
    });
    this.simulatedCamera.addEventListener('statechange', (event) => {
      if (this.cameraSource !== 'simulated') return;
      this.#applySourceState(event.detail);
    });
    calibrationController.addEventListener('change', () => {
      this.coverageEngine.rebuild(PROCESSING_WIDTH, PROCESSING_HEIGHT, calibrationController.mapping.cameraToPlane);
    });
  }

  #buildVirtualMap() {
    this.virtualCellAreas.fill(0);
    for (let y = 0; y < VIRTUAL_HEIGHT; y += 1) {
      for (let x = 0; x < VIRTUAL_WIDTH; x += 1) {
        const index = this.triggerPlane.indexAt((x + 0.5) / VIRTUAL_WIDTH, (y + 0.5) / VIRTUAL_HEIGHT);
        const offset = y * VIRTUAL_WIDTH + x;
        this.virtualCellMap[offset] = index;
        if (index >= 0) this.virtualCellAreas[index] += 1;
      }
    }
  }

  setMode(mode) {
    if (!['auto', 'pointer', 'camera'].includes(mode)) throw new RangeError(`Unknown input mode: ${mode}`);
    this.mode = mode;
    this.pointer.setEnabled(mode === 'pointer');
    if (mode !== 'camera') this.coverages.fill(0);
    this.dispatchEvent(new CustomEvent('modechange', { detail: { mode } }));
  }

  async setCameraSource(source) {
    if (!['hardware', 'simulated'].includes(source)) throw new RangeError(`Unknown camera source: ${source}`);
    if (this.cameraSource === source) {
      return this.mode === 'camera' ? this.ensureCameraStarted() : true;
    }
    const generation = ++this.sourceGeneration;
    this.hardwareCamera.stop();
    this.simulatedCamera.stop();
    this.cameraSource = source;
    this.segmenter.resetBackground();
    this.lastFrame = null;
    this.coverages.fill(0);
    this.#applySourceState({ state: 'idle', message: '摄像头来源已切换。', reconnectAttempts: 0 });
    if (this.mode !== 'camera') return true;
    const result = await this.ensureCameraStarted(generation, source);
    return generation === this.sourceGeneration && source === this.cameraSource ? result : false;
  }

  async ensureCameraStarted(expectedGeneration = this.sourceGeneration, expectedSource = this.cameraSource) {
    const controller = expectedSource === 'simulated' ? this.simulatedCamera : this.hardwareCamera;
    const result = await controller.start();
    if (expectedGeneration !== this.sourceGeneration || expectedSource !== this.cameraSource) return false;
    return result;
  }

  async captureBackground(frameCount = 18) {
    if (this.mode !== 'camera') this.setMode('camera');
    const started = await this.ensureCameraStarted();
    if (!started) {
      this.#emitMessage(this.cameraMessage || '摄像头未就绪，无法采集空场背景。', 'error');
      return false;
    }
    this.segmenter.beginBackgroundCapture(frameCount);
    this.cameraState = 'capturing-background';
    this.cameraMessage = `正在采集 ${frameCount} 帧空场背景。`;
    this.#dispatchCameraState();
    this.#emitMessage(`开始采集 ${frameCount} 帧空场背景，请保持画面无人。`, 'info');
    return true;
  }

  configure(settings) {
    this.settings = settings;
    this.segmenter.configure({ diffThreshold: settings.diffThreshold });
    this.hardwareCamera.mirror = settings.mirror;
    this.autoPaused = settings.autoPaused;
  }

  update(now, dtSeconds) {
    if (this.mode === 'auto') {
      const people = this.autoPaused ? [] : this.#autoPeople(now);
      this.#computeVirtualCoverages(people);
      return this.snapshot();
    }
    if (this.mode === 'pointer') {
      this.#computeVirtualCoverages(this.pointer.snapshot());
      return this.snapshot();
    }
    const source = this.cameraSource === 'simulated' ? this.simulatedCamera : this.hardwareCamera;
    const frame = source.getFrame(now);
    if (!frame) {
      this.coverages.fill(0);
      return this.snapshot();
    }
    this.lastFrame = frame;
    const wasCapturing = this.segmenter.capturing;
    this.lastSegmentation = this.segmenter.process(frame, dtSeconds);
    if (wasCapturing && !this.segmenter.capturing && this.segmenter.metrics.backgroundReady) {
      this.cameraState = 'ready';
      this.cameraMessage = '空场背景已就绪。';
      this.#dispatchCameraState();
      this.#emitMessage('空场背景采集完成，人物进入画面即可触发。', 'success');
    }
    this.coverages.set(this.coverageEngine.compute(this.lastSegmentation.mask));
    return this.snapshot();
  }

  #autoPeople(now) {
    const t = now * 0.00015;
    return [
      { x: 0.17 + ((t * 0.73) % 1) * 0.66, y: 0.58 + Math.sin(t * 7.2) * 0.12, rx: 0.09, ry: 0.23 },
      { x: 0.82 - ((t * 0.49 + 0.34) % 1) * 0.62, y: 0.46 + Math.cos(t * 5.4) * 0.10, rx: 0.08, ry: 0.20 },
    ];
  }

  #computeVirtualCoverages(people) {
    this.virtualMask.fill(0);
    const occupied = new Uint32Array(this.triggerPlane.count);
    for (let y = 0; y < VIRTUAL_HEIGHT; y += 1) {
      const v = (y + 0.5) / VIRTUAL_HEIGHT;
      for (let x = 0; x < VIRTUAL_WIDTH; x += 1) {
        const u = (x + 0.5) / VIRTUAL_WIDTH;
        let active = false;
        for (const person of people) {
          if (person.precise) continue;
          const dx = (u - person.x) / Math.max(0.01, person.rx || 0.09);
          const dy = (v - person.y) / Math.max(0.01, person.ry || 0.21);
          if (dx * dx + dy * dy <= 1) {
            active = true;
            break;
          }
        }
        if (!active) continue;
        const offset = y * VIRTUAL_WIDTH + x;
        this.virtualMask[offset] = 255;
        const cell = this.virtualCellMap[offset];
        if (cell >= 0) occupied[cell] += 1;
      }
    }
    for (const person of people) {
      if (!person.precise || !Number.isInteger(person.targetId) || person.targetId < 0 || person.targetId >= this.coverages.length) continue;
      occupied[person.targetId] = this.virtualCellAreas[person.targetId];
    }
    for (let index = 0; index < this.coverages.length; index += 1) {
      this.coverages[index] = this.virtualCellAreas[index] ? occupied[index] / this.virtualCellAreas[index] : 0;
    }
  }

  setSimulatedScenario(scenario) {
    this.simulatedCamera.setScenario(scenario);
  }

  simulateDisconnect() {
    if (this.cameraSource !== 'simulated') return false;
    this.simulatedCamera.simulateDisconnect(true);
    return true;
  }

  async recover() {
    this.segmenter.resetBackground();
    this.coverages.fill(0);
    if (this.cameraSource === 'simulated') {
      this.simulatedCamera.stop();
      await this.simulatedCamera.start();
      return true;
    }
    return this.hardwareCamera.recover();
  }

  stop() {
    this.sourceGeneration += 1;
    this.hardwareCamera.stop();
    this.simulatedCamera.stop();
  }

  #applySourceState(detail) {
    this.transportState = detail.state;
    if (detail.state === 'live') {
      this.cameraState = this.segmenter.capturing
        ? 'capturing-background'
        : (this.segmenter.metrics.backgroundReady ? 'ready' : 'live');
    } else {
      this.cameraState = detail.state;
    }
    this.cameraMessage = detail.message || '';
    this.reconnectAttempts = detail.reconnectAttempts || 0;
    this.reconnectFailuresTotal = detail.reconnectFailuresTotal || 0;
    this.reconnectSuccesses = detail.reconnectSuccesses || 0;
    this.cameraRetryable = Boolean(detail.retryable);
    this.cameraPermanentError = Boolean(detail.permanent);
    this.reconnectFailuresTotal = detail.reconnectFailuresTotal || 0;
    this.reconnectSuccesses = detail.reconnectSuccesses || 0;
    this.#dispatchCameraState();
  }

  #dispatchCameraState() {
    this.dispatchEvent(new CustomEvent('camerastate', { detail: this.cameraSnapshot() }));
  }

  #emitMessage(message, level) {
    this.dispatchEvent(new CustomEvent('message', { detail: { message, level } }));
  }

  cameraSnapshot() {
    return {
      source: this.cameraSource,
      state: this.cameraState,
      transportState: this.transportState,
      message: this.cameraMessage,
      reconnectAttempts: this.reconnectAttempts,
      reconnectFailuresTotal: this.reconnectFailuresTotal,
      reconnectSuccesses: this.reconnectSuccesses,
      retryable: this.cameraRetryable,
      permanentError: this.cameraPermanentError,
      reconnectFailuresTotal: this.reconnectFailuresTotal,
      reconnectSuccesses: this.reconnectSuccesses,
      sourceGeneration: this.sourceGeneration,
      getUserMediaCalls: this.hardwareCamera.getUserMediaCalls,
    };
  }

  snapshot() {
    const pointers = this.pointer.snapshot();
    return {
      mode: this.mode,
      camera: this.cameraSnapshot(),
      coverages: this.coverages,
      frame: this.lastFrame,
      segmentation: this.lastSegmentation,
      backgroundReady: Boolean(this.segmenter.background),
      capturingBackground: this.segmenter.capturing,
      captureProgress: this.segmenter.metrics.captureProgress,
      pointerCount: pointers.length,
      pointerTargetIds: pointers.filter((pointer) => pointer.precise && pointer.targetId >= 0).map((pointer) => pointer.targetId),
    };
  }
}
