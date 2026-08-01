import { clamp } from '../core/math.js';

export class SimulatedCamera extends EventTarget {
  constructor(width = 240, height = 135) {
    super();
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.connected = false;
    this.state = 'idle';
    this.scenario = 'empty';
    this.reconnectAttempts = 0;
    this.reconnectTimer = 0;
  }

  async start() {
    this.connected = true;
    this.#setState('live');
    return true;
  }

  stop() {
    clearTimeout(this.reconnectTimer);
    this.connected = false;
    this.#setState('idle');
  }

  setScenario(scenario) {
    const allowed = ['empty', 'single', 'double', 'light-shift', 'moving'];
    this.scenario = allowed.includes(scenario) ? scenario : 'empty';
  }

  simulateDisconnect(autoReconnect = true) {
    clearTimeout(this.reconnectTimer);
    this.connected = false;
    this.#setState('disconnected');
    if (autoReconnect) {
      this.reconnectAttempts += 1;
      this.#setState('reconnecting');
      this.reconnectTimer = window.setTimeout(() => {
        this.connected = true;
        this.#setState('live');
      }, 450);
    }
  }

  getFrame(now = performance.now()) {
    if (!this.connected) return null;
    const ctx = this.ctx;
    const light = this.scenario === 'light-shift' ? 38 : 0;
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, `rgb(${72 + light},${76 + light},${74 + light})`);
    gradient.addColorStop(1, `rgb(${106 + light},${102 + light},${94 + light})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = `rgba(${36 + light},${38 + light},${36 + light},0.55)`;
    ctx.fillRect(0, this.height * 0.78, this.width, this.height * 0.22);
    ctx.fillStyle = `rgba(${135 + light},${128 + light},${112 + light},0.24)`;
    for (let x = 0; x < this.width; x += 24) ctx.fillRect(x, 0, 1, this.height);

    if (this.scenario === 'single' || this.scenario === 'double' || this.scenario === 'moving') {
      const movingX = this.scenario === 'moving' ? 0.5 + Math.sin(now * 0.0008) * 0.25 : 0.42;
      this.#drawPerson(movingX, 0.63, 0.12, 0.45, '#24282a');
    }
    if (this.scenario === 'double') this.#drawPerson(0.73, 0.61, 0.11, 0.42, '#332a29');
    return ctx.getImageData(0, 0, this.width, this.height);
  }

  #drawPerson(cx, footY, widthRatio, heightRatio, color) {
    const ctx = this.ctx;
    const x = cx * this.width;
    const foot = footY * this.height;
    const bodyWidth = widthRatio * this.width;
    const bodyHeight = heightRatio * this.height;
    const headRadius = bodyWidth * 0.28;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, foot - bodyHeight + headRadius * 1.05, headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x - bodyWidth * 0.42, foot - bodyHeight + headRadius * 2, bodyWidth * 0.84, bodyHeight * 0.58, bodyWidth * 0.2);
    ctx.fill();
    ctx.lineWidth = Math.max(3, bodyWidth * 0.16);
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - bodyWidth * 0.18, foot - bodyHeight * 0.38);
    ctx.lineTo(x - bodyWidth * 0.27, foot);
    ctx.moveTo(x + bodyWidth * 0.18, foot - bodyHeight * 0.38);
    ctx.lineTo(x + bodyWidth * 0.27, foot);
    ctx.moveTo(x - bodyWidth * 0.34, foot - bodyHeight * 0.67);
    ctx.lineTo(x - bodyWidth * 0.63, foot - bodyHeight * 0.44);
    ctx.moveTo(x + bodyWidth * 0.34, foot - bodyHeight * 0.67);
    ctx.lineTo(x + bodyWidth * 0.58, foot - bodyHeight * 0.48);
    ctx.stroke();
    ctx.restore();
  }

  #setState(state) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('statechange', { detail: { state, reconnectAttempts: this.reconnectAttempts } }));
  }
}
