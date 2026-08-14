/**
 * Animated cadastral (land-registry) background for the login page.
 *
 * Renders an HTML5 canvas that resembles a land parcel map: a Voronoi
 * mosaic of roughly 4-7-sided convex parcels, survey-station marks, and
 * parcels that light up one after another
 * (like plots being registered). Entity badges — database, person,
 * organization, government, location, document, ledger, signature,
 * certificate — drift across the map: they wander on
 * their own and are gently attracted to the cursor, which also casts a soft
 * spotlight on the grid. Nearby entities are linked like a network.
 *
 * The canvas is transparent, pointer-events: none, and drawn behind the login
 * card. It respects `prefers-reduced-motion` (renders a single static frame)
 * and `prefers-color-scheme` (light / dark palettes). The grid pattern is
 * re-randomized on every page load.
 */

type RGB = [number, number, number];

interface Palette {
  grid: RGB;
  station: RGB;
  parcelFill: RGB;
  parcelStroke: RGB;
  stake: RGB;
  ring: RGB;
  entity: RGB;
  link: RGB;
  spotlight: RGB;
}

interface Parcel {
  /** Convex polygon vertices as [x0, y0, x1, y1, ...] in CSS pixels. */
  vertices: number[];
  cx: number;
  cy: number;
}

interface Geometry {
  width: number;
  height: number;
  parcels: Parcel[];
}

interface Pulse {
  parcel: number;
  start: number;
}

const ENTITY_KINDS = [
  'database',
  'person',
  'organization',
  'government',
  'location',
  'document',
  'ledger',
  'signature',
  'certificate',
] as const;
type EntityKind = (typeof ENTITY_KINDS)[number];

interface Entity {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Current wander heading, radians. */
  wander: number;
  kind: EntityKind;
  /** Icon half-size in CSS pixels. */
  size: number;
}

interface MouseState {
  x: number;
  y: number;
  /** Smoothed position, follows the real pointer with a lag. */
  sx: number;
  sy: number;
  /** 0..1; how strongly the cursor influences the scene. */
  strength: number;
  lastMove: number;
}

interface HoverCell {
  parcel: number;
  start: number;
}

const PALETTE_LIGHT: Palette = {
  grid: [13, 148, 136], // teal-600
  station: [13, 148, 136],
  parcelFill: [16, 185, 129], // emerald-500
  parcelStroke: [4, 120, 87], // emerald-700
  stake: [4, 120, 87],
  ring: [4, 120, 87],
  entity: [29, 78, 216], // blue-700
  link: [37, 99, 235], // blue-600
  spotlight: [13, 148, 136],
};

const PALETTE_DARK: Palette = {
  grid: [94, 234, 212], // teal-300
  station: [94, 234, 212],
  parcelFill: [52, 211, 153], // emerald-400
  parcelStroke: [52, 211, 153],
  stake: [110, 231, 183], // emerald-300
  ring: [52, 211, 153],
  entity: [147, 197, 253], // blue-300
  link: [96, 165, 250], // blue-400
  spotlight: [45, 212, 191], // teal-400
};

const CELL_TARGET = 176; // approximate parcel size in CSS pixels
const SEED_JITTER = 0.42; // seed displacement as a fraction of cell size
const RELAX_STEPS = 1; // Lloyd relaxation passes to even out parcel sizes
const PULSE_LIFETIME = 4600;
const PULSE_SPAWN_BASE = 900;
const PULSE_MAX = 8;

const ENTITY_COUNT = 14;
const ENTITY_SPEED = 26; // px/s
const WANDER_FORCE = 18;
const WANDER_TURN = 2.4; // rad/s of heading jitter
const MOUSE_PULL = 60; // px/s^2 toward the cursor
const MOUSE_ARRIVE = 130; // entities ease off inside this radius
const SEPARATION_DIST = 95;
const SEPARATION_FORCE = 34;
const LINK_DIST = 250;
const BOUND_MARGIN = 70;
const BOUND_FORCE = 45;
const SPOTLIGHT_RADIUS = 280;
const MOUSE_IDLE_MS = 1800;
const HOVER_ENTER_MS = 250;
const HOVER_RING_MS = 500;

