import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonMask, extractPersonDetections } from '../../src/input/person-detector.js';

test('semantic detector accepts only person and rejects background object classes', () => {
  const detections = [
    { categories: [{ categoryName: 'person', score: 0.91 }], boundingBox: { originX: 10, originY: 5, width: 20, height: 30 } },
    { categories: [{ categoryName: 'tv', score: 0.99 }], boundingBox: { originX: 35, originY: 4, width: 22, height: 25 } },
    { categories: [{ categoryName: 'person', score: 0.41 }], boundingBox: { originX: 2, originY: 2, width: 10, height: 10 } },
  ];
  const people = extractPersonDetections(detections, 80, 45, 0.52);
  assert.equal(people.length, 1);
  assert.equal(people[0].label, 'person');
  assert.equal(people[0].score, 0.91);
});

test('person mask is local to the semantic person box', () => {
  const mask = buildPersonMask(80, 45, [{ x: 10, y: 5, w: 20, h: 30, score: 0.9, label: 'person' }]);
  const active = [...mask].filter(Boolean).length;
  assert.ok(active > 250 && active < 600);
  assert.equal(mask[20 * 80 + 20], 255);
  assert.equal(mask[20 * 80 + 60], 0, 'unrelated background must not enter the trigger mask');
});

test('person boxes are clipped without expanding detections at frame edges', () => {
  const [person] = extractPersonDetections([
    { categories: [{ categoryName: 'person', score: 0.88 }], boundingBox: { originX: -10, originY: -5, width: 24, height: 18 } },
  ], 80, 45, 0.5);
  assert.deepEqual(
    { x: person.x, y: person.y, w: person.w, h: person.h },
    { x: 0, y: 0, w: 14, h: 13 },
  );
});
