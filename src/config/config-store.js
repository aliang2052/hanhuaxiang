import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, validateSettings } from '../core/config-schema.js';
import { validateQuad } from '../core/homography.js';

const SETTINGS_KEY = 'hanhuaxiang:settings:v2';
const PRESETS_KEY = 'hanhuaxiang:calibration-presets:v2';
const ACTIVE_PRESET_KEY = 'hanhuaxiang:calibration-active:v2';
const CALIBRATION_SCHEMA_VERSION = 2;

export const DEFAULT_QUAD = Object.freeze([
  Object.freeze({ x: 0.035, y: 0.04 }),
  Object.freeze({ x: 0.965, y: 0.04 }),
  Object.freeze({ x: 0.965, y: 0.96 }),
  Object.freeze({ x: 0.035, y: 0.96 }),
]);

function cloneQuad(quad) {
  return quad.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
}

function defaultPreset() {
  return { name: '默认全画面', quad: cloneQuad(DEFAULT_QUAD), updatedAt: 'reproducible-default' };
}

export class ConfigStore extends EventTarget {
  constructor(storage = globalThis.localStorage) {
    super();
    this.storage = storage;
    this.settings = structuredClone(DEFAULT_SETTINGS);
  }

  #warn(message) {
    queueMicrotask(() => this.dispatchEvent(new CustomEvent('warning', { detail: message })));
  }

  #get(key) {
    try { return this.storage?.getItem(key) ?? null; }
    catch (error) { this.#warn(`浏览器无法读取本地设置：${error instanceof Error ? error.message : String(error)}`); return null; }
  }

  #set(key, value) {
    try { this.storage?.setItem(key, value); return true; }
    catch (error) { this.#warn(`浏览器无法保存本地设置：${error instanceof Error ? error.message : String(error)}`); return false; }
  }

  #remove(key) {
    try { this.storage?.removeItem(key); } catch { /* storage may be blocked */ }
  }

  loadSettings() {
    const raw = this.#get(SETTINGS_KEY);
    if (!raw) {
      this.settings = structuredClone(DEFAULT_SETTINGS);
      return this.settings;
    }
    try {
      const result = validateSettings(JSON.parse(raw));
      if (!result.valid) {
        this.#remove(SETTINGS_KEY);
        this.#warn(`本地运行设置无效，已回退默认值：${result.errors.join('；')}`);
      }
      this.settings = result.settings;
    } catch (error) {
      this.#remove(SETTINGS_KEY);
      this.settings = structuredClone(DEFAULT_SETTINGS);
      this.#warn(`本地运行设置损坏，已回退默认值：${error instanceof Error ? error.message : String(error)}`);
    }
    return this.settings;
  }

  saveSettings(candidate = this.settings) {
    const result = validateSettings({ ...candidate, schemaVersion: SETTINGS_SCHEMA_VERSION });
    if (!result.valid) throw new Error(`拒绝保存无效设置：${result.errors.join('；')}`);
    this.settings = result.settings;
    this.#set(SETTINGS_KEY, JSON.stringify(this.settings));
    return this.settings;
  }

  resetSettings() {
    this.#remove(SETTINGS_KEY);
    this.settings = structuredClone(DEFAULT_SETTINGS);
    return this.settings;
  }

  loadPresets() {
    const raw = this.#get(PRESETS_KEY);
    if (!raw) return [defaultPreset()];
    try {
      const parsed = JSON.parse(raw);
      const source = Array.isArray(parsed) ? parsed : parsed?.presets;
      const presets = (Array.isArray(source) ? source : [])
        .filter((preset) => typeof preset?.name === 'string' && validateQuad(preset.quad).valid)
        .map((preset) => ({ name: preset.name.slice(0, 80), quad: cloneQuad(preset.quad), updatedAt: preset.updatedAt || '' }));
      return presets.length ? presets : [defaultPreset()];
    } catch {
      this.#warn('标定预设文件损坏，已回退默认全画面标定。');
      return [defaultPreset()];
    }
  }

  savePresets(presets) {
    const valid = (Array.isArray(presets) ? presets : [])
      .filter((preset) => typeof preset?.name === 'string' && validateQuad(preset.quad).valid)
      .map((preset) => ({ name: preset.name.trim().slice(0, 80), quad: cloneQuad(preset.quad), updatedAt: preset.updatedAt || new Date().toISOString() }))
      .filter((preset) => preset.name);
    const result = valid.length ? valid : [defaultPreset()];
    this.#set(PRESETS_KEY, JSON.stringify({ schemaVersion: CALIBRATION_SCHEMA_VERSION, presets: result }));
    return result;
  }

  loadActivePresetName() {
    return this.#get(ACTIVE_PRESET_KEY) || '默认全画面';
  }

  saveActivePresetName(name) {
    this.#set(ACTIVE_PRESET_KEY, String(name || '默认全画面'));
  }

  exportCalibration(presets, activeName) {
    return JSON.stringify({
      schemaVersion: CALIBRATION_SCHEMA_VERSION,
      activeName,
      presets: this.savePresets(presets),
    }, null, 2);
  }

  importCalibration(serialized) {
    try {
      const parsed = JSON.parse(serialized);
      if (parsed?.schemaVersion !== CALIBRATION_SCHEMA_VERSION || !Array.isArray(parsed.presets)) {
        return { valid: false, errors: ['标定文件 schemaVersion 或 presets 无效。'] };
      }
      const presets = parsed.presets
        .filter((preset) => typeof preset?.name === 'string' && validateQuad(preset.quad).valid)
        .map((preset) => ({ name: preset.name.trim().slice(0, 80), quad: cloneQuad(preset.quad), updatedAt: preset.updatedAt || new Date().toISOString() }));
      if (!presets.length) return { valid: false, errors: ['标定文件中没有有效预设。'] };
      const activeName = presets.some((preset) => preset.name === parsed.activeName) ? parsed.activeName : presets[0].name;
      this.savePresets(presets);
      this.saveActivePresetName(activeName);
      return { valid: true, errors: [], presets, activeName };
    } catch (error) {
      return { valid: false, errors: [`标定 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`] };
    }
  }
}
