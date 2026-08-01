const PERMANENT_ERROR_NAMES = new Set(['NotAllowedError', 'SecurityError', 'OverconstrainedError']);
const RETRYABLE_ERROR_NAMES = new Set([
  'NotReadableError',
  'TrackStartError',
  'AbortError',
  'TimeoutError',
  'NotFoundError',
  'DevicesNotFoundError',
]);

function makeError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

export function classifyCameraError(error) {
  const name = error?.name || '';
  if (PERMANENT_ERROR_NAMES.has(name)) return { retryable: false, permanent: true };
  if (RETRYABLE_ERROR_NAMES.has(name)) return { retryable: true, permanent: false };
  const message = error instanceof Error ? error.message : String(error || '');
  if (/timeout|超时/i.test(message)) return { retryable: true, permanent: false };
  // Unknown device/driver failures are treated as transient so unplug/replug can recover.
  return { retryable: true, permanent: false };
}

export function humanizeCameraError(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '摄像头权限被永久拒绝。请在浏览器地址栏允许摄像头后手动重试。';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '暂未检测到可用摄像头，将继续等待设备接入。';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '摄像头暂时不可读，可能正被其他程序占用，将自动重试。';
  if (name === 'AbortError') return '摄像头启动被系统中断，将自动重试。';
  if (name === 'TimeoutError') return '等待摄像头画面超时，将自动重试。';
  if (name === 'OverconstrainedError') return '摄像头不支持请求的视频约束。请更换设备或调整驱动后手动重试。';
  return `摄像头启动失败，将自动重试：${error instanceof Error ? error.message : String(error)}`;
}

