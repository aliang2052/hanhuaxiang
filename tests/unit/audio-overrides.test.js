import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyAudioOverrides } from '../../src/config/audio-overrides.js';

const scene = JSON.parse(fs.readFileSync(new URL('../../config/scene.json', import.meta.url), 'utf8'));
const payload = JSON.parse(fs.readFileSync(new URL('../../config/audio-overrides.json', import.meta.url), 'utf8'));

test('all 36 audition previews replace unique voices while 27 existing voices remain', () => {
  const result = applyAudioOverrides(scene, payload);
  const auditionGroups = result.audioGroups.filter((group) => group.file.startsWith('assets/audio-auditions/'));
  const existingGroups = result.audioGroups.filter((group) => group.file.startsWith('assets/audio/'));
  assert.equal(auditionGroups.length, 36);
  assert.equal(existingGroups.length, 27);
  assert.equal(new Set(auditionGroups.map((group) => group.file)).size, 36);
  assert.equal(new Set(result.audioGroups.map((group) => group.id)).size, 63);
});

test('incomplete or duplicate audition mappings are rejected', () => {
  assert.throws(() => applyAudioOverrides(scene, { ...payload, overrides: payload.overrides.slice(1) }), /36/);
  const duplicate = structuredClone(payload);
  duplicate.overrides[1].groupId = duplicate.overrides[0].groupId;
  assert.throws(() => applyAudioOverrides(scene, duplicate), /重复/);
});
