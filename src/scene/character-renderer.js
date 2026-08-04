import { clamp, hashNumber, hexToRgb, smoothstep } from '../core/math.js';
import { computeCharacterPose, deformCharacterPoint, performanceCue } from './character-motion.js';
import { getNodeRect } from './scene-layout.js';

export { performanceCue } from './character-motion.js';

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadImage(url) {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return image;
}

export function computeOpaqueBounds(pixels, width, height, alphaThreshold = 8) {
  if (!pixels || pixels.length !== width * height * 4 || width <= 0 || height <= 0) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function normalizeSource(image) {
  const maxDimension = 480;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const bounds = computeOpaqueBounds(ctx.getImageData(0, 0, width, height).data, width, height);
  if (!bounds) return canvas;
  const padX = Math.max(2, Math.round(bounds.w * 0.035));
  const padY = Math.max(2, Math.round(bounds.h * 0.025));
  const x = Math.max(0, bounds.x - padX);
  const y = Math.max(0, bounds.y - padY);
  const right = Math.min(width, bounds.x + bounds.w + padX);
  const bottom = Math.min(height, bounds.y + bounds.h + padY);
  const cropped = makeCanvas(right - x, bottom - y);
  cropped.getContext('2d').drawImage(canvas, x, y, right - x, bottom - y, 0, 0, right - x, bottom - y);
  return cropped;
}

function buildVariant(image, filter) {
  const canvas = makeCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.filter = filter;
  ctx.drawImage(image, 0, 0);
  ctx.filter = 'none';
  return canvas;
}

function fitContain(image, rect, scale = 1, yBias = 0) {
  const aspect = image.width / image.height;
  let w = rect.w * scale;
  let h = w / aspect;
  if (h > rect.h * scale) {
    h = rect.h * scale;
    w = h * aspect;
  }
  return {
    x: rect.x + (rect.w - w) / 2,
    y: rect.y + (rect.h - h) * (0.5 + yBias),
    w,
    h,
  };
}


function fitCover(image, rect, scale = 1, yBias = 0) {
  const aspect = image.width / image.height;
  let h = rect.h * scale;
  let w = h * aspect;
  if (w < rect.w * scale) {
    w = rect.w * scale;
    h = w / aspect;
  }
  return {
    x: rect.x + (rect.w - w) / 2,
    y: rect.y + (rect.h - h) * (0.5 + yBias),
    w,
    h,
  };
}

function fitAsset(image, rect, scale, yBias, mode) {
  return mode === 'cover' ? fitCover(image, rect, scale, yBias) : fitContain(image, rect, scale, yBias);
}

function expandTriangle(points, pixels = 0.72) {
  const cx = (points[0].x + points[1].x + points[2].x) / 3;
  const cy = (points[0].y + points[1].y + points[2].y) / 3;
  return points.map((point) => {
    const dx = point.x - cx;
    const dy = point.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + dx / length * pixels, y: point.y + dy / length * pixels };
  });
}

