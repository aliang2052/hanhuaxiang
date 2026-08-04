import { clamp, smoothstep } from '../core/math.js';

export const MOTION_ACTIONS = Object.freeze([
  'pluck', 'harp', 'flute', 'reed', 'panpipe', 'horn', 'bow',
  'strike', 'drum', 'gong', 'clapper', 'cymbal',
  'dance', 'acrobat', 'procession', 'banquet', 'serve', 'sway',
]);

const TAU = Math.PI * 2;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function bell(value, center, radius) {
  const distance = (value - center) / Math.max(0.001, radius);
  return Math.exp(-distance * distance * 0.5);
}

function control(name, u, v, dx, dy, radiusX = 0.24, radiusY = 0.22) {
  return { name, u, v, dx, dy, radiusX, radiusY };
}

export function performanceCue(node, now) {
  const period = Math.max(0.25, finite(node.beatPeriod, 1));
  const seconds = Math.max(0, finite(now) * 0.001 + finite(node.beatOffset));
  const phase = (seconds % period) / period;
  const isDance = node.animation === 'dance' || node.animation === 'acrobat';
  const attack = Math.exp(-phase * (isDance ? 8 : 15));
  const release = Math.exp(-phase * 3.1);
  return { phase, attack, release, period, beat: Math.floor(seconds / period) };
}

/**
 * Produces a compact 2D performance rig. Root values move the complete figure;
 * controls deform nearby mesh vertices while keeping the feet planted.
 */
