import { applyHomography } from '../core/homography.js';

const MODE_LABELS = { auto: '自动演示', pointer: '鼠标模式', camera: '人脸模式' };

const byId = (id) => document.getElementById(id);

export class OperatorUI extends EventTarget {
  constructor() {
    super();
    this.dom = {
      intro: byId('intro'), enterButton: byId('enterButton'), topBar: byId('topBar'),
      controlPanel: byId('controlPanel'), openPanel: byId('openPanel'), closePanel: byId('closePanel'),
      pointerModeButton: byId('pointerModeButton'), faceModeButton: byId('faceModeButton'),
      modeSelect: byId('modeSelect'), cameraSourceSelect: byId('cameraSourceSelect'), cameraButton: byId('cameraButton'),
      captureBackgroundButton: byId('captureBackgroundButton'), debugButton: byId('debugButton'), fullscreenButton: byId('fullscreenButton'), testAudioButton: byId('testAudioButton'),
      simulationControls: byId('simulationControls'), simulationScenarioSelect: byId('simulationScenarioSelect'), simulateDisconnectButton: byId('simulateDisconnectButton'),
      animationSpeed: byId('animationSpeed'), animationSpeedOutput: byId('animationSpeedOutput'),
      diffThreshold: byId('diffThreshold'), diffThresholdOutput: byId('diffThresholdOutput'),
      onThreshold: byId('onThreshold'), onThresholdOutput: byId('onThresholdOutput'), offThreshold: byId('offThreshold'), offThresholdOutput: byId('offThresholdOutput'),
      mirrorToggle: byId('mirrorToggle'), gridToggle: byId('gridToggle'), labelsToggle: byId('labelsToggle'), grayscaleToggle: byId('grayscaleToggle'), monitorFloatingToggle: byId('monitorFloatingToggle'), muteToggle: byId('muteToggle'),
      recognitionMonitor: byId('recognitionMonitor'), recognitionMonitorSlot: byId('recognitionMonitorSlot'), recognitionMonitorDock: byId('recognitionMonitorDock'),
      presetSelect: byId('presetSelect'), presetNameInput: byId('presetNameInput'), savePresetButton: byId('savePresetButton'),
      resetCalibrationButton: byId('resetCalibrationButton'), exportCalibrationButton: byId('exportCalibrationButton'), importCalibrationButton: byId('importCalibrationButton'), importCalibrationInput: byId('importCalibrationInput'),
      wakeAllButton: byId('wakeAllButton'), recoverButton: byId('recoverButton'), resetButton: byId('resetButton'), hideUiButton: byId('hideUiButton'),
      panelMessage: byId('panelMessage'), modeStatus: byId('modeStatus'), cameraStatus: byId('cameraStatus'), activeStatus: byId('activeStatus'), fpsStatus: byId('fpsStatus'),
      debugView: byId('debugView'), closeDebug: byId('closeDebug'), debugCaptureButton: byId('debugCaptureButton'), debugResetCalibrationButton: byId('debugResetCalibrationButton'), audioButton: byId('audioButton'),
    };
    this.monitorDrag = null;
    this.monitorResize = null;
    this.monitorPreferredWidth = 360;
    this.monitorAvoidArmed = true;
    this.monitorLastCollisionAt = -Infinity;
    this.monitorMoveTimer = null;
    this.#bind();
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #bind() {
    const d = this.dom;
    d.enterButton.addEventListener('click', () => this.#emit('enter'));
    d.openPanel.addEventListener('click', () => { d.controlPanel.hidden = false; });
    d.closePanel.addEventListener('click', () => { d.controlPanel.hidden = true; });
    d.pointerModeButton.addEventListener('click', () => this.#emit('input-mode', { mode: 'pointer' }));
    d.faceModeButton.addEventListener('click', () => this.#emit('input-mode', { mode: 'face' }));
    d.modeSelect.addEventListener('change', () => this.#emit('mode', { mode: d.modeSelect.value }));
    d.cameraSourceSelect.addEventListener('change', () => this.#emit('camera-source', { source: d.cameraSourceSelect.value }));
    d.cameraButton.addEventListener('click', () => this.#emit('camera-start'));
    d.captureBackgroundButton.addEventListener('click', () => this.#emit('capture-background'));
    d.debugButton.addEventListener('click', () => this.#emit('debug', { open: true }));
    d.closeDebug.addEventListener('click', () => this.#emit('debug', { open: false }));
    d.fullscreenButton.addEventListener('click', () => this.#emit('fullscreen'));
    d.testAudioButton.addEventListener('click', () => this.#emit('test-audio'));
    d.simulationScenarioSelect.addEventListener('change', () => this.#emit('simulation-scenario', { scenario: d.simulationScenarioSelect.value }));
    d.simulateDisconnectButton.addEventListener('click', () => this.#emit('simulation-disconnect'));
    d.animationSpeed.addEventListener('input', () => this.#emit('setting', { key: 'animationSpeed', value: Number(d.animationSpeed.value) }));
    d.diffThreshold.addEventListener('input', () => this.#emit('setting', { key: 'diffThreshold', value: Number(d.diffThreshold.value) }));
    d.onThreshold.addEventListener('input', () => this.#emit('setting', { key: 'onThreshold', value: Number(d.onThreshold.value) / 100 }));
    d.offThreshold.addEventListener('input', () => this.#emit('setting', { key: 'offThreshold', value: Number(d.offThreshold.value) / 100 }));
    d.mirrorToggle.addEventListener('change', () => this.#emit('setting', { key: 'mirror', value: d.mirrorToggle.checked }));
    d.gridToggle.addEventListener('change', () => this.#emit('setting', { key: 'showGrid', value: d.gridToggle.checked }));
    d.labelsToggle.addEventListener('change', () => this.#emit('setting', { key: 'showLabels', value: d.labelsToggle.checked }));
    d.grayscaleToggle.addEventListener('change', () => this.#emit('setting', { key: 'grayscaleEnabled', value: d.grayscaleToggle.checked }));
    d.monitorFloatingToggle.addEventListener('change', () => {
      this.#emit('setting', { key: 'monitorFloating', value: d.monitorFloatingToggle.checked });
      if (d.monitorFloatingToggle.checked) d.controlPanel.hidden = true;
    });
    d.muteToggle.addEventListener('change', () => this.#emit('setting', { key: 'muted', value: d.muteToggle.checked }));
    d.audioButton.addEventListener('click', () => this.#emit('toggle-mute'));
    d.presetSelect.addEventListener('change', () => this.#emit('preset-select', { name: d.presetSelect.value }));
    d.savePresetButton.addEventListener('click', () => this.#emit('preset-save', { name: d.presetNameInput.value }));
    d.resetCalibrationButton.addEventListener('click', () => this.#emit('calibration-reset'));
    d.debugResetCalibrationButton.addEventListener('click', () => this.#emit('calibration-reset'));
    d.exportCalibrationButton.addEventListener('click', () => this.#emit('calibration-export'));
    d.importCalibrationButton.addEventListener('click', () => d.importCalibrationInput.click());
    d.importCalibrationInput.addEventListener('change', async () => {
      const file = d.importCalibrationInput.files?.[0];
      if (!file) return;
      this.#emit('calibration-import', { text: await file.text() });
      d.importCalibrationInput.value = '';
    });
    d.wakeAllButton.addEventListener('click', () => this.#emit('wake-all'));
    d.recoverButton.addEventListener('click', () => this.#emit('recover'));
    d.resetButton.addEventListener('click', () => this.#emit('reset-settings'));
    d.hideUiButton.addEventListener('click', () => this.#emit('toggle-ui'));
    d.debugCaptureButton.addEventListener('click', () => this.#emit('capture-background'));
    this.#bindMonitorDrag();
    this.#bindMonitorResize();
    window.addEventListener('resize', () => {
      if (this.monitorResize) return;
      this.#applyMonitorWidth(this.monitorPreferredWidth);
      this.#keepMonitorInViewport();
    });
  }

  #bindMonitorDrag() {
    const d = this.dom;
    const handle = d.recognitionMonitor.querySelector('.recognition-head');
    if (!handle) return;
    handle.title = '拖动标题移动，拖动边缘缩放';
    handle.addEventListener('pointerdown', (event) => {
      if (d.recognitionMonitorDock.hidden || event.button !== 0) return;
      const rect = d.recognitionMonitorDock.getBoundingClientRect();
      d.recognitionMonitorDock.style.right = 'auto';
      d.recognitionMonitorDock.style.left = `${rect.left}px`;
      d.recognitionMonitorDock.style.top = `${rect.top}px`;
      d.recognitionMonitorDock.classList.remove('is-relocating');
      d.recognitionMonitorDock.classList.add('is-dragging');
      this.monitorDrag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
      if (!this.monitorDrag || this.monitorDrag.pointerId !== event.pointerId) return;
      const dock = d.recognitionMonitorDock;
      const margin = 8;
      const maxLeft = Math.max(margin, window.innerWidth - dock.offsetWidth - margin);
      const maxTop = Math.max(margin, window.innerHeight - dock.offsetHeight - margin);
      const left = Math.min(maxLeft, Math.max(margin, event.clientX - this.monitorDrag.offsetX));
      const top = Math.min(maxTop, Math.max(margin, event.clientY - this.monitorDrag.offsetY));
      dock.style.left = `${left}px`;
      dock.style.top = `${top}px`;
      event.preventDefault();
    });
    const finishDrag = (event) => {
      if (!this.monitorDrag || this.monitorDrag.pointerId !== event.pointerId) return;
      this.monitorDrag = null;
      d.recognitionMonitorDock.classList.remove('is-dragging');
      this.monitorAvoidArmed = false;
      this.monitorLastCollisionAt = performance.now();
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
  }

  #bindMonitorResize() {
    const dock = this.dom.recognitionMonitorDock;
    for (const handle of dock.querySelectorAll('[data-resize]')) {
      handle.title = '拖动缩放人物监视器';
      handle.addEventListener('pointerdown', (event) => {
        if (dock.hidden || event.button !== 0) return;
        const rect = dock.getBoundingClientRect();
        const direction = handle.dataset.resize;
        dock.style.right = 'auto';
        dock.style.left = `${rect.left}px`;
        dock.style.top = `${rect.top}px`;
        dock.classList.remove('is-relocating');
        dock.classList.add('is-resizing');
        this.monitorResize = {
          pointerId: event.pointerId,
          direction,
          startX: event.clientX,
          startY: event.clientY,
          startWidth: rect.width,
          startHeight: rect.height,
          startLeft: rect.left,
          startTop: rect.top,
          startRight: rect.right,
          startBottom: rect.bottom,
        };
        handle.setPointerCapture(event.pointerId);
        event.stopPropagation();
        event.preventDefault();
      });

      handle.addEventListener('pointermove', (event) => {
        const state = this.monitorResize;
        if (!state || state.pointerId !== event.pointerId) return;
        const horizontalDelta = state.direction.includes('e')
          ? event.clientX - state.startX
          : state.direction.includes('w') ? state.startX - event.clientX : null;
        const widthPerHeight = state.startWidth / Math.max(1, state.startHeight);
        const verticalDelta = state.direction.includes('s')
          ? (event.clientY - state.startY) * widthPerHeight
          : state.direction.includes('n') ? (state.startY - event.clientY) * widthPerHeight : null;
        const candidates = [horizontalDelta, verticalDelta].filter(Number.isFinite);
        const delta = candidates.reduce((strongest, value) => (
          Math.abs(value) > Math.abs(strongest) ? value : strongest
        ), candidates[0] || 0);
        const width = this.#clampMonitorWidth(state.startWidth + delta);
        dock.style.width = `${width}px`;

        const resized = dock.getBoundingClientRect();
        if (state.direction.includes('w')) dock.style.left = `${state.startRight - resized.width}px`;
        if (state.direction.includes('n')) dock.style.top = `${state.startBottom - resized.height}px`;
        this.#keepMonitorInViewport();
        event.stopPropagation();
        event.preventDefault();
      });

      const finishResize = (event) => {
        if (!this.monitorResize || this.monitorResize.pointerId !== event.pointerId) return;
        this.monitorResize = null;
        dock.classList.remove('is-resizing');
        this.monitorPreferredWidth = Math.round(dock.getBoundingClientRect().width);
        this.monitorAvoidArmed = false;
        this.monitorLastCollisionAt = performance.now();
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        this.#emit('setting', { key: 'monitorWidth', value: this.monitorPreferredWidth });
      };
      handle.addEventListener('pointerup', finishResize);
      handle.addEventListener('pointercancel', finishResize);
    }
  }

  #clampMonitorWidth(width) {
    const viewportMaximum = Math.max(160, window.innerWidth - 16);
    const maximum = Math.min(720, viewportMaximum);
    const minimum = Math.min(220, maximum);
    return Math.round(Math.min(maximum, Math.max(minimum, Number(width) || 360)));
  }

  #applyMonitorWidth(width) {
    this.monitorPreferredWidth = Math.round(Number(width) || 360);
    this.dom.recognitionMonitorDock.style.width = `${this.#clampMonitorWidth(this.monitorPreferredWidth)}px`;
  }

  #keepMonitorInViewport() {
    const dock = this.dom.recognitionMonitorDock;
    if (dock.hidden || !dock.style.left) return;
    const rect = dock.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - rect.width - margin));
    const top = Math.min(Math.max(margin, rect.top), Math.max(margin, window.innerHeight - rect.height - margin));
    dock.style.left = `${left}px`;
    dock.style.top = `${top}px`;
  }

  applySettings(settings) {
    const d = this.dom;
    d.modeSelect.value = settings.mode;
    d.cameraSourceSelect.value = settings.cameraSource;
    const pointerActive = settings.mode === 'pointer';
    const faceActive = settings.mode === 'camera' && settings.cameraSource === 'hardware';
    d.pointerModeButton.classList.toggle('is-active', pointerActive);
    d.faceModeButton.classList.toggle('is-active', faceActive);
    d.pointerModeButton.setAttribute('aria-pressed', String(pointerActive));
    d.faceModeButton.setAttribute('aria-pressed', String(faceActive));
    d.animationSpeed.value = String(settings.animationSpeed);
    d.diffThreshold.value = String(settings.diffThreshold);
    d.onThreshold.value = String(settings.onThreshold * 100);
    d.offThreshold.value = String(settings.offThreshold * 100);
    d.mirrorToggle.checked = settings.mirror;
    d.gridToggle.checked = settings.showGrid;
    d.labelsToggle.checked = settings.showLabels;
    d.grayscaleToggle.checked = settings.grayscaleEnabled;
    d.monitorFloatingToggle.checked = settings.monitorFloating;
    d.muteToggle.checked = settings.muted;
    this.#applyMonitorWidth(settings.monitorWidth);
    this.#setMonitorFloating(settings.monitorFloating);
    d.audioButton.textContent = settings.muted ? '静' : '声';
    d.audioButton.title = settings.muted ? '声音已关闭，点击开启' : '声音已开启，点击静音';
    d.audioButton.setAttribute('aria-label', d.audioButton.title);
    d.audioButton.setAttribute('aria-pressed', String(!settings.muted));
    this.#updateOutputs(settings);
    d.simulationControls.hidden = settings.cameraSource !== 'simulated';
  }

  #setMonitorFloating(floating) {
    const d = this.dom;
    if (floating) {
      d.recognitionMonitorDock.hidden = false;
      if (d.recognitionMonitor.parentElement !== d.recognitionMonitorDock) d.recognitionMonitorDock.append(d.recognitionMonitor);
    } else {
      if (d.recognitionMonitor.parentElement !== d.recognitionMonitorSlot) d.recognitionMonitorSlot.append(d.recognitionMonitor);
      d.recognitionMonitorDock.hidden = true;
    }
    document.body.classList.toggle('monitor-floating', Boolean(floating));
  }

  updateMonitorAvoidance(snapshot, { mode, cameraToPlane, now = performance.now() } = {}) {
    const dock = this.dom.recognitionMonitorDock;
    if (dock.hidden || this.monitorDrag || this.monitorResize || mode !== 'camera'
      || !Array.isArray(cameraToPlane) || cameraToPlane.length !== 9) return;
    const segmentation = snapshot?.segmentation;
    if (!segmentation?.width || !segmentation?.height || !Array.isArray(segmentation.components)) return;

    const personRects = segmentation.components.map((component) => {
      const x0 = component.x / segmentation.width;
      const y0 = component.y / segmentation.height;
      const x1 = (component.x + component.w) / segmentation.width;
      const y1 = (component.y + component.h) / segmentation.height;
      const points = [
        applyHomography(cameraToPlane, { x: x0, y: y0 }),
        applyHomography(cameraToPlane, { x: x1, y: y0 }),
        applyHomography(cameraToPlane, { x: x1, y: y1 }),
        applyHomography(cameraToPlane, { x: x0, y: y1 }),
      ].filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (!points.length) return null;
      const xs = points.map((point) => point.x * window.innerWidth);
      const ys = points.map((point) => point.y * window.innerHeight);
      return {
        left: Math.min(...xs), right: Math.max(...xs),
        top: Math.min(...ys), bottom: Math.max(...ys),
      };
    }).filter(Boolean);

    const dockRect = dock.getBoundingClientRect();
    const padding = 10;
    const colliding = personRects.some((person) => person.right >= dockRect.left - padding
      && person.left <= dockRect.right + padding
      && person.bottom >= dockRect.top - padding
      && person.top <= dockRect.bottom + padding);
    if (!colliding) {
      if (now - this.monitorLastCollisionAt > 520) this.monitorAvoidArmed = true;
      return;
    }
    this.monitorLastCollisionAt = now;
    if (!this.monitorAvoidArmed) return;
    this.monitorAvoidArmed = false;
    this.#moveMonitorToOtherSide(personRects);
  }

  #moveMonitorToOtherSide(personRects) {
    const dock = this.dom.recognitionMonitorDock;
    const current = dock.getBoundingClientRect();
    const margin = 14;
    const leftEdge = margin;
    const rightEdge = Math.max(margin, window.innerWidth - current.width - margin);
    const targetLeft = current.left + current.width / 2 >= window.innerWidth / 2 ? leftEdge : rightEdge;
    const maxTop = Math.max(margin, window.innerHeight - current.height - margin);
    const topCandidates = [
      Math.min(maxTop, Math.max(margin, current.top)),
      margin,
      maxTop,
    ];
    const overlapArea = (top) => {
      const candidate = { left: targetLeft, right: targetLeft + current.width, top, bottom: top + current.height };
      return personRects.reduce((sum, person) => {
        const width = Math.max(0, Math.min(candidate.right, person.right) - Math.max(candidate.left, person.left));
        const height = Math.max(0, Math.min(candidate.bottom, person.bottom) - Math.max(candidate.top, person.top));
        return sum + width * height;
      }, 0);
    };
    const targetTop = topCandidates.sort((a, b) => overlapArea(a) - overlapArea(b))[0];

    dock.style.right = 'auto';
    dock.style.left = `${current.left}px`;
    dock.style.top = `${current.top}px`;
    void dock.offsetWidth;
    dock.classList.add('is-relocating');
    dock.style.left = `${targetLeft}px`;
    dock.style.top = `${targetTop}px`;
    clearTimeout(this.monitorMoveTimer);
    this.monitorMoveTimer = setTimeout(() => dock.classList.remove('is-relocating'), 680);
  }

  #updateOutputs(settings) {
    this.dom.animationSpeedOutput.value = `${settings.animationSpeed.toFixed(2)}×`;
    this.dom.diffThresholdOutput.value = String(Math.round(settings.diffThreshold));
    this.dom.onThresholdOutput.value = `${(settings.onThreshold * 100).toFixed(1)}%`;
    this.dom.offThresholdOutput.value = `${(settings.offThreshold * 100).toFixed(1)}%`;
  }

  updateStatus({ mode, activeCount, fps, camera, backgroundReady, captureProgress, backgroundCountdown = 0, detector }) {
    this.dom.modeStatus.textContent = MODE_LABELS[mode] || mode;
    const capture = captureProgress > 0 && captureProgress < 1 ? ` / 空场 ${Math.round(captureProgress * 100)}%` : '';
    const readyLabel = camera.source === 'hardware'
      ? (detector?.ready ? ` / 人物模型 ${detector.delegate}` : '')
      : (backgroundReady ? ' / 模拟背景就绪' : '');
    this.dom.cameraStatus.textContent = `摄像头：${camera.source}/${camera.state}${readyLabel}${capture}`;
    this.dom.activeStatus.textContent = `${activeCount} / 63`;
    this.dom.fpsStatus.textContent = `${Number(fps || 0).toFixed(0)} FPS`;
    this.dom.cameraButton.textContent = camera.transportState === 'live' ? '摄像头已启动' : camera.state === 'requesting' ? '正在请求权限…' : '启动摄像头';
    const faceRequesting = camera.source === 'hardware' && camera.state === 'requesting';
    this.dom.faceModeButton.classList.toggle('is-requesting', faceRequesting);
    this.dom.faceModeButton.setAttribute('aria-busy', String(faceRequesting));
    if (camera.source === 'hardware') {
      this.dom.captureBackgroundButton.textContent = detector?.state === 'error' ? '重试人物模型' : detector?.ready ? '人物模型已启用' : '加载人物模型';
      this.dom.captureBackgroundButton.disabled = Boolean(detector?.ready || detector?.state === 'loading');
    } else {
      this.dom.captureBackgroundButton.disabled = backgroundCountdown > 0;
      this.dom.captureBackgroundButton.textContent = backgroundCountdown > 0
        ? `${backgroundCountdown} 秒后采集…`
        : (backgroundReady ? '重新采集模拟空场' : '采集模拟空场');
    }
  }

  setCaptureCountdown(seconds) {
    const counting = Number.isFinite(seconds) && seconds > 0;
    this.dom.captureBackgroundButton.disabled = counting;
  }

  setPresets(snapshot) {
    const select = this.dom.presetSelect;
    select.replaceChildren(...snapshot.presets.map((preset) => {
      const option = document.createElement('option');
      option.value = preset.name;
      option.textContent = preset.name;
      option.selected = preset.name === snapshot.activeName;
      return option;
    }));
  }

  setEntered(entered) {
    this.dom.intro.hidden = entered;
  }

  setDebugOpen(open) {
    this.dom.debugView.hidden = !open;
  }

  setUiHidden(hidden) {
    document.body.classList.toggle('ui-hidden', hidden);
  }

  message(text, level = 'info') {
    this.dom.panelMessage.textContent = text;
    this.dom.panelMessage.dataset.level = level;
  }

  downloadJson(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
