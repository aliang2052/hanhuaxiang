const EXPECTED_OVERRIDE_COUNT = 36;

export function applyAudioOverrides(scene, payload) {
  if (!scene || typeof scene !== 'object' || !Array.isArray(scene.audioGroups)) {
    throw new TypeError('场景配置缺少 audioGroups。');
  }
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload.overrides)) {
    throw new TypeError('试听音色覆盖配置无效。');
  }
  if (payload.overrides.length !== EXPECTED_OVERRIDE_COUNT) {
    throw new RangeError(`试听音色必须完整包含 ${EXPECTED_OVERRIDE_COUNT} 项。`);
  }

  const knownIds = new Set(scene.audioGroups.map((group) => group.id));
  const overrideIds = new Set();
  const overrideFiles = new Set();
  const overrides = new Map();
  for (const entry of payload.overrides) {
    if (!knownIds.has(entry?.groupId)) throw new RangeError(`试听音色引用未知声部：${entry?.groupId}`);
    if (overrideIds.has(entry.groupId)) throw new RangeError(`试听音色重复覆盖声部：${entry.groupId}`);
    if (typeof entry.file !== 'string'
        || !entry.file.startsWith('assets/audio-auditions/')
        || !entry.file.endsWith('.ogg')) {
      throw new TypeError(`试听音色文件路径无效：${entry?.file}`);
    }
    if (overrideFiles.has(entry.file)) throw new RangeError(`试听音色文件被重复使用：${entry.file}`);
    overrideIds.add(entry.groupId);
    overrideFiles.add(entry.file);
    overrides.set(entry.groupId, entry);
  }

  return {
    ...scene,
    audioGroups: scene.audioGroups.map((group) => {
      const override = overrides.get(group.id);
      if (!override) return { ...group };
      return {
        ...group,
        label: override.label,
        file: override.file,
        source: 'Operator-provided local audition preview',
        sourceFile: override.sourceFile,
      };
    }),
  };
}
