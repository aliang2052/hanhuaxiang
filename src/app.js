const ART_W = 1920;
const ART_H = 1080;
const ROWS = 7;
const COLS = 9;
const CELL_COUNT = ROWS * COLS;
const MASK_W = 192;
const MASK_H = 108;
const STORAGE_KEY = 'han-orchestra-settings-v1';
const QUAD_KEY = 'han-orchestra-camera-quad-v1';

const $ = (selector) => document.querySelector(selector);
const artCanvas = $('#artCanvas');
const ctx = artCanvas.getContext('2d', { alpha: false });
const inputCanvas = $('#inputCanvas');
const inputCtx = inputCanvas.getContext('2d', { willReadFrequently: true });
const debugCanvas = $('#debugCanvas');
const debugCtx = debugCanvas.getContext('2d');
const video = $('#cameraVideo');

const dom = {
  intro: $('#intro'), enterButton: $('#enterButton'), topBar: $('#topBar'),
  controlPanel: $('#controlPanel'), openPanel: $('#openPanel'), closePanel: $('#closePanel'),
  modeSelect: $('#modeSelect'), cameraButton: $('#cameraButton'), captureBackgroundButton: $('#captureBackgroundButton'),
  debugButton: $('#debugButton'), fullscreenButton: $('#fullscreenButton'), wakeAllButton: $('#wakeAllButton'), resetButton: $('#resetButton'),
  diffThreshold: $('#diffThreshold'), diffThresholdOutput: $('#diffThresholdOutput'),
  onThreshold: $('#onThreshold'), onThresholdOutput: $('#onThresholdOutput'),
  offThreshold: $('#offThreshold'), offThresholdOutput: $('#offThresholdOutput'),
  mirrorToggle: $('#mirrorToggle'), gridToggle: $('#gridToggle'), labelsToggle: $('#labelsToggle'), muteToggle: $('#muteToggle'),
  modeStatus: $('#modeStatus'), activeStatus: $('#activeStatus'), fpsStatus: $('#fpsStatus'), panelMessage: $('#panelMessage'),
  debugView: $('#debugView'), closeDebug: $('#closeDebug'), debugCaptureButton: $('#debugCaptureButton'), resetQuadButton: $('#resetQuadButton'),
  audioButton: $('#audioButton')
};

const DEFAULT_SETTINGS = {
  mode: 'auto',
  diffThreshold: 54,
  onThreshold: 0.07,
  offThreshold: 0.03,
  mirror: true,
  showGrid: false,
  showLabels: false,
  muted: false,
  autoPaused: false
};

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
const settings = loadSettings();
function safeStorageSet(key, value) { try { localStorage.setItem(key, value); } catch {} }
function safeStorageRemove(key) { try { localStorage.removeItem(key); } catch {} }
function saveSettings() { safeStorageSet(STORAGE_KEY, JSON.stringify(settings)); }

const defaultQuad = [
  { x: 0.025, y: 0.045 },
  { x: 0.975, y: 0.045 },
  { x: 0.985, y: 0.975 },
  { x: 0.015, y: 0.975 }
];
let quad = (() => {
  try {
    const q = JSON.parse(localStorage.getItem(QUAD_KEY) || 'null');
    return Array.isArray(q) && q.length === 4 ? q : structuredClone(defaultQuad);
  } catch { return structuredClone(defaultQuad); }
})();

const state = {
  ready: false,
  running: false,
  startedAt: performance.now(),
  lastFrame: performance.now(),
  fps: 0,
  fpsFrames: 0,
  fpsClock: performance.now(),
  cells: [],
  cellGeom: [],
  sprites: new Map(),
  spriteVariants: new Map(),
  blooms: new Map(),
  staticLayer: null,
  mural: null,
  pointerPeople: new Map(),
  autoPeople: [],
  cameraStream: null,
  cameraReady: false,
  background: null,
  backgroundCapture: null,
  currentPixels: null,
  rawMask: new Uint8Array(MASK_W * MASK_H),
  cleanMask: new Uint8Array(MASK_W * MASK_H),
  tempMask: new Uint8Array(MASK_W * MASK_H),
  cellMap: new Int16Array(MASK_W * MASK_H),
  cellAreas: new Uint32Array(CELL_COUNT),
  coverages: new Float32Array(CELL_COUNT),
  targets: new Uint8Array(CELL_COUNT),
  visual: new Float32Array(CELL_COUNT),
  onCounters: new Uint8Array(CELL_COUNT),
  offCounters: new Uint8Array(CELL_COUNT),
  forceWakeUntil: 0,
  debugOpen: false,
  draggingQuad: -1,
  errors: [],
  audio: null,
  audioReady: false,
  audioLoading: false,
  wakeLock: null,
  activeCount: 0
};
state.cellMap.fill(-1);

