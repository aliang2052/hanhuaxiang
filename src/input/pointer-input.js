export class PointerInput extends EventTarget {
  constructor(element, viewport) {
    super();
    this.element = element;
    this.viewport = viewport;
    this.people = new Map();
    this.enabled = false;
    this.handlers = {
      pointerdown: (event) => this.#onDown(event),
      pointermove: (event) => this.#onMove(event),
      pointerup: (event) => this.#onUp(event),
      pointercancel: (event) => this.#onUp(event),
      lostpointercapture: (event) => this.#onUp(event),
    };
    for (const [name, handler] of Object.entries(this.handlers)) element.addEventListener(name, handler);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.people.clear();
  }

  #personFromEvent(event) {
    const point = this.viewport.clientToNormalized(event.clientX, event.clientY);
    const isTouch = event.pointerType === 'touch';
    return {
      id: event.pointerId,
      x: point.x,
      y: point.y,
      rx: isTouch ? 0.105 : 0.09,
      ry: isTouch ? 0.245 : 0.21,
      pressure: Number.isFinite(event.pressure) && event.pressure > 0 ? event.pressure : 0.65,
    };
  }

  #onDown(event) {
    if (!this.enabled) return;
    event.preventDefault();
    try { this.element.setPointerCapture(event.pointerId); } catch {}
    this.people.set(event.pointerId, this.#personFromEvent(event));
    this.dispatchEvent(new Event('change'));
  }

  #onMove(event) {
    if (!this.enabled || !this.people.has(event.pointerId)) return;
    event.preventDefault();
    this.people.set(event.pointerId, this.#personFromEvent(event));
    this.dispatchEvent(new Event('change'));
  }

  #onUp(event) {
    if (!this.people.has(event.pointerId)) return;
    this.people.delete(event.pointerId);
    this.dispatchEvent(new Event('change'));
  }

  snapshot() {
    return [...this.people.values()].map((person) => ({ ...person }));
  }

  destroy() {
    for (const [name, handler] of Object.entries(this.handlers)) this.element.removeEventListener(name, handler);
    this.people.clear();
  }
}
