import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonSilhouette } from '../../src/input/person-detector.js';

test('confidence mask preserves the human silhouette instead of filling a box or ellipse', () => {
  const sourceWidth = 20;
  const sourceHeight = 10;
  const confidence = new Float32Array(sourceWidth * sourceHeight).fill(0.03);
  for (let y = 1; y < 9; y += 1) {
    const halfWidth = y < 3 ? 1 : (y < 6 ? 2 : 3);
    for (let x = 10 - halfWidth; x <= 10 + halfWidth; x += 1) confidence[y * sourceWidth + x] = 0.92;
  }
  const result = buildPersonSilhouette(confidence, sourceWidth, sourceHeight, 80, 40, 0.55);
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].label, 'person');
  assert.ok(result.foregroundPixels > 400 && result.foregroundPixels < 900);
  assert.equal(result.mask[20 * 80 + 40], 255, 'human center should remain');
  assert.equal(result.mask[20 * 80 + 18], 0, 'background inside the broad bounding region must remain empty');
  assert.equal(result.mask[5 * 80 + 65], 0, 'unrelated background must not enter the trigger mask');
});

test('background-only confidence mask contains no people', () => {
  const confidence = new Float32Array(24 * 14).fill(0.08);
  const result = buildPersonSilhouette(confidence, 24, 14, 96, 56, 0.55);
  assert.equal(result.components.length, 0);
  assert.equal(result.foregroundPixels, 0);
  assert.equal(result.mask.some(Boolean), false);
});

test('small isolated confidence noise is removed', () => {
  const confidence = new Float32Array(20 * 10).fill(0.02);
  confidence[4 * 20 + 3] = 0.99;
  confidence[4 * 20 + 4] = 0.99;
  const result = buildPersonSilhouette(confidence, 20, 10, 80, 40, 0.55);
  assert.equal(result.components.length, 0);
  assert.equal(result.foregroundPixels, 0);
});

test('nearby body fragments are reported as one person while preserving their pixels', () => {
  const width = 40;
  const height = 24;
  const confidence = new Float32Array(width * height).fill(0.02);
  for (let y = 3; y < 21; y += 1) for (let x = 20; x < 31; x += 1) confidence[y * width + x] = 0.94;
  for (let y = 16; y < 22; y += 1) for (let x = 13; x < 19; x += 1) confidence[y * width + x] = 0.91;
  const result = buildPersonSilhouette(confidence, width, height, 160, 96, 0.55);
  assert.equal(result.components.length, 1);
  assert.ok(result.mask[70 * 160 + 60]);
  assert.ok(result.mask[50 * 160 + 100]);
});
