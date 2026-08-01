import { applyHomography, createCalibrationMapping, UNIT_QUAD, validateCalibrationQuad } from '../core/homography.js';
import { DEFAULT_QUAD } from '../config/config-store.js';

function cloneQuad(quad) {
  return quad.map((point) => ({ x: point.x, y: point.y }));
}

export class CalibrationController extends EventTarget {
  constructor(configStore) {
    super();
    this.configStore = configStore;
    this.presets = configStore.loadPresets();
    this.activeName = configStore.loadActivePresetName();
    let preset = this.presets.find((item) => item.name === this.activeName) || this.presets[0];
    if (!preset) preset = { name: '默认全画面', quad: cloneQuad(DEFAULT_QUAD) };
    this.activeName = preset.name;
    this.mapping = createCalibrationMapping(preset.quad);
    this.lastValidation = validateCalibrationQuad(preset.quad);
  }

  trySetQuad(quad, options = {}) {
    const validation = validateCalibrationQuad(quad);
    this.lastValidation = validation;
    if (!validation.valid) {
      this.dispatchEvent(new CustomEvent('invalid', { detail: validation }));
      return validation;
    }
    this.mapping = {
      quad: cloneQuad(quad),
      cameraToPlane: validation.cameraToPlane,
      planeToCamera: validation.planeToCamera,
      maxError: validation.maxError,
    };
    if (options.persist !== false) this.#persistActive();
    this.dispatchEvent(new CustomEvent('change', { detail: this.snapshot() }));
    return validation;
  }

  movePoint(index, point) {
    if (!Number.isInteger(index) || index < 0 || index >= 4) return { valid: false, errors: ['角点索引无效。'] };
    const next = cloneQuad(this.mapping.quad);
    next[index] = { x: point.x, y: point.y };
    return this.trySetQuad(next);
  }

  reset() {
    this.activeName = '默认全画面';
    let preset = this.presets.find((item) => item.name === this.activeName);
    if (!preset) {
      preset = { name: this.activeName, quad: cloneQuad(DEFAULT_QUAD), updatedAt: new Date().toISOString() };
      this.presets.unshift(preset);
    }
    this.configStore.saveActivePresetName(this.activeName);
    return this.trySetQuad(preset.quad);
  }

  savePreset(name) {
    const cleanName = String(name || '').trim().slice(0, 80);
    if (!cleanName) return { ok: false, message: '请输入预设名称。' };
    const existing = this.presets.find((preset) => preset.name === cleanName);
    const entry = { name: cleanName, quad: cloneQuad(this.mapping.quad), updatedAt: new Date().toISOString() };
    if (existing) Object.assign(existing, entry);
    else this.presets.push(entry);
    this.presets = this.configStore.savePresets(this.presets);
    this.activeName = cleanName;
    this.configStore.saveActivePresetName(cleanName);
    this.dispatchEvent(new CustomEvent('presetschange', { detail: this.snapshot() }));
    return { ok: true, message: `已保存标定预设“${cleanName}”。` };
  }

  selectPreset(name) {
    const preset = this.presets.find((item) => item.name === name);
    if (!preset) return { ok: false, message: `未找到预设“${name}”。` };
    const result = this.trySetQuad(preset.quad, { persist: false });
    if (!result.valid) return { ok: false, message: result.errors.join(' ') };
    this.activeName = preset.name;
    this.configStore.saveActivePresetName(this.activeName);
    this.dispatchEvent(new CustomEvent('presetschange', { detail: this.snapshot() }));
    return { ok: true, message: `已切换到标定预设“${name}”。` };
  }

  exportJson() {
    return this.configStore.exportCalibration(this.presets, this.activeName);
  }

  importJson(serialized) {
    const result = this.configStore.importCalibration(serialized);
    if (!result.valid) return result;
    this.presets = result.presets;
    this.activeName = result.activeName;
    const selection = this.selectPreset(this.activeName);
    return { ...result, selection };
  }

  getValidationGrid(cols = 9, rows = 7, segments = 18) {
    const lines = [];
    for (let col = 0; col <= cols; col += 1) {
      const line = [];
      for (let step = 0; step <= segments; step += 1) {
        line.push(applyHomography(this.mapping.planeToCamera, { x: col / cols, y: step / segments }));
      }
      lines.push(line);
    }
    for (let row = 0; row <= rows; row += 1) {
      const line = [];
      for (let step = 0; step <= segments; step += 1) {
        line.push(applyHomography(this.mapping.planeToCamera, { x: step / segments, y: row / rows }));
      }
      lines.push(line);
    }
    return lines;
  }

  verifyMapping(samples = 11) {
    let maxRoundTripError = 0;
    for (let y = 0; y < samples; y += 1) {
      for (let x = 0; x < samples; x += 1) {
        const plane = { x: x / (samples - 1), y: y / (samples - 1) };
        const camera = applyHomography(this.mapping.planeToCamera, plane);
        const roundTrip = applyHomography(this.mapping.cameraToPlane, camera);
        maxRoundTripError = Math.max(maxRoundTripError, Math.hypot(roundTrip.x - plane.x, roundTrip.y - plane.y));
      }
    }
    return { maxRoundTripError, valid: Number.isFinite(maxRoundTripError) && maxRoundTripError < 1e-6, corners: UNIT_QUAD };
  }

  snapshot() {
    return {
      activeName: this.activeName,
      quad: cloneQuad(this.mapping.quad),
      presets: this.presets.map((preset) => ({ name: preset.name, quad: cloneQuad(preset.quad), updatedAt: preset.updatedAt })),
      maxError: this.mapping.maxError,
      valid: this.lastValidation.valid,
      errors: this.lastValidation.errors,
      verification: this.verifyMapping(),
    };
  }

  #persistActive() {
    const preset = this.presets.find((item) => item.name === this.activeName);
    if (preset) {
      preset.quad = cloneQuad(this.mapping.quad);
      preset.updatedAt = new Date().toISOString();
      this.presets = this.configStore.savePresets(this.presets);
    }
  }
}
