import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, buildSpatialMix } from '../../src/audio/audio-engine.js';

test('audio recovery only reports success after the context is actually running', async () => {
  const engine = new AudioEngine([], []);
  engine.context = { state: 'suspended', resume: async () => {} };

  assert.equal(await engine.resume(), false);
  assert.equal(engine.snapshot().contextState, 'suspended');

  engine.context.resume = async () => { engine.context.state = 'running'; };
  assert.equal(await engine.resume(), true);
  assert.equal(engine.snapshot().contextState, 'running');
});

test('audio recovery normalizes initialization results to a real running-state boolean', async () => {
  const failed = new AudioEngine([], []);
  failed.init = async () => ({ ok: false, errors: ['decode failed'] });
  assert.equal(await failed.recover(), false);

  const started = new AudioEngine([], []);
  started.init = async () => {
    started.context = { state: 'running' };
    return { ok: true, errors: [] };
  };
  assert.equal(await started.recover(), true);
});

test('audio output meter reports RMS signal only for a running context', () => {
  const engine = new AudioEngine([], []);
  engine.context = { state: 'running' };
  engine.meterData = new Float32Array(4);
  engine.analyser = { getFloatTimeDomainData: (data) => data.fill(0.25) };
  assert.equal(engine.outputLevel(), 0.25);
  engine.context.state = 'suspended';
  assert.equal(engine.outputLevel(), 0);
});

test('spatial audio follows the covered visual node and scales with overlap', () => {
  const groups = [{ id: 'left' }, { id: 'right' }];
  const nodes = [
    { id: 0, audioGroup: 'left', landscape: { x: 0.05, y: 0.2, w: 0.1, h: 0.2 } },
    { id: 1, audioGroup: 'right', landscape: { x: 0.85, y: 0.2, w: 0.1, h: 0.2 } },
  ];
  const mix = buildSpatialMix(groups, nodes, [1, 1], [0.07, 0], 'landscape');
  assert.ok(mix.get('left').intensity > 0.2 && mix.get('left').intensity < 0.3);
  assert.ok(mix.get('left').pan < -0.5);
  assert.equal(mix.get('right').intensity, 0);
  assert.equal(mix.get('right').pan, 0);
});
