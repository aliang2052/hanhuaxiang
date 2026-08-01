import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOpaqueBounds } from '../../src/scene/character-renderer.js';

test('sprite normalization measures the visible person instead of transparent canvas padding', () => {
  const width = 12;
  const height = 10;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 2; y <= 8; y += 1) {
    for (let x = 4; x <= 7; x += 1) pixels[(y * width + x) * 4 + 3] = 255;
  }
  assert.deepEqual(computeOpaqueBounds(pixels, width, height), { x: 4, y: 2, w: 4, h: 7 });
});

test('sprite normalization ignores fully transparent images and faint edge noise', () => {
  const pixels = new Uint8ClampedArray(6 * 5 * 4);
  pixels[3] = 4;
  assert.equal(computeOpaqueBounds(pixels, 6, 5), null);
});
