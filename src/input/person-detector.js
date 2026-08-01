const DEFAULT_MASK_THRESHOLD = 0.55;
const DEFAULT_INFERENCE_INTERVAL_MS = 120;
const DEFAULT_HOLD_MS = 320;
const TFLITE_INFO_MESSAGE = 'Created TensorFlow Lite XNNPACK delegate for CPU';

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function majorityFilter(source, width, height) {
  const output = new Uint8Array(source.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let count = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        const row = (y + oy) * width;
        for (let ox = -1; ox <= 1; ox += 1) count += source[row + x + ox] ? 1 : 0;
      }
      output[y * width + x] = count >= 4 ? 255 : 0;
    }
  }
  return output;
}

function mergeNearbyComponents(components, width, height) {
  const merged = components.map((component) => ({ ...component }));
  const padding = Math.max(4, Math.round(Math.min(width, height) * 0.035));
  let changed = true;
  while (changed) {
    changed = false;
    for (let left = 0; left < merged.length && !changed; left += 1) {
      for (let right = left + 1; right < merged.length; right += 1) {
        const a = merged[left];
        const b = merged[right];
        const separated = a.x + a.w + padding < b.x
          || b.x + b.w + padding < a.x
          || a.y + a.h + padding < b.y
          || b.y + b.h + padding < a.y;
        if (separated) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const maxX = Math.max(a.x + a.w, b.x + b.w);
        const maxY = Math.max(a.y + a.h, b.y + b.h);
        const area = a.area + b.area;
        merged[left] = {
          x,
          y,
          w: maxX - x,
          h: maxY - y,
          area,
          score: (a.score * a.area + b.score * b.area) / area,
          label: 'person',
        };
        merged.splice(right, 1);
        changed = true;
        break;
      }
    }
  }
  return merged;
}

