import test from 'node:test';
import assert from 'node:assert/strict';
import { TriggerPlane } from '../../src/trigger/trigger-plane.js';
import { CoverageEngine } from '../../src/trigger/coverage-engine.js';
import { createCalibrationMapping } from '../../src/core/homography.js';

const plane = new TriggerPlane(7, 9);
const quad = [{ x: 0.03, y: 0.05 }, { x: 0.97, y: 0.05 }, { x: 0.98, y: 0.97 }, { x: 0.02, y: 0.97 }];

test('9×7 trigger partition has 63 complete, non-empty cells and no holes', () => {
  assert.equal(plane.count, 63);
  const verification = plane.verifyPartition(900, 700);
  assert.equal(verification.valid, true);
  assert.equal(verification.holes, 0);
  assert.ok(verification.counts.every((count) => count > 0));
  assert.equal(new Set(Array.from({ length: 63 }, (_, index) => plane.rectFor(index).id)).size, 63);
});

test('camera mask coverage remains local under projective mapping', () => {
  const mapping = createCalibrationMapping(quad);
  const engine = new CoverageEngine(plane);
  const snapshot = engine.rebuild(240, 135, mapping.cameraToPlane);
  assert.equal(snapshot.emptyCells, 0);
  const mask = new Uint8Array(240 * 135);
  for (let y = 45; y < 118; y += 1) for (let x = 42; x < 76; x += 1) mask[y * 240 + x] = 255;
  const coverage = engine.compute(mask);
  const positive = [...coverage].filter((value) => value > 0).length;
  assert.ok(positive >= 4 && positive < 24, `positive cells: ${positive}`);
});
