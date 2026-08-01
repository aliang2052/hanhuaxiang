import { getVisualStructureSummary } from './scene-layout.js';

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function pathRect(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

function drawCloud(ctx, x, y, scale, flip = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -scale : scale, scale);
  ctx.beginPath();
  ctx.moveTo(-25, 2);
  ctx.bezierCurveTo(-20, -10, -8, -13, 0, -5);
  ctx.bezierCurveTo(7, -19, 27, -16, 31, -2);
  ctx.bezierCurveTo(46, -8, 57, 3, 50, 13);
  ctx.bezierCurveTo(42, 24, 20, 20, 15, 10);
  ctx.bezierCurveTo(3, 24, -17, 19, -25, 8);
  ctx.stroke();
  ctx.restore();
}

function drawScrollVine(ctx, x, y, w, h, flip = false) {
  ctx.save();
  ctx.translate(flip ? x + w : x, y);
  ctx.scale(flip ? -1 : 1, 1);
  const mid = h * 0.5;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.bezierCurveTo(w * 0.16, h * 0.06, w * 0.38, h * 0.92, w * 0.52, mid);
  ctx.bezierCurveTo(w * 0.66, h * 0.08, w * 0.86, h * 0.88, w, mid);
  ctx.stroke();
  for (const t of [0.2, 0.48, 0.76]) {
    const px = w * t;
    const py = mid + Math.sin(t * Math.PI * 4) * h * 0.18;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1, h * 0.10), 0, Math.PI * 1.65);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTinyBeast(ctx, x, y, scale, flip = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -scale : scale, scale);
  ctx.beginPath();
  ctx.moveTo(-18, 5);
  ctx.quadraticCurveTo(-13, -10, 2, -8);
  ctx.quadraticCurveTo(17, -7, 20, 4);
  ctx.quadraticCurveTo(9, 13, -7, 11);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-11, 9); ctx.lineTo(-15, 18);
  ctx.moveTo(10, 9); ctx.lineTo(15, 18);
  ctx.moveTo(18, 0); ctx.quadraticCurveTo(28, -7, 25, -14);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-5, -2, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRoof(ctx, x, y, w, h) {
  const eave = Math.min(h * 0.16, w * 0.08);
  ctx.beginPath();
  ctx.moveTo(x - eave, y + eave * 0.65);
  ctx.quadraticCurveTo(x + w * 0.22, y - eave * 0.2, x + w * 0.5, y);
  ctx.quadraticCurveTo(x + w * 0.78, y - eave * 0.2, x + w + eave, y + eave * 0.65);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + w * 0.16, y + eave * 0.56);
  ctx.lineTo(x + w * 0.84, y + eave * 0.56);
  ctx.stroke();
}

export class DecorativeRenderer {
  constructor(textureImage, palette = {}) {
    this.texture = textureImage;
    this.palette = {
      paper: palette.paper || '#d8d0bd',
      ink: palette.ink || '#25221d',
      accent: palette.accent || '#983e2d',
    };
    this.cache = null;
    this.cacheKey = '';
    this.lastStructureSummary = getVisualStructureSummary('landscape');
  }

