import test from 'node:test';
import assert from 'node:assert/strict';
import { ForegroundSegmenter } from '../../src/input/foreground-segmenter.js';

function frame(width, height, background = 100, rectangles = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = background;
    data[i * 4 + 1] = background;
    data[i * 4 + 2] = background;
    data[i * 4 + 3] = 255;
  }
  for (const rect of rectangles) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const index = (y * width + x) * 4;
        data[index] = rect.value ?? 20;
        data[index + 1] = (rect.value ?? 20) + 8;
        data[index + 2] = (rect.value ?? 20) + 12;
      }
    }
  }
  return { width, height, data };
}

test('background subtraction filters noise, detects multiple components, and preserves a static person', () => {
  const width = 80;
  const height = 45;
  const segmenter = new ForegroundSegmenter(width, height, { diffThreshold: 32, minComponentArea: 20, backgroundAdaptPerSecond: 0.5 });
  segmenter.beginBackgroundCapture(4);
  for (let i = 0; i < 4; i += 1) segmenter.process(frame(width, height), 1 / 30);
  assert.equal(segmenter.metrics.backgroundReady, true);
  const people = frame(width, height, 100, [{ x: 12, y: 10, w: 14, h: 28 }, { x: 52, y: 11, w: 13, h: 27 }]);
  let result = segmenter.process(people, 1 / 30);
  assert.equal(result.components.length, 2);
  for (let i = 0; i < 120; i += 1) result = segmenter.process(people, 1 / 30);
  assert.equal(result.components.length, 2, 'foreground pixels must be frozen out of background adaptation');
});

test('global light shift does not become a full-frame foreground mask', () => {
  const width = 80;
  const height = 45;
  const segmenter = new ForegroundSegmenter(width, height, { diffThreshold: 32, minComponentArea: 20 });
  segmenter.beginBackgroundCapture(3);
  for (let i = 0; i < 3; i += 1) segmenter.process(frame(width, height, 90), 1 / 30);
  const result = segmenter.process(frame(width, height, 132), 1 / 30);
  assert.equal(result.components.length, 0);
  assert.equal(result.metrics.foregroundPixels, 0);
});
