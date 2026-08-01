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

  update(snapshot, { mode, activeCount, audio, now }) {
    if (this.panel.hidden || now - this.lastDraw < 90) return;
    this.lastDraw = now;
    const segmentation = snapshot.segmentation;
    const metrics = segmentation?.metrics || {};
    const components = segmentation?.components || [];
    this.#draw(snapshot.frame, segmentation);

    this.people.textContent = String(components.length);
    this.foreground.textContent = String(metrics.foregroundPixels || 0);
    this.active.textContent = `${activeCount} / 63`;
    const outputPercent = (Number(audio.outputLevel || 0) * 100).toFixed(1);
    this.audio.textContent = `${audio.contextState} · ${audio.loadedGroups}/${audio.requestedGroups} · ${outputPercent}%${audio.muted ? ' · 静音' : ''}`;

    let state = 'warning';
    let health = '需要设置';
    let hint = '';
    if (mode !== 'camera') {
      hint = '当前不是摄像头模式；切换后可在这里查看人物前景框。';
    } else if (snapshot.camera.transportState !== 'live') {
      hint = '摄像头尚未提供画面，请先启动摄像头。';
    } else if (!snapshot.backgroundReady) {
      health = '未采集空场';
      hint = '点击“采集空场背景”后有 3 秒离开画面；没有空场基线就无法识别人。';
    } else if (!components.length) {
      health = '未见人物';
      hint = '空场已就绪，但未识别到人物前景。请进入画面；必要时降低“前景灵敏度”的数值。';
    } else if (activeCount === 0) {
      health = '已见前景';
      hint = '已框出人物前景，但尚未触发格子；可适当降低“格子开启阈值”。';
    } else if (audio.muted || audio.contextState !== 'running' || audio.outputLevel < 0.0005) {
      health = '声音未就绪';
      hint = '人物和格子已触发，但输出电平仍为零。点击“测试声音”检查浏览器与系统输出。';
    } else {
      state = 'ok';
      health = '识别正常';
      hint = '人物前景、格子触发与声音链路均已就绪。';
    }
    this.health.dataset.state = state;
    this.health.textContent = health;
    this.hint.textContent = hint;
  }

  #draw(frame, segmentation) {
    const ctx = this.canvas.getContext('2d');
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!frame) {
      this.#label(ctx, '等待摄像头画面');
      return;
    }

    fitCanvasBuffer(this.frameBuffer, frame);
    this.frameBuffer.getContext('2d').putImageData(frame, 0, 0);
    ctx.drawImage(this.frameBuffer, 0, 0, this.canvas.width, this.canvas.height);

    if (!segmentation?.mask) {
      this.#label(ctx, '尚未生成前景 Mask');
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
      ctx.fillRect(x, Math.max(0, y - 21), 64, 21);
      ctx.fillStyle = '#211d17';
      ctx.fillText(`前景 ${index + 1}`, x + 5, Math.max(15, y - 6));
    });
  }

  #label(ctx, text) {
    ctx.fillStyle = 'rgba(0,0,0,.62)';
    ctx.fillRect(0, this.canvas.height - 34, this.canvas.width, 34);
    ctx.fillStyle = '#dfd7c4';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(text, 12, this.canvas.height - 12);
  }
}