const TYPE_DRAW = {
  qin:       { fit: 0.88, y: 0.09, motion: 0.38, upper: [0.13, 0.03, 0.78, 0.62], pivot: [0.50, 0.56] },
  flute:     { fit: 0.82, y: 0.03, motion: 0.82, upper: [0.11, 0.03, 0.82, 0.55], pivot: [0.50, 0.58] },
  pipa:      { fit: 0.84, y: 0.07, motion: 0.72, upper: [0.12, 0.02, 0.80, 0.68], pivot: [0.50, 0.69] },
  bells:     { fit: 0.79, y: 0.11, motion: 0.86, upper: [0.10, 0.02, 0.84, 0.62], pivot: [0.48, 0.63] },
  erhu:      { fit: 0.82, y: 0.10, motion: 0.78, upper: [0.10, 0.02, 0.83, 0.70], pivot: [0.50, 0.72] },
  drum:      { fit: 0.93, y: 0.08, motion: 0.62, upper: [0.02, 0.02, 0.47, 0.62], pivot: [0.34, 0.62] },
  dancer:    { fit: 0.96, y: 0.03, motion: 1.10, upper: [0.05, 0.01, 0.90, 0.90], pivot: [0.50, 0.66] },
  attendant: { fit: 0.78, y: 0.02, motion: 0.42, upper: [0.14, 0.02, 0.72, 0.58], pivot: [0.50, 0.60] }
};

function clamp(v, a = 0, b = 1) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); }
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function bilerpQuad(u, v) {
  const top = { x: lerp(quad[0].x, quad[1].x, u), y: lerp(quad[0].y, quad[1].y, u) };
  const bottom = { x: lerp(quad[3].x, quad[2].x, u), y: lerp(quad[3].y, quad[2].y, u) };
  return { x: lerp(top.x, bottom.x, v), y: lerp(top.y, bottom.y, v) };
}
function pointInPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i].x, yi = p[i].y, xj = p[j].x, yj = p[j].y;
    const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

function buildCellGeometry() {
  const xBounds = [0, .105, .214, .326, .441, .558, .675, .787, .896, 1];
  const yBounds = [0, .132, .267, .405, .544, .684, .824, 1];
  const frame = { x: 112, y: 153, w: 1696, h: 794 };
  state.cellGeom = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const u0 = xBounds[c], u1 = xBounds[c + 1];
      const v0 = yBounds[r], v1 = yBounds[r + 1];
      const jitter = (((r * 11 + c * 7) % 5) - 2) * 0.7;
      const x = frame.x + u0 * frame.w + jitter;
      const y = frame.y + v0 * frame.h;
      const w = (u1 - u0) * frame.w - jitter;
      const h = (v1 - v0) * frame.h;
      state.cellGeom.push({ x, y, w, h, cx: x + w / 2, cy: y + h / 2, row: r, col: c });
    }
  }
}

function buildCameraCellMap() {
  state.cellMap.fill(-1);
  state.cellAreas.fill(0);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const id = r * COLS + c;
      const poly = [
        bilerpQuad(c / COLS, r / ROWS),
        bilerpQuad((c + 1) / COLS, r / ROWS),
        bilerpQuad((c + 1) / COLS, (r + 1) / ROWS),
        bilerpQuad(c / COLS, (r + 1) / ROWS)
      ].map(p => ({ x: p.x * MASK_W, y: p.y * MASK_H }));
      const minX = Math.max(0, Math.floor(Math.min(...poly.map(p => p.x))));
      const maxX = Math.min(MASK_W - 1, Math.ceil(Math.max(...poly.map(p => p.x))));
      const minY = Math.max(0, Math.floor(Math.min(...poly.map(p => p.y))));
      const maxY = Math.min(MASK_H - 1, Math.ceil(Math.max(...poly.map(p => p.y))));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (pointInPoly(x + .5, y + .5, poly)) {
            const i = y * MASK_W + x;
            state.cellMap[i] = id;
            state.cellAreas[id]++;
          }
        }
      }
    }
  }
}

async function loadImage(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas'); c.width = width; c.height = height; return c;
}

function buildSpriteVariant(img, filter) {
  const c = makeCanvas(img.width, img.height);
  const cctx = c.getContext('2d');
  cctx.clearRect(0, 0, img.width, img.height);
  cctx.filter = filter;
  cctx.drawImage(img, 0, 0);
  cctx.filter = 'none';
  return c;
}

