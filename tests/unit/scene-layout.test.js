import test from 'node:test';
import assert from 'node:assert/strict';
import { getArchitecturalStructure, getVisualStructureSummary } from '../../src/scene/scene-layout.js';

test('landscape architecture is a dense portrait-stone wall with central stage and bilateral ornament bands', () => {
  const structure = getArchitecturalStructure('landscape');
  const summary = getVisualStructureSummary('landscape');
  assert.equal(structure.panels.length, 63);
  assert.ok(summary.panelCount >= 55);
  assert.equal(summary.centralStagePresent, true);
  assert.ok(summary.centralStagePanelCount >= 5);
  assert.equal(summary.leftBorderPresent, true);
  assert.equal(summary.rightBorderPresent, true);
  assert.equal(summary.sideBorderCount, 2);
  assert.ok(summary.horizontalBeamCount >= 8);
  assert.ok(structure.panels.filter((panel) => panel.role === 'central-stage').length >= 5);
});

test('portrait architecture remains independently adapted rather than squeezing the landscape wall', () => {
  const structure = getArchitecturalStructure('portrait');
  assert.equal(structure.orientation, 'portrait');
  assert.equal(structure.panels.length, 21);
  assert.equal(structure.sideBorders.length, 2);
  assert.ok(structure.centralStage.h > 0.5);
});