/** Convert the model's per-pixel human confidence into a clean, exact silhouette. */
export function buildPersonSilhouette(
  confidence,
  sourceWidth,
  sourceHeight,
  width,
  height,
  threshold = DEFAULT_MASK_THRESHOLD,
) {
  if (!confidence || confidence.length !== sourceWidth * sourceHeight) {
    throw new TypeError('Person confidence mask dimensions do not match its data.');
  }
  const raw = new Uint8Array(width * height);
  const scores = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / width));
      const score = finite(confidence[sourceY * sourceWidth + sourceX]);
      const index = y * width + x;
      scores[index] = score;
      raw[index] = score >= threshold ? 255 : 0;
    }
  }

  const filtered = majorityFilter(raw, width, height);
  const mask = new Uint8Array(filtered.length);
  const visited = new Uint8Array(filtered.length);
  const queue = new Int32Array(filtered.length);
  const components = [];
  const minArea = Math.max(80, Math.round(width * height * 0.0015));
  let foregroundPixels = 0;

  for (let start = 0; start < filtered.length; start += 1) {
    if (!filtered[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let scoreSum = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      scoreSum += scores[index];
      for (let oy = -1; oy <= 1; oy += 1) {
        const ny = y + oy;
        if (ny < 0 || ny >= height) continue;
        for (let ox = -1; ox <= 1; ox += 1) {
          const nx = x + ox;
          if (nx < 0 || nx >= width || (ox === 0 && oy === 0)) continue;
          const neighbor = ny * width + nx;
          if (filtered[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1;
            queue[tail++] = neighbor;
          }
        }
      }
    }
    if (tail < minArea || maxX - minX < 4 || maxY - minY < 5) continue;
    for (let index = 0; index < tail; index += 1) mask[queue[index]] = 255;
    foregroundPixels += tail;
    components.push({
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      area: tail,
      score: scoreSum / tail,
      label: 'person',
    });
  }

  const people = mergeNearbyComponents(components, width, height).sort((a, b) => b.area - a.area);
  return { mask, components: people, foregroundPixels };
}

export class PersonDetector extends EventTarget {
  constructor(width, height, options = {}) {
    super();
    this.width = width;
    this.height = height;
    this.maskThreshold = options.maskThreshold ?? DEFAULT_MASK_THRESHOLD;
    this.inferenceIntervalMs = options.inferenceIntervalMs ?? DEFAULT_INFERENCE_INTERVAL_MS;
    this.holdMs = options.holdMs ?? DEFAULT_HOLD_MS;
    this.detector = null;
    this.initializing = null;
    this.state = 'idle';
    this.error = '';
    this.delegate = 'none';
    this.lastInferenceAt = -Infinity;
    this.lastDetectionAt = -Infinity;
    this.lastTimestamp = -1;
    this.canvas = null;
    this.context = null;
    this.components = [];
    this.mask = new Uint8Array(width * height);
    this.metrics = {
      processingMs: 0,
      foregroundPixels: 0,
      componentCount: 0,
      inferenceFps: 0,
      detectorState: this.state,
      model: 'MediaPipe Selfie Segmenter Landscape',
      delegate: this.delegate,
      semanticPersonOnly: true,
      silhouetteMask: true,
    };
  }

  async initialize() {
    if (this.detector && this.state === 'ready') return true;
    if (this.initializing) return this.initializing;
    if (this.detector) {
      try { this.detector.close(); } catch { /* Recreate after a failed inference. */ }
      this.detector = null;
    }
    this.state = 'loading';
    this.error = '';
    this.#notify();
    this.initializing = this.#createDetector()
      .then(() => {
        this.state = 'ready';
        this.#notify();
        return true;
      })
      .catch((error) => {
        this.state = 'error';
        this.error = error instanceof Error ? error.message : String(error);
        this.#notify();
        return false;
      })
      .finally(() => { this.initializing = null; });
    return this.initializing;
  }

  async #createDetector() {
    const { FilesetResolver, ImageSegmenter } = await import('../../vendor/mediapipe/vision_bundle.mjs');
    const wasmRoot = new URL('../../vendor/mediapipe/wasm', import.meta.url).href.replace(/\/$/, '');
    const modelAssetPath = new URL('../../assets/models/selfie_segmenter_landscape.tflite', import.meta.url).href;
    const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
    const options = {
      baseOptions: { modelAssetPath },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    };
    const originalConsoleError = console.error;
    const filteredConsoleError = (...args) => {
      const message = args.map((value) => String(value)).join(' ');
      if (message.includes(TFLITE_INFO_MESSAGE)) {
        console.info(...args);
        return;
      }
      originalConsoleError(...args);
    };
    console.error = filteredConsoleError;
    try {
      this.detector = await ImageSegmenter.createFromOptions(fileset, options);
    } finally {
      if (console.error === filteredConsoleError) console.error = originalConsoleError;
    }
    this.delegate = 'CPU';
  }

  process(frame, timestamp) {
    if (!frame || !this.detector || this.state !== 'ready') return this.result();
    if (timestamp - this.lastInferenceAt < this.inferenceIntervalMs) {
      if (timestamp - this.lastDetectionAt > this.holdMs) this.#setSilhouette(null);
      return this.result();
    }
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.context = this.canvas.getContext('2d', { willReadFrequently: false });
    }
    this.context.putImageData(frame, 0, 0);
    const monotonicTimestamp = Math.max(finite(timestamp), this.lastTimestamp + 0.01);
    const started = performance.now();
    try {
      let silhouette = null;
      this.detector.segmentForVideo(this.canvas, monotonicTimestamp, (result) => {
        const confidenceMask = result?.confidenceMasks?.[0];
        if (!confidenceMask) throw new Error('人物分割模型没有返回置信度 Mask。');
        silhouette = buildPersonSilhouette(
          confidenceMask.getAsFloat32Array(),
          confidenceMask.width,
          confidenceMask.height,
          this.width,
          this.height,
          this.maskThreshold,
        );
      });
      if (!silhouette) throw new Error('人物分割模型没有返回结果。');
      this.lastInferenceAt = monotonicTimestamp;
      this.lastTimestamp = monotonicTimestamp;
      if (silhouette.components.length) {
        this.lastDetectionAt = monotonicTimestamp;
        this.#setSilhouette(silhouette);
      } else if (monotonicTimestamp - this.lastDetectionAt > this.holdMs) {
        this.#setSilhouette(silhouette);
      }
      const elapsed = performance.now() - started;
      this.metrics.processingMs = elapsed;
      this.metrics.inferenceFps = elapsed > 0 ? Math.min(1000 / this.inferenceIntervalMs, 1000 / elapsed) : 0;
    } catch (error) {
      this.state = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      this.#setSilhouette(null);
      this.#notify();
    }
    return this.result();
  }

  reset() {
    this.#setSilhouette(null);
    this.lastDetectionAt = -Infinity;
  }

  #setSilhouette(silhouette) {
    this.mask = silhouette?.mask || new Uint8Array(this.width * this.height);
    this.components = silhouette?.components || [];
    this.metrics.foregroundPixels = silhouette?.foregroundPixels || 0;
    this.metrics.componentCount = this.components.length;
  }

  #notify() {
    this.metrics.detectorState = this.state;
    this.metrics.delegate = this.delegate;
    this.dispatchEvent(new CustomEvent('statechange', { detail: this.snapshot() }));
  }

  snapshot() {
    return {
      state: this.state,
      ready: this.state === 'ready',
      error: this.error,
      model: this.metrics.model,
      delegate: this.delegate,
      semanticPersonOnly: true,
      silhouetteMask: true,
    };
  }

  result() {
    this.metrics.detectorState = this.state;
    this.metrics.delegate = this.delegate;
    return {
      width: this.width,
      height: this.height,
      mask: this.mask,
      components: this.components,
      metrics: { ...this.metrics },
    };
  }
}
