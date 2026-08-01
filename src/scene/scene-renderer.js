import { clamp } from '../core/math.js';
import { getSceneMetrics } from './scene-layout.js';

export class SceneRenderer {
  constructor(viewport, decorativeRenderer, characterRenderer, triggerPlane) {
    this.viewport = viewport;
    this.decorativeRenderer = decorativeRenderer;
    this.characterRenderer = characterRenderer;
    this.triggerPlane = triggerPlane;
    this.lastMetrics = getSceneMetrics(viewport.cssWidth, viewport.cssHeight, viewport.orientation);
  }

  render(now, visual, options = {}) {
    this.viewport.resize();
    const ctx = this.viewport.beginFrame();
    const metrics = getSceneMetrics(this.viewport.cssWidth, this.viewport.cssHeight, this.viewport.orientation);
    this.lastMetrics = metrics;
    this.decorativeRenderer.draw(ctx, metrics, now);
    const drawn = this.characterRenderer.draw(ctx, metrics, visual, now);
    if (options.showGrid) this.#drawTriggerGrid(ctx, metrics, options.coverages, options.showLabels);
    this.#drawInkVeil(ctx, metrics, now, visual);
    return { metrics, drawn };
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
