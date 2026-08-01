import { clamp, hashNumber, hexToRgb, smoothstep } from '../core/math.js';
import { getNodeRect } from './scene-layout.js';

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

function buildVariant(image, filter) {
  const maxDimension = 480;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.filter = filter;
  ctx.drawImage(image, 0, 0, width, height);
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

function animationTransform(node, activation, now) {
  const t = now * 0.001 + (node.phase || 0);
  const strength = activation * (node.motion || 1);
  const result = { dx: 0, dy: 0, rotation: 0, sx: 1, sy: 1, upperDx: 0, upperDy: 0, upperRotation: 0 };
  switch (node.animation) {
    case 'pluck':
      result.dy = Math.sin(t * 1.8) * 0.003 * strength;
      result.upperDx = Math.sin(t * 7.4) * 0.012 * strength;
      result.upperRotation = Math.sin(t * 4.7) * 0.014 * strength;
      break;
    case 'flute':
      result.rotation = Math.sin(t * 1.25) * 0.009 * strength;
      result.upperDy = Math.sin(t * 3.1) * 0.009 * strength;
      break;
    case 'strike': {
      const beat = Math.pow(Math.max(0, Math.sin(t * 4.2)), 8);
      result.upperDy = -beat * 0.045 * strength;
      result.upperRotation = -beat * 0.045 * strength;
      result.sy = 1 + beat * 0.012;
      break;
    }
    case 'bow':
      result.upperDx = Math.sin(t * 4.9) * 0.028 * strength;
      result.upperRotation = Math.sin(t * 2.45) * 0.02 * strength;
      result.rotation = Math.sin(t * 1.15) * 0.006 * strength;
      break;
    case 'drum': {
      const beat = Math.pow(Math.max(0, Math.sin(t * 3.6)), 10);
      result.upperDx = beat * 0.025 * strength;
      result.upperDy = beat * 0.028 * strength;
      result.upperRotation = beat * 0.055 * strength;
      break;
    }
    case 'dance':
      result.dx = Math.sin(t * 1.3) * 0.018 * strength;
      result.dy = Math.cos(t * 2.1) * 0.008 * strength;
      result.rotation = Math.sin(t * 1.65) * 0.035 * strength;
      result.sx = 1 + Math.sin(t * 2.4) * 0.014 * strength;
      result.upperRotation = Math.sin(t * 2.9) * 0.055 * strength;
      break;
    case 'serve':
      result.dy = Math.sin(t * 1.15) * 0.005 * strength;
      result.rotation = Math.sin(t * 0.85) * 0.006 * strength;
      break;
    case 'reed':
      result.upperDy = Math.sin(t * 2.8) * 0.006 * strength;
      result.rotation = Math.sin(t * 1.05) * 0.008 * strength;
      result.sy = 1 + Math.sin(t * 1.7) * 0.006 * strength;
      break;
    case 'panpipe':
      result.upperDx = Math.sin(t * 2.4) * 0.009 * strength;
      result.upperRotation = Math.sin(t * 1.8) * 0.014 * strength;
      break;
    case 'harp':
      result.upperDx = Math.sin(t * 6.2) * 0.014 * strength;
      result.upperDy = Math.cos(t * 3.1) * 0.004 * strength;
      result.rotation = Math.sin(t * 0.9) * 0.006 * strength;
      break;
    case 'clapper': {
      const clap = Math.pow(Math.max(0, Math.sin(t * 5.4)), 9);
      result.upperDx = clap * 0.035 * strength;
      result.upperRotation = -clap * 0.04 * strength;
      break;
    }
    case 'cymbal': {
      const clash = Math.pow(Math.max(0, Math.sin(t * 4.7)), 7);
      result.upperDx = -clash * 0.028 * strength;
      result.upperDy = clash * 0.012 * strength;
      result.sx = 1 + clash * 0.015 * strength;
      break;
    }
    case 'acrobat':
      result.dx = Math.sin(t * 1.8) * 0.022 * strength;
      result.dy = Math.cos(t * 2.7) * 0.014 * strength;
      result.rotation = Math.sin(t * 2.1) * 0.055 * strength;
      result.sy = 1 + Math.sin(t * 3.2) * 0.018 * strength;
      break;
    case 'procession':
      result.dx = Math.sin(t * 1.15) * 0.012 * strength;
      result.dy = Math.abs(Math.sin(t * 2.3)) * -0.006 * strength;
      result.upperRotation = Math.sin(t * 1.4) * 0.015 * strength;
      break;
    case 'banquet':
      result.upperDx = Math.sin(t * 2.2) * 0.012 * strength;
      result.upperDy = Math.cos(t * 2.2) * 0.006 * strength;
      result.sy = 1 + Math.sin(t * 1.1) * 0.005 * strength;
      break;
    case 'gong': {
      const hit = Math.pow(Math.max(0, Math.sin(t * 3.3)), 10);
      result.upperDx = hit * 0.038 * strength;
      result.upperDy = -hit * 0.028 * strength;
      result.upperRotation = hit * 0.065 * strength;
      result.sx = 1 + hit * 0.009;
      break;
    }
    case 'horn':
      result.rotation = Math.sin(t * 0.85) * 0.012 * strength;
      result.upperDy = Math.sin(t * 2.6) * 0.007 * strength;
      result.upperRotation = Math.sin(t * 1.3) * 0.01 * strength;
      break;
    case 'sway':
      result.dx = Math.sin(t * 1.2) * 0.009 * strength;
      result.rotation = Math.sin(t * 1.05) * 0.012 * strength;
      break;
    default:
      result.sy = 1 + Math.sin(t * 1.5) * 0.008 * strength;
      result.dy = Math.sin(t * 1.2) * 0.003 * strength;
  }
  return result;
}

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
        this.assets.set(url, {
          source: image,
          idle: buildVariant(image, 'grayscale(1) contrast(.88) brightness(1.08) opacity(.92)'),
          active: buildVariant(image, 'grayscale(1) contrast(1.56) brightness(.52)'),
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
      cacheContext.globalAlpha = 0.075 + (node.idleOpacity || 0.12);
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
    const transform = animationTransform(node, activation, now);
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

    const activeAlpha = smoothstep(0, 0.8, activation);
    const hasUpperMotion = node.composition === 'solo'
      && Math.abs(transform.upperDx) + Math.abs(transform.upperDy) + Math.abs(transform.upperRotation) > 0.0001;
    ctx.globalAlpha = activeAlpha * 0.985;
    if (hasUpperMotion) {
      const clipY = box.y + box.h * (node.upperSplit || 0.58);
      // Draw the lower body once, then independently articulate the upper body.
      // This avoids the old full-body + duplicate-upper ghost image.
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x - box.w * 0.15, clipY, box.w * 1.3, box.y + box.h - clipY + box.h * 0.08);
      ctx.clip();
      ctx.drawImage(asset.active, box.x, box.y, box.w, box.h);
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x - box.w * 0.15, box.y - box.h * 0.08, box.w * 1.3, clipY - box.y + box.h * 0.16);
      ctx.clip();
      const upperCx = box.x + box.w * 0.5;
      const upperCy = clipY;
      ctx.translate(upperCx + transform.upperDx * box.w, upperCy + transform.upperDy * box.h);
      ctx.rotate(transform.upperRotation);
      ctx.translate(-upperCx, -upperCy);
      ctx.globalAlpha = activeAlpha * 0.985;
      ctx.drawImage(asset.active, box.x, box.y, box.w, box.h);
      ctx.restore();
    } else {
      ctx.drawImage(asset.active, box.x, box.y, box.w, box.h);
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
