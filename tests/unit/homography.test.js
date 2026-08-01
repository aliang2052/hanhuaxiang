import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIT_QUAD,
  applyHomography,
  computeHomography,
  createCalibrationMapping,
  invertHomography,
  validateCalibrationQuad,
} from '../../src/core/homography.js';

const quad = [
  { x: 0.08, y: 0.10 },
  { x: 0.91, y: 0.06 },
  { x: 0.96, y: 0.91 },
  { x: 0.04, y: 0.95 },
];

test('true 3×3 homography maps corners and round-trips interior points', () => {
  const mapping = createCalibrationMapping(quad);
  assert.ok(mapping.maxError < 1e-10, `corner error ${mapping.maxError}`);
  quad.forEach((point, index) => {
    const projected = applyHomography(mapping.cameraToPlane, point);
    assert.ok(Math.hypot(projected.x - UNIT_QUAD[index].x, projected.y - UNIT_QUAD[index].y) < 1e-10);
  });
  for (const point of [{ x: 0.12, y: 0.18 }, { x: 0.5, y: 0.5 }, { x: 0.81, y: 0.73 }]) {
    const camera = applyHomography(mapping.planeToCamera, point);
    const roundTrip = applyHomography(mapping.cameraToPlane, camera);
    assert.ok(Math.hypot(roundTrip.x - point.x, roundTrip.y - point.y) < 1e-10);
  }
});

test('homography inverse is consistent', () => {
  const matrix = computeHomography(quad, UNIT_QUAD);
  const inverse = invertHomography(matrix);
  const point = { x: 0.44, y: 0.61 };
  const mapped = applyHomography(matrix, point);
  const restored = applyHomography(inverse, mapped);
  assert.ok(Math.hypot(restored.x - point.x, restored.y - point.y) < 1e-10);
});

test('invalid calibration quads are rejected', () => {
  assert.equal(validateCalibrationQuad(quad).valid, true);
  assert.equal(validateCalibrationQuad([quad[0], quad[2], quad[1], quad[3]]).valid, false, 'crossed');
  assert.equal(validateCalibrationQuad([{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }, { x: 0.51, y: 0.51 }, { x: 0.5, y: 0.51 }]).valid, false, 'tiny');
  assert.equal(validateCalibrationQuad([{ x: -0.1, y: 0.1 }, quad[1], quad[2], quad[3]]).valid, false, 'out of bounds');
  assert.equal(validateCalibrationQuad([...quad].reverse()).valid, false, 'wrong winding/order');
});
