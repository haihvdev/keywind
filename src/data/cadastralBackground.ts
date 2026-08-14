/**
 * Animated cadastral (land-registry) background for the login page.
 *
 * Renders an HTML5 canvas that resembles a land parcel map: a jittered parcel
 * grid, survey-station marks, parcels that light up one after another (like
 * plots being registered), and a slow "surveyor scan" beam sweeping the map.
 *
 * The canvas is transparent, pointer-events: none, and drawn behind the login
 * card. It respects `prefers-reduced-motion` (renders a single static frame)
 * and `prefers-color-scheme` (light / dark palettes).
 */

type RGB = [number, number, number];

interface Palette {
  grid: RGB;
  station: RGB;
  parcelFill: RGB;
  parcelStroke: RGB;
  stake: RGB;
  ring: RGB;
  sweepFill: RGB;
  sweepLine: RGB;
}

interface Geometry {
  width: number;
  height: number;
  cols: number;
  rows: number;
  xs: Float32Array;
  ys: Float32Array;
}

interface Pulse {
  col: number;
  row: number;
  start: number;
}

const PALETTE_LIGHT: Palette = {
  grid: [13, 148, 136], // teal-600
  station: [13, 148, 136],
  parcelFill: [16, 185, 129], // emerald-500
  parcelStroke: [4, 120, 87], // emerald-700
  stake: [4, 120, 87],
  ring: [4, 120, 87],
  sweepFill: [13, 148, 136],
  sweepLine: [13, 148, 136],
};

const PALETTE_DARK: Palette = {
  grid: [94, 234, 212], // teal-300
  station: [94, 234, 212],
  parcelFill: [52, 211, 153], // emerald-400
  parcelStroke: [52, 211, 153],
  stake: [110, 231, 183], // emerald-300
  ring: [52, 211, 153],
  sweepFill: [45, 212, 191], // teal-400
  sweepLine: [45, 212, 191],
};

const CELL_TARGET = 176; // approximate parcel size in CSS pixels
const JITTER_RATIO = 0.3;
const PULSE_LIFETIME = 4600;
const PULSE_SPAWN_BASE = 900;
const PULSE_MAX = 8;
const SWEEP_PERIOD = 17000;
const SWEEP_TRAIL = 280;

function rgba([r, g, b]: RGB, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Deterministic pseudo-random in [0, 1) from two integer coordinates. */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function buildGeometry(width: number, height: number): Geometry {
  const cols = Math.max(3, Math.ceil(width / CELL_TARGET));
  const rows = Math.max(3, Math.ceil(height / CELL_TARGET));
  const cellW = width / cols;
  const cellH = height / rows;
  const xs = new Float32Array((cols + 1) * (rows + 1));
  const ys = new Float32Array((cols + 1) * (rows + 1));

  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const index = row * (cols + 1) + col;
      const jx = (hash(row, col) - 0.5) * 2 * JITTER_RATIO * cellW;
      const jy = (hash(row + 57, col + 91) - 0.5) * 2 * JITTER_RATIO * cellH;
      xs[index] = col * cellW + jx;
      ys[index] = row * cellH + jy;
    }
  }

  return { width, height, cols, rows, xs, ys };
}

