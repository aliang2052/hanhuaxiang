import { applyHomography } from '../core/homography.js';

function fitCanvasBuffer(canvas, imageData) {
  if (canvas.width !== imageData.width) canvas.width = imageData.width;
  if (canvas.height !== imageData.height) canvas.height = imageData.height;
}

export class RecognitionMonitor {
  constructor(elements) {
    Object.assign(this, elements);
    this.frameBuffer = document.createElement('canvas');
    this.maskBuffer = document.createElement('canvas');
    this.lastDraw = 0;
  }

  update(snapshot, {
    mode, activeCount, audio, now, backgroundCountdown = 0,
    planeToCamera = null, gridRows = 7, gridCols = 9,
  }) {
    if (!this.panel.isConnected || this.panel.getClientRects().length === 0 || now - this.lastDraw < 90) return;
    this.lastDraw = now;
    const segmentation = snapshot.segmentation;
    const metrics = segmentation?.metrics || {};
    const components = segmentation?.components || [];
    const semantic = snapshot.recognitionMode === 'semantic-person';
    this.#draw(snapshot.frame, segmentation, {
      planeToCamera,
      rows: gridRows,
      cols: gridCols,
      coverages: snapshot.coverages,
    });

    this.people.textContent = String(components.length);
    this.foreground.textContent = String(metrics.foregroundPixels || 0);
    this.active.textContent = `${activeCount} / 63`;
    const outputPercent = (Number(audio.outputLevel || 0) * 100).toFixed(1);
    this.audio.textContent = `${audio.contextState} · ${audio.loadedGroups}/${audio.requestedGroups} · ${outputPercent}%${audio.muted ? ' · 静音' : ''}`;

    let state = 'warning';
    let health = '需要设置';
    let hint = '';
    if (!semantic && backgroundCountdown > 0) {
      health = `${backgroundCountdown} 秒后采集`;
      hint = '模拟验收模式正在采集测试空场。';
    } else if (mode !== 'camera') {
      hint = '当前不是摄像头模式；切换后可在这里查看人物像素轮廓。';
    } else if (snapshot.camera.transportState !== 'live') {
      hint = '摄像头尚未提供画面，请先启动摄像头。';
    } else if (semantic && snapshot.detector?.state === 'loading') {
      health = '模型加载中';
      hint = '正在从本机载入 MediaPipe 人像分割模型，不会联网。';
    } else if (semantic && snapshot.detector?.state === 'error') {
      health = '模型加载失败';
      hint = snapshot.detector.error || '请点击“重试人物模型”。';
    } else if (!snapshot.backgroundReady) {
      health = semantic ? '模型未就绪' : '模拟空场未就绪';
      hint = semantic ? '请点击“加载人物模型”。' : '模拟摄像头需先采集测试空场。';
    } else if (!components.length) {
      health = '未见人物';
      hint = semantic
        ? '人物模型运行正常，目前没有置信度足够的 person；普通画面变化不会直接触发。'
        : '模拟空场已就绪，等待模拟人物。';
    } else if (activeCount === 0) {
      health = '已识别人';
      hint = '已提取人物轮廓，但尚未触发格子；可适当降低“格子开启阈值”。';
    } else if (audio.muted || audio.contextState !== 'running' || audio.outputLevel < 0.0005) {
      health = '声音未就绪';
      hint = '人物和格子已触发，但输出电平仍为零。点击“测试声音”检查浏览器与系统输出。';
    } else {
      state = 'ok';
      health = '识别正常';
      hint = semantic
        ? `人物语义检测、格子触发与声音链路均已就绪（${snapshot.detector.model} / ${snapshot.detector.delegate}）。`
        : '模拟前景、格子触发与声音链路均已就绪。';
    }
    this.health.dataset.state = state;
    this.health.textContent = health;
    this.hint.textContent = hint;
  }

  #draw(frame, segmentation, grid) {
    const ctx = this.canvas.getContext('2d');
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!frame) {
      this.#drawGrid(ctx, grid);
      this.#label(ctx, '等待摄像头画面');
      return;
    }

    fitCanvasBuffer(this.frameBuffer, frame);
    this.frameBuffer.getContext('2d').putImageData(frame, 0, 0);
    ctx.drawImage(this.frameBuffer, 0, 0, this.canvas.width, this.canvas.height);

    if (!segmentation?.mask) {
      this.#drawGrid(ctx, grid);
      this.#label(ctx, '尚未生成人物 Mask');
      return;
    }
    const maskImage = new ImageData(segmentation.width, segmentation.height);
    for (let index = 0, output = 0; index < segmentation.mask.length; index += 1, output += 4) {
      if (!segmentation.mask[index]) continue;
      maskImage.data[output] = 214;
      maskImage.data[output + 1] = 73;
      maskImage.data[output + 2] = 48;
      maskImage.data[output + 3] = 118;
    }
    fitCanvasBuffer(this.maskBuffer, maskImage);
    this.maskBuffer.getContext('2d').putImageData(maskImage, 0, 0);
    ctx.drawImage(this.maskBuffer, 0, 0, this.canvas.width, this.canvas.height);

    this.#drawGrid(ctx, grid);

    const sx = this.canvas.width / segmentation.width;
    const sy = this.canvas.height / segmentation.height;
    ctx.lineWidth = 3;
    ctx.font = 'bold 13px system-ui, sans-serif';
    segmentation.components.forEach((component, index) => {
      const x = component.x * sx;
      const y = component.y * sy;
      const width = component.w * sx;
      const height = component.h * sy;
      ctx.strokeStyle = '#ffc04f';
      ctx.strokeRect(x, y, width, height);
      ctx.fillStyle = '#ffc04f';
      const score = Number(component.score || 0);
      const label = component.label === 'person'
        ? `人物 ${index + 1} ${Math.round(score * 100)}%`
        : `模拟人物 ${index + 1}`;
      const labelWidth = component.label === 'person' ? 112 : 92;
      ctx.fillRect(x, Math.max(0, y - 21), labelWidth, 21);
      ctx.fillStyle = '#211d17';
      ctx.fillText(label, x + 5, Math.max(15, y - 6));
    });
  }

  #drawGrid(ctx, { planeToCamera, rows, cols, coverages } = {}) {
    if (!Array.isArray(planeToCamera) || planeToCamera.length !== 9
      || !Number.isInteger(rows) || rows <= 0
      || !Number.isInteger(cols) || cols <= 0) return;

    const project = (u, v) => {
      const point = applyHomography(planeToCamera, { x: u, y: v });
      return {
        x: point.x * this.canvas.width,
        y: point.y * this.canvas.height,
      };
    };
    const traceLine = (points) => {
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    };

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const coverage = Math.max(0, Math.min(1, Number(coverages?.[row * cols + col]) || 0));
        if (coverage < 0.004) continue;
        const corners = [
          project(col / cols, row / rows),
          project((col + 1) / cols, row / rows),
          project((col + 1) / cols, (row + 1) / rows),
          project(col / cols, (row + 1) / rows),
        ];
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        corners.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.closePath();
        ctx.fillStyle = `rgba(236,170,74,${0.06 + coverage * 0.2})`;
        ctx.fill();
      }
    }

    const segments = 12;
    for (let col = 0; col <= cols; col += 1) {
      ctx.strokeStyle = col === 0 || col === cols ? 'rgba(244,229,194,.78)' : 'rgba(233,222,195,.42)';
      ctx.lineWidth = col === 0 || col === cols ? 1.5 : 1;
      traceLine(Array.from({ length: segments + 1 }, (_, step) => project(col / cols, step / segments)));
    }
    for (let row = 0; row <= rows; row += 1) {
      ctx.strokeStyle = row === 0 || row === rows ? 'rgba(244,229,194,.78)' : 'rgba(233,222,195,.42)';
      ctx.lineWidth = row === 0 || row === rows ? 1.5 : 1;
      traceLine(Array.from({ length: segments + 1 }, (_, step) => project(step / segments, row / rows)));
    }

    ctx.fillStyle = 'rgba(246,234,207,.63)';
    ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const center = project((col + 0.5) / cols, (row + 0.5) / rows);
        ctx.fillText(String(row * cols + col + 1), center.x, center.y);
      }
    }
    ctx.restore();
  }

  #label(ctx, text) {
    ctx.fillStyle = 'rgba(0,0,0,.62)';
    ctx.fillRect(0, this.canvas.height - 34, this.canvas.width, 34);
    ctx.fillStyle = '#dfd7c4';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(text, 12, this.canvas.height - 12);
  }
}
