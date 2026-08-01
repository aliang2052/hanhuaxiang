function panel(x, y, w, h, role = 'bay', id = -1) {
  return { id, x, y, w, h, role };
}

function weightedRow(count, y, h, weights, x0, x1, gap, role, startId) {
  const usable = x1 - x0 - gap * (count - 1);
  const total = weights.reduce((sum, value) => sum + value, 0);
  let x = x0;
  const panels = [];
  for (let index = 0; index < count; index += 1) {
    const w = usable * weights[index] / total;
    panels.push(panel(x, y, w, h, role, startId + index));
    x += w + gap;
  }
  return panels;
}

function segmentedRow(leftCount, rightCount, y, h, leftWeights, rightWeights, role, startId, centralCount = 1) {
  const left = weightedRow(leftCount, y, h, leftWeights, 0.052, 0.394, 0.0045, role, startId);
  const central = weightedRow(
    centralCount,
    y - 0.005,
    h + 0.01,
    Array.from({ length: centralCount }, () => 1),
    0.406,
    0.594,
    0.004,
    'central-stage',
    startId + leftCount,
  );
  const right = weightedRow(
    rightCount,
    y,
    h,
    rightWeights,
    0.606,
    0.948,
    0.0045,
    role,
    startId + leftCount + centralCount,
  );
  return [...left, ...central, ...right];
}

function landscapePanels() {
  const panels = [];
  panels.push(...weightedRow(
    12,
    0.145,
    0.108,
    [1.0, 0.78, 1.08, 0.88, 1.12, 0.82, 0.92, 1.16, 0.84, 1.08, 0.78, 1.02],
    0.052,
    0.948,
    0.0042,
    'upper-gallery',
    panels.length,
  ));
  panels.push(...segmentedRow(
    6,
    6,
    0.275,
    0.138,
    [1.0, 0.82, 1.12, 0.92, 1.08, 0.86],
    [0.86, 1.08, 0.92, 1.12, 0.82, 1.0],
    'upper-hall',
    panels.length,
    1,
  ));
  panels.push(...segmentedRow(
    5,
    5,
    0.437,
    0.145,
    [1.0, 0.86, 1.18, 0.86, 1.1],
    [1.1, 0.86, 1.18, 0.86, 1.0],
    'middle-hall',
    panels.length,
    1,
  ));
  panels.push(...segmentedRow(
    6,
    6,
    0.608,
    0.128,
    [0.86, 1.12, 0.92, 1.04, 0.82, 1.08],
    [1.08, 0.82, 1.04, 0.92, 1.12, 0.86],
    'lower-hall',
    panels.length,
    1,
  ));
  panels.push(...segmentedRow(
    6,
    6,
    0.758,
    0.145,
    [1.0, 0.84, 1.12, 0.9, 1.06, 0.88],
    [0.88, 1.06, 0.9, 1.12, 0.84, 1.0],
    'lower-gallery',
    panels.length,
    2,
  ));
  return panels;
}

function portraitPanels() {
  const panels = [];
  const heights = [0.105, 0.105, 0.115, 0.145, 0.115, 0.105, 0.105];
  let y = 0.095;
  for (let row = 0; row < heights.length; row += 1) {
    const h = heights[row];
    const weights = row === 3 ? [0.9, 1.4, 0.9] : (row % 2 ? [1.12, 0.88, 1.12] : [1, 1, 1]);
    panels.push(...weightedRow(3, y, h, weights, 0.045, 0.955, 0.014, row === 3 ? 'central' : 'portrait-bay', panels.length));
    y += h + 0.012;
  }
  return panels;
}

const LANDSCAPE_BEAMS = [0.108, 0.132, 0.258, 0.424, 0.594, 0.744, 0.912, 0.934];
const LANDSCAPE_CENTRAL_IDS = [18, 30, 42, 55, 56];

/**
 * Dense architectural wall model. The visual panels are independent from the
 * legacy 9×7 normalized trigger partition, although both contain 63 entries.
 * Camera input resolves pixels against these real panel rectangles.
 */
