import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigStore, DEFAULT_QUAD } from '../../src/config/config-store.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test('calibration presets save, export, and import with schema validation', () => {
  const store = new ConfigStore(new MemoryStorage());
  const adjusted = DEFAULT_QUAD.map((point, index) => ({ x: point.x + index * 0.001, y: point.y }));
  const presets = store.savePresets([{ name: '现场 A', quad: adjusted, updatedAt: '2026-08-01T00:00:00.000Z' }]);
  const json = store.exportCalibration(presets, '现场 A');
  const imported = new ConfigStore(new MemoryStorage()).importCalibration(json);
  assert.equal(imported.valid, true, imported.errors?.join('\n'));
  assert.equal(imported.activeName, '现场 A');
  assert.equal(imported.presets.length, 1);
  assert.equal(new ConfigStore(new MemoryStorage()).importCalibration('{"version":99,"presets":[]}').valid, false);
});
