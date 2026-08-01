import { clamp } from '../core/math.js';

function drawImageDataScaled(ctx, imageData, canvas) {
  if (!imageData) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const temp = document.createElement('canvas');
  temp.width = imageData.width;
  temp.height = imageData.height;
  temp.getContext('2d').putImageData(imageData, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);
}

export class CalibrationView {
  constructor({ rawCanvas, maskCanvas, coverageCanvas, calibrationController, triggerPlane, metricsElements = {} }) {
    this.rawCanvas = rawCanvas;
    this.maskCanvas = maskCanvas;
    this.coverageCanvas = coverageCanvas;
    this.calibrationController = calibrationController;
    this.triggerPlane = triggerPlane;
    this.metricsElements = metricsElements;
    this.draggingPoint = -1;
    this.lastSnapshot = null;
    this.rawCanvas.addEventListener('pointerdown', (event) => this.#pointerDown(event));
    this.rawCanvas.addEventListener('pointermove', (event) => this.#pointerMove(event));
    this.rawCanvas.addEventListener('pointerup', () => { this.draggingPoint = -1; });
    this.rawCanvas.addEventListener('pointercancel', () => { this.draggingPoint = -1; });
  }

  update(snapshot, appMetrics) {
    this.lastSnapshot = snapshot;
    this.#drawRaw(snapshot);
    this.#drawMask(snapshot);
    this.#drawCoverage(snapshot.coverages);
    this.#updateMetrics(snapshot, appMetrics);
  }

  #drawRaw(snapshot) {
    const canvas = this.rawCanvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawImageDataScaled(ctx, snapshot.frame, canvas);

    const sourceWidth = snapshot.frame?.width || 240;
    const sourceHeight = snapshot.frame?.height || 135;
    const sx = canvas.width / sourceWidth;
    const sy = canvas.height / sourceHeight;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,190,64,0.9)';
    ctx.lineWidth = 2;
    for (const component of snapshot.segmentation?.components || []) {
      ctx.strokeRect(component.x * sx, component.y * sy, component.w * sx, component.h * sy);
    }
    const grid = this.calibrationController.getValidationGrid(this.triggerPlane.cols, this.triggerPlane.rows, 20);
    ctx.strokeStyle = 'rgba(236,231,210,0.45)';
    ctx.lineWidth = 1;
    for (const line of grid) {
      ctx.beginPath();
      line.forEach((point, index) => {
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    const quad = this.calibrationController.mapping.quad;
    ctx.strokeStyle = '#d4543f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    quad.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    quad.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      ctx.fillStyle = '#d4543f';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff4dc';
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), x, y);
    });
    ctx.restore();
  }

  #drawMask(snapshot) {
    const canvas = this.maskCanvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const segmentation = snapshot.segmentation;
    if (!segmentation?.mask) {
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const image = new ImageData(segmentation.width, segmentation.height);
    for (let index = 0, output = 0; index < segmentation.mask.length; index += 1, output += 4) {
      const value = segmentation.mask[index] ? 245 : 10;
      image.data[output] = value;
      image.data[output + 1] = value;
      image.data[output + 2] = value;
      image.data[output + 3] = 255;
    }
    drawImageDataScaled(ctx, image, canvas);
    const sx = canvas.width / segmentation.width;
    const sy = canvas.height / segmentation.height;
    ctx.strokeStyle = '#e5a13c';
    ctx.lineWidth = 2;
    for (const component of segmentation.components) {
      ctx.strokeRect(component.x * sx, component.y * sy, component.w * sx, component.h * sy);
    }
  }

  #drawCoverage(coverages) {
    const canvas = this.coverageCanvas;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e2dccd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cellW = canvas.width / this.triggerPlane.cols;
    const cellH = canvas.height / this.triggerPlane.rows;
    ctx.font = `${Math.max(10, Math.min(cellW, cellH) * 0.22)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let index = 0; index < this.triggerPlane.count; index += 1) {
      const row = Math.floor(index / this.triggerPlane.cols);
      const col = index % this.triggerPlane.cols;
      const coverage = clamp(coverages[index] || 0);
      ctx.fillStyle = `rgba(145,55,42,${0.02 + coverage * 0.82})`;
      ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
      ctx.strokeStyle = 'rgba(42,39,33,0.35)';
      ctx.strokeRect(col * cellW, row * cellH, cellW, cellH);
      ctx.fillStyle = coverage > 0.45 ? '#fff5df' : '#302c25';
      ctx.fillText(`${Math.round(coverage * 100)}%`, col * cellW + cellW / 2, row * cellH + cellH / 2);
    }
  }

  #updateMetrics(snapshot, appMetrics) {
    const segmentation = snapshot.segmentation?.metrics || {};
    const values = {
      camera: `${snapshot.camera.source} / ${snapshot.camera.state}`,
      fps: `${Number(appMetrics?.fps || 0).toFixed(1)} FPS`,
      latency: `${Number(segmentation.processingMs || 0).toFixed(1)} ms`,
      components: String(segmentation.componentCount || 0),
      foreground: `${segmentation.foregroundPixels || 0} px`,
      light: Number(segmentation.globalLightDelta || 0).toFixed(1),
      calibration: this.calibrationController.lastValidation.valid ? '有效 3×3 Homography' : '无效',
    };
    for (const [key, value] of Object.entries(values)) {
      if (this.metricsElements[key]) this.metricsElements[key].textContent = value;
    }
  }

  #canvasPoint(event) {
    const rect = this.rawCanvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height)),
    };
  }

  #pointerDown(event) {
    const point = this.#canvasPoint(event);
    const quad = this.calibrationController.mapping.quad;
    let best = -1;
    let bestDistance = 0.005;
    quad.forEach((corner, index) => {
      const dx = corner.x - point.x;
      const dy = corner.y - point.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    if (best >= 0) {
      this.draggingPoint = best;
      try { this.rawCanvas.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
    }
  }

  #pointerMove(event) {
    if (this.draggingPoint < 0) return;
    event.preventDefault();
    this.calibrationController.movePoint(this.draggingPoint, this.#canvasPoint(event));
  }
}