export function getArchitecturalStructure(orientation) {
  if (orientation === 'portrait') {
    const panels = portraitPanels();
    return {
      version: 3,
      orientation,
      panels,
      beams: [0.073, 0.238, 0.447, 0.648, 0.916],
      sideBorders: [
        { x: 0.012, y: 0.052, w: 0.024, h: 0.91, side: 'left' },
        { x: 0.964, y: 0.052, w: 0.024, h: 0.91, side: 'right' },
      ],
      centralStage: { x: 0.335, y: 0.235, w: 0.33, h: 0.67, levels: 4, panelIds: [10] },
      horizontalBeamCount: 5,
    };
  }
  const panels = landscapePanels();
  return {
    version: 3,
    orientation,
    panels,
    beams: LANDSCAPE_BEAMS.map((y, index) => ({ y, weight: index === 0 || index >= 6 ? 'heavy' : 'normal' })),
    sideBorders: [
      { x: 0.012, y: 0.055, w: 0.032, h: 0.89, side: 'left' },
      { x: 0.956, y: 0.055, w: 0.032, h: 0.89, side: 'right' },
    ],
    centralStage: {
      x: 0.401,
      y: 0.122,
      w: 0.198,
      h: 0.792,
      levels: 5,
      panelIds: [...LANDSCAPE_CENTRAL_IDS],
      bellRackY: 0.29,
      drumY: 0.51,
      danceY: 0.68,
      stairY: 0.82,
    },
    horizontalBeamCount: LANDSCAPE_BEAMS.length,
  };
}

export function getArchitecturalPanels(orientation) {
  return getArchitecturalStructure(orientation).panels;
}

export function getVisualStructureSummary(orientation = 'landscape') {
  const structure = getArchitecturalStructure(orientation);
  return {
    version: structure.version,
    orientation,
    panelCount: structure.panels.length,
    centralStagePresent: Boolean(structure.centralStage && structure.centralStage.levels >= 4),
    centralStagePanelCount: structure.centralStage?.panelIds?.length || 0,
    leftBorderPresent: structure.sideBorders.some((border) => border.side === 'left'),
    rightBorderPresent: structure.sideBorders.some((border) => border.side === 'right'),
    sideBorderCount: structure.sideBorders.length,
    horizontalBeamCount: structure.horizontalBeamCount,
  };
}

export function getSceneMetrics(width, height, orientation = width / Math.max(1, height) < 0.82 ? 'portrait' : 'landscape') {
  const structure = getArchitecturalStructure(orientation);
  return {
    width,
    height,
    orientation,
    minDimension: Math.min(width, height),
    panels: structure.panels,
    structure,
    structureSummary: getVisualStructureSummary(orientation),
    safeRect: orientation === 'portrait'
      ? { x: width * 0.035, y: height * 0.052, w: width * 0.93, h: height * 0.91 }
      : { x: width * 0.012, y: height * 0.055, w: width * 0.976, h: height * 0.89 },
  };
}

export function getNodeRect(node, metrics) {
  const layout = node[metrics.orientation] ?? node.landscape;
  return {
    x: layout.x * metrics.width,
    y: layout.y * metrics.height,
    w: layout.w * metrics.width,
    h: layout.h * metrics.height,
  };
}

/** Return the topmost visual node under a normalized stage point. */
export function hitTestVisualNode(nodes, orientation, u, v) {
  if (!Array.isArray(nodes) || !Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
    return -1;
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const layout = node?.[orientation] ?? node?.landscape;
    if (!layout) continue;
    if (u >= layout.x && u <= layout.x + layout.w && v >= layout.y && v <= layout.y + layout.h) {
      return Number.isInteger(node.id) ? node.id : -1;
    }
  }
  return -1;
}

/** Return the architectural bay under a normalized landscape point. */
export function hitTestArchitecturalPanel(panels, u, v) {
  if (!Array.isArray(panels) || !Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
    return -1;
  }
  for (let index = panels.length - 1; index >= 0; index -= 1) {
    const item = panels[index];
    if (u >= item.x && u <= item.x + item.w && v >= item.y && v <= item.y + item.h) {
      return Number.isInteger(item.id) ? item.id : -1;
    }
  }
  return -1;
}