export function computeCharacterPose(node, activation, now) {
  const action = MOTION_ACTIONS.includes(node.animation) ? node.animation : 'sway';
  const cue = performanceCue(node, now);
  const strength = clamp(finite(activation)) * clamp(finite(node.motion, 1), 0, 1.65);
  const t = finite(now) * 0.001 + finite(node.phase);
  const cycle = Math.sin(cue.phase * TAU);
  const counterCycle = Math.cos(cue.phase * TAU);
  const breath = Math.sin(t * 1.45);
  const alternate = cue.beat % 2 === 0 ? 1 : -1;
  const windup = bell(cue.phase, 0.78, 0.13);
  const jump = Math.max(0, Math.sin(cue.phase * Math.PI));
  const pose = {
    action,
    cue,
    dx: 0,
    dy: 0,
    rotation: 0,
    sx: 1,
    sy: 1,
    controls: [],
    meshEnergy: 0,
  };

  const add = (name, u, v, dx, dy, radiusX, radiusY) => {
    const point = control(name, u, v, dx * strength, dy * strength, radiusX, radiusY);
    pose.controls.push(point);
    pose.meshEnergy = Math.max(pose.meshEnergy, Math.abs(point.dx) + Math.abs(point.dy));
  };

  switch (action) {
    case 'pluck':
      pose.dy = breath * 0.0025 * strength;
      pose.rotation = breath * 0.0035 * strength;
      add('torso', 0.5, 0.43, -cycle * 0.004, breath * 0.004, 0.32, 0.3);
      add('fretting-hand', 0.38, 0.48, -cycle * 0.006, cue.attack * 0.009, 0.2, 0.18);
      add('plucking-hand', 0.66, 0.52, cycle * 0.012 + alternate * cue.attack * 0.012, cue.attack * 0.027, 0.22, 0.2);
      break;
    case 'harp':
      pose.rotation = breath * 0.004 * strength;
      add('torso', 0.5, 0.42, breath * 0.004, breath * 0.003, 0.34, 0.3);
      add('high-hand', 0.61, 0.39, cycle * 0.015, -counterCycle * 0.008, 0.21, 0.2);
      add('low-hand', 0.55, 0.57, -cycle * 0.012, cue.attack * 0.019, 0.22, 0.2);
      break;
    case 'flute':
    case 'reed':
    case 'panpipe':
    case 'horn': {
      const breadth = action === 'horn' ? 1.25 : action === 'flute' ? 1 : 0.72;
      pose.rotation = breath * 0.006 * breadth * strength;
      pose.sy = 1 + breath * 0.004 * strength;
      add('chest', 0.5, 0.38, breath * 0.002, -breath * 0.005 * breadth, 0.34, 0.28);
      add('head', 0.5, 0.19, breath * 0.004 * breadth, -breath * 0.003, 0.24, 0.2);
      add('left-hand', 0.38, 0.39, cycle * 0.004, cue.attack * 0.004, 0.19, 0.17);
      add('right-hand', 0.66, 0.4, -cycle * 0.006, cue.attack * 0.006, 0.2, 0.17);
      break;
    }
    case 'bow':
      pose.rotation = -cycle * 0.004 * strength;
      add('torso', 0.5, 0.42, -cycle * 0.007, breath * 0.003, 0.34, 0.29);
      add('neck-hand', 0.4, 0.42, cycle * 0.004, -cycle * 0.003, 0.19, 0.18);
      add('bow-hand', 0.69, 0.48, cycle * 0.048, counterCycle * 0.006, 0.25, 0.2);
      break;
    case 'strike':
    case 'drum':
    case 'gong': {
      const force = action === 'drum' ? 1.12 : action === 'gong' ? 1.05 : 0.88;
      pose.dy = cue.attack * 0.004 * strength;
      pose.rotation = alternate * cue.attack * 0.006 * strength;
      add('torso', 0.5, 0.43, alternate * cue.attack * 0.008, cue.attack * 0.01, 0.34, 0.3);
      add('striking-hand', alternate > 0 ? 0.7 : 0.3, 0.35,
        -alternate * cue.attack * 0.026 * force,
        (cue.attack * 0.062 - windup * 0.048) * force,
        0.25, 0.24);
      add('support-hand', alternate > 0 ? 0.32 : 0.68, 0.4,
        alternate * cue.attack * 0.009,
        cue.attack * 0.018 - windup * 0.02,
        0.22, 0.2);
      break;
    }
    case 'clapper':
    case 'cymbal': {
      const close = cue.attack * (action === 'cymbal' ? 0.052 : 0.038);
      pose.sy = 1 - cue.attack * 0.008 * strength;
      add('left-hand', 0.3, 0.4, close, cue.attack * 0.012, 0.25, 0.22);
      add('right-hand', 0.7, 0.4, -close, cue.attack * 0.012, 0.25, 0.22);
      add('chest', 0.5, 0.42, 0, cue.attack * 0.008, 0.3, 0.25);
      break;
    }
    case 'dance': {
      const sleeveWave = Math.sin(cue.phase * TAU + Math.PI * 0.25);
      pose.dx = cycle * 0.013 * strength;
      pose.dy = (-jump * 0.044 + cue.attack * 0.009) * strength;
      pose.rotation = (cycle * 0.018 + alternate * cue.attack * 0.009) * strength;
      pose.sx = 1 + jump * 0.012 * strength;
      pose.sy = 1 + jump * 0.025 * strength - cue.attack * 0.035 * strength;
      add('left-sleeve', 0.2, 0.42, -0.032 - sleeveWave * 0.022, -jump * 0.025 + cycle * 0.012, 0.3, 0.25);
      add('right-sleeve', 0.8, 0.42, 0.032 + sleeveWave * 0.022, -jump * 0.025 - cycle * 0.012, 0.3, 0.25);
      add('torso', 0.5, 0.43, cycle * 0.012, -jump * 0.012, 0.35, 0.3);
      add('left-skirt', 0.34, 0.72, -cycle * 0.017, jump * 0.008, 0.3, 0.25);
      add('right-skirt', 0.66, 0.72, cycle * 0.017, jump * 0.008, 0.3, 0.25);
      break;
    }
    case 'acrobat':
      pose.dx = cycle * 0.018 * strength;
      pose.dy = (-jump * 0.072 + cue.attack * 0.01) * strength;
      pose.rotation = (cycle * 0.04 + alternate * jump * 0.018) * strength;
      pose.sx = 1 + jump * 0.018 * strength;
      pose.sy = 1 + jump * 0.035 * strength - cue.attack * 0.04 * strength;
      add('left-arm', 0.25, 0.39, -0.035 - cycle * 0.02, -jump * 0.035, 0.3, 0.26);
      add('right-arm', 0.75, 0.39, 0.035 + cycle * 0.02, -jump * 0.035, 0.3, 0.26);
      add('hips', 0.5, 0.66, -cycle * 0.014, jump * 0.008, 0.33, 0.26);
      break;
    case 'procession': {
      const step = Math.abs(cycle);
      pose.dx = cycle * 0.009 * strength;
      pose.dy = -step * 0.009 * strength;
      pose.rotation = cycle * 0.008 * strength;
      add('carried-object', 0.58, 0.4, -cycle * 0.012, -step * 0.008, 0.3, 0.23);
      add('hips', 0.5, 0.67, cycle * 0.008, step * 0.005, 0.32, 0.25);
      break;
    }
    case 'serve':
      pose.dy = breath * 0.003 * strength;
      pose.rotation = breath * 0.004 * strength;
      add('tray', 0.61, 0.43, -breath * 0.006, -Math.abs(breath) * 0.004, 0.28, 0.2);
      add('torso', 0.5, 0.43, breath * 0.004, 0, 0.33, 0.28);
      break;
    case 'banquet':
      pose.sy = 1 + breath * 0.003 * strength;
      add('gesture-hand', 0.66, 0.46, cycle * 0.012, -counterCycle * 0.008, 0.24, 0.2);
      add('head', 0.5, 0.2, breath * 0.004, breath * 0.002, 0.24, 0.2);
      break;
    default:
      pose.dx = breath * 0.005 * strength;
      pose.rotation = breath * 0.006 * strength;
      add('torso', 0.5, 0.44, breath * 0.007, 0, 0.36, 0.3);
      break;
  }

  return pose;
}

/** Continuous radial deformation around the action controls. */
export function deformCharacterPoint(pose, u, v, amount = 1) {
  let x = finite(u);
  let y = finite(v);
  const rigAmount = clamp(finite(amount, 1), 0, 1);
  const groundLock = 1 - smoothstep(0.76, 0.985, y);
  for (const point of pose.controls || []) {
    const nx = (x - point.u) / point.radiusX;
    const ny = (y - point.v) / point.radiusY;
    const weight = Math.exp(-(nx * nx + ny * ny) * 1.35) * groundLock * rigAmount;
    x += point.dx * weight;
    y += point.dy * weight;
  }
  return { x, y };
}
