import { applyHomography } from '../core/homography.js';

export class CoverageEngine {
  constructor(triggerPlane) {
    this.triggerPlane = triggerPlane;
    this.width = 0;
    this.height = 0;
    this.mapping = null;
    this.pixelToCell = new Int16Array(0);
    this.cellAreas = new Uint32Array(triggerPlane.count);
    this.coverages = new Float32Array(triggerPlane.count);
    this.revision = 0;
  }

  rebuild(width, height, cameraToPlane) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new TypeError('Coverage dimensions must be positive integers.');
    if (!Array.isArray(cameraToPlane) || cameraToPlane.length !== 9) throw new TypeError('Coverage mapping requires a 3×3 homography.');
    this.width = width;
    this.height = height;
    this.mapping = [...cameraToPlane];
    this.pixelToCell = new Int16Array(width * height);
    this.pixelToCell.fill(-1);
    this.cellAreas.fill(0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const point = applyHomography(cameraToPlane, { x: (x + 0.5) / width, y: (y + 0.5) / height });
        const cell = this.triggerPlane.indexAt(point.x, point.y);
        const offset = y * width + x;
        this.pixelToCell[offset] = cell;
        if (cell >= 0) this.cellAreas[cell] += 1;
      }
    }
    this.revision += 1;
    return this.snapshot();
  }

  compute(mask) {
    if (!(mask instanceof Uint8Array) || mask.length !== this.pixelToCell.length) {
      throw new TypeError(`Mask length ${mask?.length ?? 'null'} does not match mapping length ${this.pixelToCell.length}.`);
    }
    const occupied = new Uint32Array(this.triggerPlane.count);
    for (let offset = 0; offset < mask.length; offset += 1) {
      if (!mask[offset]) continue;
      const cell = this.pixelToCell[offset];
      if (cell >= 0) occupied[cell] += 1;
    }
    for (let index = 0; index < this.coverages.length; index += 1) {
      this.coverages[index] = this.cellAreas[index] ? occupied[index] / this.cellAreas[index] : 0;
    }
    return this.coverages;
  }

  snapshot() {
    return {
      width: this.width,
      height: this.height,
      revision: this.revision,
      mappedPixels: this.cellAreas.reduce((sum, value) => sum + value, 0),
      emptyCells: [...this.cellAreas].filter((value) => value === 0).length,
      minCellArea: Math.min(...this.cellAreas),
      maxCellArea: Math.max(...this.cellAreas),
    };
  }
}