export function initCadastralBackground(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#kc-cadastral-background');
  if (!canvas) return;

  const context = canvas.getContext('2d');
  if (!context) return;

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  let palette = darkQuery.matches ? PALETTE_DARK : PALETTE_LIGHT;
  let geometry = buildGeometry(window.innerWidth, window.innerHeight);
  let pulses: Pulse[] = [];
  let nextSpawn = 0;
  let frame = 0;

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    geometry = buildGeometry(width, height);
    pulses = pulses.filter(({ col, row }) => col < geometry.cols && row < geometry.rows);
    if (reducedMotionQuery.matches) {
      drawStatic();
    }
  };

  const vertexX = (row: number, col: number): number => geometry.xs[row * (geometry.cols + 1) + col];
  const vertexY = (row: number, col: number): number => geometry.ys[row * (geometry.cols + 1) + col];

  const traceParcel = (col: number, row: number): void => {
    context.beginPath();
    context.moveTo(vertexX(row, col), vertexY(row, col));
    context.lineTo(vertexX(row, col + 1), vertexY(row, col + 1));
    context.lineTo(vertexX(row + 1, col + 1), vertexY(row + 1, col + 1));
    context.lineTo(vertexX(row + 1, col), vertexY(row + 1, col));
    context.closePath();
  };

  const parcelCentroid = (col: number, row: number): [number, number] => {
    const xs = [vertexX(row, col), vertexX(row, col + 1), vertexX(row + 1, col + 1), vertexX(row + 1, col)];
    const ys = [vertexY(row, col), vertexY(row, col + 1), vertexY(row + 1, col + 1), vertexY(row + 1, col)];
    return [xs.reduce((a, b) => a + b, 0) / 4, ys.reduce((a, b) => a + b, 0) / 4];
  };

  const drawGrid = (): void => {
    context.beginPath();
    for (let row = 0; row <= geometry.rows; row++) {
      for (let col = 0; col <= geometry.cols; col++) {
        if (col < geometry.cols) {
          context.moveTo(vertexX(row, col), vertexY(row, col));
          context.lineTo(vertexX(row, col + 1), vertexY(row, col + 1));
        }
        if (row < geometry.rows) {
          context.moveTo(vertexX(row, col), vertexY(row, col));
          context.lineTo(vertexX(row + 1, col), vertexY(row + 1, col));
        }
      }
    }
    context.strokeStyle = rgba(palette.grid, darkQuery.matches ? 0.1 : 0.13);
    context.lineWidth = 1;
    context.stroke();
  };

  /** Small "+" marks on some vertices, like survey stations on a parcel map. */
  const drawStations = (): void => {
    context.strokeStyle = rgba(palette.station, darkQuery.matches ? 0.22 : 0.3);
    context.lineWidth = 1;
    context.beginPath();
    for (let row = 1; row < geometry.rows; row++) {
      for (let col = 1; col < geometry.cols; col++) {
        if (hash(row * 3 + 11, col * 7 + 5) < 0.12) {
          const x = vertexX(row, col);
          const y = vertexY(row, col);
          context.moveTo(x - 4, y);
          context.lineTo(x + 4, y);
          context.moveTo(x, y - 4);
          context.lineTo(x, y + 4);
        }
      }
    }
    context.stroke();
  };

  const pulseAlpha = (pulse: Pulse, now: number): number => {
    const progress = (now - pulse.start) / PULSE_LIFETIME;
    if (progress < 0 || progress > 1) return 0;
    return smoothstep(progress / 0.22) * smoothstep((1 - progress) / 0.3);
  };

  const spawnPulses = (now: number): void => {
    if (now < nextSpawn || pulses.length >= PULSE_MAX) return;
    nextSpawn = now + PULSE_SPAWN_BASE + hash(pulses.length, Math.floor(now / 1000)) * 700;

    for (let attempt = 0; attempt < 12; attempt++) {
      const col = Math.floor(hash(attempt, Math.floor(now / 37)) * geometry.cols);
      const row = Math.floor(hash(Math.floor(now / 53), attempt) * geometry.rows);
      if (pulses.some((p) => p.col === col && p.row === row)) continue;
      pulses.push({ col, row, start: now });
      return;
    }
  };

  const drawPulses = (now: number): void => {
    pulses = pulses.filter((pulse) => pulseAlpha(pulse, now) > 0);

    for (const pulse of pulses) {
      const alpha = pulseAlpha(pulse, now);
      if (alpha <= 0) continue;

      traceParcel(pulse.col, pulse.row);
      context.fillStyle = rgba(palette.parcelFill, alpha * (darkQuery.matches ? 0.12 : 0.1));
      context.fill();

      context.strokeStyle = rgba(palette.parcelStroke, alpha * (darkQuery.matches ? 0.5 : 0.55));
      context.lineWidth = 1.5;
      context.stroke();

      // Corner stakes
      context.fillStyle = rgba(palette.stake, alpha * 0.75);
      for (const [dc, dr] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as const) {
        context.beginPath();
        context.arc(vertexX(pulse.row + dr, pulse.col + dc), vertexY(pulse.row + dr, pulse.col + dc), 2.5, 0, Math.PI * 2);
        context.fill();
      }

      // Expanding ring at the centroid, like a marker being dropped
      const progress = (now - pulse.start) / PULSE_LIFETIME;
      if (progress < 0.4) {
        const [cx, cy] = parcelCentroid(pulse.col, pulse.row);
        const ringProgress = progress / 0.4;
        context.beginPath();
        context.arc(cx, cy, 4 + ringProgress * 22, 0, Math.PI * 2);
        context.strokeStyle = rgba(palette.ring, (1 - ringProgress) * alpha * 0.5);
        context.lineWidth = 1.5;
        context.stroke();
      }
    }
  };

  /** A vertical beam that sweeps across the map like a surveyor's scan. */
  const drawSweep = (now: number): void => {
    const margin = SWEEP_TRAIL;
    const span = geometry.width + margin * 2;
    const x = ((now % SWEEP_PERIOD) / SWEEP_PERIOD) * span - margin;

    const gradient = context.createLinearGradient(x - SWEEP_TRAIL, 0, x, 0);
    gradient.addColorStop(0, rgba(palette.sweepFill, 0));
    gradient.addColorStop(1, rgba(palette.sweepFill, darkQuery.matches ? 0.07 : 0.09));
    context.fillStyle = gradient;
    context.fillRect(x - SWEEP_TRAIL, 0, SWEEP_TRAIL, geometry.height);

    context.strokeStyle = rgba(palette.sweepLine, darkQuery.matches ? 0.22 : 0.3);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, geometry.height);
    context.stroke();
  };

  const drawFrame = (now: number): void => {
    context.clearRect(0, 0, geometry.width, geometry.height);
    drawGrid();
    drawStations();
    spawnPulses(now);
    drawPulses(now);
    drawSweep(now);
  };

  /** Single still frame for users who prefer reduced motion. */
  const drawStatic = (): void => {
    context.clearRect(0, 0, geometry.width, geometry.height);
    drawGrid();
    drawStations();
    for (const [col, row] of [
      [0.25, 0.3],
      [0.72, 0.62],
      [0.5, 0.85],
    ] as const) {
      const c = Math.floor(col * geometry.cols);
      const r = Math.floor(row * geometry.rows);
      traceParcel(c, r);
      context.fillStyle = rgba(palette.parcelFill, 0.1);
      context.fill();
      context.strokeStyle = rgba(palette.parcelStroke, 0.5);
      context.lineWidth = 1.5;
      context.stroke();
    }
  };

  const tick = (now: number): void => {
    drawFrame(now);
    frame = requestAnimationFrame(tick);
  };

  const start = (): void => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    if (reducedMotionQuery.matches) {
      drawStatic();
      return;
    }
    // A few staggered pulses so the map feels alive on first paint.
    pulses = [0, 1, 2].map((offset) => ({
      col: Math.floor(hash(offset, 7) * geometry.cols),
      row: Math.floor(hash(13, offset) * geometry.rows),
      start: performance.now() - offset * 1200,
    }));
    nextSpawn = performance.now() + PULSE_SPAWN_BASE;
    frame = requestAnimationFrame(tick);
  };

  const onSchemeChange = (): void => {
    palette = darkQuery.matches ? PALETTE_DARK : PALETTE_LIGHT;
    if (reducedMotionQuery.matches) drawStatic();
  };

  darkQuery.addEventListener('change', onSchemeChange);
  reducedMotionQuery.addEventListener('change', start);
  window.addEventListener('resize', resize);

  resize();
  start();
}
