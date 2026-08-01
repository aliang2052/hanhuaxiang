export function buildSpatialMix(groups, nodes, visual, coverages, orientation = 'landscape') {
  const mix = new Map(groups.map((group) => [group.id, { intensity: 0, panSum: 0, panWeight: 0 }]));
  for (const node of nodes) {
    const gate = Math.max(0, Math.min(1, Number(visual[node.id]) || 0));
    const coverage = Math.max(0, Math.min(1, Number(coverages?.[node.id] ?? gate) || 0));
    const intensity = gate * Math.min(1, coverage / 0.28);
    if (intensity <= 0) continue;
    const entry = mix.get(node.audioGroup);
    if (!entry) continue;
    const layout = node[orientation] || node.landscape;
    const centerX = layout ? layout.x + layout.w * 0.5 : 0.5;
    const pan = Math.max(-0.82, Math.min(0.82, (centerX * 2 - 1) * 0.82));
    entry.intensity = Math.max(entry.intensity, intensity);
    entry.panSum += pan * intensity;
    entry.panWeight += intensity;
  }
  return new Map([...mix].map(([id, entry]) => [id, {
    intensity: entry.intensity,
    pan: entry.panWeight > 0 ? entry.panSum / entry.panWeight : 0,
  }]));
}

export class AudioEngine extends EventTarget {
  constructor(groups, nodes) {
    super();
    this.groups = groups;
    this.nodes = nodes;
    this.context = null;
    this.master = null;
    this.analyser = null;
    this.meterData = null;
    this.groupNodes = new Map();
    this.started = false;
    this.loading = false;
    this.muted = false;
    this.errors = [];
    this.state = 'idle';
    this.lastMix = {};
  }

  async init() {
    if (this.started) {
      await this.resume();
      return { ok: true, errors: this.errors };
    }
    if (this.loading) return new Promise((resolve) => this.addEventListener('ready', () => resolve({ ok: this.started, errors: this.errors }), { once: true }));
    this.loading = true;
    this.state = 'loading';
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      this.errors.push('当前浏览器不支持 Web Audio。');
      this.state = 'unsupported';
      this.loading = false;
      this.dispatchEvent(new CustomEvent('ready', { detail: this.snapshot() }));
      return { ok: false, errors: this.errors };
    }
    try {
      this.context = new AudioContextConstructor({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.74;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.meterData = new Float32Array(this.analyser.fftSize);
      this.master.connect(this.analyser).connect(this.context.destination);
      const loaded = [];
      for (const group of this.groups) {
        try {
          const response = await fetch(group.file, { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
          loaded.push({ group, buffer });
        } catch (error) {
          this.errors.push(`${group.label || group.id} 音频加载失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const startTime = this.context.currentTime + 0.09;
      for (const { group, buffer } of loaded) {
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = this.context.createGain();
        const panner = typeof this.context.createStereoPanner === 'function' ? this.context.createStereoPanner() : null;
        gain.gain.value = group.id === 'ambience' ? 0.13 : 0.0001;
        source.connect(gain);
        if (panner) gain.connect(panner).connect(this.master);
        else gain.connect(this.master);
        source.start(startTime);
        this.groupNodes.set(group.id, { source, gain, panner, group });
      }
      this.started = true;
      this.state = this.errors.length ? 'ready-with-errors' : 'ready';
      await this.context.resume().catch(() => {});
    } catch (error) {
      this.errors.push(`音频引擎初始化失败：${error instanceof Error ? error.message : String(error)}`);
      this.state = 'error';
    } finally {
      this.loading = false;
      this.dispatchEvent(new CustomEvent('ready', { detail: this.snapshot() }));
    }
    return { ok: this.started, errors: this.errors };
  }

  update(visual, coverages = visual, orientation = 'landscape') {
    if (!this.started || !this.context) return;
    const mix = buildSpatialMix(this.groups, this.nodes, visual, coverages, orientation);
    const now = this.context.currentTime;
    for (const [id, entry] of this.groupNodes) {
      const spatial = mix.get(id) || { intensity: 0, pan: 0 };
      const groupIntensity = spatial.intensity;
      const baseGain = entry.group.gain ?? 0.3;
      const target = id === 'ambience' ? baseGain : Math.max(0.0001, groupIntensity * baseGain);
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setTargetAtTime(target, now, groupIntensity > 0.1 ? 0.06 : 0.18);
      if (entry.panner) {
        entry.panner.pan.cancelScheduledValues(now);
        entry.panner.pan.setTargetAtTime(id === 'ambience' ? 0 : spatial.pan, now, 0.08);
      }
    }
    this.lastMix = Object.fromEntries([...mix].map(([id, value]) => [id, { ...value }]));
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.master || !this.context) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.74, now, 0.05);
  }

  async resume() {
    if (!this.context) return false;
    try {
      await this.context.resume();
      return this.context.state === 'running';
    } catch {
      return false;
    }
  }

  async recover() {
    if (!this.context) {
      const result = await this.init();
      return Boolean(result.ok && this.context?.state === 'running');
    }
    return this.resume();
  }

  async testTone(durationSeconds = 0.42) {
    if (!this.context) {
      const result = await this.init();
      if (!result.ok) return false;
    }
    if (!await this.resume()) return false;
    const now = this.context.currentTime;
    const duration = Math.max(0.15, Math.min(1.2, Number(durationSeconds) || 0.42));
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(523.25, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    return true;
  }

  outputLevel() {
    if (!this.analyser || !this.meterData || this.context?.state !== 'running') return 0;
    this.analyser.getFloatTimeDomainData(this.meterData);
    let squares = 0;
    for (const sample of this.meterData) squares += sample * sample;
    return Math.sqrt(squares / this.meterData.length);
  }

  snapshot() {
    return {
      state: this.state,
      contextState: this.context?.state || 'uninitialized',
      started: this.started,
      muted: this.muted,
      loadedGroups: this.groupNodes.size,
      requestedGroups: this.groups.length,
      outputLevel: this.outputLevel(),
      spatialMix: structuredClone(this.lastMix),
      errors: [...this.errors],
    };
  }
}
