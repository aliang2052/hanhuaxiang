import test from 'node:test';
import assert from 'node:assert/strict';
import { TriggerHysteresis } from '../../src/trigger/hysteresis.js';

test('hysteresis requires consecutive frames and lower release threshold', () => {
  const bank = new TriggerHysteresis(2, { onThreshold: 0.1, offThreshold: 0.04, onFrames: 2, offFrames: 3, attackSeconds: 0, releaseSeconds: 0 });
  assert.equal(bank.update([0.11, 0], 1 / 60, 0).active[0], 0);
  assert.equal(bank.update([0.12, 0], 1 / 60, 16).active[0], 1);
  assert.equal(bank.update([0.06, 0], 1 / 60, 32).active[0], 1);
  assert.equal(bank.update([0.02, 0], 1 / 60, 48).active[0], 1);
  assert.equal(bank.update([0.02, 0], 1 / 60, 64).active[0], 1);
  assert.equal(bank.update([0.02, 0], 1 / 60, 80).active[0], 0);
});

test('force wake activates all cells temporarily', () => {
  const bank = new TriggerHysteresis(63, { attackSeconds: 0, releaseSeconds: 0 });
  bank.forceWake(1000, 100);
  const forced = bank.update(new Float32Array(63), 1 / 60, 200);
  assert.equal(forced.activeCount, 63);
  const after = bank.update(new Float32Array(63), 1, 1200);
  assert.equal(after.forced, false);
});