function drawTexturedTriangle(ctx, image, source, target) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = target;
  const denominator = s0.x * (s1.y - s2.y)
    + s1.x * (s2.y - s0.y)
    + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 0.000001) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y)
    + d1.x * (s2.x * s0.y - s0.x * s2.y)
    + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y)
    + d1.y * (s2.x * s0.y - s0.x * s2.y)
    + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const clip = expandTriangle(target);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(clip[0].x, clip[0].y);
  ctx.lineTo(clip[1].x, clip[1].y);
  ctx.lineTo(clip[2].x, clip[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

const EFFECT_ANCHORS = {
  pluck: [0.58, 0.56], harp: [0.54, 0.58], flute: [0.61, 0.37], reed: [0.55, 0.38],
  panpipe: [0.56, 0.39], horn: [0.63, 0.38], strike: [0.57, 0.43], drum: [0.55, 0.48],
  gong: [0.52, 0.43], clapper: [0.57, 0.42], cymbal: [0.55, 0.44], bow: [0.60, 0.54],
  dance: [0.50, 0.48], acrobat: [0.50, 0.48], procession: [0.52, 0.50], banquet: [0.53, 0.53],
  serve: [0.54, 0.48],
};

export class CharacterRenderer {
  constructor(nodes) {
    this.nodes = nodes;
    this.assets = new Map();
    this.loadErrors = [];
    this.idleCache = null;
    this.idleCacheKey = '';
    this.bloomCache = new Map();
  }

  async load() {
    const urls = [...new Set(this.nodes.map((node) => node.sprite))];
    await Promise.all(urls.map(async (url) => {
      try {
        const image = await loadImage(url);
        const source = normalizeSource(image);
        this.assets.set(url, {
          url,
          source,
          idle: buildVariant(source, 'grayscale(1) contrast(.88) brightness(1.08) opacity(.92)'),
          active: buildVariant(source, 'grayscale(1) contrast(1.56) brightness(.52)'),
        });
      } catch (error) {
        this.loadErrors.push({ url, message: error instanceof Error ? error.message : String(error) });
      }
    }));
    return { loaded: this.assets.size, requested: urls.length, errors: this.loadErrors };
  }

  draw(ctx, metrics, visual, now) {
    this.#ensureIdleCache(metrics);
    if (this.idleCache) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(this.idleCache, 0, 0, metrics.width, metrics.height);
      ctx.restore();
    }

    let drawn = 0;
    for (const node of this.nodes) {
      const asset = this.assets.get(node.sprite);
      if (!asset) continue;
      const activation = clamp(visual[node.id] || 0);
      if (activation > 0.002) {
        const rect = getNodeRect(node, metrics);
        this.#drawActiveNode(ctx, node, asset, rect, activation, now);
      }
      drawn += 1;
    }
    return drawn;
  }

  #ensureIdleCache(metrics) {
    const maxCachePixels = 2_500_000;
    const cacheScale = Math.min(1, Math.sqrt(maxCachePixels / Math.max(1, metrics.width * metrics.height)));
    const width = Math.max(1, Math.round(metrics.width * cacheScale));
    const height = Math.max(1, Math.round(metrics.height * cacheScale));
    const key = `${width}x${height}:${metrics.orientation}:${this.assets.size}`;
    if (key === this.idleCacheKey && this.idleCache) return;
    const cacheMetrics = { ...metrics, width, height, minDimension: Math.min(width, height) };
    const cache = makeCanvas(width, height);
    const cacheContext = cache.getContext('2d');
    cacheContext.clearRect(0, 0, width, height);
    for (const node of this.nodes) {
      const asset = this.assets.get(node.sprite);
      if (!asset) continue;
      const rect = getNodeRect(node, cacheMetrics);
      const seed = hashNumber(node.id * 7919 + 17);
      const baseScale = (node.scale || 0.9) * (0.94 + seed * 0.08);
      const box = fitAsset(asset.idle, rect, baseScale, node.yBias || 0.05, node.fitMode);
      const cx = box.x + box.w * 0.5;
      const cy = box.y + box.h * (node.pivotY || 0.68);
      cacheContext.save();
      cacheContext.beginPath();
      cacheContext.rect(rect.x, rect.y, rect.w, rect.h);
      cacheContext.clip();
      cacheContext.translate(cx, cy);
      cacheContext.scale(node.mirror ? -1 : 1, 1);
      cacheContext.translate(-cx, -cy);
      cacheContext.globalAlpha = 0.105 + (node.idleOpacity || 0.12);
      cacheContext.drawImage(asset.idle, box.x, box.y, box.w, box.h);
      cacheContext.restore();
    }
    this.idleCache = cache;
    this.idleCacheKey = key;
  }

  #drawActiveNode(ctx, node, asset, rect, activation, now) {
    const seed = hashNumber(node.id * 7919 + 17);
    const baseScale = (node.scale || 0.9) * (0.94 + seed * 0.08);
    const box = fitAsset(asset.active, rect, baseScale, node.yBias || 0.05, node.fitMode);
    const transform = computeCharacterPose(node, activation, now);
    const cx = box.x + box.w * 0.5;
    const cy = box.y + box.h * (node.pivotY || 0.68);

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    this.#drawBloom(ctx, node, box, activation, now);
    ctx.translate(cx + transform.dx * box.w, cy + transform.dy * box.h);
    ctx.rotate(transform.rotation);
    ctx.scale((node.mirror ? -1 : 1) * transform.sx, transform.sy);
    ctx.translate(-cx, -cy);

    const activeAlpha = smoothstep(0, 0.58, activation);
    const cue = performanceCue(node, now);
    this.#drawArticulatedSprite(ctx, node, asset.active, box, transform, activeAlpha * 0.985);
    this.#drawColorAccent(ctx, node, box, activeAlpha, cue, now);
    ctx.restore();
  }

  #drawArticulatedSprite(ctx, node, image, box, transform, alpha) {
    ctx.globalAlpha = alpha;
    if (transform.meshEnergy < 0.0002) {
      ctx.drawImage(image, box.x, box.y, box.w, box.h);
      return;
    }
    const isSolo = node.composition === 'solo';
    const columns = isSolo ? 4 : 2;
    const rows = isSolo ? 5 : 3;
    const rigAmount = isSolo ? 1 : 0.34;
    const points = [];
    for (let row = 0; row <= rows; row += 1) {
      const v = row / rows;
      const line = [];
      for (let column = 0; column <= columns; column += 1) {
        const u = column / columns;
        const deformed = deformCharacterPoint(transform, u, v, rigAmount);
        line.push({
          source: { x: u * image.width, y: v * image.height },
          target: { x: box.x + deformed.x * box.w, y: box.y + deformed.y * box.h },
        });
      }
      points.push(line);
    }

    ctx.imageSmoothingEnabled = true;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const topLeft = points[row][column];
        const topRight = points[row][column + 1];
        const bottomLeft = points[row + 1][column];
        const bottomRight = points[row + 1][column + 1];
        drawTexturedTriangle(ctx, image,
          [topLeft.source, topRight.source, bottomRight.source],
          [topLeft.target, topRight.target, bottomRight.target]);
        drawTexturedTriangle(ctx, image,
          [topLeft.source, bottomRight.source, bottomLeft.source],
          [topLeft.target, bottomRight.target, bottomLeft.target]);
      }
    }
  }

  #drawColorAccent(ctx, node, box, activeAlpha, cue, now) {
    if (activeAlpha < 0.015) return;
    const anchor = EFFECT_ANCHORS[node.animation] || [0.52, 0.48];
    const ax = box.x + box.w * anchor[0];
    const ay = box.y + box.h * anchor[1];
    const radiusX = box.w * (node.composition === 'solo' ? 0.32 : 0.24);
    const radiusY = box.h * (node.composition === 'solo' ? 0.27 : 0.22);
    const color = node.color || '#c49a3a';
    const secondary = node.secondaryColor || '#e2b951';
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = secondary;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, Math.min(box.w, box.h) * 0.012);
    ctx.globalAlpha = activeAlpha * (0.1 + cue.release * 0.1 + cue.attack * 0.34);
    if (['strike', 'drum', 'gong', 'cymbal', 'clapper'].includes(node.animation)) {
      const ring = Math.max(3, Math.min(box.w, box.h) * (0.12 + (1 - cue.release) * 0.18));
      ctx.beginPath();
      ctx.arc(ax, ay, ring, 0, Math.PI * 2);
      ctx.stroke();
      for (let index = 0; index < 7; index += 1) {
        const angle = index / 7 * Math.PI * 2 + node.id * 0.73;
        const length = ring * (0.45 + hashNumber(node.id * 31 + index) * 0.55);
        ctx.beginPath();
        ctx.moveTo(ax + Math.cos(angle) * ring * 0.72, ay + Math.sin(angle) * ring * 0.72);
        ctx.lineTo(ax + Math.cos(angle) * (ring + length), ay + Math.sin(angle) * (ring + length));
        ctx.stroke();
      }
    } else if (['dance', 'acrobat', 'procession'].includes(node.animation)) {
      for (let index = 0; index < 9; index += 1) {
        const seed = hashNumber(node.id * 97 + index * 13 + cue.beat);
        const angle = seed * Math.PI * 2 + now * 0.00035 * (index % 2 ? 1 : -1);
        const distance = Math.max(box.w, box.h) * (0.08 + seed * 0.25) * cue.release;
        const size = Math.max(1.5, Math.min(box.w, box.h) * (0.012 + seed * 0.014));
        ctx.globalAlpha = activeAlpha * (0.12 + cue.attack * 0.6) * (0.55 + seed * 0.45);
        ctx.fillStyle = index % 3 === 0 ? secondary : color;
        ctx.beginPath();
        ctx.arc(ax + Math.cos(angle) * distance, ay + Math.sin(angle) * distance, size, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(ax - radiusX * 0.65, ay + radiusY * 0.3);
      ctx.quadraticCurveTo(ax, ay - radiusY * (0.55 + cue.attack * 0.5), ax + radiusX * 0.72, ay + radiusY * 0.18);
      ctx.stroke();
    }
    ctx.restore();
  }

  #getBloom(color) {
    if (this.bloomCache.has(color)) return this.bloomCache.get(color);
    const size = 128;
    const canvas = makeCanvas(size, size);
    const context = canvas.getContext('2d');
    const { r, g, b } = hexToRgb(color);
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `rgba(${r},${g},${b},0.22)`);
    gradient.addColorStop(0.48, `rgba(${r},${g},${b},0.08)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    this.bloomCache.set(color, canvas);
    return canvas;
  }

  #drawBloom(ctx, node, box, activation, now) {
    if (activation < 0.025) return;
    const color = node.color || '#879c74';
    const pulse = 0.78 + Math.sin(now * 0.0013 + node.phase) * 0.12;
    const radius = Math.max(box.w, box.h) * (0.46 + activation * 0.12);
    const x = box.x + box.w * (0.45 + Math.sin(node.id * 1.7) * 0.04);
    const y = box.y + box.h * 0.58;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = activation * pulse;
    ctx.drawImage(this.#getBloom(color), x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }
}
