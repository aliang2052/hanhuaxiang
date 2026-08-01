import { clamp } from '../core/math.js';
import { applyHomography } from '../core/homography.js';
import { getSceneMetrics } from './scene-layout.js';

export class SceneRenderer {
  constructor(viewport, decorativeRenderer, characterRenderer, triggerPlane) {
    this.viewport = viewport;
    this.decorativeRenderer = decorativeRenderer;
    this.characterRenderer = characterRenderer;
    this.triggerPlane = triggerPlane;
    this.lastMetrics = getSceneMetrics(viewport.cssWidth, viewport.cssHeight, viewport.orientation);
    this.personOverlayCanvas = null;
    this.personOverlayContext = null;
    this.personProjectionMap = new Int32Array(0);
    this.personProjectionKey = '';
  }

  render(now, visual, options = {}) {
    this.viewport.resize();
    const ctx = this.viewport.beginFrame();
    const metrics = getSceneMetrics(this.viewport.cssWidth, this.viewport.cssHeight, this.viewport.orientation);
    this.lastMetrics = metrics;
    this.decorativeRenderer.draw(ctx, metrics, now);
    const drawn = this.characterRenderer.draw(ctx, metrics, visual, now);
    this.#drawPersonOverlay(ctx, metrics, options.personSegmentation, options.planeToCamera);
    if (options.showGrid) this.#drawTriggerGrid(ctx, metrics, options.coverages, options.showLabels);
    this.#drawInkVeil(ctx, metrics, now, visual);
    return { metrics, drawn };
  }

  #drawPersonOverlay(ctx, metrics, segmentation, planeToCamera) {
    if (!segmentation?.mask || !Array.isArray(planeToCamera) || planeToCamera.length !== 9) return;
    const width = 320;
    const height = 180;
    if (!this.personOverlayCanvas) {
      this.personOverlayCanvas = document.createElement('canvas');
      this.personOverlayCanvas.width = width;
      this.personOverlayCanvas.height = height;
      this.personOverlayContext = this.personOverlayCanvas.getContext('2d');
    }
    const key = `${segmentation.width}x${segmentation.height}:${planeToCamera.map((value) => value.toFixed(7)).join(',')}`;
    if (key !== this.personProjectionKey) {
      this.personProjectionKey = key;
      this.personProjectionMap = new Int32Array(width * height);
      this.personProjectionMap.fill(-1);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const camera = applyHomography(planeToCamera, { x: (x + 0.5) / width, y: (y + 0.5) / height });
          if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y) || camera.x < 0 || camera.x > 1 || camera.y < 0 || camera.y > 1) continue;
          const sourceX = Math.min(segmentation.width - 1, Math.floor(camera.x * segmentation.width));
          const sourceY = Math.min(segmentation.height - 1, Math.floor(camera.y * segmentation.height));
          this.personProjectionMap[y * width + x] = sourceY * segmentation.width + sourceX;
        }
      }
    }
    const image = this.personOverlayContext.createImageData(width, height);
    for (let index = 0, output = 0; index < this.personProjectionMap.length; index += 1, output += 4) {
      const source = this.personProjectionMap[index];
      if (source < 0 || !segmentation.mask[source]) continue;
      const sourceX = source % segmentation.width;
      const sourceY = Math.floor(source / segmentation.width);
      const boundary = sourceX === 0 || sourceY === 0
        || sourceX === segmentation.width - 1 || sourceY === segmentation.height - 1
        || !segmentation.mask[source - 1] || !segmentation.mask[source + 1]
        || !segmentation.mask[source - segmentation.width]
        || !segmentation.mask[source + segmentation.width];
      image.data[output] = 45;
      image.data[output + 1] = 47;
      image.data[output + 2] = 48;
      image.data[output + 3] = boundary ? 132 : 68;
    }
    this.personOverlayContext.putImageData(image, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.personOverlayCanvas, 0, 0, metrics.width, metrics.height);
    ctx.restore();
  }

  #drawTriggerGrid(ctx, metrics, coverages, labels) {
    const rows = this.triggerPlane.rows;
    const cols = this.triggerPlane.cols;
    const lineWidth = Math.max(1, Math.min(metrics.width, metrics.height) * 0.0011);
    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.font = `${Math.max(9, Math.min(metrics.width, metrics.height) * 0.012)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const id = row * cols + col;
        const x = col / cols * metrics.width;
        const y = row / rows * metrics.height;
        const w = metrics.width / cols;
        const h = metrics.height / rows;
        const coverage = clamp(coverages?.[id] || 0);
        ctx.strokeStyle = coverage > 0 ? `rgba(129,49,36,${0.35 + coverage * 0.6})` : 'rgba(40,38,32,0.2)';
        ctx.strokeRect(x, y, w, h);
        if (coverage > 0.005) {
          ctx.fillStyle = `rgba(143,59,43,${coverage * 0.12})`;
          ctx.fillRect(x, y, w, h);
        }
        if (labels) {
          ctx.fillStyle = 'rgba(39,36,31,0.58)';
          ctx.fillText(`${id + 1}`, x + w / 2, y + h / 2);
        }
      }
    }
    ctx.restore();
  }

  #drawInkVeil(ctx, metrics, now, visual) {
    const average = visual.reduce((sum, value) => sum + value, 0) / Math.max(1, visual.length);
    if (average < 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const gradient = ctx.createLinearGradient(0, 0, metrics.width, metrics.height);
    gradient.addColorStop(0, `rgba(74,63,47,${average * 0.018})`);
    gradient.addColorStop(0.5, `rgba(112,91,63,${average * (0.018 + Math.sin(now * 0.0003) * 0.004)})`);
    gradient.addColorStop(1, `rgba(54,58,50,${average * 0.018})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, metrics.width, metrics.height);
    ctx.restore();
  }
}
