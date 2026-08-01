/** @param {number} value @param {number} [min] @param {number} [max] */
export function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

/** @param {number} a @param {number} b @param {number} t */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** @param {number} a @param {number} b @param {number} x */
export function smoothstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** @param {number} value @param {number} target @param {number} rate @param {number} dt */
export function damp(value, target, rate, dt) {
  return lerp(value, target, 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt)));
}

/** @param {string} hex */
export function hexToRgb(hex) {
  const normalized = hex.replace('#', '').trim();
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

/** @param {{x:number,y:number}[]} points */
export function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

/** @param {{x:number,y:number}} a @param {{x:number,y:number}} b @param {{x:number,y:number}} c */
export function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** @param {{x:number,y:number}} a @param {{x:number,y:number}} b @param {{x:number,y:number}} c @param {{x:number,y:number}} d */
export function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
}

/** @param {{x:number,y:number}} point @param {{x:number,y:number}[]} polygon */
export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** @param {number} width @param {number} height @param {number} maxPixels @param {number} [devicePixelRatio] */
export function computeBackingSize(width, height, maxPixels = 2_500_000, devicePixelRatio = 1) {
  const cssWidth = Math.max(1, Math.round(width));
  const cssHeight = Math.max(1, Math.round(height));
  const requestedScale = clamp(devicePixelRatio, 1, 2);
  const requestedPixels = cssWidth * cssHeight * requestedScale * requestedScale;
  const pixelScale = requestedPixels > maxPixels ? Math.sqrt(maxPixels / (cssWidth * cssHeight)) : requestedScale;
  return {
    cssWidth,
    cssHeight,
    scale: pixelScale,
    width: Math.max(1, Math.round(cssWidth * pixelScale)),
    height: Math.max(1, Math.round(cssHeight * pixelScale)),
  };
}

/** @param {DOMRect|{left:number,top:number,width:number,height:number}} rect @param {number} clientX @param {number} clientY */
export function normalizedPointFromClient(rect, clientX, clientY) {
  return {
    x: clamp((clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp((clientY - rect.top) / Math.max(1, rect.height)),
  };
}

/** Stable 0..1 pseudo-random value for deterministic visual variation. */
export function hashNumber(value) {
  const x = Math.sin(Number(value) * 12.9898 + 78.233) * 43758.5453123;
  return x - Math.floor(x);
}