function defaultCanvasFactory(width, height) {
  if (!globalThis.document?.createElement) throw new Error('CameraController requires a canvasFactory outside a browser.');
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function dispatchDetail(target, type, detail) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

export class CameraController extends EventTarget {
  constructor(
    video,
    width = 240,
    height = 135,
    mediaDevices = globalThis.navigator?.mediaDevices,
    options = {},
  ) {
    super();
    this.video = video;
    this.width = width;
    this.height = height;
    this.mediaDevices = mediaDevices;
    this.options = {
      reconnectBaseMs: options.reconnectBaseMs ?? 500,
      reconnectMaxMs: options.reconnectMaxMs ?? 8000,
      videoTimeoutMs: options.videoTimeoutMs ?? 8000,
      setTimeout: options.setTimeout ?? globalThis.setTimeout.bind(globalThis),
      clearTimeout: options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis),
    };
    this.canvas = options.canvas ?? (options.canvasFactory ?? defaultCanvasFactory)(width, height);
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.track = null;
    this.trackListeners = null;
    this.state = 'idle';
    this.pending = null;
    this.desiredRunning = false;
    this.manualStop = false;
    this.generation = 0;
    this.reconnectTimer = 0;
    this.reconnectAttempts = 0;
    this.reconnectFailuresTotal = 0;
    this.reconnectSuccesses = 0;
    this.lastError = '';
    this.lastErrorRetryable = false;
    this.getUserMediaCalls = 0;
    this.mirror = true;
    this.waitCancel = null;
  }

  async start() {
    if (this.state === 'live' && this.stream && this.desiredRunning) return true;
    if (!this.desiredRunning) {
      this.desiredRunning = true;
      this.manualStop = false;
      this.generation += 1;
      this.reconnectAttempts = 0;
    }
    const token = this.generation;
    if (this.pending?.token === token) return this.pending.promise;
    return this.#queueAttempt(token, false);
  }

  #queueAttempt(token, reconnecting) {
    if (!this.#isCurrent(token)) return Promise.resolve(false);
    if (this.pending?.token === token) return this.pending.promise;
    const record = { token, promise: null };
    record.promise = this.#attempt(token, reconnecting).finally(() => {
      if (this.pending === record) this.pending = null;
    });
    this.pending = record;
    return record.promise;
  }

  async #attempt(token, reconnecting) {
    if (!this.mediaDevices?.getUserMedia) {
      const error = makeError('NotSupportedError', '当前浏览器不支持摄像头接口。');
      this.#handleAttemptFailure(token, error, false, reconnecting);
      return false;
    }
    this.#clearReconnectTimer();
    this.#setState(reconnecting ? 'reconnecting' : 'requesting', reconnecting ? '正在重新连接摄像头。' : '正在请求摄像头。');
    let stream = null;
    try {
      this.getUserMediaCalls += 1;
      stream = await this.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: 'user',
        },
      });
      if (!this.#isCurrent(token)) {
        this.#stopStream(stream);
        return false;
      }
      this.#adoptStream(stream, token);
      await this.#waitForVideo(token);
      if (!this.#isCurrent(token) || this.stream !== stream) {
        this.#stopStream(stream);
        return false;
      }
      if (reconnecting) this.reconnectSuccesses += 1;
      this.reconnectAttempts = 0;
      this.lastError = '';
      this.lastErrorRetryable = false;
      this.#setState('live');
      return true;
    } catch (error) {
      if (stream) this.#releaseStream(stream);
      if (!this.#isCurrent(token)) return false;
      this.#handleAttemptFailure(token, error, true, reconnecting);
      return false;
    }
  }

  #handleAttemptFailure(token, error, allowRetry, reconnecting = false) {
    const classification = classifyCameraError(error);
    this.lastError = humanizeCameraError(error);
    this.lastErrorRetryable = classification.retryable;
    if (reconnecting && classification.retryable) this.reconnectFailuresTotal += 1;
    if (!allowRetry || classification.permanent) {
      this.desiredRunning = false;
      this.#clearReconnectTimer();
      this.#setState('error', this.lastError, { retryable: false, permanent: true });
      return;
    }
    this.#setState('error', this.lastError, { retryable: true, permanent: false });
    this.#scheduleReconnect(token, this.lastError);
  }

  #adoptStream(stream, token) {
    this.#releaseCurrentStream();
    this.stream = stream;
    this.video.srcObject = stream;
    this.track = stream.getVideoTracks?.()[0] || null;
    if (!this.track) throw makeError('NotFoundError', '摄像头流不包含视频轨道。');
    const onEnded = () => this.#handleDisconnect(token, '摄像头视频轨道已结束。');
    const onMute = () => this.#handleDisconnect(token, '摄像头视频轨道暂时中断。');
    this.track.addEventListener?.('ended', onEnded);
    this.track.addEventListener?.('mute', onMute);
    this.trackListeners = { track: this.track, onEnded, onMute };
  }

  #waitForVideo(token) {
    if (!this.#isCurrent(token)) return Promise.reject(makeError('AbortError', '摄像头请求已失效。'));
    const play = async () => {
      if (typeof this.video.play === 'function') await this.video.play();
    };
    if (this.video.readyState >= 2) return play();
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.options.clearTimeout(timer);
        this.video.removeEventListener?.('loadeddata', onReady);
        this.video.removeEventListener?.('error', onVideoError);
        if (this.waitCancel === cancel) this.waitCancel = null;
      };
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onReady = () => {
        play().then(() => settle(resolve), (error) => settle(reject, error));
      };
      const onVideoError = () => settle(reject, makeError('AbortError', '摄像头视频元素报告播放错误。'));
      const cancel = () => settle(reject, makeError('AbortError', '摄像头请求已取消。'));
      const timer = this.options.setTimeout(
        () => settle(reject, makeError('TimeoutError', '等待摄像头画面超时。')),
        this.options.videoTimeoutMs,
      );
      this.waitCancel = cancel;
      this.video.addEventListener?.('loadeddata', onReady, { once: true });
      this.video.addEventListener?.('error', onVideoError, { once: true });
    });
  }

  #handleDisconnect(token, message) {
    if (!this.#isCurrent(token)) return;
    this.lastError = message;
    this.lastErrorRetryable = true;
    this.#releaseCurrentStream();
    this.#setState('disconnected', message, { retryable: true, permanent: false });
    this.#scheduleReconnect(token, message);
  }

  #scheduleReconnect(token, reason) {
    if (!this.#isCurrent(token)) return;
    this.#clearReconnectTimer();
    const exponent = Math.min(20, this.reconnectAttempts);
    const delay = Math.min(this.options.reconnectMaxMs, this.options.reconnectBaseMs * 2 ** exponent);
    this.reconnectAttempts += 1;
    const delayText = Math.round(delay / 100) / 10;
    this.#setState('reconnecting', `${reason} ${delayText} 秒后进行第 ${this.reconnectAttempts} 次重连。`, {
      retryable: true,
      permanent: false,
      nextRetryMs: delay,
    });
    this.reconnectTimer = this.options.setTimeout(() => {
      this.reconnectTimer = 0;
      if (!this.#isCurrent(token)) return;
      void this.#queueAttempt(token, true);
    }, delay);
  }

  #clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    this.options.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
  }

  #isCurrent(token) {
    return this.desiredRunning && !this.manualStop && token === this.generation;
  }

  #stopStream(stream) {
    try {
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch {
      // Driver cleanup must not mask the original camera error.
    }
  }

  #releaseStream(stream) {
    if (this.stream === stream) this.#releaseCurrentStream();
    else this.#stopStream(stream);
  }

  #releaseCurrentStream() {
    if (this.waitCancel) {
      const cancel = this.waitCancel;
      this.waitCancel = null;
      cancel();
    }
    if (this.trackListeners) {
      const { track, onEnded, onMute } = this.trackListeners;
      track.removeEventListener?.('ended', onEnded);
      track.removeEventListener?.('mute', onMute);
      this.trackListeners = null;
    }
    const stream = this.stream;
    this.stream = null;
    this.track = null;
    if (this.video.srcObject === stream || this.video.srcObject) this.video.srcObject = null;
    this.#stopStream(stream);
  }

  getFrame() {
    if (this.state !== 'live' || !this.video.videoWidth || !this.video.videoHeight) return null;
    const sourceAspect = this.video.videoWidth / this.video.videoHeight;
    const targetAspect = this.width / this.height;
    let sx = 0;
    let sy = 0;
    let sw = this.video.videoWidth;
    let sh = this.video.videoHeight;
    if (sourceAspect > targetAspect) {
      sw = sh * targetAspect;
      sx = (this.video.videoWidth - sw) / 2;
    } else {
      sh = sw / targetAspect;
      sy = (this.video.videoHeight - sh) / 2;
    }
    this.ctx.save();
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (this.mirror) {
      this.ctx.translate(this.width, 0);
      this.ctx.scale(-1, 1);
    }
    this.ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, this.width, this.height);
    this.ctx.restore();
    return this.ctx.getImageData(0, 0, this.width, this.height);
  }

  async recover() {
    this.stop();
    await new Promise((resolve) => this.options.setTimeout(resolve, 80));
    return this.start();
  }

  stop() {
    this.desiredRunning = false;
    this.manualStop = true;
    this.generation += 1;
    this.#clearReconnectTimer();
    this.pending = null;
    this.#releaseCurrentStream();
    this.reconnectAttempts = 0;
    this.lastErrorRetryable = false;
    this.#setState('idle');
  }

  #setState(state, message = '', extra = {}) {
    this.state = state;
    dispatchDetail(this, 'statechange', {
      state,
      message,
      reconnectAttempts: this.reconnectAttempts,
      reconnectFailuresTotal: this.reconnectFailuresTotal,
      reconnectSuccesses: this.reconnectSuccesses,
      getUserMediaCalls: this.getUserMediaCalls,
      generation: this.generation,
      retryable: this.lastErrorRetryable,
      ...extra,
    });
  }
}