/** Fixed entities for the reduced-motion still frame. */
const STATIC_ENTITIES: ReadonlyArray<readonly [number, number, EntityKind]> = [
  [0.18, 0.3, 'database'],
  [0.42, 0.68, 'person'],
  [0.64, 0.24, 'organization'],
  [0.82, 0.56, 'government'],
  [0.3, 0.46, 'location'],
  [0.12, 0.72, 'document'],
  [0.55, 0.85, 'ledger'],
  [0.88, 0.2, 'signature'],
  [0.7, 0.75, 'certificate'],
];

function rgba([r, g, b]: RGB, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Seed for the grid jitter; re-randomized on each page load. */
let gridSeed = Math.random() * 1e6;

/** Deterministic pseudo-random in [0, 1) from two integer coordinates. */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/** Grid-dependent hash: same input coordinates, different pattern per seed. */
function seededHash(x: number, y: number): number {
  return hash(x + gridSeed * 13.37, y + gridSeed * 7.77);
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Clip a convex polygon (x,y pairs) to the half-plane closer to p than to q. */
function clipByBisector(poly: number[], px: number, py: number, qx: number, qy: number): number[] {
  const mx = (px + qx) / 2;
  const my = (py + qy) / 2;
  const dx = qx - px;
  const dy = qy - py;
  const out: number[] = [];
  const count = poly.length / 2;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ax = poly[i * 2];
    const ay = poly[i * 2 + 1];
    const bx = poly[j * 2];
    const by = poly[j * 2 + 1];
    const sa = (ax - mx) * dx + (ay - my) * dy;
    const sb = (bx - mx) * dx + (by - my) * dy;
    if (sa <= 0) out.push(ax, ay);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return out;
}

/** Voronoi cell of seeds[idx] (flat x,y pairs) clipped to the viewport. */
function voronoiCell(seeds: number[], idx: number, width: number, height: number): number[] {
  let poly = [0, 0, width, 0, width, height, 0, height];
  const px = seeds[idx * 2];
  const py = seeds[idx * 2 + 1];
  for (let k = 0; k < seeds.length / 2; k++) {
    if (k === idx) continue;
    poly = clipByBisector(poly, px, py, seeds[k * 2], seeds[k * 2 + 1]);
    if (poly.length < 6) break;
  }
  return poly;
}

function polygonCentroid(poly: number[]): [number, number] {
  let sx = 0;
  let sy = 0;
  const count = poly.length / 2;
  for (let i = 0; i < count; i++) {
    sx += poly[i * 2];
    sy += poly[i * 2 + 1];
  }
  return [sx / count, sy / count];
}

/**
 * Cadastral tessellation: Voronoi cells of a jittered point lattice. Cells
 * come out as convex polygons with roughly 4-7 sides — like real land
 * parcels — instead of a uniform quad grid.
 */
function buildGeometry(width: number, height: number): Geometry {
  const cols = Math.max(3, Math.ceil(width / CELL_TARGET));
  const rows = Math.max(3, Math.ceil(height / CELL_TARGET));
  const cellW = width / cols;
  const cellH = height / rows;

  // Seeds span one extra ring outside the viewport so border cells clip well.
  let seeds: number[] = [];
  for (let row = 0; row < rows + 2; row++) {
    for (let col = 0; col < cols + 2; col++) {
      const jx = (seededHash(row, col) - 0.5) * 2 * SEED_JITTER * cellW;
      const jy = (seededHash(row + 57, col + 91) - 0.5) * 2 * SEED_JITTER * cellH;
      seeds.push((col - 1) * cellW + cellW / 2 + jx, (row - 1) * cellH + cellH / 2 + jy);
    }
  }

  // Lloyd relaxation: move each seed to its cell centroid so parcels stay
  // even-sized and slivers are rare.
  for (let step = 0; step < RELAX_STEPS; step++) {
    const relaxed: number[] = new Array(seeds.length);
    for (let i = 0; i < seeds.length / 2; i++) {
      const cell = voronoiCell(seeds, i, width, height);
      const [cx, cy] = polygonCentroid(cell.length >= 6 ? cell : [seeds[i * 2], seeds[i * 2 + 1]]);
      relaxed[i * 2] = cx;
      relaxed[i * 2 + 1] = cy;
    }
    seeds = relaxed;
  }

  const parcels: Parcel[] = [];
  for (let i = 0; i < seeds.length / 2; i++) {
    const vertices = voronoiCell(seeds, i, width, height);
    if (vertices.length < 6) continue; // degenerate, fully clipped away
    const [cx, cy] = polygonCentroid(vertices);
    parcels.push({ vertices, cx, cy });
  }

  return { width, height, parcels };
}

function spawnEntities(geometry: Geometry): Entity[] {
  const entities: Entity[] = [];
  for (let i = 0; i < ENTITY_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    entities.push({
      x: BOUND_MARGIN + Math.random() * (geometry.width - BOUND_MARGIN * 2),
      y: BOUND_MARGIN + Math.random() * (geometry.height - BOUND_MARGIN * 2),
      vx: Math.cos(angle) * ENTITY_SPEED * 0.5,
      vy: Math.sin(angle) * ENTITY_SPEED * 0.5,
      wander: angle,
      kind: ENTITY_KINDS[i % ENTITY_KINDS.length],
      size: 10 + Math.random() * 3,
    });
  }
  return entities;
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
  let entities: Entity[] = [];
  let hover: HoverCell | null = null;
  let nextSpawn = 0;
  let frame = 0;
  let lastNow = 0;
  const mouse: MouseState = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    sx: window.innerWidth / 2,
    sy: window.innerHeight / 2,
    strength: 0,
    lastMove: -Infinity,
  };

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    geometry = buildGeometry(width, height);
    pulses = pulses.filter(({ parcel }) => parcel < geometry.parcels.length);
    for (const entity of entities) {
      entity.x = Math.min(Math.max(entity.x, BOUND_MARGIN), geometry.width - BOUND_MARGIN);
      entity.y = Math.min(Math.max(entity.y, BOUND_MARGIN), geometry.height - BOUND_MARGIN);
    }
    if (reducedMotionQuery.matches) {
      drawStatic();
    }
  };

  const traceParcel = (index: number): void => {
    const { vertices } = geometry.parcels[index];
    context.beginPath();
    context.moveTo(vertices[0], vertices[1]);
    for (let i = 2; i < vertices.length; i += 2) {
      context.lineTo(vertices[i], vertices[i + 1]);
    }
    context.closePath();
  };

  /** Point-in-polygon test for a convex parcel (all same-sign cross products). */
  const pointInParcel = (index: number, x: number, y: number): boolean => {
    const { vertices } = geometry.parcels[index];
    const count = vertices.length / 2;
    let sign = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const ax = vertices[i * 2];
      const ay = vertices[i * 2 + 1];
      const bx = vertices[j * 2];
      const by = vertices[j * 2 + 1];
      const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (cross === 0) continue;
      const crossSign = Math.sign(cross);
      if (sign === 0) sign = crossSign;
      else if (crossSign !== sign) return false;
    }
    return true;
  };

  const parcelAt = (x: number, y: number): number => {
    for (let i = 0; i < geometry.parcels.length; i++) {
      if (pointInParcel(i, x, y)) return i;
    }
    return -1;
  };

  const drawGrid = (): void => {
    context.beginPath();
    for (const parcel of geometry.parcels) {
      const { vertices } = parcel;
      context.moveTo(vertices[0], vertices[1]);
      for (let i = 2; i < vertices.length; i += 2) {
        context.lineTo(vertices[i], vertices[i + 1]);
      }
      context.closePath();
    }
    context.strokeStyle = rgba(palette.grid, darkQuery.matches ? 0.1 : 0.13);
    context.lineWidth = 1;
    context.stroke();
  };

  /** Small "+" marks on some parcel vertices, like survey stations on a map. */
  const drawStations = (): void => {
    context.strokeStyle = rgba(palette.station, darkQuery.matches ? 0.22 : 0.3);
    context.lineWidth = 1;
    context.beginPath();
    const seen = new Set<number>();
    for (const parcel of geometry.parcels) {
      for (let i = 0; i < parcel.vertices.length; i += 2) {
        const x = Math.round(parcel.vertices[i]);
        const y = Math.round(parcel.vertices[i + 1]);
        const key = x * 100000 + y;
        if (seen.has(key)) continue;
        seen.add(key);
        if (seededHash(x, y) < 0.12) {
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
      const parcel = Math.floor(hash(attempt, Math.floor(now / 37)) * geometry.parcels.length);
      if (pulses.some((p) => p.parcel === parcel)) continue;
      pulses.push({ parcel, start: now });
      return;
    }
  };

  const drawPulses = (now: number): void => {
    pulses = pulses.filter((pulse) => pulseAlpha(pulse, now) > 0);

    for (const pulse of pulses) {
      const alpha = pulseAlpha(pulse, now);
      if (alpha <= 0) continue;

      traceParcel(pulse.parcel);
      context.fillStyle = rgba(palette.parcelFill, alpha * (darkQuery.matches ? 0.12 : 0.1));
      context.fill();

      context.strokeStyle = rgba(palette.parcelStroke, alpha * (darkQuery.matches ? 0.5 : 0.55));
      context.lineWidth = 1.5;
      context.stroke();

      // Corner stakes at every parcel vertex
      const { vertices } = geometry.parcels[pulse.parcel];
      context.fillStyle = rgba(palette.stake, alpha * 0.75);
      for (let i = 0; i < vertices.length; i += 2) {
        context.beginPath();
        context.arc(vertices[i], vertices[i + 1], 2.5, 0, Math.PI * 2);
        context.fill();
      }

      // Expanding ring at the centroid, like a marker being dropped
      const progress = (now - pulse.start) / PULSE_LIFETIME;
      if (progress < 0.4) {
        const { cx, cy } = geometry.parcels[pulse.parcel];
        const ringProgress = progress / 0.4;
        context.beginPath();
        context.arc(cx, cy, 4 + ringProgress * 22, 0, Math.PI * 2);
        context.strokeStyle = rgba(palette.ring, (1 - ringProgress) * alpha * 0.5);
        context.lineWidth = 1.5;
        context.stroke();
      }
    }
  };

  /** Soft radial highlight that follows the cursor across the grid. */
  const drawSpotlight = (): void => {
    if (mouse.strength <= 0.01) return;
    const gradient = context.createRadialGradient(mouse.sx, mouse.sy, 0, mouse.sx, mouse.sy, SPOTLIGHT_RADIUS);
    gradient.addColorStop(0, rgba(palette.spotlight, mouse.strength * (darkQuery.matches ? 0.09 : 0.1)));
    gradient.addColorStop(1, rgba(palette.spotlight, 0));
    context.fillStyle = gradient;
    context.fillRect(mouse.sx - SPOTLIGHT_RADIUS, mouse.sy - SPOTLIGHT_RADIUS, SPOTLIGHT_RADIUS * 2, SPOTLIGHT_RADIUS * 2);
  };

  const updateMouse = (now: number, dt: number): void => {
    const target = now - mouse.lastMove < MOUSE_IDLE_MS ? 1 : 0;
    mouse.strength += (target - mouse.strength) * Math.min(1, dt * 4);
    const follow = Math.min(1, dt * 8);
    mouse.sx += (mouse.x - mouse.sx) * follow;
    mouse.sy += (mouse.y - mouse.sy) * follow;
  };

  /** Track which parcel the pointer is over; resets the enter animation on change. */
  const updateHover = (now: number): void => {
    if (mouse.strength <= 0.01) {
      hover = null;
      return;
    }
    const parcel = parcelAt(mouse.x, mouse.y);
    if (parcel < 0) {
      hover = null;
      return;
    }
    if (!hover || hover.parcel !== parcel) {
      hover = { parcel, start: now };
    }
  };

  /**
   * The parcel under the cursor lights up like a plot at the moment of
   * registration: fill, boundary, corner stakes, and an expanding ring.
   */
  const drawHover = (now: number): void => {
    if (!hover) return;
    if (hover.parcel >= geometry.parcels.length) {
      hover = null;
      return;
    }
    const alpha = smoothstep((now - hover.start) / HOVER_ENTER_MS) * mouse.strength;
    if (alpha <= 0) return;

    traceParcel(hover.parcel);
    context.fillStyle = rgba(palette.parcelFill, alpha * (darkQuery.matches ? 0.16 : 0.14));
    context.fill();
    context.strokeStyle = rgba(palette.parcelStroke, alpha * (darkQuery.matches ? 0.6 : 0.7));
    context.lineWidth = 1.5;
    context.stroke();

    const { vertices } = geometry.parcels[hover.parcel];
    context.fillStyle = rgba(palette.stake, alpha * 0.8);
    for (let i = 0; i < vertices.length; i += 2) {
      context.beginPath();
      context.arc(vertices[i], vertices[i + 1], 2.5, 0, Math.PI * 2);
      context.fill();
    }

    const ringProgress = Math.min((now - hover.start) / HOVER_RING_MS, 1);
    if (ringProgress < 1) {
      const { cx, cy } = geometry.parcels[hover.parcel];
      context.beginPath();
      context.arc(cx, cy, 4 + ringProgress * 22, 0, Math.PI * 2);
      context.strokeStyle = rgba(palette.ring, (1 - ringProgress) * alpha * 0.5);
      context.lineWidth = 1.5;
      context.stroke();
    }
  };

  const updateEntities = (dt: number): void => {
    for (const entity of entities) {
      const wanderScale = 1 - 0.6 * mouse.strength;
      entity.wander += (Math.random() - 0.5) * WANDER_TURN * dt;

      let ax = Math.cos(entity.wander) * WANDER_FORCE * wanderScale;
      let ay = Math.sin(entity.wander) * WANDER_FORCE * wanderScale;

      // Attraction toward the cursor, easing off near it ("arrive" behavior)
      if (mouse.strength > 0.01) {
        const dx = mouse.sx - entity.x;
        const dy = mouse.sy - entity.y;
        const dist = Math.hypot(dx, dy) || 1;
        const pull = MOUSE_PULL * mouse.strength * smoothstep(Math.min(dist / MOUSE_ARRIVE, 1));
        ax += (dx / dist) * pull;
        ay += (dy / dist) * pull;
      }

      // Steer back toward the visible area
      if (entity.x < BOUND_MARGIN) ax += BOUND_FORCE * (1 - entity.x / BOUND_MARGIN);
      if (entity.x > geometry.width - BOUND_MARGIN) ax -= BOUND_FORCE * (1 - (geometry.width - entity.x) / BOUND_MARGIN);
      if (entity.y < BOUND_MARGIN) ay += BOUND_FORCE * (1 - entity.y / BOUND_MARGIN);
      if (entity.y > geometry.height - BOUND_MARGIN) ay -= BOUND_FORCE * (1 - (geometry.height - entity.y) / BOUND_MARGIN);

      entity.vx += ax * dt;
      entity.vy += ay * dt;
    }

    // Mild repulsion so entities do not stack on top of each other
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i];
        const b = entities[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= SEPARATION_DIST || dist === 0) continue;
        const push = SEPARATION_FORCE * (1 - dist / SEPARATION_DIST) * dt;
        a.vx -= (dx / dist) * push;
        a.vy -= (dy / dist) * push;
        b.vx += (dx / dist) * push;
        b.vy += (dy / dist) * push;
      }
    }

    for (const entity of entities) {
      const speed = Math.hypot(entity.vx, entity.vy);
      if (speed > ENTITY_SPEED) {
        entity.vx *= ENTITY_SPEED / speed;
        entity.vy *= ENTITY_SPEED / speed;
      }
      entity.x += entity.vx * dt;
      entity.y += entity.vy * dt;
    }
  };

  const drawEntityIcon = (kind: EntityKind, cx: number, cy: number, s: number): void => {
    const iconAlpha = darkQuery.matches ? 0.9 : 0.8;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 1.5;

    // Badge disc so the icon stays legible over the grid
    context.beginPath();
    context.arc(cx, cy, s * 1.45, 0, Math.PI * 2);
    context.fillStyle = rgba(palette.entity, darkQuery.matches ? 0.08 : 0.07);
    context.fill();
    context.strokeStyle = rgba(palette.entity, darkQuery.matches ? 0.35 : 0.3);
    context.lineWidth = 1;
    context.stroke();

    context.strokeStyle = rgba(palette.entity, iconAlpha);
    context.fillStyle = rgba(palette.entity, iconAlpha);
    context.lineWidth = 1.5;

    switch (kind) {
      case 'database': {
        const rx = s * 0.5;
        const ry = s * 0.2;
        const top = cy - s * 0.55;
        const bottom = cy + s * 0.55;
        context.beginPath();
        context.ellipse(cx, top, rx, ry, 0, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.moveTo(cx - rx, top);
        context.lineTo(cx - rx, bottom);
        context.moveTo(cx + rx, top);
        context.lineTo(cx + rx, bottom);
        context.stroke();
        context.beginPath();
        context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
        context.stroke();
        context.beginPath();
        context.ellipse(cx, bottom, rx, ry, 0, 0, Math.PI);
        context.stroke();
        break;
      }
      case 'person': {
        context.beginPath();
        context.arc(cx, cy - s * 0.34, s * 0.26, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.arc(cx, cy + s * 0.82, s * 0.58, Math.PI * 1.18, Math.PI * 1.82);
        context.stroke();
        break;
      }
      case 'organization': {
        const w = s * 0.52;
        context.strokeRect(cx - w, cy - s * 0.62, w * 2, s * 1.24);
        for (const [ox, oy] of [
          [-0.24, -0.32],
          [0.24, -0.32],
          [-0.24, 0.08],
          [0.24, 0.08],
        ] as const) {
          context.fillRect(cx + ox * s - s * 0.09, cy + oy * s - s * 0.09, s * 0.18, s * 0.18);
        }
        break;
      }
      case 'government': {
        const baseY = cy + s * 0.6;
        const lintelY = cy - s * 0.26;
        context.beginPath();
        context.moveTo(cx - s * 0.72, lintelY);
        context.lineTo(cx + s * 0.72, lintelY);
        context.moveTo(cx - s * 0.72, baseY);
        context.lineTo(cx + s * 0.72, baseY);
        context.moveTo(cx - s * 0.6, lintelY);
        context.lineTo(cx, cy - s * 0.72);
        context.lineTo(cx + s * 0.6, lintelY);
        context.stroke();
        context.beginPath();
        for (const ox of [-0.42, -0.14, 0.14, 0.42]) {
          context.moveTo(cx + ox * s, lintelY);
          context.lineTo(cx + ox * s, baseY);
        }
        context.stroke();
        break;
      }
      case 'location': {
        context.beginPath();
        context.arc(cx, cy - s * 0.3, s * 0.34, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.moveTo(cx, cy + s * 0.72);
        context.lineTo(cx - s * 0.24, cy - s * 0.02);
        context.lineTo(cx + s * 0.24, cy - s * 0.02);
        context.closePath();
        context.fill();
        context.beginPath();
        context.arc(cx, cy - s * 0.3, s * 0.11, 0, Math.PI * 2);
        context.fill();
        break;
      }
      case 'document': {
        // Page with a folded top-right corner and text lines
        context.beginPath();
        context.moveTo(cx - s * 0.42, cy - s * 0.62);
        context.lineTo(cx + s * 0.18, cy - s * 0.62);
        context.lineTo(cx + s * 0.5, cy - s * 0.3);
        context.lineTo(cx + s * 0.5, cy + s * 0.65);
        context.lineTo(cx - s * 0.42, cy + s * 0.65);
        context.closePath();
        context.stroke();
        context.beginPath();
        context.moveTo(cx + s * 0.18, cy - s * 0.62);
        context.lineTo(cx + s * 0.18, cy - s * 0.3);
        context.lineTo(cx + s * 0.5, cy - s * 0.3);
        for (const oy of [-0.02, 0.22, 0.46] as const) {
          context.moveTo(cx - s * 0.24, cy + oy * s);
          context.lineTo(cx + s * 0.3, cy + oy * s);
        }
        context.stroke();
        break;
      }
      case 'ledger': {
        // Bound register: cover, spine, ruled rows
        context.strokeRect(cx - s * 0.5, cy - s * 0.6, s, s * 1.2);
        context.beginPath();
        context.moveTo(cx - s * 0.28, cy - s * 0.6);
        context.lineTo(cx - s * 0.28, cy + s * 0.6);
        for (const oy of [-0.15, 0.2] as const) {
          context.moveTo(cx - s * 0.14, cy + oy * s);
          context.lineTo(cx + s * 0.36, cy + oy * s);
        }
        context.stroke();
        break;
      }
      case 'signature': {
        // Handwritten squiggle over a signing line
        context.beginPath();
        context.moveTo(cx - s * 0.55, cy + s * 0.3);
        context.bezierCurveTo(cx - s * 0.3, cy - s * 0.15, cx - s * 0.15, cy + s * 0.5, cx + s * 0.05, cy + s * 0.05);
        context.bezierCurveTo(cx + s * 0.2, cy - s * 0.25, cx + s * 0.4, cy + s * 0.2, cx + s * 0.55, cy - s * 0.1);
        context.stroke();
        context.beginPath();
        context.moveTo(cx - s * 0.5, cy + s * 0.6);
        context.lineTo(cx + s * 0.5, cy + s * 0.6);
        context.stroke();
        break;
      }
      case 'certificate': {
        // Landscape diploma with a seal and ribbons at the bottom right
        context.strokeRect(cx - s * 0.65, cy - s * 0.5, s * 1.3, s * 0.95);
        context.beginPath();
        context.moveTo(cx - s * 0.4, cy - s * 0.24);
        context.lineTo(cx + s * 0.05, cy - s * 0.24);
        context.moveTo(cx - s * 0.4, cy - s * 0.02);
        context.lineTo(cx - s * 0.08, cy - s * 0.02);
        context.stroke();
        // Ribbon tails
        context.beginPath();
        context.moveTo(cx + s * 0.24, cy + s * 0.14);
        context.lineTo(cx + s * 0.16, cy + s * 0.62);
        context.moveTo(cx + s * 0.38, cy + s * 0.14);
        context.lineTo(cx + s * 0.44, cy + s * 0.62);
        context.stroke();
        // Seal
        context.beginPath();
        context.arc(cx + s * 0.31, cy + s * 0.05, s * 0.22, 0, Math.PI * 2);
        context.stroke();
        break;
      }
    }
  };

  const drawEntityLinks = (): void => {
    const baseAlpha = darkQuery.matches ? 0.4 : 0.42;
    context.lineWidth = 1;
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i];
        const b = entities[j];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist >= LINK_DIST) continue;
        context.strokeStyle = rgba(palette.link, (1 - dist / LINK_DIST) * baseAlpha);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
    }

    // Brighter tether from the cursor to nearby entities
    if (mouse.strength > 0.02) {
      const reach = LINK_DIST * 1.1;
      for (const entity of entities) {
        const dist = Math.hypot(mouse.sx - entity.x, mouse.sy - entity.y);
        if (dist >= reach) continue;
        context.strokeStyle = rgba(palette.link, (1 - dist / reach) * 0.55 * mouse.strength);
        context.beginPath();
        context.moveTo(mouse.sx, mouse.sy);
        context.lineTo(entity.x, entity.y);
        context.stroke();
      }
    }
  };

  const drawEntities = (): void => {
    drawEntityLinks();
    for (const entity of entities) {
      drawEntityIcon(entity.kind, entity.x, entity.y, entity.size);
    }
  };

  const drawFrame = (now: number): void => {
    const dt = lastNow === 0 ? 0 : Math.min((now - lastNow) / 1000, 0.05);
    lastNow = now;

    context.clearRect(0, 0, geometry.width, geometry.height);
    updateMouse(now, dt);
    drawGrid();
    drawStations();
    drawSpotlight();
    updateHover(now);
    drawHover(now);
    spawnPulses(now);
    drawPulses(now);
    updateEntities(dt);
    drawEntities();
  };

  /** Single still frame for users who prefer reduced motion. */
  const drawStatic = (): void => {
    context.clearRect(0, 0, geometry.width, geometry.height);
    drawGrid();
    drawStations();
    for (const [fx, fy] of [
      [0.25, 0.3],
      [0.72, 0.62],
      [0.5, 0.85],
    ] as const) {
      const parcel = parcelAt(fx * geometry.width, fy * geometry.height);
      if (parcel < 0) continue;
      traceParcel(parcel);
      context.fillStyle = rgba(palette.parcelFill, 0.1);
      context.fill();
      context.strokeStyle = rgba(palette.parcelStroke, 0.5);
      context.lineWidth = 1.5;
      context.stroke();
    }

    const placed = STATIC_ENTITIES.map(([fx, fy, kind]) => ({
      x: fx * geometry.width,
      y: fy * geometry.height,
      kind,
      size: 11,
    }));
    context.lineWidth = 1;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const dist = Math.hypot(placed[j].x - placed[i].x, placed[j].y - placed[i].y);
        if (dist >= LINK_DIST) continue;
        context.strokeStyle = rgba(palette.link, (1 - dist / LINK_DIST) * (darkQuery.matches ? 0.4 : 0.42));
        context.beginPath();
        context.moveTo(placed[i].x, placed[i].y);
        context.lineTo(placed[j].x, placed[j].y);
        context.stroke();
      }
    }
    for (const entity of placed) {
      drawEntityIcon(entity.kind, entity.x, entity.y, entity.size);
    }
  };

  const tick = (now: number): void => {
    drawFrame(now);
    frame = requestAnimationFrame(tick);
  };

  const start = (): void => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    lastNow = 0;
    if (reducedMotionQuery.matches) {
      drawStatic();
      return;
    }
    // No pulses at load; the spawner brings the map to life after a pause.
    pulses = [];
    nextSpawn = performance.now() + PULSE_SPAWN_BASE;
    frame = requestAnimationFrame(tick);
  };

  const onMouseMove = (event: MouseEvent): void => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.lastMove = performance.now();
  };

  const onMouseLeave = (): void => {
    mouse.lastMove = -Infinity;
  };

  const onSchemeChange = (): void => {
    palette = darkQuery.matches ? PALETTE_DARK : PALETTE_LIGHT;
    if (reducedMotionQuery.matches) drawStatic();
  };

  darkQuery.addEventListener('change', onSchemeChange);
  reducedMotionQuery.addEventListener('change', start);
  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', onMouseMove);
  document.documentElement.addEventListener('mouseleave', onMouseLeave);

  resize();
  entities = spawnEntities(geometry);
  start();
}
