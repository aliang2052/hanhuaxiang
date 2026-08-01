import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getArchitecturalStructure,
  getVisualStructureSummary,
  hitTestArchitecturalPanel,
  hitTestVisualNode,
} from '../../src/scene/scene-layout.js';

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

test('visual pointer hit testing selects only the topmost real panel and ignores gaps', () => {
  const nodes = [
    { id: 3, landscape: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } },
    { id: 7, landscape: { x: 0.25, y: 0.25, w: 0.3, h: 0.3 } },
  ];
  assert.equal(hitTestVisualNode(nodes, 'landscape', 0.18, 0.18), 3);
  assert.equal(hitTestVisualNode(nodes, 'landscape', 0.3, 0.3), 7);
  assert.equal(hitTestVisualNode(nodes, 'landscape', 0.8, 0.8), -1);
});

test('architectural panel hit testing maps the whole visible bay to its own node id', () => {
  const panels = getArchitecturalStructure('landscape').panels;
  for (const item of panels) {
    assert.equal(hitTestArchitecturalPanel(panels, item.x + item.w / 2, item.y + item.h / 2), item.id);
  }
  assert.equal(hitTestArchitecturalPanel(panels, 0.5, 0.02), -1);
});
