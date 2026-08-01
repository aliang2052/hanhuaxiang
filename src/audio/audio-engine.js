export class AudioEngine extends EventTarget {
  constructor(groups, nodes) {
    super();
    this.groups = groups;
    this.nodes = nodes;
    this.context = null;
    this.master = null;
    this.groupNodes = new Map();
    this.started = false;
    this.loading = false;
    this.muted = false;
    this.errors = [];
    this.state = 'idle';
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
      this.master.connect(this.context.destination);
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
        gain.gain.value = group.id === 'ambience' ? 0.13 : 0.0001;
        source.connect(gain).connect(this.master);
        source.start(startTime);
        this.groupNodes.set(group.id, { source, gain, group });
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

  update(visual) {
    if (!this.started || !this.context) return;
    const intensity = new Map(this.groups.map((group) => [group.id, group.id === 'ambience' ? 0.13 : 0]));
    for (const node of this.nodes) {
      const value = visual[node.id] || 0;
      intensity.set(node.audioGroup, Math.max(intensity.get(node.audioGroup) || 0, value));
    }
    const now = this.context.currentTime;
    for (const [id, entry] of this.groupNodes) {
      const groupIntensity = intensity.get(id) || 0;
      const baseGain = entry.group.gain ?? 0.3;
      const target = id === 'ambience' ? baseGain : Math.max(0.0001, groupIntensity * baseGain);
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setTargetAtTime(target, now, groupIntensity > 0.1 ? 0.08 : 0.28);
    }
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
      return true;
    } catch {
      return false;
    }
  }

  async recover() {
    if (!this.context) return this.init();
    return this.resume();
  }

  snapshot() {
    return {
      state: this.state,
      started: this.started,
      muted: this.muted,
      loadedGroups: this.groupNodes.size,
      requestedGroups: this.groups.length,
      errors: [...this.errors],
    };
  }
}
