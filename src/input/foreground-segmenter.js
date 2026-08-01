import { clamp } from '../core/math.js';

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export class ForegroundSegmenter {
  constructor(width = 240, height = 135, options = {}) {
    this.width = width;
    this.height = height;
    this.pixelCount = width * height;
    this.diffThreshold = options.diffThreshold ?? 48;
    this.minComponentArea = options.minComponentArea ?? Math.max(24, Math.round(this.pixelCount * 0.0012));
    this.backgroundAdaptPerSecond = options.backgroundAdaptPerSecond ?? 0.018;
    this.background = null;
    this.captureAccumulator = null;
    this.captureTarget = 0;
    this.captureCount = 0;
    this.rawMask = new Uint8Array(this.pixelCount);
    this.filteredMask = new Uint8Array(this.pixelCount);
    this.tempMask = new Uint8Array(this.pixelCount);
    this.queue = new Int32Array(this.pixelCount);
    this.visited = new Uint8Array(this.pixelCount);
    this.components = [];
    this.metrics = {
      processingMs: 0,
      globalLightDelta: 0,
      foregroundPixels: 0,
      componentCount: 0,
      backgroundReady: false,
      captureProgress: 0,
    };
  }

  configure(options = {}) {
    if (Number.isFinite(options.diffThreshold)) this.diffThreshold = clamp(options.diffThreshold, 8, 180);
    if (Number.isFinite(options.minComponentArea)) this.minComponentArea = Math.max(1, Math.round(options.minComponentArea));
  }

  resetBackground() {
    this.background = null;
    this.captureAccumulator = null;
    this.captureTarget = 0;
    this.captureCount = 0;
    this.rawMask.fill(0);
    this.filteredMask.fill(0);
    this.components = [];
    this.metrics.backgroundReady = false;
    this.metrics.captureProgress = 0;
  }

  beginBackgroundCapture(frameCount = 18) {
    this.captureTarget = Math.max(3, Math.round(frameCount));
    this.captureCount = 0;
    this.captureAccumulator = new Float64Array(this.pixelCount * 3);
    this.metrics.captureProgress = 0;
  }

  get capturing() {
    return this.captureAccumulator !== null;
  }

  addCaptureFrame(imageData) {
    this.#assertFrame(imageData);
    if (!this.captureAccumulator) this.beginBackgroundCapture();
    const data = imageData.data;
    for (let pixel = 0, source = 0, target = 0; pixel < this.pixelCount; pixel += 1, source += 4, target += 3) {
      this.captureAccumulator[target] += data[source];
      this.captureAccumulator[target + 1] += data[source + 1];
      this.captureAccumulator[target + 2] += data[source + 2];
    }
    this.captureCount += 1;
    this.metrics.captureProgress = this.captureCount / this.captureTarget;
    if (this.captureCount >= this.captureTarget) {
      this.background = new Float32Array(this.pixelCount * 3);
      for (let index = 0; index < this.background.length; index += 1) {
        this.background[index] = this.captureAccumulator[index] / this.captureCount;
      }
      this.captureAccumulator = null;
      this.metrics.backgroundReady = true;
      this.metrics.captureProgress = 1;
      return true;
    }
    return false;
  }

  process(imageData, dtSeconds = 1 / 30) {
    this.#assertFrame(imageData);
    const started = performance.now();
    if (this.capturing) this.addCaptureFrame(imageData);
    if (!this.background) {
      this.filteredMask.fill(0);
      this.components = [];
      this.metrics.processingMs = performance.now() - started;
      this.metrics.foregroundPixels = 0;
      this.metrics.componentCount = 0;
      return this.result();
    }

    const data = imageData.data;
    let deltaSum = 0;
    let samples = 0;
    for (let pixel = 0; pixel < this.pixelCount; pixel += 7) {
      const source = pixel * 4;
      const target = pixel * 3;
      deltaSum += luminance(data[source], data[source + 1], data[source + 2])
        - luminance(this.background[target], this.background[target + 1], this.background[target + 2]);
      samples += 1;
    }
    const globalDelta = samples ? deltaSum / samples : 0;
    const threshold = this.diffThreshold;

    for (let pixel = 0, source = 0, target = 0; pixel < this.pixelCount; pixel += 1, source += 4, target += 3) {
      const cr = data[source];
      const cg = data[source + 1];
      const cb = data[source + 2];
      const br = this.background[target];
      const bg = this.background[target + 1];
      const bb = this.background[target + 2];
      const ar = cr - globalDelta;
      const ag = cg - globalDelta;
      const ab = cb - globalDelta;
      const rgbDiff = (Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)) / 3;
      const currentLum = luminance(cr, cg, cb);
      const backgroundLum = luminance(br, bg, bb);
      const adjustedLumDiff = Math.abs((currentLum - globalDelta) - backgroundLum);
      const currentRg = cr - cg;
      const currentGb = cg - cb;
      const backgroundRg = br - bg;
      const backgroundGb = bg - bb;
      const chromaDiff = (Math.abs(currentRg - backgroundRg) + Math.abs(currentGb - backgroundGb)) * 0.5;
      const score = rgbDiff * 0.74 + adjustedLumDiff * 0.42 + chromaDiff * 0.58;
      const ratio = currentLum / Math.max(8, backgroundLum);
      const likelyShadow = ratio > 0.48 && ratio < 0.96 && chromaDiff < threshold * 0.28 && currentLum < backgroundLum;
      this.rawMask[pixel] = score >= threshold && !likelyShadow ? 255 : 0;
    }

    this.#majorityFilter(this.rawMask, this.tempMask, 3);
    this.#dilate(this.tempMask, this.rawMask);
    this.#majorityFilter(this.rawMask, this.tempMask, 4);
    this.#filterComponents(this.tempMask, this.filteredMask);

    const alpha = 1 - Math.exp(-clamp(dtSeconds, 0, 0.25) * this.backgroundAdaptPerSecond);
    const lightOnly = Math.abs(globalDelta) > threshold * 0.45 && this.metrics.foregroundPixels < this.pixelCount * 0.02;
    const effectiveAlpha = lightOnly ? Math.max(alpha, 0.035) : alpha;
    for (let pixel = 0, source = 0, target = 0; pixel < this.pixelCount; pixel += 1, source += 4, target += 3) {
      if (this.filteredMask[pixel]) continue;
      this.background[target] += (data[source] - this.background[target]) * effectiveAlpha;
      this.background[target + 1] += (data[source + 1] - this.background[target + 1]) * effectiveAlpha;
      this.background[target + 2] += (data[source + 2] - this.background[target + 2]) * effectiveAlpha;
    }

    this.metrics.processingMs = performance.now() - started;
    this.metrics.globalLightDelta = globalDelta;
    this.metrics.backgroundReady = true;
    this.metrics.captureProgress = 1;
    return this.result();
  }

  result() {
    return {
      mask: this.filteredMask,
      components: this.components,
      metrics: { ...this.metrics },
      width: this.width,
      height: this.height,
    };
  }

  #majorityFilter(source, destination, minimumNeighbors) {
    const { width, height } = this;
    destination.fill(0);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          const row = (y + oy) * width;
          for (let ox = -1; ox <= 1; ox += 1) count += source[row + x + ox] ? 1 : 0;
        }
        destination[y * width + x] = count >= minimumNeighbors ? 255 : 0;
      }
    }
  }

  #dilate(source, destination) {
    const { width, height } = this;
    destination.fill(0);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (!source[index]) continue;
        for (let oy = -1; oy <= 1; oy += 1) {
          const row = (y + oy) * width;
          for (let ox = -1; ox <= 1; ox += 1) destination[row + x + ox] = 255;
        }
      }
    }
  }

  #filterComponents(source, destination) {
    const { width, height } = this;
    destination.fill(0);
    this.visited.fill(0);
    this.components = [];
    let foregroundPixels = 0;
    for (let start = 0; start < source.length; start += 1) {
      if (!source[start] || this.visited[start]) continue;
      let head = 0;
      let tail = 0;
      this.queue[tail++] = start;
      this.visited[start] = 1;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      while (head < tail) {
        const index = this.queue[head++];
        const x = index % width;
        const y = Math.floor(index / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        for (let oy = -1; oy <= 1; oy += 1) {
          const ny = y + oy;
          if (ny < 0 || ny >= height) continue;
          for (let ox = -1; ox <= 1; ox += 1) {
            const nx = x + ox;
            if (nx < 0 || nx >= width || (ox === 0 && oy === 0)) continue;
            const neighbor = ny * width + nx;
            if (source[neighbor] && !this.visited[neighbor]) {
              this.visited[neighbor] = 1;
              this.queue[tail++] = neighbor;
            }
          }
        }
      }
      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      const valid = tail >= this.minComponentArea && boxWidth >= 4 && boxHeight >= 5;
      if (!valid) continue;
      for (let index = 0; index < tail; index += 1) destination[this.queue[index]] = 255;
      foregroundPixels += tail;
      this.components.push({ x: minX, y: minY, w: boxWidth, h: boxHeight, area: tail });
    }
    this.metrics.foregroundPixels = foregroundPixels;
    this.metrics.componentCount = this.components.length;
  }

  #assertFrame(imageData) {
    if (!imageData || imageData.width !== this.width || imageData.height !== this.height || !imageData.data || imageData.data.length !== this.pixelCount * 4) {
      throw new TypeError(`Expected ${this.width}×${this.height} ImageData.`);
    }
  }
}
