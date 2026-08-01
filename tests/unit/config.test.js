import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateSceneConfig, validateSettings } from '../../src/core/config-schema.js';

const scene = JSON.parse(fs.readFileSync(new URL('../../config/scene.json', import.meta.url), 'utf8'));

test('V2 scene uses the full composition catalog and at least 16 independent voices', () => {
  const result = validateSceneConfig(scene);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(scene.nodes.length, 63);
  assert.equal(new Set(scene.nodes.map((node) => node.id)).size, 63);
  assert.ok(new Set(scene.nodes.map((node) => node.sprite)).size >= 40);
  assert.ok(new Set(scene.nodes.map((node) => node.audioGroup)).size >= 16);
  assert.ok(scene.audioGroups.length >= 17);
  assert.ok(scene.nodes.some((node) => node.composition === 'duo'));
  assert.ok(scene.nodes.some((node) => node.composition === 'trio'));
  assert.ok(scene.nodes.some((node) => node.composition === 'ensemble'));
  assert.ok(scene.nodes.every((node) => Number(node.beatPeriod) >= 0.25));
  assert.ok(scene.nodes.every((node) => typeof node.secondaryColor === 'string'));
  assert.equal(scene.assetStats.runtimeSpriteCount, 60);
  assert.equal(scene.assetStats.distinctBaseSilhouetteCount, 32);
  assert.equal(scene.assetStats.independentHighResSourceCount, 8);
  assert.equal(scene.assetStats.muralDerivedDistinctSourceCount, 24);
  assert.equal(scene.visualStructure.landscapePanelCount, 63);
  assert.ok(scene.visualStructure.centralStagePanelIds.length >= 5);
  assert.equal(scene.visualStructure.sideBorderCount, 2);
  assert.match(scene.visualStructure.description, /three-tier.*solos, ensembles.*central ritual stage/i);
});

test('settings validation clamps corrupted values and repairs threshold ordering', () => {
  const result = validateSettings({ version: 1, mode: 'bogus', diffThreshold: 999, onThreshold: 0.02, offThreshold: 0.5 });
  assert.equal(result.settings.mode, 'auto');
  assert.equal(result.settings.diffThreshold, 140);
  assert.ok(result.settings.offThreshold < result.settings.onThreshold);
  assert.ok(result.errors.length >= 1);
});
