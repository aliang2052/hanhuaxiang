import { clamp } from '../core/math.js';

export class TriggerPlane {
  constructor(rows = 7, cols = 9) {
    if (!Number.isInteger(rows) || rows <= 0 || !Number.isInteger(cols) || cols <= 0) {
      throw new TypeError('TriggerPlane rows and cols must be positive integers.');
    }
    this.rows = rows;
    this.cols = cols;
    this.count = rows * cols;
  }

  indexAt(u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u > 1 || v > 1) return -1;
    const col = Math.min(this.cols - 1, Math.floor(clamp(u) * this.cols));
    const row = Math.min(this.rows - 1, Math.floor(clamp(v) * this.rows));
    return row * this.cols + col;
  }

  rectFor(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) throw new RangeError('Invalid trigger index.');
    const row = Math.floor(index / this.cols);
    const col = index % this.cols;
    return {
      x: col / this.cols,
      y: row / this.rows,
      w: 1 / this.cols,
      h: 1 / this.rows,
      row,
      col,
      id: index,
    };
  }

  allRects() {
    return Array.from({ length: this.count }, (_, index) => this.rectFor(index));
  }

  verifyPartition(sampleCols = 900, sampleRows = 700) {
    const counts = new Uint32Array(this.count);
    let holes = 0;
    let overlaps = 0;
    for (let y = 0; y < sampleRows; y += 1) {
      for (let x = 0; x < sampleCols; x += 1) {
        const u = (x + 0.5) / sampleCols;
        const v = (y + 0.5) / sampleRows;
        const index = this.indexAt(u, v);
        if (index < 0) holes += 1;
        else counts[index] += 1;
      }
    }
    const expected = sampleCols * sampleRows / this.count;
    const maxDeviation = Math.max(...counts.map((count) => Math.abs(count - expected)));
    return { holes, overlaps, counts: [...counts], expected, maxDeviation, valid: holes === 0 && overlaps === 0 && counts.every((count) => count > 0) };
  }
}
