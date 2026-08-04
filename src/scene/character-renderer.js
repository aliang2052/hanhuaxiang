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

export function selectMotionFrame(clip, now, phase = 0) {
  const frameCount = Math.max(1, Math.floor(Number(clip?.frames) || 1));
  const fps = Math.max(0.01, Number(clip?.fps) || 1);
  const phaseFrames = Number.isFinite(phase) ? phase / (Math.PI * 2) * frameCount : 0;
  const raw = Math.floor(Math.max(0, Number(now) || 0) * fps / 1000 + phaseFrames);
  return ((raw % frameCount) + frameCount) % frameCount;
}

function motionFrameSize(image, clip) {
  return {
    width: image.width / Math.max(1, Math.floor(Number(clip?.columns) || 1)),
    height: image.height / Math.max(1, Math.floor(Number(clip?.rows) || 1)),
  };
}

function drawMotionFrame(ctx, image, clip, frameIndex, box) {
  const columns = Math.max(1, Math.floor(Number(clip?.columns) || 1));
  const frame = Math.max(0, Math.min(Math.floor(Number(clip?.frames) || 1) - 1, frameIndex));
  const size = motionFrameSize(image, clip);
  const sourceX = (frame % columns) * size.width;
  const sourceY = Math.floor(frame / columns) * size.height;
  ctx.drawImage(image, sourceX, sourceY, size.width, size.height, box.x, box.y, box.w, box.h);
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

const NEON_TONES = {
  pluck: { primary: '#ff4fd8', secondary: '#ffd84d', filter: 'sepia(1) saturate(10) hue-rotate(285deg) brightness(1.42) contrast(1.08)' },
  harp: { primary: '#ffd84d', secondary: '#ff5db1', filter: 'sepia(1) saturate(9) hue-rotate(345deg) brightness(1.45) contrast(1.05)' },
  flute: { primary: '#00eaff', secondary: '#73ffcf', filter: 'sepia(1) saturate(11) hue-rotate(125deg) brightness(1.45) contrast(1.08)' },
  reed: { primary: '#51ff8a', secondary: '#00eaff', filter: 'sepia(1) saturate(10) hue-rotate(88deg) brightness(1.42) contrast(1.08)' },
  panpipe: { primary: '#38ffd1', secondary: '#5b8cff', filter: 'sepia(1) saturate(11) hue-rotate(112deg) brightness(1.43) contrast(1.08)' },
  horn: { primary: '#ff9f1c', secondary: '#ffea67', filter: 'sepia(1) saturate(10) hue-rotate(345deg) brightness(1.43) contrast(1.06)' },
  bow: { primary: '#32c5ff', secondary: '#7b61ff', filter: 'sepia(1) saturate(12) hue-rotate(145deg) brightness(1.45) contrast(1.08)' },
  strike: { primary: '#ffb000', secondary: '#fff06a', filter: 'sepia(1) saturate(11) hue-rotate(350deg) brightness(1.5) contrast(1.1)' },
  drum: { primary: '#ff3b5c', secondary: '#ffb000', filter: 'sepia(1) saturate(12) hue-rotate(300deg) brightness(1.4) contrast(1.1)' },
  gong: { primary: '#ff6b1a', secondary: '#ffe66d', filter: 'sepia(1) saturate(12) hue-rotate(330deg) brightness(1.45) contrast(1.1)' },
  clapper: { primary: '#ff5b2e', secondary: '#ffdb4d', filter: 'sepia(1) saturate(11) hue-rotate(320deg) brightness(1.42) contrast(1.08)' },
  cymbal: { primary: '#ffe14d', secondary: '#ff4f9a', filter: 'sepia(1) saturate(12) hue-rotate(355deg) brightness(1.52) contrast(1.08)' },
  dance: { primary: '#ff3df2', secondary: '#6c63ff', filter: 'sepia(1) saturate(13) hue-rotate(245deg) brightness(1.48) contrast(1.08)' },
  acrobat: { primary: '#b94dff', secondary: '#00eaff', filter: 'sepia(1) saturate(13) hue-rotate(205deg) brightness(1.48) contrast(1.08)' },
  procession: { primary: '#6dff9a', secondary: '#00cfff', filter: 'sepia(1) saturate(10) hue-rotate(95deg) brightness(1.42) contrast(1.06)' },
  banquet: { primary: '#ffcf4d', secondary: '#ff6fae', filter: 'sepia(1) saturate(10) hue-rotate(350deg) brightness(1.44) contrast(1.06)' },
  serve: { primary: '#69ffb0', secondary: '#ffe66d', filter: 'sepia(1) saturate(10) hue-rotate(85deg) brightness(1.43) contrast(1.06)' },
};

export function activePalette(animation) {
  return NEON_TONES[animation] || { primary: '#00eaff', secondary: '#ff4fd8', filter: 'sepia(1) saturate(11) hue-rotate(145deg) brightness(1.45)' };
}

export class CharacterRenderer {
  constructor(nodes) {
    this.nodes = nodes;
    this.assets = new Map();
    this.motionAssets = new Map();
    this.loadErrors = [];
    this.idleCache = null;
    this.idleCacheKey = '';
    this.bloomCache = new Map();
    this.animationTime = 0;
    this.lastAnimationSourceTime = null;
  }

  async load() {
    const urls = [...new Set(this.nodes.map((node) => node.sprite))];
    const motionUrls = [...new Set(this.nodes.map((node) => node.motionClip?.file).filter(Boolean))];
    await Promise.all([...urls.map(async (url) => {
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
    }), ...motionUrls.map(async (url) => {
      try {
        const image = await loadImage(url);
        this.motionAssets.set(url, {
          url,
          source: image,
          idle: buildVariant(image, 'grayscale(1) contrast(.88) brightness(1.08) opacity(.92)'),
          active: buildVariant(image, 'grayscale(1) contrast(1.56) brightness(.52)'),
        });
      } catch (error) {
        this.loadErrors.push({ url, message: error instanceof Error ? error.message : String(error) });
      }
    })]);
    return {
      loaded: this.assets.size,
      requested: urls.length,
      motionLoaded: this.motionAssets.size,
      motionRequested: motionUrls.length,
      errors: this.loadErrors,
    };
  }

  draw(ctx, metrics, visual, now, animationSpeed = 1, grayscaleEnabled = false) {
    const sourceNow = Number.isFinite(now) ? now : 0;
    const speed = clamp(Number(animationSpeed) || 1, 0.25, 1.5);
    if (this.lastAnimationSourceTime === null) {
      this.animationTime = sourceNow * speed;
    } else {
      const elapsed = sourceNow - this.lastAnimationSourceTime;
      if (elapsed >= 0 && elapsed < 1000) this.animationTime += elapsed * speed;
    }
    this.lastAnimationSourceTime = sourceNow;
    const animationNow = this.animationTime;
    this.#ensureIdleCache(metrics, grayscaleEnabled);
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
      const motionAsset = node.motionClip ? this.motionAssets.get(node.motionClip.file) : null;
      const activation = clamp(visual[node.id] || 0);
      if (activation > 0.002) {
        const rect = getNodeRect(node, metrics);
        const activeImage = grayscaleEnabled ? asset.active : asset.source;
        const activeMotionImage = motionAsset ? (grayscaleEnabled ? motionAsset.active : motionAsset.source) : null;
        this.#drawActiveNode(ctx, node, activeImage, activeMotionImage, rect, activation, animationNow);
      }
      drawn += 1;
    }
    return drawn;
  }

  #ensureIdleCache(metrics, grayscaleEnabled) {
    const maxCachePixels = 2_500_000;
    const cacheScale = Math.min(1, Math.sqrt(maxCachePixels / Math.max(1, metrics.width * metrics.height)));
    const width = Math.max(1, Math.round(metrics.width * cacheScale));
    const height = Math.max(1, Math.round(metrics.height * cacheScale));
    const key = `${width}x${height}:${metrics.orientation}:${this.assets.size}:${this.motionAssets.size}:${grayscaleEnabled ? 'gray' : 'color'}`;
    if (key === this.idleCacheKey && this.idleCache) return;
    const cacheMetrics = { ...metrics, width, height, minDimension: Math.min(width, height) };
    const cache = makeCanvas(width, height);
    const cacheContext = cache.getContext('2d');
    cacheContext.clearRect(0, 0, width, height);
    for (const node of this.nodes) {
      const asset = this.assets.get(node.sprite);
      if (!asset) continue;
      const motionAsset = node.motionClip ? this.motionAssets.get(node.motionClip.file) : null;
      const rect = getNodeRect(node, cacheMetrics);
      const seed = hashNumber(node.id * 7919 + 17);
      const baseScale = (node.scale || 0.9) * (0.94 + seed * 0.08);
      const idleImage = motionAsset
        ? (grayscaleEnabled ? motionAsset.idle : motionAsset.source)
        : (grayscaleEnabled ? asset.idle : asset.source);
      const fitImage = motionAsset ? motionFrameSize(idleImage, node.motionClip) : idleImage;
      const box = fitAsset(fitImage, rect, baseScale, node.yBias || 0.05, node.fitMode);
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
      if (motionAsset) drawMotionFrame(cacheContext, idleImage, node.motionClip, 0, box);
      else cacheContext.drawImage(idleImage, box.x, box.y, box.w, box.h);
      cacheContext.restore();
    }
    this.idleCache = cache;
    this.idleCacheKey = key;
  }

  #drawActiveNode(ctx, node, activeImage, activeMotionImage, rect, activation, now) {
    if (activeMotionImage) {
      this.#drawKeyframeNode(ctx, node, activeMotionImage, rect, activation, now);
      return;
    }
    const seed = hashNumber(node.id * 7919 + 17);
    const baseScale = (node.scale || 0.9) * (0.94 + seed * 0.08);
    const box = fitAsset(activeImage, rect, baseScale, node.yBias || 0.05, node.fitMode);
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
    this.#drawBackdropEffect(ctx, node, box, activeAlpha, cue, now);
    this.#drawArticulatedSprite(ctx, node, activeImage, box, transform, activeAlpha * 0.985);
    ctx.restore();
  }

  #drawKeyframeNode(ctx, node, motionImage, rect, activation, now) {
    const seed = hashNumber(node.id * 7919 + 17);
    const baseScale = (node.scale || 0.9) * (0.94 + seed * 0.08);
    const frameSize = motionFrameSize(motionImage, node.motionClip);
    const box = fitAsset(frameSize, rect, baseScale, node.yBias || 0.05, node.fitMode);
    const cx = box.x + box.w * 0.5;
    const cy = box.y + box.h * (node.pivotY || 0.68);
    const activeAlpha = smoothstep(0, 0.58, activation);
    const cue = performanceCue(node, now);
    const frame = selectMotionFrame(node.motionClip, now, node.phase);

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    this.#drawBloom(ctx, node, box, activation, now);
    ctx.translate(cx, cy);
    ctx.scale(node.mirror ? -1 : 1, 1);
    ctx.translate(-cx, -cy);
    this.#drawBackdropEffect(ctx, node, box, activeAlpha, cue, now);
    ctx.globalAlpha = activeAlpha * 0.985;
    drawMotionFrame(ctx, motionImage, node.motionClip, frame, box);
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

  #drawBackdropEffect(ctx, node, box, activeAlpha, cue, now) {
    if (activeAlpha < 0.015) return;
    const anchor = EFFECT_ANCHORS[node.animation] || [0.52, 0.48];
    const ax = box.x + box.w * anchor[0];
    const ay = box.y + box.h * anchor[1];
    const palette = activePalette(node.animation);
    const minSize = Math.min(box.w, box.h);
    const isPercussion = ['strike', 'drum', 'gong', 'cymbal', 'clapper'].includes(node.animation);
    const isDance = ['dance', 'acrobat', 'procession'].includes(node.animation);
    const phase = now * 0.00022 + node.phase * 0.34;
    const pulse = 0.9 + cue.attack * 0.1 + Math.sin(now * 0.0022 + node.phase) * 0.025;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.shadowBlur = Math.max(2, minSize * 0.018);

    // The colored geometry is deliberately painted first: the black performer is
    // composited over it afterwards, keeping the figure itself completely untinted.
    ctx.save();
    ctx.translate(ax, ay);
    ctx.scale(1, 0.82);
    for (let index = 0; index < 4; index += 1) {
      const radius = minSize * (0.18 + index * 0.062) * pulse;
      const gap = 0.34 + index * 0.055;
      const offset = phase * (index % 2 ? -1 : 1) + index * 0.48;
      ctx.strokeStyle = index % 2 ? palette.secondary : palette.primary;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.lineWidth = Math.max(1, minSize * (0.0105 - index * 0.0012));
      ctx.globalAlpha = activeAlpha * (0.28 - index * 0.032 + cue.attack * 0.13);
      ctx.beginPath();
      ctx.arc(0, 0, radius, -Math.PI + gap + offset, Math.PI - gap + offset);
      ctx.stroke();
    }
    ctx.restore();

    if (isPercussion) {
      const ring = minSize * (0.24 + cue.attack * 0.035);
      ctx.strokeStyle = palette.secondary;
      ctx.shadowColor = palette.secondary;
      ctx.lineWidth = Math.max(1, minSize * 0.006);
      ctx.globalAlpha = activeAlpha * (0.17 + cue.attack * 0.24);
      for (let index = 0; index < 10; index += 1) {
        const angle = index / 10 * Math.PI * 2 + node.id * 0.37;
        const length = minSize * (0.035 + hashNumber(node.id * 31 + index) * 0.055);
        ctx.beginPath();
        ctx.moveTo(ax + Math.cos(angle) * ring, ay + Math.sin(angle) * ring * 0.82);
        ctx.lineTo(ax + Math.cos(angle) * (ring + length), ay + Math.sin(angle) * (ring + length));
        ctx.stroke();
      }
    }

    const particleCount = isDance ? 10 : 5;
    for (let index = 0; index < particleCount; index += 1) {
      const seed = hashNumber(node.id * 97 + index * 13 + cue.beat);
      const angle = index / particleCount * Math.PI * 2 + phase * (index % 2 ? -1 : 1);
      const distance = minSize * (0.22 + seed * (isDance ? 0.18 : 0.08));
      const size = Math.max(1, minSize * (0.006 + seed * 0.006));
      ctx.globalAlpha = activeAlpha * (0.15 + cue.attack * 0.24) * (0.62 + seed * 0.38);
      ctx.fillStyle = index % 3 === 0 ? palette.secondary : palette.primary;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      if (isDance && index % 2 === 0) {
        const x = ax + Math.cos(angle) * distance;
        const y = ay + Math.sin(angle) * distance * 0.82;
        ctx.moveTo(x, y - size * 1.8);
        ctx.lineTo(x + size * 1.4, y);
        ctx.lineTo(x, y + size * 1.8);
        ctx.lineTo(x - size * 1.4, y);
        ctx.closePath();
      } else {
        ctx.arc(ax + Math.cos(angle) * distance, ay + Math.sin(angle) * distance * 0.82, size, 0, Math.PI * 2);
      }
      ctx.fill();
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
    gradient.addColorStop(0, `rgba(${r},${g},${b},0.48)`);
    gradient.addColorStop(0.46, `rgba(${r},${g},${b},0.2)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    this.bloomCache.set(color, canvas);
    return canvas;
  }

  #drawBloom(ctx, node, box, activation, now) {
    if (activation < 0.025) return;
    const color = activePalette(node.animation).primary;
    const pulse = 0.72 + Math.sin(now * 0.0018 + node.phase) * 0.2;
    const radius = Math.max(box.w, box.h) * (0.46 + activation * 0.12);
    const x = box.x + box.w * (0.45 + Math.sin(node.id * 1.7) * 0.04);
    const y = box.y + box.h * 0.58;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = activation * pulse * 0.86;
    ctx.drawImage(this.#getBloom(color), x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }
}
