const MODE_LABELS = { auto: '自动演示', pointer: '鼠标 / 触摸', camera: '摄像头' };

const byId = (id) => document.getElementById(id);

export class OperatorUI extends EventTarget {
  constructor() {
    super();
    this.dom = {
      intro: byId('intro'), enterButton: byId('enterButton'), topBar: byId('topBar'),
      controlPanel: byId('controlPanel'), openPanel: byId('openPanel'), closePanel: byId('closePanel'),
      modeSelect: byId('modeSelect'), cameraSourceSelect: byId('cameraSourceSelect'), cameraButton: byId('cameraButton'),
      captureBackgroundButton: byId('captureBackgroundButton'), debugButton: byId('debugButton'), fullscreenButton: byId('fullscreenButton'),
      simulationControls: byId('simulationControls'), simulationScenarioSelect: byId('simulationScenarioSelect'), simulateDisconnectButton: byId('simulateDisconnectButton'),
      diffThreshold: byId('diffThreshold'), diffThresholdOutput: byId('diffThresholdOutput'),
      onThreshold: byId('onThreshold'), onThresholdOutput: byId('onThresholdOutput'), offThreshold: byId('offThreshold'), offThresholdOutput: byId('offThresholdOutput'),
      mirrorToggle: byId('mirrorToggle'), gridToggle: byId('gridToggle'), labelsToggle: byId('labelsToggle'), muteToggle: byId('muteToggle'),
      presetSelect: byId('presetSelect'), presetNameInput: byId('presetNameInput'), savePresetButton: byId('savePresetButton'),
      resetCalibrationButton: byId('resetCalibrationButton'), exportCalibrationButton: byId('exportCalibrationButton'), importCalibrationButton: byId('importCalibrationButton'), importCalibrationInput: byId('importCalibrationInput'),
      wakeAllButton: byId('wakeAllButton'), recoverButton: byId('recoverButton'), resetButton: byId('resetButton'), hideUiButton: byId('hideUiButton'),
      panelMessage: byId('panelMessage'), modeStatus: byId('modeStatus'), cameraStatus: byId('cameraStatus'), activeStatus: byId('activeStatus'), fpsStatus: byId('fpsStatus'),
      debugView: byId('debugView'), closeDebug: byId('closeDebug'), debugCaptureButton: byId('debugCaptureButton'), debugResetCalibrationButton: byId('debugResetCalibrationButton'), audioButton: byId('audioButton'),
    };
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
    d.modeSelect.addEventListener('change', () => this.#emit('mode', { mode: d.modeSelect.value }));
    d.cameraSourceSelect.addEventListener('change', () => this.#emit('camera-source', { source: d.cameraSourceSelect.value }));
    d.cameraButton.addEventListener('click', () => this.#emit('camera-start'));
    d.captureBackgroundButton.addEventListener('click', () => this.#emit('capture-background'));
    d.debugButton.addEventListener('click', () => this.#emit('debug', { open: true }));
    d.closeDebug.addEventListener('click', () => this.#emit('debug', { open: false }));
    d.fullscreenButton.addEventListener('click', () => this.#emit('fullscreen'));
    d.simulationScenarioSelect.addEventListener('change', () => this.#emit('simulation-scenario', { scenario: d.simulationScenarioSelect.value }));
    d.simulateDisconnectButton.addEventListener('click', () => this.#emit('simulation-disconnect'));
    d.diffThreshold.addEventListener('input', () => this.#emit('setting', { key: 'diffThreshold', value: Number(d.diffThreshold.value) }));
    d.onThreshold.addEventListener('input', () => this.#emit('setting', { key: 'onThreshold', value: Number(d.onThreshold.value) / 100 }));
    d.offThreshold.addEventListener('input', () => this.#emit('setting', { key: 'offThreshold', value: Number(d.offThreshold.value) / 100 }));
    d.mirrorToggle.addEventListener('change', () => this.#emit('setting', { key: 'mirror', value: d.mirrorToggle.checked }));
    d.gridToggle.addEventListener('change', () => this.#emit('setting', { key: 'showGrid', value: d.gridToggle.checked }));
    d.labelsToggle.addEventListener('change', () => this.#emit('setting', { key: 'showLabels', value: d.labelsToggle.checked }));
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
  }

  applySettings(settings) {
    const d = this.dom;
    d.modeSelect.value = settings.mode;
    d.cameraSourceSelect.value = settings.cameraSource;
    d.diffThreshold.value = String(settings.diffThreshold);
    d.onThreshold.value = String(settings.onThreshold * 100);
    d.offThreshold.value = String(settings.offThreshold * 100);
    d.mirrorToggle.checked = settings.mirror;
    d.gridToggle.checked = settings.showGrid;
    d.labelsToggle.checked = settings.showLabels;
    d.muteToggle.checked = settings.muted;
    this.#updateOutputs(settings);
    d.simulationControls.hidden = settings.cameraSource !== 'simulated';
  }

  #updateOutputs(settings) {
    this.dom.diffThresholdOutput.value = String(Math.round(settings.diffThreshold));
    this.dom.onThresholdOutput.value = `${(settings.onThreshold * 100).toFixed(1)}%`;
    this.dom.offThresholdOutput.value = `${(settings.offThreshold * 100).toFixed(1)}%`;
  }

  updateStatus({ mode, activeCount, fps, camera, backgroundReady, captureProgress }) {
    this.dom.modeStatus.textContent = MODE_LABELS[mode] || mode;
    const capture = captureProgress > 0 && captureProgress < 1 ? ` / 空场 ${Math.round(captureProgress * 100)}%` : '';
    this.dom.cameraStatus.textContent = `摄像头：${camera.source}/${camera.state}${backgroundReady ? ' / 背景就绪' : ''}${capture}`;
    this.dom.activeStatus.textContent = `${activeCount} / 63`;
    this.dom.fpsStatus.textContent = `${Number(fps || 0).toFixed(0)} FPS`;
    this.dom.cameraButton.textContent = camera.state === 'live' ? '摄像头已启动' : camera.state === 'requesting' ? '正在请求权限…' : '启动摄像头';
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
