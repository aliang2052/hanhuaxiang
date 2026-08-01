const MODES = new Set(['auto', 'pointer', 'camera']);
const CAMERA_SOURCES = new Set(['hardware', 'simulated']);

export const SETTINGS_SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  mode: 'auto',
  cameraSource: 'simulated',
  diffThreshold: 42,
  chromaThreshold: 24,
  onThreshold: 0.055,
  offThreshold: 0.024,
  onFrames: 2,
  offFrames: 6,
  mirror: true,
  showGrid: false,
  showLabels: false,
  muted: false,
  debugOverlays: true,
  autoPaused: false,
  camera: Object.freeze({
    width: 1280,
    height: 720,
    frameRate: 30,
    maskWidth: 240,
    maskHeight: 135,
    minComponentArea: 80,
    backgroundLearningRate: 0.0025,
  }),
});

function cloneDefaults(defaults = DEFAULT_SETTINGS) {
  return structuredClone(defaults);
}

function finiteNumber(candidate, key, fallback, errors) {
  const value = Number(candidate?.[key]);
  if (!Number.isFinite(value)) {
    errors.push(`${key} 无效`);
    return fallback;
  }
  return value;
}

/** Validate and normalize persistent operator settings.
 * Returns both `settings` and the legacy alias `value` to keep migration code explicit.
 */
export function validateSettings(candidate, defaults = DEFAULT_SETTINGS) {
  const settings = cloneDefaults(defaults);
  const errors = [];
  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, settings, value: settings, errors: ['设置不是对象'] };
  }
  if (candidate.schemaVersion !== SETTINGS_SCHEMA_VERSION) errors.push('schemaVersion 不匹配');

  if (MODES.has(candidate.mode)) settings.mode = candidate.mode;
  else errors.push('mode 无效');
  if (CAMERA_SOURCES.has(candidate.cameraSource)) settings.cameraSource = candidate.cameraSource;
  else errors.push('cameraSource 无效');

  settings.diffThreshold = finiteNumber(candidate, 'diffThreshold', settings.diffThreshold, errors);
  settings.chromaThreshold = finiteNumber(candidate, 'chromaThreshold', settings.chromaThreshold, errors);
  settings.onThreshold = finiteNumber(candidate, 'onThreshold', settings.onThreshold, errors);
  settings.offThreshold = finiteNumber(candidate, 'offThreshold', settings.offThreshold, errors);
  settings.onFrames = finiteNumber(candidate, 'onFrames', settings.onFrames, errors);
  settings.offFrames = finiteNumber(candidate, 'offFrames', settings.offFrames, errors);

  for (const key of ['mirror', 'showGrid', 'showLabels', 'muted', 'debugOverlays', 'autoPaused']) {
    if (typeof candidate[key] === 'boolean') settings[key] = candidate[key];
    else errors.push(`${key} 无效`);
  }

  settings.diffThreshold = Math.min(140, Math.max(5, settings.diffThreshold));
  settings.chromaThreshold = Math.min(180, Math.max(3, settings.chromaThreshold));
  settings.onThreshold = Math.min(0.5, Math.max(0.001, settings.onThreshold));
  settings.offThreshold = Math.min(settings.onThreshold * 0.95, Math.max(0.0005, settings.offThreshold));
  settings.onFrames = Math.round(Math.min(20, Math.max(1, settings.onFrames)));
  settings.offFrames = Math.round(Math.min(60, Math.max(1, settings.offFrames)));

  const camera = candidate.camera && typeof candidate.camera === 'object' ? candidate.camera : {};
  settings.camera = { ...cloneDefaults(defaults).camera, ...camera };
  for (const key of ['width', 'height', 'frameRate', 'maskWidth', 'maskHeight', 'minComponentArea', 'backgroundLearningRate']) {
    const value = Number(settings.camera[key]);
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`camera.${key} 无效`);
      settings.camera[key] = defaults.camera[key];
    }
  }
  settings.camera.width = Math.round(settings.camera.width);
  settings.camera.height = Math.round(settings.camera.height);
  settings.camera.frameRate = Math.round(settings.camera.frameRate);
  settings.camera.maskWidth = Math.round(settings.camera.maskWidth);
  settings.camera.maskHeight = Math.round(settings.camera.maskHeight);
  settings.camera.minComponentArea = Math.round(settings.camera.minComponentArea);

  return { valid: errors.length === 0, settings, value: settings, errors };
}

function validLayout(layout) {
  return layout && ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(layout[key]))
    && layout.w > 0 && layout.h > 0
    && layout.x >= -0.25 && layout.y >= -0.25
    && layout.x + layout.w <= 1.25 && layout.y + layout.h <= 1.25;
}

/** Validate the generated scene config consumed by the runtime. */
export function validateSceneConfig(scene) {
  const errors = [];
  if (!scene || typeof scene !== 'object') return { valid: false, config: null, errors: ['scene 不是对象'] };
  if (scene.version !== 3) errors.push('scene.version 必须为 3');
  if (scene.trigger?.rows !== 7 || scene.trigger?.cols !== 9) errors.push('触发平面必须是 9×7 / 63 区');
  if (!Array.isArray(scene.nodes) || scene.nodes.length !== 63) errors.push('nodes 必须包含 63 项');
  if (!Array.isArray(scene.audioGroups) || scene.audioGroups.length < 2) errors.push('audioGroups 无效');

  const assetStats = scene.assetStats;
  if (!assetStats
      || assetStats.distinctBaseSilhouetteCount < 24
      || assetStats.runtimeSpriteCount < 50
      || assetStats.independentHighResSourceCount < 8
      || assetStats.muralDerivedDistinctSourceCount < 16) {
    errors.push('assetStats 必须记录至少 24 个不同基础轮廓、50 个运行时素材、8 个独立高分辨率源和 16 个画像石派生源');
  }
  const structure = scene.visualStructure;
  if (!structure
      || structure.landscapePanelCount < 55
      || !Array.isArray(structure.centralStagePanelIds)
      || structure.centralStagePanelIds.length < 4
      || structure.sideBorderCount < 2
      || structure.horizontalBeamCount < 6) {
    errors.push('visualStructure 必须包含至少 55 个横屏画格、中央纵向舞台、左右边框和多层横梁');
  }

  if (Array.isArray(scene.nodes)) {
    const ids = new Set();
    for (const node of scene.nodes) {
      if (!Number.isInteger(node?.id) || node.id < 0 || node.id >= 63) errors.push(`节点 id 无效：${node?.id}`);
      else ids.add(node.id);
      if (typeof node?.sprite !== 'string' || !node.sprite.startsWith('assets/')) errors.push(`节点 ${node?.id} sprite 无效`);
      if (!validLayout(node?.landscape)) errors.push(`节点 ${node?.id} 缺少有效 landscape 布局`);
      if (!validLayout(node?.portrait)) errors.push(`节点 ${node?.id} 缺少有效 portrait 布局`);
      if (typeof node?.audioGroup !== 'string') errors.push(`节点 ${node?.id} audioGroup 无效`);
    }
    if (ids.size !== 63) errors.push('节点 id 必须完整覆盖 0–62');
  }

  const config = errors.length ? null : structuredClone(scene);
  return { valid: errors.length === 0, config, errors };
}

// Compatibility alias used by unit tests and earlier internal modules.
export function validateScene(scene) {
  return validateSceneConfig(scene);
}
