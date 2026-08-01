import { computeBackingSize, normalizedPointFromClient } from '../core/math.js';

/** Full-window CSS viewport with a bounded internal canvas backing store. */
export class ViewportManager {
  constructor(canvas, options = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('ViewportManager requires a canvas element.');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.maxPixels = options.maxPixels ?? 1_200_000;
    this.cssWidth = 1;
    this.cssHeight = 1;
    this.backingWidth = 1;
    this.backingHeight = 1;
    this.scale = 1;
    this.revision = 0;
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.resize())
      : null;
    this.resizeObserver?.observe(canvas.parentElement ?? canvas);
    window.addEventListener('resize', () => this.resize(), { passive: true });
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || window.innerWidth || 1;
    const height = rect.height || window.innerHeight || 1;
    const dpr = window.devicePixelRatio || 1;
    const size = computeBackingSize(width, height, this.maxPixels, dpr);
    this.cssWidth = size.cssWidth;
    this.cssHeight = size.cssHeight;
    this.scale = size.scale;
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
      this.backingWidth = size.width;
      this.backingHeight = size.height;
      this.revision += 1;
    } else {
      this.backingWidth = this.canvas.width;
      this.backingHeight = this.canvas.height;
    }
    return this.snapshot();
  }

  beginFrame() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    return ctx;
  }

  get width() { return this.cssWidth; }
  get height() { return this.cssHeight; }
  get aspect() { return this.cssWidth / Math.max(1, this.cssHeight); }
  get orientation() { return this.aspect < 0.82 ? 'portrait' : 'landscape'; }

  clientToNormalized(clientX, clientY) {
    return normalizedPointFromClient(this.canvas.getBoundingClientRect(), clientX, clientY);
  }

  // Compatibility alias used by a few development tools.
  clientPoint(clientX, clientY) { return this.clientToNormalized(clientX, clientY); }

  snapshot() {
    return {
      cssWidth: this.cssWidth,
      cssHeight: this.cssHeight,
      backingWidth: this.canvas.width,
      backingHeight: this.canvas.height,
      backingPixels: this.canvas.width * this.canvas.height,
      scale: this.scale,
      aspect: this.aspect,
      orientation: this.orientation,
      revision: this.revision,
    };
  }

  destroy() { this.resizeObserver?.disconnect(); }
}

export const Viewport = ViewportManager;
