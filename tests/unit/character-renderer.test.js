import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOpaqueBounds, performanceCue } from '../../src/scene/character-renderer.js';
import { MOTION_ACTIONS, computeCharacterPose, deformCharacterPoint } from '../../src/scene/character-motion.js';

test('sprite normalization measures the visible person instead of transparent canvas padding', () => {
  const width = 12;
  const height = 10;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 2; y <= 8; y += 1) {
    for (let x = 4; x <= 7; x += 1) pixels[(y * width + x) * 4 + 3] = 255;
  }
  assert.deepEqual(computeOpaqueBounds(pixels, width, height), { x: 4, y: 2, w: 4, h: 7 });
});

test('sprite normalization ignores fully transparent images and faint edge noise', () => {
  const pixels = new Uint8ClampedArray(6 * 5 * 4);
  pixels[3] = 4;
  assert.equal(computeOpaqueBounds(pixels, 6, 5), null);
});

test('performance cue has a deterministic attack at the shared transport beat', () => {
  const node = { animation: 'drum', beatPeriod: 0.5, beatOffset: 0 };
  assert.equal(performanceCue(node, 0).attack, 1);
  assert.equal(performanceCue(node, 500).attack, 1);
  assert.ok(performanceCue(node, 250).attack < 0.01);
});

test('every performance family produces a finite continuous motion rig', () => {
  for (const animation of MOTION_ACTIONS) {
    const pose = computeCharacterPose({ animation, beatPeriod: 1, motion: 1.2, phase: 0.3 }, 1, 375);
    assert.equal(pose.action, animation);
    assert.ok(pose.controls.length > 0, `${animation} should have local controls`);
    for (const value of [pose.dx, pose.dy, pose.rotation, pose.sx, pose.sy, pose.meshEnergy]) {
      assert.ok(Number.isFinite(value), `${animation} returned a non-finite pose value`);
    }
    const deformed = deformCharacterPoint(pose, 0.5, 0.45);
    assert.ok(Number.isFinite(deformed.x) && Number.isFinite(deformed.y));
  }
});

test('continuous mesh keeps the feet planted while drum hands strike', () => {
  const pose = computeCharacterPose({ animation: 'drum', beatPeriod: 1, motion: 1 }, 1, 0);
  const feet = deformCharacterPoint(pose, 0.5, 1);
  const hand = deformCharacterPoint(pose, 0.7, 0.35);
  assert.deepEqual(feet, { x: 0.5, y: 1 });
  assert.ok(hand.y > 0.38, 'drum hand should travel down toward the drum head on attack');
});

test('dance rig lifts the full figure and opens both sleeves without detaching them', () => {
  const pose = computeCharacterPose({ animation: 'dance', beatPeriod: 1, motion: 1 }, 1, 500);
  const leftSleeve = deformCharacterPoint(pose, 0.2, 0.42);
  const rightSleeve = deformCharacterPoint(pose, 0.8, 0.42);
  assert.ok(pose.dy < -0.035, 'dance figure should visibly leave the ground mid-beat');
  assert.ok(leftSleeve.x < 0.2 && rightSleeve.x > 0.8, 'sleeves should open in opposing directions');
  assert.deepEqual(deformCharacterPoint(pose, 0.5, 1), { x: 0.5, y: 1 });
});