function buildBloom(color) {
  const size = 256;
  const c = makeCanvas(size, size);
  const bctx = c.getContext('2d');
  const rgb = hexToRgb(color);
  const g = bctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},.92)`);
  g.addColorStop(.48, `rgba(${rgb.r},${rgb.g},${rgb.b},.42)`);
  g.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
  bctx.fillStyle = g; bctx.fillRect(0, 0, size, size);
  return c;
}

async function preload() {
  const [cells, mural] = await Promise.all([
    fetch('config/cells.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('cells.json 加载失败'); return r.json(); }),
    loadImage('assets/mural-base.jpg')
  ]);
  state.cells = cells;
  state.mural = mural;
  const unique = [...new Set(cells.map(c => c.sprite))];
  await Promise.all(unique.map(async src => {
    const img = await loadImage(src);
    state.sprites.set(src, img);
    state.spriteVariants.set(src, {
      active: buildSpriteVariant(img, 'contrast(1.22) brightness(.78)'),
      idle: buildSpriteVariant(img, 'grayscale(1) contrast(.72) brightness(1.35)')
    });
  }));
  for (const color of new Set(cells.map(c => c.color))) state.blooms.set(color, buildBloom(color));
  buildCellGeometry();
  buildCameraCellMap();
  buildStaticLayer();
  state.ready = true;
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.tracks = new Map();
    this.started = false;
  }
  async init() {
    if (this.started) { await this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = settings.muted ? 0 : 0.78;
    this.master.connect(this.ctx.destination);
    const urls = {
      ambience: 'assets/audio/ambience.wav', qin: 'assets/audio/qin.wav', flute: 'assets/audio/flute.wav',
      pipa: 'assets/audio/pipa.wav', bells: 'assets/audio/bells.wav', erhu: 'assets/audio/erhu.wav',
      drum: 'assets/audio/drum.wav', dancer: 'assets/audio/dancer.wav', attendant: 'assets/audio/attendant.wav'
    };
    const decoded = await Promise.all(Object.entries(urls).map(async ([name, url]) => {
      const arr = await fetch(url).then(r => r.arrayBuffer());
      return [name, await this.ctx.decodeAudioData(arr)];
    }));
    const startAt = this.ctx.currentTime + 0.12;
    for (const [name, buffer] of decoded) {
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      src.buffer = buffer; src.loop = true;
      gain.gain.value = name === 'ambience' ? 0.105 : 0.0001;
      if (pan) { src.connect(gain); gain.connect(pan); pan.connect(this.master); }
      else { src.connect(gain); gain.connect(this.master); }
      src.start(startAt);
      this.tracks.set(name, { src, gain, pan });
    }
    this.started = true;
  }
  update() {
    if (!this.started) return;
    const groups = new Map();
    for (let i = 0; i < state.cells.length; i++) {
      const cell = state.cells[i];
      if (!groups.has(cell.type)) groups.set(cell.type, []);
      groups.get(cell.type).push({ value: state.visual[i], pan: (cell.col / (COLS - 1)) * 2 - 1 });
    }
    const now = this.ctx.currentTime;
    for (const [name, track] of this.tracks) {
      if (name === 'ambience') continue;
      const items = (groups.get(name) || []).sort((a, b) => b.value - a.value);
      const strength = clamp((items[0]?.value || 0) * .58 + (items[1]?.value || 0) * .27 + (items[2]?.value || 0) * .15);
      const target = 0.0001 + Math.pow(strength, 1.35) * 0.38;
      track.gain.gain.setTargetAtTime(target, now, target > track.gain.gain.value ? .10 : .34);
      if (track.pan) {
        const weight = items.reduce((sum, item) => sum + item.value, 0);
        const pan = weight > .001 ? items.reduce((sum, item) => sum + item.value * item.pan, 0) / weight : 0;
        track.pan.pan.setTargetAtTime(clamp(pan * .58, -1, 1), now, .22);
      }
    }
  }
  setMuted(muted) {
    if (!this.started) return;
    this.master.gain.setTargetAtTime(muted ? 0 : .78, this.ctx.currentTime, .05);
  }
}
state.audio = new AudioEngine();

function applySettingsToDom() {
  dom.modeSelect.value = settings.mode;
  dom.diffThreshold.value = settings.diffThreshold;
  dom.onThreshold.value = Math.round(settings.onThreshold * 100);
  dom.offThreshold.value = Math.round(settings.offThreshold * 100);
  dom.mirrorToggle.checked = settings.mirror;
  dom.gridToggle.checked = settings.showGrid;
  dom.labelsToggle.checked = settings.showLabels;
  dom.muteToggle.checked = settings.muted;
  dom.diffThresholdOutput.textContent = settings.diffThreshold;
  dom.onThresholdOutput.textContent = `${Math.round(settings.onThreshold * 100)}%`;
  dom.offThresholdOutput.textContent = `${Math.round(settings.offThreshold * 100)}%`;
  updateStatus();
}

function updateStatus() {
  const modeLabel = settings.mode === 'camera' ? (state.cameraReady ? (state.background ? '摄像头已标定' : '摄像头待采空场') : '摄像头未开启') : settings.mode === 'pointer' ? '鼠标 / 触摸' : (settings.autoPaused ? '自动演示暂停' : '自动演示');
  dom.modeStatus.textContent = modeLabel;
  dom.activeStatus.textContent = `${state.activeCount} / 63`;
  dom.fpsStatus.textContent = `${Math.round(state.fps)} FPS`;
}

async function startExperience(withAudio = true) {
  if (!state.ready) return;
  dom.intro.hidden = true;
  dom.controlPanel.hidden = true;
  state.running = true;
  document.body.classList.remove('ui-hidden');
  if (withAudio && !state.audioLoading) {
    state.audioLoading = true;
    state.audio.init().then(() => { state.audioReady = true; state.audioLoading = false; }).catch(err => {
      state.audioLoading = false; state.errors.push(String(err)); setMessage('声音加载失败，但视觉仍可使用。');
    });
  }
  try {
    if ('wakeLock' in navigator && !state.wakeLock) state.wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}

function setMessage(text) { dom.panelMessage.textContent = text; }

async function startCamera() {
  if (state.cameraStream) return true;
  if (!navigator.mediaDevices?.getUserMedia) { setMessage('当前浏览器不支持摄像头。请使用 Chrome / Edge，并通过 localhost 打开。'); return false; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' }
    });
    video.srcObject = stream;
    await video.play();
    state.cameraStream = stream;
    state.cameraReady = true;
    dom.cameraButton.textContent = '摄像头已开启';
    setMessage('摄像头已开启。现场无人时点击“采集空场背景”。');
    updateStatus();
    return true;
  } catch (err) {
    state.errors.push(String(err));
    setMessage(`摄像头开启失败：${err?.message || err}`);
    return false;
  }
}

function drawVideoToInput() {
  if (!state.cameraReady || video.readyState < 2) return false;
  inputCtx.save();
  inputCtx.clearRect(0, 0, MASK_W, MASK_H);
  if (settings.mirror) {
    inputCtx.translate(MASK_W, 0); inputCtx.scale(-1, 1);
  }
  inputCtx.drawImage(video, 0, 0, MASK_W, MASK_H);
  inputCtx.restore();
  return true;
}

async function captureBackground() {
  const ok = await startCamera();
  if (!ok) return;
  state.backgroundCapture = { count: 0, sum: new Float64Array(MASK_W * MASK_H * 3), target: 18 };
  setMessage('正在采集空场背景：请保持画面无人、摄像头固定……');
}

function updateBackgroundCapture(pixels) {
  const cap = state.backgroundCapture;
  if (!cap) return;
  for (let p = 0, j = 0; p < pixels.length; p += 4, j += 3) {
    cap.sum[j] += pixels[p]; cap.sum[j + 1] += pixels[p + 1]; cap.sum[j + 2] += pixels[p + 2];
  }
  cap.count++;
  if (cap.count >= cap.target) {
    const bg = new Uint8ClampedArray(MASK_W * MASK_H * 3);
    for (let i = 0; i < bg.length; i++) bg[i] = Math.round(cap.sum[i] / cap.count);
    state.background = bg;
    state.backgroundCapture = null;
    setMessage('空场背景采集完成。现在人物进入画面即可触发。');
    updateStatus();
  }
}

function computeCameraMask() {
  if (!drawVideoToInput()) return;
  const image = inputCtx.getImageData(0, 0, MASK_W, MASK_H);
  state.currentPixels = image.data;
  updateBackgroundCapture(image.data);
  if (!state.background) {
    state.rawMask.fill(0);
    state.cleanMask.fill(0);
    return;
  }
  const px = image.data, bg = state.background, raw = state.rawMask;
  const threshold = settings.diffThreshold;
  for (let p = 0, j = 0, i = 0; i < raw.length; i++, p += 4, j += 3) {
    const dr = Math.abs(px[p] - bg[j]);
    const dg = Math.abs(px[p + 1] - bg[j + 1]);
    const db = Math.abs(px[p + 2] - bg[j + 2]);
    const maxd = Math.max(dr, dg, db);
    const sum = dr * .72 + dg + db * .62;
    const luma = Math.abs((px[p] * .21 + px[p + 1] * .72 + px[p + 2] * .07) - (bg[j] * .21 + bg[j + 1] * .72 + bg[j + 2] * .07));
    raw[i] = (maxd > threshold * .52 && sum > threshold * 1.6 && luma > 8) ? 1 : 0;
  }
  morphology(raw, state.tempMask, state.cleanMask);
}

function morphology(src, tmp, dst) {
  tmp.fill(0); dst.fill(0);
  // Remove isolated noise (3x3 majority), then dilate once to reconnect limbs.
  for (let y = 1; y < MASK_H - 1; y++) {
    for (let x = 1; x < MASK_W - 1; x++) {
      const i = y * MASK_W + x;
      let n = 0;
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) n += src[i + yy * MASK_W + xx];
      tmp[i] = n >= 3 ? 1 : 0;
    }
  }
  for (let y = 1; y < MASK_H - 1; y++) {
    for (let x = 1; x < MASK_W - 1; x++) {
      const i = y * MASK_W + x;
      let n = 0;
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) n += tmp[i + yy * MASK_W + xx];
      dst[i] = n >= 2 ? 1 : 0;
    }
  }
}

function computeVirtualMask(now) {
  state.cleanMask.fill(0);
  let people = [];
  if (settings.mode === 'pointer') {
    people = [...state.pointerPeople.values()];
  } else {
    if (settings.autoPaused) people = [];
    else {
      const tt = now * 0.00012;
      people = [
        { x: .5 + Math.sin(tt * 2.1) * .34, y: .49 + Math.sin(tt * 1.43) * .20, rx: .105, ry: .34 },
        { x: .5 + Math.cos(tt * 1.27 + 2.3) * .37, y: .58 + Math.sin(tt * 1.7 + 1.1) * .18, rx: .085, ry: .28 }
      ];
    }
  }
  for (let y = 0; y < MASK_H; y++) {
    const ny = (y + .5) / MASK_H;
    for (let x = 0; x < MASK_W; x++) {
      const nx = (x + .5) / MASK_W;
      let active = 0;
      for (const p of people) {
        const headY = p.y - p.ry * 0.78;
        const head = Math.pow((nx - p.x) / (p.rx * .52), 2) + Math.pow((ny - headY) / (p.ry * .19), 2) < 1;
        const torso = Math.pow((nx - p.x) / p.rx, 2) + Math.pow((ny - (p.y + 0.02)) / p.ry, 2) < 1;
        const armL = Math.pow((nx - (p.x - p.rx * .78)) / (p.rx * .58), 2) + Math.pow((ny - (p.y - .02)) / (p.ry * .22), 2) < 1;
        const armR = Math.pow((nx - (p.x + p.rx * .78)) / (p.rx * .58), 2) + Math.pow((ny - (p.y - .02)) / (p.ry * .22), 2) < 1;
        if (head || torso || armL || armR) { active = 1; break; }
      }
      state.cleanMask[y * MASK_W + x] = active;
    }
  }
}

function computeCoverages() {
  const active = new Uint32Array(CELL_COUNT);
  state.coverages.fill(0);
  for (let i = 0; i < state.cleanMask.length; i++) {
    const cell = state.cellMap[i];
    if (cell >= 0 && state.cleanMask[i]) active[cell]++;
  }
  for (let i = 0; i < CELL_COUNT; i++) state.coverages[i] = state.cellAreas[i] ? active[i] / state.cellAreas[i] : 0;
}

function updateCellStates(dt, now) {
  const forceAll = now < state.forceWakeUntil;
  let activeCount = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const coverage = forceAll ? 1 : state.coverages[i];
    if (state.targets[i]) {
      if (coverage < settings.offThreshold) {
        state.offCounters[i]++;
        if (state.offCounters[i] >= 7) { state.targets[i] = 0; state.offCounters[i] = 0; }
      } else state.offCounters[i] = 0;
    } else {
      if (coverage > settings.onThreshold) {
        state.onCounters[i]++;
        if (state.onCounters[i] >= 2) { state.targets[i] = 1; state.onCounters[i] = 0; }
      } else state.onCounters[i] = 0;
    }
    const tau = state.targets[i] ? .13 : .46;
    const alpha = 1 - Math.exp(-dt / tau);
    state.visual[i] += (state.targets[i] - state.visual[i]) * alpha;
    if (state.visual[i] > .18) activeCount++;
  }
  state.activeCount = activeCount;
}

function buildStaticLayer() {
  const c = makeCanvas(ART_W, ART_H);
  const sctx = c.getContext('2d', { alpha: false });
  sctx.fillStyle = '#d9d2c0'; sctx.fillRect(0, 0, ART_W, ART_H);
  sctx.globalAlpha = .38; sctx.drawImage(state.mural, 0, 0, ART_W, ART_H); sctx.globalAlpha = 1;
  const veil = sctx.createLinearGradient(0, 0, 0, ART_H);
  veil.addColorStop(0, 'rgba(236,232,220,.38)'); veil.addColorStop(.5, 'rgba(227,222,208,.58)'); veil.addColorStop(1, 'rgba(213,207,191,.35)');
  sctx.fillStyle = veil; sctx.fillRect(0, 0, ART_W, ART_H);
  // Static stone speckle.
  sctx.globalAlpha = .045; sctx.fillStyle = '#211f1b';
  for (let i = 0; i < 1450; i++) { const x = (i * 1597 + 23) % ART_W; const y = (i * 971 + 41) % ART_H; sctx.fillRect(x, y, 1 + ((i * 13) % 3), 1); }
  sctx.globalAlpha = 1;
  const frame = { x: 103, y: 144, w: 1714, h: 812 };
  sctx.strokeStyle = 'rgba(49,46,40,.34)'; sctx.lineWidth = 2.1; sctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
  sctx.strokeStyle = 'rgba(49,46,40,.19)'; sctx.lineWidth = 1.15;
  for (const g of state.cellGeom) sctx.strokeRect(g.x, g.y, g.w, g.h);
  sctx.fillStyle = 'rgba(40,38,33,.26)'; sctx.fillRect(frame.x, frame.y - 7, frame.w, 6); sctx.fillRect(frame.x, frame.y + frame.h + 2, frame.w, 5);
  for (let col = 0; col <= COLS; col++) { const x = frame.x + frame.w * col / COLS; sctx.fillRect(x - 2, frame.y - 12, 4, frame.h + 24); }
  sctx.fillStyle = 'rgba(43,40,34,.66)'; sctx.font = '600 26px serif'; sctx.fillText('汉画像 · 百戏乐舞', 118, 112);
  sctx.font = '15px ui-monospace, monospace'; sctx.fillStyle = 'rgba(54,50,42,.48)'; sctx.fillText('63 CELLS / LIVE BODY ORCHESTRA', 118, 136);
  const vignette = sctx.createRadialGradient(ART_W / 2, ART_H / 2, ART_H * .24, ART_W / 2, ART_H / 2, ART_W * .73);
  vignette.addColorStop(0, 'rgba(18,17,15,0)'); vignette.addColorStop(1, 'rgba(18,17,15,.20)');
  sctx.fillStyle = vignette; sctx.fillRect(0, 0, ART_W, ART_H);
  state.staticLayer = c;
}

function drawStoneBackground() {
  ctx.drawImage(state.staticLayer, 0, 0);
}

function drawArchitecturalGrid() {}

function fitSprite(cell, img, type, cfg) {
  const meta = TYPE_DRAW[type] || TYPE_DRAW.attendant;
  const maxW = cell.w * meta.fit * cfg.scale;
  const maxH = cell.h * (type === 'flute' || type === 'attendant' ? .92 : .88) * cfg.scale;
  const s = Math.min(maxW / img.width, maxH / img.height);
  const w = img.width * s, h = img.height * s;
  const x = cell.cx - w / 2 + cfg.xOffset * cell.w;
  const y = cell.y + (cell.h - h) * .54 + meta.y * cell.h + cfg.yOffset * cell.h;
  return { x, y, w, h, meta };
}

function drawInkBloom(cell, cfg, activation, now) {
  if (activation < .035 || cfg.id % 3 !== 0) return;
  const bloom = state.blooms.get(cfg.color);
  const pulse = .82 + Math.sin(now * .0017 + cfg.phase) * .12;
  const size = Math.max(cell.w, cell.h) * (1.05 + activation * .55);
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = activation * .16 * pulse;
  ctx.drawImage(bloom, cell.cx - size / 2, cell.cy - size / 2, size, size); ctx.restore();
}

function drawSpriteLayer(variant, box, cfg, activation, now) {
  const { x, y, w, h, meta } = box;
  const phase = now * .0017 + cfg.phase;
  const sway = Math.sin(phase * (1.15 + meta.motion * .09)) * .012 * meta.motion * activation;
  const lift = Math.sin(phase * 1.7) * 2.2 * activation;
  const breathe = 1 + Math.sin(phase * 1.23) * .008 * activation;
  const flip = cfg.mirror ? -1 : 1;
  const drawBase = (source, alpha) => {
    ctx.save(); ctx.translate(x + w / 2, y + h / 2 + lift); ctx.rotate(sway * .35); ctx.scale(flip * breathe, breathe); ctx.translate(-w / 2, -h / 2);
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(source, 0, 0, w, h); ctx.restore();
  };
  const idleAlpha = .11 * (1 - activation);
  if (idleAlpha > .008) drawBase(variant.idle, idleAlpha);
  if (activation <= .008) return;
  drawBase(variant.active, activation * .92);
  if (activation < .14 || cfg.id % 2 === 1) return;
  const [ux, uy, uw, uh] = meta.upper; const pivotX = meta.pivot[0] * w, pivotY = meta.pivot[1] * h;
  ctx.save(); ctx.translate(x + w / 2, y + h / 2 + lift); ctx.scale(flip, 1); ctx.translate(-w / 2, -h / 2);
  ctx.beginPath(); ctx.rect(ux * w, uy * h, uw * w, uh * h); ctx.clip(); ctx.translate(pivotX, pivotY);
  ctx.rotate(sway * (cfg.type === 'dancer' ? 2.7 : 1.8));
  ctx.translate(-pivotX + Math.sin(phase * 2.2) * 2.5 * activation * meta.motion, -pivotY);
  ctx.globalAlpha = activation * .68; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(variant.active, 0, 0, w, h); ctx.restore();
}

function drawCells(now) {
  for (let i = 0; i < state.cells.length; i++) {
    const cfg = state.cells[i];
    cfg.type = cfg.type || 'attendant';
    const cell = state.cellGeom[i];
    const img = state.sprites.get(cfg.sprite);
    const variant = state.spriteVariants.get(cfg.sprite);
    const a = state.visual[i];
    drawInkBloom(cell, cfg, a, now);
    const box = fitSprite(cell, img, cfg.type, cfg);
    drawSpriteLayer(variant, box, cfg, a, now);
    if (settings.showGrid) {
      ctx.save();
      const cov = state.coverages[i];
      ctx.fillStyle = a > .18 ? `rgba(77,95,65,${.05 + a * .12})` : `rgba(25,24,21,${cov * .12})`;
      ctx.fillRect(cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2);
      ctx.strokeStyle = a > .18 ? 'rgba(55,70,45,.65)' : 'rgba(48,45,39,.25)';
      ctx.lineWidth = a > .18 ? 2 : 1;
      ctx.strokeRect(cell.x, cell.y, cell.w, cell.h);
      ctx.restore();
    }
    if (settings.showLabels) {
      ctx.save();
      ctx.font = '17px ui-monospace, monospace';
      ctx.fillStyle = a > .2 ? 'rgba(50,45,39,.8)' : 'rgba(50,45,39,.35)';
      ctx.fillText(`${String(i + 1).padStart(2, '0')} ${cfg.label}`, cell.x + 8, cell.y + 21);
      ctx.restore();
    }
  }
}

function drawTitleAndVignette() {}

function render(now) {
  if (!state.ready) {
    ctx.fillStyle = '#181814'; ctx.fillRect(0, 0, ART_W, ART_H);
    ctx.fillStyle = '#bdb5a3'; ctx.font = '28px serif'; ctx.fillText('正在装载画像与乐声……', 740, 540);
    return;
  }
  drawStoneBackground(now);
  drawArchitecturalGrid();
  drawCells(now);
  drawTitleAndVignette(now);
}

function updateDebugCanvas() {
  if (!state.debugOpen) return;
  const w = debugCanvas.width, h = debugCanvas.height;
  debugCtx.clearRect(0, 0, w, h);
  debugCtx.save();
  if (state.cameraReady && video.readyState >= 2) {
    if (settings.mirror) { debugCtx.translate(w, 0); debugCtx.scale(-1, 1); }
    debugCtx.drawImage(video, 0, 0, w, h);
  } else {
    debugCtx.fillStyle = '#121212'; debugCtx.fillRect(0, 0, w, h);
    debugCtx.fillStyle = '#827d70'; debugCtx.font = '24px sans-serif'; debugCtx.fillText('摄像头未开启', 390, 270);
  }
  debugCtx.restore();

  // Mask overlay.
  if (state.cleanMask) {
    const maskImage = inputCtx.createImageData(MASK_W, MASK_H);
    for (let i = 0, p = 0; i < state.cleanMask.length; i++, p += 4) {
      if (state.cleanMask[i]) { maskImage.data[p] = 196; maskImage.data[p + 1] = 57; maskImage.data[p + 2] = 40; maskImage.data[p + 3] = 132; }
    }
    inputCtx.putImageData(maskImage, 0, 0);
    debugCtx.save(); debugCtx.imageSmoothingEnabled = false; debugCtx.drawImage(inputCanvas, 0, 0, w, h); debugCtx.restore();
  }

  // Grid and values.
  debugCtx.save();
  debugCtx.lineWidth = 1.5;
  for (let r = 0; r <= ROWS; r++) {
    debugCtx.beginPath();
    for (let c = 0; c <= COLS; c++) {
      const p = bilerpQuad(c / COLS, r / ROWS);
      const x = p.x * w, y = p.y * h;
      c ? debugCtx.lineTo(x, y) : debugCtx.moveTo(x, y);
    }
    debugCtx.strokeStyle = 'rgba(245,238,218,.72)'; debugCtx.stroke();
  }
  for (let c = 0; c <= COLS; c++) {
    debugCtx.beginPath();
    for (let r = 0; r <= ROWS; r++) {
      const p = bilerpQuad(c / COLS, r / ROWS);
      const x = p.x * w, y = p.y * h;
      r ? debugCtx.lineTo(x, y) : debugCtx.moveTo(x, y);
    }
    debugCtx.strokeStyle = 'rgba(245,238,218,.72)'; debugCtx.stroke();
  }
  debugCtx.font = '13px ui-monospace, monospace';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const id = r * COLS + c;
    const p = bilerpQuad((c + .5) / COLS, (r + .5) / ROWS);
    debugCtx.fillStyle = state.targets[id] ? '#ffe8a4' : 'rgba(255,255,255,.78)';
    debugCtx.textAlign = 'center';
    debugCtx.fillText(`${id + 1}:${Math.round(state.coverages[id] * 100)}`, p.x * w, p.y * h + 4);
  }
  quad.forEach((p, i) => {
    debugCtx.beginPath(); debugCtx.arc(p.x * w, p.y * h, 10, 0, Math.PI * 2);
    debugCtx.fillStyle = i === state.draggingQuad ? '#ffcf66' : '#e23e2f'; debugCtx.fill();
    debugCtx.strokeStyle = 'white'; debugCtx.lineWidth = 2; debugCtx.stroke();
  });
  debugCtx.restore();
}

function loop(now) {
  const dt = Math.min(.08, Math.max(.001, (now - state.lastFrame) / 1000));
  state.lastFrame = now;
  if (state.running) {
    if (settings.mode === 'camera') computeCameraMask(); else computeVirtualMask(now);
    computeCoverages();
    updateCellStates(dt, now);
    state.audio.update();
  }
  render(now);
  updateDebugCanvas();
  state.fpsFrames++;
  if (now - state.fpsClock > 600) {
    state.fps = state.fpsFrames * 1000 / (now - state.fpsClock);
    state.fpsFrames = 0; state.fpsClock = now;
    updateStatus();
  }
  requestAnimationFrame(loop);
}

function artPointFromEvent(ev) {
  const rect = artCanvas.getBoundingClientRect();
  // Canvas uses contain-like scaling; determine rendered content rectangle.
  const scale = Math.min(rect.width / ART_W, rect.height / ART_H);
  const rw = ART_W * scale, rh = ART_H * scale;
  const ox = rect.left + (rect.width - rw) / 2, oy = rect.top + (rect.height - rh) / 2;
  return { x: clamp((ev.clientX - ox) / rw), y: clamp((ev.clientY - oy) / rh) };
}

function addPointerPerson(ev) {
  const p = artPointFromEvent(ev);
  state.pointerPeople.set(ev.pointerId, { x: p.x, y: p.y, rx: .095, ry: .30 });
  try { artCanvas.setPointerCapture(ev.pointerId); } catch {}
}
artCanvas.addEventListener('pointerdown', ev => { if (settings.mode === 'pointer') addPointerPerson(ev); });
artCanvas.addEventListener('pointermove', ev => {
  if (settings.mode !== 'pointer' || !state.pointerPeople.has(ev.pointerId)) return;
  const p = artPointFromEvent(ev); const person = state.pointerPeople.get(ev.pointerId); person.x = p.x; person.y = p.y;
});
for (const name of ['pointerup', 'pointercancel', 'pointerleave']) artCanvas.addEventListener(name, ev => state.pointerPeople.delete(ev.pointerId));

function openDebug() { state.debugOpen = true; dom.debugView.hidden = false; }
function closeDebug() { state.debugOpen = false; state.draggingQuad = -1; dom.debugView.hidden = true; }

function debugPoint(ev) {
  const rect = debugCanvas.getBoundingClientRect();
  return { x: clamp((ev.clientX - rect.left) / rect.width), y: clamp((ev.clientY - rect.top) / rect.height) };
}
debugCanvas.addEventListener('pointerdown', ev => {
  const p = debugPoint(ev); let best = -1, dist = .05;
  quad.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < dist) { dist = d; best = i; } });
  if (best >= 0) { state.draggingQuad = best; debugCanvas.setPointerCapture(ev.pointerId); }
});
debugCanvas.addEventListener('pointermove', ev => {
  if (state.draggingQuad < 0) return;
  quad[state.draggingQuad] = debugPoint(ev);
  buildCameraCellMap();
});
debugCanvas.addEventListener('pointerup', () => {
  if (state.draggingQuad >= 0) safeStorageSet(QUAD_KEY, JSON.stringify(quad));
  state.draggingQuad = -1;
});

function setMode(mode) {
  settings.mode = mode;
  dom.modeSelect.value = mode;
  if (mode === 'camera') startCamera();
  if (mode !== 'pointer') state.pointerPeople.clear();
  saveSettings(); updateStatus();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}
function toggleUi() { document.body.classList.toggle('ui-hidden'); }
function toggleMute() {
  settings.muted = !settings.muted; dom.muteToggle.checked = settings.muted;
  state.audio.setMuted(settings.muted); saveSettings();
}

function bindUi() {
  dom.enterButton.addEventListener('click', () => startExperience(true));
  dom.openPanel.addEventListener('click', () => { dom.controlPanel.hidden = false; document.body.classList.remove('ui-hidden'); });
  dom.closePanel.addEventListener('click', () => { dom.controlPanel.hidden = true; });
  dom.modeSelect.addEventListener('change', ev => setMode(ev.target.value));
  dom.cameraButton.addEventListener('click', startCamera);
  dom.captureBackgroundButton.addEventListener('click', captureBackground);
  dom.debugCaptureButton.addEventListener('click', captureBackground);
  dom.debugButton.addEventListener('click', openDebug);
  dom.closeDebug.addEventListener('click', closeDebug);
  dom.fullscreenButton.addEventListener('click', toggleFullscreen);
  dom.wakeAllButton.addEventListener('click', () => { state.forceWakeUntil = performance.now() + 6500; });
  dom.resetButton.addEventListener('click', () => {
    Object.assign(settings, DEFAULT_SETTINGS); safeStorageRemove(STORAGE_KEY);
    quad = structuredClone(defaultQuad); safeStorageRemove(QUAD_KEY);
    state.background = null; buildCameraCellMap(); applySettingsToDom(); setMode('auto'); setMessage('已恢复默认设置。');
  });
  dom.resetQuadButton.addEventListener('click', () => { quad = structuredClone(defaultQuad); safeStorageSet(QUAD_KEY, JSON.stringify(quad)); buildCameraCellMap(); });
  dom.diffThreshold.addEventListener('input', ev => { settings.diffThreshold = +ev.target.value; dom.diffThresholdOutput.textContent = settings.diffThreshold; saveSettings(); });
  dom.onThreshold.addEventListener('input', ev => { settings.onThreshold = +ev.target.value / 100; dom.onThresholdOutput.textContent = `${ev.target.value}%`; saveSettings(); });
  dom.offThreshold.addEventListener('input', ev => { settings.offThreshold = +ev.target.value / 100; dom.offThresholdOutput.textContent = `${ev.target.value}%`; saveSettings(); });
  dom.mirrorToggle.addEventListener('change', ev => { settings.mirror = ev.target.checked; state.background = null; saveSettings(); setMessage('镜像设置已变更，请重新采集空场背景。'); });
  dom.gridToggle.addEventListener('change', ev => { settings.showGrid = ev.target.checked; saveSettings(); });
  dom.labelsToggle.addEventListener('change', ev => { settings.showLabels = ev.target.checked; saveSettings(); });
  dom.muteToggle.addEventListener('change', ev => { settings.muted = ev.target.checked; state.audio.setMuted(settings.muted); saveSettings(); });
  dom.audioButton.addEventListener('click', toggleMute);
  window.addEventListener('keydown', ev => {
    if (ev.target?.matches('input,select,textarea')) return;
    if (ev.key.toLowerCase() === 'h') toggleUi();
    if (ev.key.toLowerCase() === 'd') state.debugOpen ? closeDebug() : openDebug();
    if (ev.key.toLowerCase() === 'f') toggleFullscreen();
    if (ev.key.toLowerCase() === 'm') toggleMute();
    if (ev.key === ' ') { ev.preventDefault(); settings.autoPaused = !settings.autoPaused; saveSettings(); updateStatus(); }
    if (ev.key.toLowerCase() === 'a') state.forceWakeUntil = performance.now() + 6500;
  });
  document.addEventListener('fullscreenchange', () => { dom.fullscreenButton.textContent = document.fullscreenElement ? '退出全屏' : '全屏投影'; });
  window.addEventListener('error', ev => state.errors.push(ev.message || String(ev.error)));
  window.addEventListener('unhandledrejection', ev => state.errors.push(String(ev.reason)));
}

function exposeTestApi() {
  window.__HAN_APP__ = {
    version: '1.0.0',
    getState: () => ({ ready: state.ready, running: state.running, mode: settings.mode, activeCount: state.activeCount, fps: state.fps, audioReady: state.audioReady, cameraReady: state.cameraReady, backgroundReady: !!state.background, errors: [...state.errors], cellCount: state.cells.length }),
    setMode,
    wakeAll: (ms = 3500) => { state.forceWakeUntil = performance.now() + ms; },
    start: () => startExperience(false),
    setShowGrid: value => { settings.showGrid = !!value; dom.gridToggle.checked = !!value; },
    setPointerPeople: people => {
      state.pointerPeople.clear();
      (people || []).forEach((p, i) => state.pointerPeople.set(i + 1, { x: p.x, y: p.y, rx: p.rx || .095, ry: p.ry || .30 }));
      setMode('pointer');
    },
    openDebug, closeDebug,
    getCoverages: () => Array.from(state.coverages),
    getVisualStates: () => Array.from(state.visual),
    saveFrame: () => artCanvas.toDataURL('image/png')
  };
}

async function main() {
  applySettingsToDom(); bindUi(); exposeTestApi();
  try { await preload(); }
  catch (err) {
    state.errors.push(String(err));
    dom.intro.querySelector('.intro-copy').textContent = `资源加载失败：${err?.message || err}`;
    dom.enterButton.disabled = true;
  }
  if (new URLSearchParams(location.search).has('test')) {
    await startExperience(false);
    setMode('auto');
    settings.showGrid = true;
  }
  requestAnimationFrame(loop);
}
main();
