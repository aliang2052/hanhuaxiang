import { polygonArea, segmentsIntersect } from './math.js';

const EPSILON = 1e-10;

/** @typedef {{x:number,y:number}} Point */

/** Solve A*x=b using Gaussian elimination with partial pivoting. */
function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < EPSILON) throw new Error('Homography matrix is singular.');
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let valueColumn = column; valueColumn <= size; valueColumn += 1) augmented[column][valueColumn] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (Math.abs(factor) < EPSILON) continue;
      for (let valueColumn = column; valueColumn <= size; valueColumn += 1) {
        augmented[row][valueColumn] -= factor * augmented[column][valueColumn];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

/** @param {Point[]} source @param {Point[]} destination */
export function solveHomography(source, destination) {
  if (!Array.isArray(source) || !Array.isArray(destination) || source.length !== 4 || destination.length !== 4) {
    throw new TypeError('Homography requires four source and four destination points.');
  }
  const rows = [];
  const values = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = source[index];
    const { x: u, y: v } = destination[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }
  const h = solveLinearSystem(rows, values);
  const matrix = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  if (matrix.some((value) => !Number.isFinite(value))) throw new Error('Homography contains non-finite values.');
  return matrix;
}

/** @param {number[]} matrix @param {Point} point */
export function projectPoint(matrix, point) {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) return { x: Number.NaN, y: Number.NaN };
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
}

/** @param {number[]} matrix */
export function invertHomography(matrix) {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const determinant = a * A + b * B + c * C;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < EPSILON) throw new Error('Homography is not invertible.');
  return [A, D, G, B, E, H, C, F, I].map((value) => value / determinant);
}

/** @param {Point[]} quad */
export function validateQuad(quad, options = {}) {
  const minArea = options.minArea ?? 0.035;
  const margin = options.margin ?? 0;
  if (!Array.isArray(quad) || quad.length !== 4) return { valid: false, reason: '四角必须包含 4 个点。' };
  if (quad.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return { valid: false, reason: '四角包含无效坐标。' };
  }
  if (quad.some((point) => point.x < margin || point.x > 1 - margin || point.y < margin || point.y > 1 - margin)) {
    return { valid: false, reason: '四角超出可用画面范围。' };
  }
  if (segmentsIntersect(quad[0], quad[1], quad[2], quad[3]) || segmentsIntersect(quad[1], quad[2], quad[3], quad[0])) {
    return { valid: false, reason: '四角边线发生交叉。' };
  }
  const signedArea = polygonArea(quad);
  if (Math.abs(signedArea) < minArea) return { valid: false, reason: '标定区域面积过小。' };
  const signs = [];
  for (let index = 0; index < 4; index += 1) {
    const a = quad[index];
    const b = quad[(index + 1) % 4];
    const c = quad[(index + 2) % 4];
    signs.push(Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)));
  }
  if (signs.some((sign) => sign === 0) || !signs.every((sign) => sign === signs[0])) {
    return { valid: false, reason: '标定区域必须是凸四边形。' };
  }
  // Expected order: top-left, top-right, bottom-right, bottom-left.
  if (signedArea <= 0) return { valid: false, reason: '四角顺序错误，应按顺时针排列。' };
  return { valid: true, reason: '', area: signedArea };
}

export const UNIT_SQUARE = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 1, y: 1 }),
  Object.freeze({ x: 0, y: 1 }),
]);

/** @param {Point[]} cameraQuad */
export function createCameraMapping(cameraQuad) {
  const validation = validateCalibrationQuad(cameraQuad);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return {
    quad: cameraQuad.map((point) => ({ x: point.x, y: point.y })),
    cameraToPlane: validation.cameraToPlane,
    planeToCamera: validation.planeToCamera,
    maxCornerError: validation.maxError,
    maxError: validation.maxError,
    validation,
  };
}


/** Compatibility alias used by calibration and coverage modules. */
export const applyHomography = projectPoint;
export const UNIT_QUAD = UNIT_SQUARE;

/**
 * Validate a camera quadrilateral and calculate both projective transforms.
 * Invalid input returns an explicit errors list and never mutates caller data.
 */
export function validateCalibrationQuad(quad, options = {}) {
  const basic = validateQuad(quad, options);
  if (!basic.valid) return { valid: false, errors: [basic.reason], area: basic.area ?? 0 };
  try {
    const cameraToPlane = solveHomography(quad, UNIT_SQUARE);
    const planeToCamera = invertHomography(cameraToPlane);
    let maxError = 0;
    for (let index = 0; index < UNIT_SQUARE.length; index += 1) {
      const plane = projectPoint(cameraToPlane, quad[index]);
      const camera = projectPoint(planeToCamera, UNIT_SQUARE[index]);
      maxError = Math.max(
        maxError,
        Math.hypot(plane.x - UNIT_SQUARE[index].x, plane.y - UNIT_SQUARE[index].y),
        Math.hypot(camera.x - quad[index].x, camera.y - quad[index].y),
      );
    }
    if (![...cameraToPlane, ...planeToCamera, maxError].every(Number.isFinite)) {
      return { valid: false, errors: ['Homography 包含非有限值。'], area: basic.area };
    }
    return { valid: true, errors: [], area: basic.area, cameraToPlane, planeToCamera, maxError };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)], area: basic.area };
  }
}

/** Construct the persisted calibration mapping after full validation. */
export function createCalibrationMapping(cameraQuad) {
  const validation = validateCalibrationQuad(cameraQuad);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return {
    quad: cameraQuad.map((point) => ({ x: point.x, y: point.y })),
    cameraToPlane: validation.cameraToPlane,
    planeToCamera: validation.planeToCamera,
    maxError: validation.maxError,
  };
}

export const computeHomography = solveHomography;
