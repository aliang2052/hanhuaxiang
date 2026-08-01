import { AudioEngine } from './audio/audio-engine.js';
import { CalibrationController } from './calibration/calibration-controller.js';
import { CalibrationView } from './calibration/calibration-view.js';
import { ConfigStore } from './config/config-store.js';
import { validateSceneConfig, validateSettings } from './core/config-schema.js';
import { DecorativeRenderer } from './scene/decorative-renderer.js';
import { CharacterRenderer } from './scene/character-renderer.js';
import { SceneRenderer } from './scene/scene-renderer.js';
import { ViewportManager } from './scene/viewport.js';
import { InputController } from './input/input-controller.js';
import { TriggerHysteresis } from './trigger/hysteresis.js';
import { TriggerPlane } from './trigger/trigger-plane.js';
import { OperatorUI } from './ui/operator-ui.js';
import { RecognitionMonitor } from './ui/recognition-monitor.js';

const APP_VERSION = '2.2.0-p0-fix2';
const BASELINE = 'ac76d30';

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} 加载失败：HTTP ${response.status}`);
  return response.json();
}

async function loadImage(url) {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return image;
}

function modeLabel(mode) {
  return ({ auto: '自动演示', pointer: '鼠标精准 / 多点触摸', camera: '摄像头' })[mode] || mode;
}

class HanOrchestraApp {
  constructor(sceneConfig, textureImage) {
    this.sceneConfig = sceneConfig;
    this.configStore = new ConfigStore();
    this.settings = this.configStore.loadSettings();
    this.ui = new OperatorUI();
    this.ui.applySettings(this.settings);
    this.triggerPlane = new TriggerPlane(sceneConfig.trigger.rows, sceneConfig.trigger.cols);
    this.calibration = new CalibrationController(this.configStore);
    this.viewport = new ViewportManager(document.getElementById('artCanvas'));
    this.characterRenderer = new CharacterRenderer(sceneConfig.nodes);
    this.decorativeRenderer = new DecorativeRenderer(textureImage, sceneConfig.palette);
    this.sceneRenderer = new SceneRenderer(this.viewport, this.decorativeRenderer, this.characterRenderer, this.triggerPlane);
    this.input = new InputController({
      canvas: document.getElementById('artCanvas'),
      viewport: this.viewport,
      video: document.getElementById('cameraVideo'),
      triggerPlane: this.triggerPlane,
      calibrationController: this.calibration,
      settings: this.settings,
      visualNodes: sceneConfig.nodes,
    });
    this.hysteresis = new TriggerHysteresis(this.triggerPlane.count, {
      onThreshold: this.settings.onThreshold,
      offThreshold: this.settings.offThreshold,
      onFrames: this.settings.onFrames,
      offFrames: this.settings.offFrames,
      attackSeconds: 0.16,
      releaseSeconds: 0.52,
    });
    this.audio = new AudioEngine(sceneConfig.audioGroups, sceneConfig.nodes);
    this.audio.setMuted(this.settings.muted);
    this.calibrationView = new CalibrationView({
      rawCanvas: document.getElementById('rawDebugCanvas'),
      maskCanvas: document.getElementById('maskDebugCanvas'),
      coverageCanvas: document.getElementById('coverageDebugCanvas'),
      calibrationController: this.calibration,
      triggerPlane: this.triggerPlane,
      metricsElements: {
        camera: document.getElementById('debugMetricCamera'),
        fps: document.getElementById('debugMetricFps'),
        latency: document.getElementById('debugMetricLatency'),
        components: document.getElementById('debugMetricComponents'),
        foreground: document.getElementById('debugMetricForeground'),
        light: document.getElementById('debugMetricLight'),
        calibration: document.getElementById('debugMetricCalibration'),
      },
    });
    this.recognitionMonitor = new RecognitionMonitor({
      panel: document.getElementById('controlPanel'),
      canvas: document.getElementById('recognitionCanvas'),
      health: document.getElementById('recognitionHealth'),
      people: document.getElementById('recognitionPeople'),
      foreground: document.getElementById('recognitionForeground'),
      active: document.getElementById('recognitionActive'),
      audio: document.getElementById('recognitionAudio'),
      hint: document.getElementById('recognitionHint'),
    });

    this.ready = false;
    this.entered = false;
    this.debugOpen = false;
    this.uiHidden = false;
    this.lastNow = performance.now();
    this.lastInputSnapshot = this.input.snapshot();
    this.lastRenderSnapshot = null;
    this.lastMessage = '';
    this.lastMessageLevel = 'info';
    this.fps = 0;
    this.fpsFrames = 0;
    this.fpsClock = performance.now();
    this.raf = 0;
    this.externalErrors = [];
    this.triggerPartition = this.triggerPlane.verifyPartition();
    this.assetLoadResult = null;
    this.backgroundCaptureToken = 0;
    this.backgroundCountdown = 0;

    this.#bindUi();
    this.#bindControllers();
    this.ui.setPresets(this.calibration.snapshot());
  }

  async init() {
    this.ui.message('正在加载原创画像石素材…', 'info');
    this.assetLoadResult = await this.characterRenderer.load();
    if (this.assetLoadResult.errors.length) {
      this.ui.message(`有 ${this.assetLoadResult.errors.length} 个素材加载失败；作品会继续运行。`, 'warning');
    } else {
      this.ui.message(`63 个视觉节点、${this.sceneConfig.assetStats.distinctBaseSilhouetteCount} 个基础源与 ${this.assetLoadResult.loaded} 个运行时素材已就绪。`, 'success');
    }
    this.ready = true;
    this.raf = requestAnimationFrame((now) => this.#loop(now));
    document.dispatchEvent(new CustomEvent('han-ready', { detail: this.getState() }));
    return this;
  }

  async enter() {
    this.entered = true;
    this.ui.setEntered(true);
    const result = await this.audio.init();
    if (result.errors.length) this.ui.message(`画面已运行；${result.errors.join(' ')}`, 'warning');
    else this.ui.message('作品已运行。可隐藏操作界面后全屏投影。', 'success');
    return true;
  }

  #bindControllers() {
    this.configStore.addEventListener('warning', (event) => this.ui.message(event.detail, 'warning'));
    this.input.addEventListener('message', (event) => this.#message(event.detail.message, event.detail.level));
    this.input.addEventListener('camerastate', (event) => {
      if (event.detail.message) this.#message(event.detail.message, event.detail.state === 'error' ? 'error' : 'warning');
    });
    this.calibration.addEventListener('invalid', (event) => this.#message(`无效标定已拒绝：${event.detail.errors.join(' ')}`, 'error'));
    this.calibration.addEventListener('presetschange', () => this.ui.setPresets(this.calibration.snapshot()));
    this.audio.addEventListener('ready', (event) => {
      if (event.detail.errors.length) this.#message(event.detail.errors.join(' '), 'warning');
    });
    window.addEventListener('unhandledrejection', (event) => {
      this.externalErrors.push(`unhandledrejection: ${String(event.reason)}`);
    });
    window.addEventListener('error', (event) => {
      this.externalErrors.push(`error: ${event.message}`);
    });
  }

  #bindUi() {
    this.ui.addEventListener('enter', () => this.enter());
    this.ui.addEventListener('mode', (event) => this.setMode(event.detail.mode));
    this.ui.addEventListener('camera-source', async (event) => {
      this.settings.cameraSource = event.detail.source;
      await this.input.setCameraSource(event.detail.source);
      this.#persistSettings();
      this.ui.applySettings(this.settings);
    });
    this.ui.addEventListener('camera-start', async () => {
      this.setMode('camera');
      const ok = await this.input.ensureCameraStarted();
      if (!ok) {
        this.#message(this.input.cameraMessage || '摄像头启动失败。', 'error');
        return;
      }
      if (this.input.cameraSource === 'simulated' && !this.lastInputSnapshot.backgroundReady) {
        this.#message('模拟摄像头已启动，即将自动采集测试空场。', 'success');
        await this.captureBackgroundFromUi();
      } else {
        this.#message('摄像头与离线人物模型均已启动，只检测 person 类别。', 'success');
      }
    });
    this.ui.addEventListener('capture-background', () => { void this.captureBackgroundFromUi(); });
    this.ui.addEventListener('debug', (event) => this.setDebugOpen(event.detail.open));
    this.ui.addEventListener('fullscreen', () => this.toggleFullscreen());
    this.ui.addEventListener('simulation-scenario', (event) => {
      this.input.setSimulatedScenario(event.detail.scenario);
      this.#message(`模拟摄像头场景：${event.detail.scenario}`, 'info');
    });
    this.ui.addEventListener('simulation-disconnect', () => {
      if (!this.input.simulateDisconnect()) this.#message('请先选择内置模拟摄像头。', 'warning');
    });
    this.ui.addEventListener('setting', (event) => {
      if (event.detail.key === 'muted') void this.setMuted(event.detail.value);
      else this.setSetting(event.detail.key, event.detail.value);
    });
    this.ui.addEventListener('toggle-mute', () => { void this.setMuted(!this.settings.muted); });
    this.ui.addEventListener('test-audio', async () => {
      this.setSetting('muted', false);
      const ok = await this.audio.testTone();
      this.#message(ok ? '测试音已播放；若仍听不到，请检查系统输出设备与标签页声音权限。' : '测试音播放失败；请再次点击，或检查浏览器音频权限。', ok ? 'success' : 'error');
    });
    this.ui.addEventListener('preset-select', (event) => {
      const result = this.calibration.selectPreset(event.detail.name);
      this.#message(result.message, result.ok ? 'success' : 'error');
      this.ui.setPresets(this.calibration.snapshot());
    });
    this.ui.addEventListener('preset-save', (event) => {
      const result = this.calibration.savePreset(event.detail.name);
      this.#message(result.message, result.ok ? 'success' : 'error');
      this.ui.setPresets(this.calibration.snapshot());
    });
    this.ui.addEventListener('calibration-reset', () => {
      const result = this.calibration.reset();
      this.#message(result.valid ? '四角标定已重置。' : result.errors.join(' '), result.valid ? 'success' : 'error');
      this.ui.setPresets(this.calibration.snapshot());
    });
    this.ui.addEventListener('calibration-export', () => {
      this.ui.downloadJson(`han-orchestra-calibration-${Date.now()}.json`, this.calibration.exportJson());
      this.#message('标定预设已导出。', 'success');
    });
    this.ui.addEventListener('calibration-import', (event) => {
      const result = this.calibration.importJson(event.detail.text);
      this.#message(result.valid ? '标定预设已导入。' : result.errors.join(' '), result.valid ? 'success' : 'error');
      this.ui.setPresets(this.calibration.snapshot());
    });
    this.ui.addEventListener('wake-all', () => this.hysteresis.forceWake(6500));
    this.ui.addEventListener('recover', async () => {
      const cameraOk = await this.input.recover();
      const audioOk = await this.audio.recover();
      this.#message(`恢复完成：摄像头 ${cameraOk ? '已恢复' : '需检查'}，音频 ${audioOk ? '已恢复' : '需交互后恢复'}。`, cameraOk ? 'success' : 'warning');
    });
    this.ui.addEventListener('reset-settings', () => this.resetSettings());
    this.ui.addEventListener('toggle-ui', () => this.toggleUi());

    document.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const key = event.key.toLowerCase();
      if (key === 'h') this.toggleUi();
      else if (key === 'd') this.setDebugOpen(!this.debugOpen);
      else if (key === 'f') this.toggleFullscreen();
      else if (key === 'm') void this.setMuted(!this.settings.muted);
      else if (key === 'a') this.hysteresis.forceWake(6500);
      else if (event.code === 'Space') {
        event.preventDefault();
        this.setSetting('autoPaused', !this.settings.autoPaused);
      }
    });
  }

  setMode(mode) {
    this.input.setMode(mode);
    this.hysteresis.reset();
    this.settings.mode = mode;
    this.#persistSettings();
    this.ui.applySettings(this.settings);
    this.#message(`触发来源已切换为${modeLabel(mode)}。`, 'info');
  }

  setSetting(key, value) {
    const result = validateSettings({ ...this.settings, [key]: value });
    this.settings = result.settings;
    this.input.configure(this.settings);
    this.hysteresis.configure({
      onThreshold: this.settings.onThreshold,
      offThreshold: this.settings.offThreshold,
      onFrames: this.settings.onFrames,
      offFrames: this.settings.offFrames,
    });
    this.audio.setMuted(this.settings.muted);
    this.#persistSettings();
    this.ui.applySettings(this.settings);
    if (result.errors.length) this.#message(result.errors.join(' '), 'warning');
  }

  async setMuted(muted) {
    this.setSetting('muted', Boolean(muted));
    if (this.settings.muted) {
      this.#message('声音已关闭。', 'info');
      return true;
    }
    const resumed = await this.audio.recover();
    this.#message(resumed ? '声音已开启。' : '声音仍被浏览器暂停，请再次点击声音按钮。', resumed ? 'success' : 'warning');
    return resumed;
  }

  async captureBackgroundFromUi(countdownSeconds = 6) {
    const token = ++this.backgroundCaptureToken;
    this.setMode('camera');
    const started = await this.input.ensureCameraStarted();
    if (!started || token !== this.backgroundCaptureToken) {
      this.#message(this.input.cameraMessage || '摄像头未就绪，无法采集空场背景。', 'error');
      return false;
    }
    if (this.input.cameraSource === 'hardware') {
      this.backgroundCountdown = 0;
      this.ui.setCaptureCountdown(null);
      this.#message('实体摄像头已使用人物模型，无需采集空场背景。', 'success');
      return true;
    }
    for (let remaining = Math.max(3, Math.round(countdownSeconds)); remaining > 0; remaining -= 1) {
      this.backgroundCountdown = remaining;
      this.ui.setCaptureCountdown(remaining);
      this.#message(`${remaining} 秒后采集空场背景，请离开摄像头画面。`, 'warning');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (token !== this.backgroundCaptureToken) {
        this.backgroundCountdown = 0;
        this.ui.setCaptureCountdown(null);
        return false;
      }
    }
    this.backgroundCountdown = 0;
    this.ui.setCaptureCountdown(null);
    const ok = await this.input.captureBackground(18);
    this.#persistSettings();
    if (!ok) this.#message(this.input.cameraMessage || '无法采集空场背景。', 'error');
    return ok;
  }

  resetSettings() {
    this.settings = this.configStore.resetSettings();
    this.input.setMode(this.settings.mode);
    this.input.setCameraSource(this.settings.cameraSource);
    this.input.configure(this.settings);
    this.hysteresis.configure({
      onThreshold: this.settings.onThreshold,
      offThreshold: this.settings.offThreshold,
      onFrames: this.settings.onFrames,
      offFrames: this.settings.offFrames,
    });
    this.audio.setMuted(this.settings.muted);
    this.ui.applySettings(this.settings);
    this.#message('运行设置已恢复默认值；标定预设未删除。', 'success');
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch (error) {
      this.#message(`全屏失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  toggleUi(force) {
    this.uiHidden = typeof force === 'boolean' ? force : !this.uiHidden;
    this.ui.setUiHidden(this.uiHidden);
  }

  setDebugOpen(open) {
    this.debugOpen = Boolean(open);
    this.ui.setDebugOpen(this.debugOpen);
    if (this.debugOpen) this.uiHidden = false;
    this.ui.setUiHidden(this.uiHidden);
  }

  #persistSettings() {
    this.configStore.saveSettings(this.settings);
  }

  #message(text, level = 'info') {
    this.lastMessage = text;
    this.lastMessageLevel = level;
    this.ui.message(text, level);
  }

  #loop(now) {
    const dt = Math.min(0.25, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.lastInputSnapshot = this.input.update(now, dt);
    const trigger = this.hysteresis.update(this.lastInputSnapshot.coverages, dt, now);
    this.lastRenderSnapshot = this.sceneRenderer.render(now, trigger.visual, {
      showGrid: this.settings.showGrid,
      showLabels: this.settings.showLabels,
      coverages: this.lastInputSnapshot.coverages,
    });
    this.audio.update(trigger.visual);

    this.fpsFrames += 1;
    if (now - this.fpsClock >= 500) {
      this.fps = this.fpsFrames * 1000 / (now - this.fpsClock);
      this.fpsFrames = 0;
      this.fpsClock = now;
    }
    this.ui.updateStatus({
      mode: this.input.mode,
      activeCount: trigger.activeCount,
      fps: this.fps,
      camera: this.lastInputSnapshot.camera,
      backgroundReady: this.lastInputSnapshot.backgroundReady,
      captureProgress: this.lastInputSnapshot.captureProgress,
      backgroundCountdown: this.backgroundCountdown,
      detector: this.lastInputSnapshot.detector,
    });
    this.recognitionMonitor.update(this.lastInputSnapshot, {
      mode: this.input.mode,
      activeCount: trigger.activeCount,
      audio: this.audio.snapshot(),
      now,
      backgroundCountdown: this.backgroundCountdown,
    });
    if (this.debugOpen) this.calibrationView.update(this.lastInputSnapshot, { fps: this.fps });
    this.raf = requestAnimationFrame((next) => this.#loop(next));
  }

  getState() {
    const activeIds = [];
    for (let index = 0; index < this.hysteresis.active.length; index += 1) if (this.hysteresis.active[index]) activeIds.push(index);
    return {
      version: APP_VERSION,
      baseline: BASELINE,
      ready: this.ready,
      entered: this.entered,
      configVersion: this.sceneConfig.version,
      sceneNodeCount: this.sceneConfig.nodes.length,
      distinctSpriteFiles: new Set(this.sceneConfig.nodes.map((node) => node.sprite)).size,
      assetStats: structuredClone(this.sceneConfig.assetStats),
      sceneStructure: this.decorativeRenderer.structureSnapshot(),
      loadedSpriteFiles: this.characterRenderer.assets.size,
      assetErrors: [...this.characterRenderer.loadErrors],
      mode: this.input.mode,
      camera: this.lastInputSnapshot.camera,
      backgroundReady: this.lastInputSnapshot.backgroundReady,
      capturingBackground: this.lastInputSnapshot.capturingBackground,
      captureProgress: this.lastInputSnapshot.captureProgress,
      componentCount: this.lastInputSnapshot.segmentation?.components?.length || 0,
      recognitionMode: this.lastInputSnapshot.recognitionMode,
      detector: structuredClone(this.lastInputSnapshot.detector),
      processingMs: this.lastInputSnapshot.segmentation?.metrics?.processingMs || 0,
      foregroundPixels: this.lastInputSnapshot.segmentation?.metrics?.foregroundPixels || 0,
      coverages: [...this.lastInputSnapshot.coverages],
      positiveCoverageCount: [...this.lastInputSnapshot.coverages].filter((value) => value > 0.001).length,
      pointerCount: this.lastInputSnapshot.pointerCount || 0,
      pointerTargetIds: [...(this.lastInputSnapshot.pointerTargetIds || [])],
      activeCount: activeIds.length,
      activeIds,
      visual: [...this.hysteresis.visual],
      fps: this.fps,
      viewport: this.viewport.snapshot(),
      orientation: this.lastRenderSnapshot?.metrics?.orientation || this.viewport.orientation,
      rendererDrawn: this.lastRenderSnapshot?.drawn || 0,
      calibration: this.calibration.snapshot(),
      coverageMapping: this.input.coverageEngine.snapshot(),
      triggerPartition: this.triggerPartition,
      audio: this.audio.snapshot(),
      debugOpen: this.debugOpen,
      uiHidden: this.uiHidden,
      lastMessage: this.lastMessage,
      lastMessageLevel: this.lastMessageLevel,
      runtimeErrors: [...this.externalErrors],
      memory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
      } : null,
    };
  }

  exposeTestApi() {
    const app = this;
    window.__HAN_TEST_API__ = {
      getState: () => app.getState(),
      enter: () => app.enter(),
      setMode: (mode) => app.setMode(mode),
      setCameraSource: async (source) => {
        app.settings.cameraSource = source;
        const result = await app.input.setCameraSource(source);
        app.#persistSettings();
        app.ui.applySettings(app.settings);
        return result;
      },
      startCamera: () => app.input.ensureCameraStarted(),
      initializePersonDetector: () => app.input.personDetector.initialize(),
      captureBackground: (frames = 18) => app.input.captureBackground(frames),
      setSimulatedScenario: (scenario) => app.input.setSimulatedScenario(scenario),
      simulateDisconnect: () => app.input.simulateDisconnect(),
      wakeAll: (duration = 6500) => app.hysteresis.forceWake(duration),
      resetTriggers: () => app.hysteresis.reset(),
      setCalibration: (quad) => app.calibration.trySetQuad(quad),
      resetCalibration: () => app.calibration.reset(),
      setSetting: (key, value) => app.setSetting(key, value),
      setDebug: (open) => app.setDebugOpen(open),
      toggleUi: (hidden) => app.toggleUi(hidden),
      stop: () => { cancelAnimationFrame(app.raf); app.input.stop(); },
    };
  }
}

async function bootstrap() {
  const introCopy = document.querySelector('.intro-copy');
  try {
    const [sceneRaw, texture] = await Promise.all([
      loadJson('config/scene.json'),
      loadImage('assets/background/mural-texture.jpg'),
    ]);
    const validation = validateSceneConfig(sceneRaw);
    if (!validation.valid) throw new Error(`场景配置无效：${validation.errors.join(' ')}`);
    const app = new HanOrchestraApp(validation.config, texture);
    app.exposeTestApi();
    await app.init();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (introCopy) introCopy.textContent = `作品初始化失败：${message}`;
    const button = document.getElementById('enterButton');
    if (button) {
      button.textContent = '初始化失败';
      button.disabled = true;
    }
    window.__HAN_BOOT_ERROR__ = message;
  }
}

bootstrap();
