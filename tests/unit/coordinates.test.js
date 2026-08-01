import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBackingSize, normalizedPointFromClient } from '../../src/core/math.js';

test('backing store fills CSS viewport while limiting internal 4K pixels', () => {
  const size = computeBackingSize(3840, 2160, 2_800_000, 2, 2);
  assert.equal(size.cssWidth, 3840);
  assert.equal(size.cssHeight, 2160);
  assert.ok(size.width * size.height <= 2_810_000);
  assert.ok(Math.abs(size.width / size.height - 16 / 9) < 0.003);
});

test('client coordinates map directly to full-screen normalized stage', () => {
  const rect = { left: 100, top: 50, width: 1000, height: 500 };
  assert.deepEqual(normalizedPointFromClient(rect, 600, 300), { x: 0.5, y: 0.5 });
  assert.deepEqual(normalizedPointFromClient(rect, -20, 900), { x: 0, y: 1 });
});
