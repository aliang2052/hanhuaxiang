import { clamp } from '../core/math.js';

export class TriggerHysteresis {
  constructor(count, options = {}) {
    this.count = count;
    this.onThreshold = options.onThreshold ?? 0.065;
    this.offThreshold = options.offThreshold ?? 0.028;
    this.onFrames = options.onFrames ?? 2;
    this.offFrames = options.offFrames ?? 6;
    this.attackSeconds = options.attackSeconds ?? 0.16;
    this.releaseSeconds = options.releaseSeconds ?? 0.52;
    this.active = new Uint8Array(count);
    this.onCounters = new Uint16Array(count);
    this.offCounters = new Uint16Array(count);
    this.visual = new Float32Array(count);
    this.forceUntil = 0;
  }

  configure(options = {}) {
    if (Number.isFinite(options.onThreshold)) this.onThreshold = clamp(options.onThreshold, 0.001, 0.9);
    if (Number.isFinite(options.offThreshold)) this.offThreshold = clamp(options.offThreshold, 0.0005, this.onThreshold * 0.95);
    if (Number.isFinite(options.onFrames)) this.onFrames = Math.max(1, Math.round(options.onFrames));
    if (Number.isFinite(options.offFrames)) this.offFrames = Math.max(1, Math.round(options.offFrames));
  }

  forceWake(durationMs = 6500, now = performance.now()) {
    this.forceUntil = Math.max(this.forceUntil, now + durationMs);
  }

  reset() {
    this.active.fill(0);
    this.onCounters.fill(0);
    this.offCounters.fill(0);
    this.visual.fill(0);
    this.forceUntil = 0;
  }

  update(coverages, dtSeconds, now = performance.now()) {
    if (!coverages || coverages.length !== this.count) throw new TypeError('Coverage vector has invalid length.');
    const forced = now < this.forceUntil;
    const dt = clamp(dtSeconds, 0, 0.25);
    for (let index = 0; index < this.count; index += 1) {
      const coverage = forced ? 1 : coverages[index] || 0;
      if (forced) {
        this.active[index] = 1;
        this.onCounters[index] = 0;
        this.offCounters[index] = 0;
      }
      if (this.active[index]) {
        if (coverage < this.offThreshold) {
          this.offCounters[index] += 1;
          if (this.offCounters[index] >= this.offFrames) {
            this.active[index] = 0;
            this.offCounters[index] = 0;
          }
        } else {
          this.offCounters[index] = 0;
        }
      } else if (coverage >= this.onThreshold) {
        this.onCounters[index] += 1;
        if (this.onCounters[index] >= this.onFrames) {
          this.active[index] = 1;
          this.onCounters[index] = 0;
        }
      } else {
        this.onCounters[index] = 0;
      }
      const target = this.active[index] || forced ? 1 : 0;
      const seconds = target > this.visual[index] ? this.attackSeconds : this.releaseSeconds;
      const alpha = seconds <= 0 ? 1 : 1 - Math.exp(-dt / seconds);
      this.visual[index] += (target - this.visual[index]) * alpha;
      if (Math.abs(target - this.visual[index]) < 0.0005) this.visual[index] = target;
    }
    return { active: this.active, visual: this.visual, activeCount: this.active.reduce((sum, value) => sum + value, 0), forced };
  }
}