  draw(ctx, metrics, now) {
    const { width, height, orientation } = metrics;
    this.lastStructureSummary = structuredClone(metrics.structureSummary);
    const maxCachePixels = 2_800_000;
    const scale = Math.min(1, Math.sqrt(maxCachePixels / Math.max(1, width * height)));
    const cacheWidth = Math.max(1, Math.round(width * scale));
    const cacheHeight = Math.max(1, Math.round(height * scale));
    const key = `${cacheWidth}x${cacheHeight}:${orientation}:v4`;
    if (!this.cache || this.cacheKey !== key) {
      const cache = makeCanvas(cacheWidth, cacheHeight);
      const cacheContext = cache.getContext('2d');
      const scaledMetrics = {
        ...metrics,
        width: cacheWidth,
        height: cacheHeight,
        minDimension: Math.min(cacheWidth, cacheHeight),
      };
      this.#drawStatic(cacheContext, scaledMetrics);
      this.cache = cache;
      this.cacheKey = key;
    }
    ctx.drawImage(this.cache, 0, 0, width, height);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.045 + Math.sin(now * 0.00019) * 0.008;
    const wash = ctx.createLinearGradient(0, 0, width, height);
    wash.addColorStop(0, 'rgba(104,79,51,.42)');
    wash.addColorStop(0.48, 'rgba(132,66,48,.22)');
    wash.addColorStop(1, 'rgba(52,69,57,.34)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }


  structureSnapshot() {
    return structuredClone(this.lastStructureSummary || getVisualStructureSummary('landscape'));
  }

  #drawStatic(ctx, metrics) {
    this.#drawBackground(ctx, metrics.width, metrics.height);
    this.#drawOuterFrame(ctx, metrics);
    this.#drawArchitecture(ctx, metrics);
    this.#drawCentralRitualStage(ctx, metrics);
    this.#drawAgedInk(ctx, metrics);
  }

  #drawBackground(ctx, width, height) {
    ctx.save();
    ctx.fillStyle = this.palette.paper;
    ctx.fillRect(0, 0, width, height);
    if (this.texture) {
      const scale = Math.max(width / this.texture.width, height / this.texture.height);
      const drawWidth = this.texture.width * scale;
      const drawHeight = this.texture.height * scale;
      ctx.globalAlpha = 0.54;
      ctx.filter = 'sepia(.34) grayscale(.62) contrast(1.12) brightness(.88)';
      ctx.drawImage(this.texture, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      ctx.filter = 'none';
    }
    const vertical = ctx.createLinearGradient(0, 0, 0, height);
    vertical.addColorStop(0, 'rgba(224,200,157,.31)');
    vertical.addColorStop(0.45, 'rgba(198,166,119,.18)');
    vertical.addColorStop(1, 'rgba(150,116,75,.28)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = vertical;
    ctx.fillRect(0, 0, width, height);
    const radial = ctx.createRadialGradient(width * 0.5, height * 0.46, 0, width * 0.5, height * 0.46, Math.max(width, height) * 0.66);
    radial.addColorStop(0, 'rgba(255,226,178,.09)');
    radial.addColorStop(0.72, 'rgba(70,58,43,.025)');
    radial.addColorStop(1, 'rgba(33,24,17,.19)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  #drawOuterFrame(ctx, metrics) {
    const { width, height, orientation, structure } = metrics;
    const min = Math.min(width, height);
    const margin = min * (orientation === 'portrait' ? 0.014 : 0.012);
    const topBand = height * (orientation === 'portrait' ? 0.04 : 0.052);
    const bottomBand = height * (orientation === 'portrait' ? 0.035 : 0.047);
    ctx.save();
    ctx.strokeStyle = 'rgba(28,26,22,.88)';
    ctx.fillStyle = 'rgba(28,26,22,.10)';
    ctx.lineWidth = Math.max(1.4, min * 0.0022);
    ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2);
    ctx.strokeRect(margin * 1.45, margin * 1.45, width - margin * 2.9, height - margin * 2.9);
    ctx.fillRect(margin * 1.45, margin * 1.45, width - margin * 2.9, topBand);
    ctx.fillRect(margin * 1.45, height - margin * 1.45 - bottomBand, width - margin * 2.9, bottomBand);

    const motifCount = orientation === 'portrait' ? 7 : 20;
    ctx.lineWidth = Math.max(1, min * 0.00155);
    for (let index = 0; index < motifCount; index += 1) {
      const x = margin * 2 + (index + 0.5) / motifCount * (width - margin * 4);
      if (index % 3 === 0) {
        drawTinyBeast(ctx, x, margin * 1.6 + topBand * 0.55, topBand / 64, index % 2 === 0);
        drawTinyBeast(ctx, x, height - margin * 1.6 - bottomBand * 0.48, bottomBand / 60, index % 2 !== 0);
      } else {
        drawCloud(ctx, x, margin * 1.6 + topBand * 0.54, topBand / 72, index % 2 === 1);
        drawCloud(ctx, x, height - margin * 1.6 - bottomBand * 0.48, bottomBand / 72, index % 2 === 0);
      }
    }

    for (const border of structure.sideBorders) {
      const x = border.x * width;
      const y = border.y * height;
      const w = border.w * width;
      const h = border.h * height;
      ctx.fillStyle = 'rgba(27,25,21,.78)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(231,221,197,.73)';
      ctx.lineWidth = Math.max(0.8, min * 0.0012);
      ctx.strokeRect(x + w * 0.16, y + h * 0.01, w * 0.68, h * 0.98);
      const segments = orientation === 'portrait' ? 9 : 13;
      for (let index = 0; index < segments; index += 1) {
        const segmentY = y + h * index / segments;
        drawScrollVine(ctx, x + w * 0.18, segmentY, w * 0.64, h / segments, border.side === 'right');
      }
    }
    ctx.restore();
  }

  #drawArchitecture(ctx, metrics) {
    const { width, height, minDimension, structure, orientation } = metrics;
    ctx.save();
    ctx.strokeStyle = 'rgba(34,31,26,.72)';
    ctx.fillStyle = 'rgba(38,34,28,.055)';
    ctx.lineWidth = Math.max(0.8, minDimension * 0.00128);

    for (const beam of structure.beams) {
      const y = (typeof beam === 'number' ? beam : beam.y) * height;
      const heavy = typeof beam === 'object' && beam.weight === 'heavy';
      const thickness = height * (heavy ? 0.0105 : 0.0062);
      ctx.fillStyle = heavy ? 'rgba(31,29,24,.48)' : 'rgba(36,33,27,.30)';
      ctx.fillRect(width * 0.045, y - thickness / 2, width * 0.91, thickness);
      ctx.strokeStyle = 'rgba(228,218,193,.22)';
      ctx.beginPath();
      ctx.moveTo(width * 0.048, y - thickness * 0.16);
      ctx.lineTo(width * 0.952, y - thickness * 0.16);
      ctx.stroke();
    }

    for (const item of structure.panels) {
      const x = item.x * width;
      const y = item.y * height;
      const w = item.w * width;
      const h = item.h * height;
      const central = item.role === 'central-stage';
      ctx.fillStyle = central ? 'rgba(48,40,31,.095)' : `rgba(52,46,36,${0.035 + (item.id % 4) * 0.009})`;
      pathRect(ctx, x, y, w, h);
      ctx.fill();
      ctx.strokeStyle = central ? 'rgba(28,25,21,.82)' : 'rgba(38,35,29,.67)';
      ctx.lineWidth = Math.max(0.8, minDimension * (central ? 0.0017 : 0.00112));
      ctx.stroke();

      const columnWidth = Math.max(2, minDimension * (central ? 0.007 : 0.0042));
      ctx.fillStyle = central ? 'rgba(36,31,25,.36)' : 'rgba(41,37,30,.18)';
      ctx.fillRect(x - columnWidth * 0.34, y, columnWidth, h);
      ctx.fillRect(x + w - columnWidth * 0.66, y, columnWidth, h);
      ctx.fillStyle = 'rgba(35,31,26,.24)';
      ctx.fillRect(x, y + h * 0.84, w, Math.max(1, h * 0.028));

      if (orientation === 'landscape' && item.role !== 'central-stage') {
        ctx.strokeStyle = 'rgba(43,39,32,.40)';
        ctx.lineWidth = Math.max(0.6, minDimension * 0.0008);
        drawRoof(ctx, x + w * 0.06, y + h * 0.04, w * 0.88, h);
        if (item.id % 3 === 0) {
          const railY = y + h * 0.76;
          ctx.beginPath();
          ctx.moveTo(x + w * 0.06, railY);
          ctx.lineTo(x + w * 0.94, railY);
          ctx.stroke();
          for (let rail = 1; rail < 5; rail += 1) {
            const railX = x + w * (0.06 + rail * 0.176);
            ctx.beginPath(); ctx.moveTo(railX, railY); ctx.lineTo(railX, y + h * 0.84); ctx.stroke();
          }
        }
      }
    }

    // Repeated hanging tassels under the first heavy beam reinforce the long-wall continuity.
    const roofY = height * (orientation === 'portrait' ? 0.071 : 0.109);
    const tasselCount = orientation === 'portrait' ? 11 : 30;
    ctx.strokeStyle = 'rgba(38,34,28,.55)';
    ctx.fillStyle = 'rgba(38,34,28,.44)';
    ctx.lineWidth = Math.max(0.7, minDimension * 0.0009);
    for (let index = 0; index < tasselCount; index += 1) {
      const x = width * (0.052 + 0.896 * index / Math.max(1, tasselCount - 1));
      const length = height * (0.012 + (index % 4) * 0.0025);
      ctx.beginPath(); ctx.moveTo(x, roofY); ctx.lineTo(x, roofY + length); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, roofY + length, Math.max(1, minDimension * 0.0013), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  #drawCentralRitualStage(ctx, metrics) {
    const { width, height, minDimension, orientation, structure } = metrics;
    const stage = structure.centralStage;
    const x = stage.x * width;
    const y = stage.y * height;
    const w = stage.w * width;
    const h = stage.h * height;
    ctx.save();
    ctx.strokeStyle = 'rgba(28,25,21,.88)';
    ctx.fillStyle = 'rgba(36,31,25,.10)';
    ctx.lineWidth = Math.max(1, minDimension * 0.0018);
    ctx.strokeRect(x, y, w, h);

    // Twin load-bearing columns and capitals.
    const columnW = Math.max(5, w * 0.055);
    for (const columnX of [x + w * 0.065, x + w * 0.88]) {
      ctx.fillStyle = 'rgba(31,28,23,.43)';
      ctx.fillRect(columnX, y + h * 0.05, columnW, h * 0.87);
      ctx.fillStyle = 'rgba(31,28,23,.63)';
      ctx.fillRect(columnX - columnW * 0.35, y + h * 0.04, columnW * 1.7, h * 0.018);
      ctx.fillRect(columnX - columnW * 0.28, y + h * 0.91, columnW * 1.55, h * 0.018);
    }

    // Multi-eave tower roof.
    for (const level of [0.0, 0.19, 0.47, 0.70]) {
      const roofY = y + h * (0.04 + level);
      ctx.strokeStyle = 'rgba(26,24,20,.88)';
      ctx.lineWidth = Math.max(1, minDimension * 0.00165);
      drawRoof(ctx, x - w * 0.035, roofY, w * 1.07, h * 0.11);
      ctx.fillStyle = 'rgba(33,29,24,.25)';
      ctx.fillRect(x + w * 0.02, roofY + h * 0.018, w * 0.96, h * 0.012);
    }

    if (orientation === 'landscape') {
      // Bell rack on the upper level.
      const rackX = x + w * 0.15;
      const rackY = y + h * 0.19;
      const rackW = w * 0.70;
      const rackH = h * 0.12;
      ctx.strokeStyle = 'rgba(29,26,22,.80)';
      ctx.strokeRect(rackX, rackY, rackW, rackH);
      for (let index = 0; index < 9; index += 1) {
        const bx = rackX + rackW * (0.08 + index * 0.105);
        ctx.beginPath(); ctx.moveTo(bx, rackY); ctx.lineTo(bx, rackY + rackH * 0.25); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx - rackH * 0.035, rackY + rackH * 0.27); ctx.lineTo(bx + rackH * 0.035, rackY + rackH * 0.27); ctx.lineTo(bx, rackY + rackH * 0.44); ctx.closePath(); ctx.stroke();
      }

      // Large central ritual drum: deliberately much stronger than the previous prototype.
      const drumCx = x + w * 0.5;
      const drumCy = y + h * 0.49;
      const drumR = Math.min(w * 0.20, h * 0.085);
      ctx.fillStyle = 'rgba(45,35,27,.11)';
      ctx.beginPath(); ctx.arc(drumCx, drumCy, drumR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(drumCx, drumCy, drumR * 0.78, 0, Math.PI * 2); ctx.stroke();
      for (let index = 0; index < 12; index += 1) {
        const angle = index / 12 * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(drumCx + Math.cos(angle) * drumR * 0.89, drumCy + Math.sin(angle) * drumR * 0.89, Math.max(1, drumR * 0.035), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34,29,24,.68)';
        ctx.fill();
      }
      ctx.beginPath(); ctx.moveTo(drumCx - drumR * 0.78, drumCy + drumR * 1.05); ctx.lineTo(drumCx - drumR * 1.14, drumCy + drumR * 1.72); ctx.lineTo(drumCx + drumR * 1.14, drumCy + drumR * 1.72); ctx.lineTo(drumCx + drumR * 0.78, drumCy + drumR * 1.05); ctx.stroke();

      // Lower performance terrace and deep central stair.
      const terraceY = y + h * 0.70;
      ctx.fillStyle = 'rgba(37,32,26,.18)';
      ctx.fillRect(x + w * 0.08, terraceY, w * 0.84, h * 0.018);
      for (let step = 0; step < 7; step += 1) {
        const stepY = y + h * (0.82 + step * 0.022);
        const half = w * (0.13 + step * 0.035);
        ctx.beginPath(); ctx.moveTo(x + w * 0.5 - half, stepY); ctx.lineTo(x + w * 0.5 + half, stepY); ctx.stroke();
      }
    } else {
      // Compact portrait equivalent; retains a recognizable vertical ritual spine.
      const rackY = y + h * 0.18;
      ctx.strokeRect(x + w * 0.14, rackY, w * 0.72, h * 0.10);
      const drumCx = x + w * 0.5;
      const drumCy = y + h * 0.52;
      const drumR = Math.min(w * 0.22, h * 0.07);
      ctx.beginPath(); ctx.arc(drumCx, drumCy, drumR, 0, Math.PI * 2); ctx.stroke();
      for (let step = 0; step < 6; step += 1) {
        const stepY = y + h * (0.79 + step * 0.025);
        const half = w * (0.12 + step * 0.045);
        ctx.beginPath(); ctx.moveTo(drumCx - half, stepY); ctx.lineTo(drumCx + half, stepY); ctx.stroke();
      }
    }
    ctx.restore();
  }

  #drawAgedInk(ctx, metrics) {
    const { width, height } = metrics;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let index = 0; index < 28; index += 1) {
      const x = width * (0.035 + ((index * 0.173) % 0.93));
      const y = height * (0.07 + ((index * 0.277) % 0.86));
      const rx = width * (0.006 + (index % 5) * 0.0035);
      const ry = height * (0.0025 + (index % 4) * 0.0017);
      ctx.fillStyle = `rgba(70,55,39,${0.025 + (index % 4) * 0.008})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, index * 0.37, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
