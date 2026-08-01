const DEFAULT_SCORE_THRESHOLD = 0.50;
const DEFAULT_INFERENCE_INTERVAL_MS = 140;
const DEFAULT_HOLD_MS = 420;
const TFLITE_INFO_MESSAGE = 'Created TensorFlow Lite XNNPACK delegate for CPU';

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function extractPersonDetections(detections, width, height, scoreThreshold = DEFAULT_SCORE_THRESHOLD) {
  const people = [];
  for (const detection of detections || []) {
    const category = detection?.categories?.find((item) => item?.categoryName === 'person');
    const box = detection?.boundingBox;
    const score = finite(category?.score, 0);
    if (!category || !box || score < scoreThreshold) continue;
    const originX = finite(box.originX);
    const originY = finite(box.originY);
    const x = Math.max(0, Math.min(width, originX));
    const y = Math.max(0, Math.min(height, originY));
    const right = Math.max(x, Math.min(width, originX + Math.max(0, finite(box.width))));
    const bottom = Math.max(y, Math.min(height, originY + Math.max(0, finite(box.height))));
    if (right - x < 2 || bottom - y < 2) continue;
    people.push({ x, y, w: right - x, h: bottom - y, score, label: 'person' });
  }
  return people.sort((a, b) => b.score - a.score);
}

export function buildPersonMask(width, height, people) {
  const mask = new Uint8Array(width * height);
  for (const person of people || []) {
    const left = Math.max(0, Math.floor(person.x));
    const top = Math.max(0, Math.floor(person.y));
    const right = Math.min(width, Math.ceil(person.x + person.w));
    const bottom = Math.min(height, Math.ceil(person.y + person.h));
    const cx = person.x + person.w * 0.5;
    const cy = person.y + person.h * 0.54;
    const rx = Math.max(1, person.w * 0.43);
    const ry = Math.max(1, person.h * 0.50);
    for (let y = top; y < bottom; y += 1) {
      const dy = ((y + 0.5) - cy) / ry;
      for (let x = left; x < right; x += 1) {
        const dx = ((x + 0.5) - cx) / rx;
        if (dx * dx + dy * dy <= 1) mask[y * width + x] = 255;
      }
    }
  }
  return mask;
}

export class PersonDetector extends EventTarget {
  constructor(width, height, options = {}) {
    super();
    this.width = width;
    this.height = height;
    this.scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
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
      model: 'EfficientDet Lite0',
      delegate: this.delegate,
      semanticPersonOnly: true,
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
    const { FilesetResolver, ObjectDetector } = await import('../../vendor/mediapipe/vision_bundle.mjs');
    const wasmRoot = new URL('../../vendor/mediapipe/wasm', import.meta.url).href.replace(/\/$/, '');
    const modelAssetPath = new URL('../../assets/models/efficientdet_lite0_uint8.tflite', import.meta.url).href;
    const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
    const options = {
      baseOptions: { modelAssetPath },
      runningMode: 'VIDEO',
      maxResults: 8,
      scoreThreshold: this.scoreThreshold,
      categoryAllowlist: ['person'],
    };
    // CPU is deliberate: EfficientDet's TFLite post-process is only partially
    // supported by WebGL and can fail after a camera source is replaced.
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
      this.detector = await ObjectDetector.createFromOptions(fileset, options);
    } finally {
      if (console.error === filteredConsoleError) console.error = originalConsoleError;
    }
    this.delegate = 'CPU';
  }

  process(frame, timestamp) {
    if (!frame || !this.detector || this.state !== 'ready') return this.result();
    if (timestamp - this.lastInferenceAt < this.inferenceIntervalMs) {
      if (timestamp - this.lastDetectionAt > this.holdMs) this.#setPeople([]);
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
      const result = this.detector.detectForVideo(this.canvas, monotonicTimestamp);
      const people = extractPersonDetections(result?.detections, this.width, this.height, this.scoreThreshold);
      this.lastInferenceAt = monotonicTimestamp;
      this.lastTimestamp = monotonicTimestamp;
      if (people.length) {
        this.lastDetectionAt = monotonicTimestamp;
        this.#setPeople(people);
      } else if (monotonicTimestamp - this.lastDetectionAt > this.holdMs) {
        this.#setPeople([]);
      }
      const elapsed = performance.now() - started;
      this.metrics.processingMs = elapsed;
      this.metrics.inferenceFps = elapsed > 0 ? Math.min(1000 / this.inferenceIntervalMs, 1000 / elapsed) : 0;
    } catch (error) {
      this.state = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      this.#setPeople([]);
      this.#notify();
    }
    return this.result();
  }

  reset() {
    this.components = [];
    this.mask.fill(0);
    this.lastDetectionAt = -Infinity;
  }

  #setPeople(people) {
    this.components = people;
    this.mask = buildPersonMask(this.width, this.height, people);
    let foregroundPixels = 0;
    for (const value of this.mask) if (value) foregroundPixels += 1;
    this.metrics.foregroundPixels = foregroundPixels;
    this.metrics.componentCount = people.length;
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
