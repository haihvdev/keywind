/**
 * Animated cadastral (land-registry) background for the login page.
 *
 * Port từ Vbdlis-Tools tools-worker public/vbdlis/js/cadastral-background.js
 * (Giai đoạn 2, 2026-08-15) — nền cũ (Voronoi parcels) được thay bằng:
 *   1) Lưới kinh-vĩ tuyến toàn thế giới (orthographic, tâm Việt Nam).
 *   2) Bản đồ 99 phường/xã tỉnh Bắc Ninh (mesh strokes, hover sáng tên xã).
 * Các đối tượng khác (entities, links, spotlight, hover ring, pulses,
 * reduced-motion, resize) giữ nguyên hành vi và thông số.
 *
 * Khác biệt so với bản tools-worker:
 *   - Dark-mode dùng `prefers-color-scheme` media query (login theme không
 *     kiểm soát theme bằng class).
 *   - Selector canvas là #kc-cadastral-background.
 *   - Pan bằng kéo chuột (xoay tâm orthographic); double-click reset.
 *   - GeoJSON VNLIS: tọa độ WGS84 (EPSG:4326), lon/lat độ — mesh xã chiếu
 *     orthographic cùng R/tâm với lưới kinh-vĩ để độ cong khớp khi pan.
 *
 * The canvas is transparent, pointer-events: none, and drawn behind the
 * login card. It respects `prefers-reduced-motion` (renders a single
 * static frame).
 */

import { BACNINH_GEO } from './bacninhGeo';

type RGB = [number, number, number];

interface Palette {
  grid: RGB;
  parcelFill: RGB;
  parcelStroke: RGB;
  stake: RGB;
  ring: RGB;
  entity: RGB;
  link: RGB;
  spotlight: RGB;
}

interface Geometry {
  width: number;
  height: number;
  parcels: number[][];
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
  wander: number;
  kind: EntityKind;
  size: number;
}

interface MouseState {
  x: number;
  y: number;
  sx: number;
  sy: number;
  strength: number;
  lastMove: number;
}

interface HoverCell {
  parcel: number;
  start: number;
}

const PALETTE_LIGHT: Palette = {
  grid: [13, 148, 136], // teal-600
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
  parcelFill: [52, 211, 153], // emerald-400
  parcelStroke: [52, 211, 153],
  stake: [110, 231, 183], // emerald-300
  ring: [52, 211, 153],
  entity: [147, 197, 253], // blue-300
  link: [96, 165, 250], // blue-400
  spotlight: [45, 212, 191], // teal-400
};

// --- Lưới kinh-vĩ tuyến ---
/** Bước lưới mặc định (toàn cầu); khi zoom bbox Bắc Ninh dùng graticuleStepDeg(). */
const GRATICULE_STEP_MAX = 15;
const GRATICULE_NICE_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15] as const;
const GRATICULE_TARGET_LINES = 10;
/** Biên độ vẽ lưới (độ) — theo kích thước màn, không chỉ bbox tỉnh (tránh cụt trên màn lớn). */
function graticuleDrawHalfSpan(
  width: number,
  height: number,
  R: number,
  lat0: number
): { lonHalf: number; latHalf: number } {
  const degPerPxLat = (180 / Math.PI) / R;
  const cosPhi0 = Math.cos((lat0 * Math.PI) / 180);
  const degPerPxLon = (180 / Math.PI) / (R * Math.max(0.15, cosPhi0));
  const margin = 1.15;
  return {
    latHalf: Math.min(88, (height / 2) * degPerPxLat * margin),
    lonHalf: Math.min(90, (width / 2) * degPerPxLon * margin),
  };
}

/** Bước lưới theo span bbox (~1.15°) — 15° không có đường nào trong viewport. */
function graticuleStepDeg(): number {
  const span = Math.max(
    BACNINH_GEO.bbox[2] - BACNINH_GEO.bbox[0],
    BACNINH_GEO.bbox[3] - BACNINH_GEO.bbox[1]
  );
  const raw = span / GRATICULE_TARGET_LINES;
  for (const step of GRATICULE_NICE_STEPS) {
    if (step >= raw) return step;
  }
  return GRATICULE_STEP_MAX;
}

// --- Pulse ---
const PULSE_LIFETIME = 4600;
const PULSE_SPAWN_BASE = 900;
const PULSE_MAX = 8;

// --- Entity / interaction ---
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

/** Deterministic pseudo-random in [0, 1) from two integer coordinates. */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function rgba([r, g, b]: RGB, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ================================================================
// Lưới kinh-vĩ tuyến (orthographic, tâm Việt Nam)
// ================================================================

/** Tâm bản đồ Bắc Ninh (bbox GeoJSON) — căn giữa viewport khi load / reset. */
const BACNINH_CENTER_LON = (BACNINH_GEO.bbox[0] + BACNINH_GEO.bbox[2]) / 2;
const BACNINH_CENTER_LAT = (BACNINH_GEO.bbox[1] + BACNINH_GEO.bbox[3]) / 2;

/** Bán kính orthographic (px) fit bbox tỉnh — mesh xã và lưới kinh-vĩ dùng cùng R. */
function orthoRadius(width: number, height: number): number {
  const [minLon, minLat, maxLon, maxLat] = BACNINH_GEO.bbox;
  const cosMid = Math.cos((BACNINH_CENTER_LAT * Math.PI) / 180);
  const spanLonRad = ((maxLon - minLon) * cosMid * Math.PI) / 180;
  const spanLatRad = ((maxLat - minLat) * Math.PI) / 180;
  let r = (0.85 * width) / spanLonRad;
  if (r * spanLatRad > 0.8 * height) {
    r = (0.8 * height) / spanLatRad;
  }
  return r;
}

/** Chuẩn hóa kinh độ về [-180, 180]. */
function normalizeLon(lonDeg: number): number {
  return ((lonDeg + 540) % 360) - 180;
}

/**
 * Orthographic projection: geographic (lon, lat in degrees) to screen (x, y).
 * Returns null if the point is on the far side of the globe (not visible).
 */
function orthoProject(
  lonDeg: number,
  latDeg: number,
  cx: number,
  cy: number,
  R: number,
  lon0Deg: number,
  lat0Deg: number
): [number, number] | null {
  const lambda = (lonDeg * Math.PI) / 180;
  const phi = (latDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const lon0Rad = (lon0Deg * Math.PI) / 180;
  const lat0Rad = (lat0Deg * Math.PI) / 180;
  const sinPhi0 = Math.sin(lat0Rad);
  const cosPhi0 = Math.cos(lat0Rad);
  const dl = lambda - lon0Rad;
  const cosDl = Math.cos(dl);
  // Visibility check: dot product with view direction
  const vis = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDl;
  if (vis < 0) return null;
  const x = cx + R * cosPhi * Math.sin(dl);
  const y = cy - R * (cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosDl);
  return [x, y];
}

// ================================================================
// Bản đồ Bắc Ninh (orthographic WGS84 — cùng hệ với lưới kinh-vĩ)
// ================================================================

interface BacNinhProjection {
  parcels: number[][];
  cx: number;
  cy: number;
}

/**
 * Chiếu orthographic 99 polygon phường/xã — cùng cx/cy/R và tâm (lon0, lat0)
 * với drawGraticule để ranh giới xã cong khớp lưới khi pan.
 */
function projectBacNinh(
  width: number,
  height: number,
  lon0: number,
  lat0: number
): BacNinhProjection | null {
  const rings = BACNINH_GEO.communes;
  if (!rings.length) return null;

  const cx = width / 2;
  const cy = height / 2;
  const R = orthoRadius(width, height);

  const parcels: number[][] = [];
  for (const ring of rings) {
    const flat: number[] = [];
    for (const [lon, lat] of ring) {
      const pt = orthoProject(lon, lat, cx, cy, R, lon0, lat0);
      if (!pt) continue;
      flat.push(pt[0], pt[1]);
    }
    if (flat.length >= 6) parcels.push(flat);
  }
  return { parcels, cx, cy };
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
  const isDark = (): boolean => darkQuery.matches;

  let palette = isDark() ? PALETTE_DARK : PALETTE_LIGHT;
  let geometry: Geometry = {
    width: window.innerWidth,
    height: window.innerHeight,
    parcels: [],
  };

  let dpr = Math.min(window.devicePixelRatio || 1, 2);

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

  let graticuleLon = BACNINH_CENTER_LON;
  let graticuleLat = BACNINH_CENTER_LAT;
  let dragging = false;
  let activePointerId: number | null = null;
  let lastPx = 0;
  let lastPy = 0;
  let lastTouch: { x: number; y: number } | null = null;

  // ================================================================
  // Resize
  // ================================================================

  const graticuleRadius = (): number => orthoRadius(geometry.width, geometry.height);

  const reproject = (): void => {
    const bacninh = projectBacNinh(geometry.width, geometry.height, graticuleLon, graticuleLat);
    geometry.parcels = bacninh ? bacninh.parcels : [];
    pulses = pulses.filter((p) => p.parcel < geometry.parcels.length);
  };

  /** Kéo bản đồ: pixel dưới con trỏ bám theo tỷ lệ tại tâm chiếu. */
  const applyPanDelta = (dx: number, dy: number): void => {
    if (dx === 0 && dy === 0) return;
    const R = graticuleRadius();
    const latRad = (graticuleLat * Math.PI) / 180;
    const cosPhi0 = Math.cos(latRad);
    const degLonPerPx = (180 / Math.PI) / (R * Math.max(0.15, cosPhi0));
    const degLatPerPx = (180 / Math.PI) / R;
    graticuleLon = normalizeLon(graticuleLon - dx * degLonPerPx);
    graticuleLat = Math.max(-85, Math.min(85, graticuleLat - dy * degLatPerPx));
    reproject();
    if (reducedMotionQuery.matches) drawStatic();
  };

  const resetPan = (): void => {
    graticuleLon = BACNINH_CENTER_LON;
    graticuleLat = BACNINH_CENTER_LAT;
    hover = null;
    reproject();
    if (reducedMotionQuery.matches) drawStatic();
  };

  const isInteractiveTarget = (event: Event): boolean => {
    const target = event.target as Element | null;
    return !!target?.closest?.('a, button, input, label, select, textarea, form, nav');
  };

  const resize = (): void => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    geometry.width = width;
    geometry.height = height;
    reproject();
    for (const entity of entities) {
      entity.x = Math.min(Math.max(entity.x, BOUND_MARGIN), geometry.width - BOUND_MARGIN);
      entity.y = Math.min(Math.max(entity.y, BOUND_MARGIN), geometry.height - BOUND_MARGIN);
    }
    if (reducedMotionQuery.matches) {
      drawStatic();
    }
  };

  // ================================================================
  // Trace polygon — flat vertex array [x1,y1,x2,y2,...]
  // ================================================================

  const traceParcel = (index: number): void => {
    const vertices = geometry.parcels[index];
    context.beginPath();
    context.moveTo(vertices[0], vertices[1]);
    for (let i = 2; i < vertices.length; i += 2) {
      context.lineTo(vertices[i], vertices[i + 1]);
    }
    context.closePath();
  };

  /** Point-in-polygon test (ray casting — works for any simple polygon). */
  const pointInParcel = (index: number, x: number, y: number): boolean => {
    const vertices = geometry.parcels[index];
    const count = vertices.length / 2;
    let inside = false;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      const xi = vertices[i * 2];
      const yi = vertices[i * 2 + 1];
      const xj = vertices[j * 2];
      const yj = vertices[j * 2 + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  const parcelAt = (x: number, y: number): number => {
    for (let i = 0; i < geometry.parcels.length; i++) {
      if (pointInParcel(i, x, y)) return i;
    }
    return -1;
  };

  // ================================================================
  // Graticule — lưới kinh-vĩ tuyến orthographic tâm Việt Nam
  // ================================================================

  const drawGraticule = (): void => {
    const cx = geometry.width / 2;
    const cy = geometry.height / 2;
    const R = graticuleRadius();
    const step = graticuleStepDeg();
    const { lonHalf, latHalf } = graticuleDrawHalfSpan(
      geometry.width,
      geometry.height,
      R,
      graticuleLat
    );
    // Vĩ tuyến: span theo màn (bbox zoom)
    const parallelLatMin = Math.max(-88, graticuleLat - latHalf);
    const parallelLatMax = Math.min(88, graticuleLat + latHalf);
    const kpMin = Math.floor(parallelLatMin / step);
    const kpMax = Math.ceil(parallelLatMax / step);
    const lonMin = graticuleLon - lonHalf;
    const lonMax = graticuleLon + lonHalf;
    // Kinh tuyến: lưới kinh độ tuyệt đối (không neo graticuleLon + k*step)
    const meridianLonStart = Math.floor(lonMin / step) * step;
    const meridianLonEnd = lonMax;
    // Kinh tuyến: quét bán cầu nhìn thấy — span bbox (~0.5°) làm đường dọc cụt
    const meridianLatMin = Math.max(-89, graticuleLat - 90);
    const meridianLatMax = Math.min(89, graticuleLat + 90);
    const phiStep = step <= 0.25 ? 0.25 : step <= 0.5 ? 0.5 : 1;
    const lambdaStep = step <= 0.25 ? 0.25 : step <= 0.5 ? 0.5 : 1;

    // Đĩa cầu rất nhẹ
    context.fillStyle = rgba(palette.grid, 0.03);
    context.beginPath();
    context.arc(cx, cy, R, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = rgba(palette.grid, isDark() ? 0.1 : 0.12);
    context.lineWidth = 1;
    context.stroke();

    // Kinh tuyến — λ cố định WGS84, dịch trên màn khi pan (cùng logic vĩ tuyến)
    context.lineWidth = 0.75;
    context.strokeStyle = rgba(palette.grid, isDark() ? 0.14 : 0.17);
    for (let lon = meridianLonStart; lon <= meridianLonEnd; lon += step) {
      const meridianLon = normalizeLon(lon);
      context.beginPath();
      let started = false;
      for (let phi = meridianLatMin; phi <= meridianLatMax; phi += phiStep) {
        const pt = orthoProject(meridianLon, phi, cx, cy, R, graticuleLon, graticuleLat);
        if (pt) {
          if (!started) {
            context.moveTo(pt[0], pt[1]);
            started = true;
          } else context.lineTo(pt[0], pt[1]);
        } else {
          started = false;
        }
      }
      context.stroke();
    }

    // Vĩ tuyến — ngang theo span kinh độ đủ phủ mép màn
    for (let kp = kpMin; kp <= kpMax; kp++) {
      const lat = kp * step;
      if (lat < -88 || lat > 88) continue;
      context.beginPath();
      let started = false;
      for (let lambda = lonMin; lambda <= lonMax; lambda += lambdaStep) {
        const pt = orthoProject(lambda, lat, cx, cy, R, graticuleLon, graticuleLat);
        if (pt) {
          if (!started) {
            context.moveTo(pt[0], pt[1]);
            started = true;
          } else context.lineTo(pt[0], pt[1]);
        } else {
          started = false;
        }
      }
      context.stroke();
    }
  };

  // ================================================================
  // Mesh xã — stroke từng polygon phường/xã
  // ================================================================

  const drawCommuneMesh = (): void => {
    if (!geometry.parcels.length) return;
    // Ranh giới xã đậm hơn lưới cầu 1 chút để không bị lưới làm mờ ở viền màn
    context.strokeStyle = rgba(palette.grid, isDark() ? 0.18 : 0.22);
    context.lineWidth = 1.2;
    for (let i = 0; i < geometry.parcels.length; i++) {
      traceParcel(i);
      context.stroke();
    }
  };

  // ================================================================
  // Pulse — parcel = polygon xã
  // ================================================================

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
      context.fillStyle = rgba(palette.parcelFill, alpha * (isDark() ? 0.12 : 0.1));
      context.fill();
      context.strokeStyle = rgba(palette.parcelStroke, alpha * (isDark() ? 0.5 : 0.55));
      context.lineWidth = 1.5;
      context.stroke();

      // Corner stakes ở mọi đỉnh polygon
      const vertices = geometry.parcels[pulse.parcel];
      context.fillStyle = rgba(palette.stake, alpha * 0.75);
      for (let i = 0; i < vertices.length; i += 2) {
        context.beginPath();
        context.arc(vertices[i], vertices[i + 1], 2.5, 0, Math.PI * 2);
        context.fill();
      }

      // Ring mở rộng tại tâm chuột
      const progress = (now - pulse.start) / PULSE_LIFETIME;
      if (progress < 0.4) {
        const ringProgress = progress / 0.4;
        context.beginPath();
        context.arc(mouse.sx, mouse.sy, 4 + ringProgress * 22, 0, Math.PI * 2);
        context.strokeStyle = rgba(palette.ring, (1 - ringProgress) * alpha * 0.5);
        context.lineWidth = 1.5;
        context.stroke();
      }
    }
  };

  // ================================================================
  // Spotlight, mouse, hover
  // ================================================================

  const drawSpotlight = (): void => {
    if (mouse.strength <= 0.01) return;
    const gradient = context.createRadialGradient(
      mouse.sx,
      mouse.sy,
      0,
      mouse.sx,
      mouse.sy,
      SPOTLIGHT_RADIUS
    );
    gradient.addColorStop(0, rgba(palette.spotlight, mouse.strength * (isDark() ? 0.09 : 0.1)));
    gradient.addColorStop(1, rgba(palette.spotlight, 0));
    context.fillStyle = gradient;
    context.fillRect(
      mouse.sx - SPOTLIGHT_RADIUS,
      mouse.sy - SPOTLIGHT_RADIUS,
      SPOTLIGHT_RADIUS * 2,
      SPOTLIGHT_RADIUS * 2
    );
  };

  const updateMouse = (now: number, dt: number): void => {
    const target = now - mouse.lastMove < MOUSE_IDLE_MS ? 1 : 0;
    mouse.strength += (target - mouse.strength) * Math.min(1, dt * 4);
    const follow = Math.min(1, dt * 8);
    mouse.sx += (mouse.x - mouse.sx) * follow;
    mouse.sy += (mouse.y - mouse.sy) * follow;
  };

  /** Track which commune the pointer is over; resets the enter animation on change. */
  const updateHover = (now: number): void => {
    if (dragging) {
      hover = null;
      mouse.strength = 0;
      return;
    }
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
   * The commune under the cursor lights up: fill, boundary, corner stakes,
   * an expanding ring at the cursor position, and its name.
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
    context.fillStyle = rgba(palette.parcelFill, alpha * (isDark() ? 0.16 : 0.14));
    context.fill();
    context.strokeStyle = rgba(palette.parcelStroke, alpha * (isDark() ? 0.6 : 0.7));
    context.lineWidth = 1.5;
    context.stroke();

    const vertices = geometry.parcels[hover.parcel];
    context.fillStyle = rgba(palette.stake, alpha * 0.8);
    for (let i = 0; i < vertices.length; i += 2) {
      context.beginPath();
      context.arc(vertices[i], vertices[i + 1], 2.5, 0, Math.PI * 2);
      context.fill();
    }

    const ringProgress = Math.min((now - hover.start) / HOVER_RING_MS, 1);
    if (ringProgress < 1) {
      context.beginPath();
      context.arc(mouse.sx, mouse.sy, 4 + ringProgress * 22, 0, Math.PI * 2);
      context.strokeStyle = rgba(palette.ring, (1 - ringProgress) * alpha * 0.5);
      context.lineWidth = 1.5;
      context.stroke();
    }

    // Hiển thị tên xã khi hover
    const communeName = BACNINH_GEO.names[hover.parcel];
    if (communeName) {
      context.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
      const textWidth = context.measureText(communeName).width;
      let tx = mouse.x + 14;
      let ty = mouse.y - 14;
      // Lật sang trái chuột nếu tràn mép phải viewport
      if (tx + textWidth > geometry.width) {
        tx = mouse.x - 14 - textWidth;
      }
      // Vẽ dưới chuột nếu y quá gần mép trên
      if (ty < 20) {
        ty = mouse.y + 20;
      }
      // Halo strokeText tương phản
      context.lineJoin = 'round';
      context.lineWidth = 3;
      context.strokeStyle = isDark() ? 'rgba(2,6,23,0.75)' : 'rgba(255,255,255,0.75)';
      context.strokeText(communeName, tx, ty);
      context.fillStyle = rgba(palette.parcelStroke, 0.95);
      context.fillText(communeName, tx, ty);
    }
  };

  // ================================================================
  // Entities
  // ================================================================

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
      if (entity.x > geometry.width - BOUND_MARGIN)
        ax -= BOUND_FORCE * (1 - (geometry.width - entity.x) / BOUND_MARGIN);
      if (entity.y < BOUND_MARGIN) ay += BOUND_FORCE * (1 - entity.y / BOUND_MARGIN);
      if (entity.y > geometry.height - BOUND_MARGIN)
        ay -= BOUND_FORCE * (1 - (geometry.height - entity.y) / BOUND_MARGIN);

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

  // ================================================================
  // Entity icons
  // ================================================================

  const drawEntityIcon = (kind: EntityKind, cx: number, cy: number, s: number): void => {
    const iconAlpha = isDark() ? 0.9 : 0.8;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 1.5;

    // Badge disc so the icon stays legible over the grid
    context.beginPath();
    context.arc(cx, cy, s * 1.45, 0, Math.PI * 2);
    context.fillStyle = rgba(palette.entity, isDark() ? 0.08 : 0.07);
    context.fill();
    context.strokeStyle = rgba(palette.entity, isDark() ? 0.35 : 0.3);
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
        const offsets = [
          [-0.24, -0.32],
          [0.24, -0.32],
          [-0.24, 0.08],
          [0.24, 0.08],
        ];
        for (const [ox, oy] of offsets) {
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
        for (const off of [-0.42, -0.14, 0.14, 0.42]) {
          context.moveTo(cx + off * s, lintelY);
          context.lineTo(cx + off * s, baseY);
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
        for (const dy of [-0.02, 0.22, 0.46]) {
          context.moveTo(cx - s * 0.24, cy + dy * s);
          context.lineTo(cx + s * 0.3, cy + dy * s);
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
        for (const dy of [-0.15, 0.2]) {
          context.moveTo(cx - s * 0.14, cy + dy * s);
          context.lineTo(cx + s * 0.36, cy + dy * s);
        }
        context.stroke();
        break;
      }
      case 'signature': {
        // Handwritten squiggle over a signing line
        context.beginPath();
        context.moveTo(cx - s * 0.55, cy + s * 0.3);
        context.bezierCurveTo(
          cx - s * 0.3,
          cy - s * 0.15,
          cx - s * 0.15,
          cy + s * 0.5,
          cx + s * 0.05,
          cy + s * 0.05
        );
        context.bezierCurveTo(
          cx + s * 0.2,
          cy - s * 0.25,
          cx + s * 0.4,
          cy + s * 0.2,
          cx + s * 0.55,
          cy - s * 0.1
        );
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
    const baseAlpha = isDark() ? 0.4 : 0.42;
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

  // ================================================================
  // Main draw frame — thứ tự lớp: graticule → mesh →
  //   spotlight → hover → pulses → entities
  // ================================================================

  const drawFrame = (now: number): void => {
    const dt = lastNow === 0 ? 0 : Math.min((now - lastNow) / 1000, 0.05);
    lastNow = now;

    context.clearRect(0, 0, geometry.width, geometry.height);
    updateMouse(now, dt);
    drawGraticule(); // Lớp dưới: lưới kinh-vĩ tuyến thế giới
    drawCommuneMesh(); // Mesh xã
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

    // Lớp nền: graticule + mesh
    drawGraticule();
    drawCommuneMesh();

    // Sáng cố định 3 polygon xã
    for (const idx of [0, 49, 98]) {
      if (idx >= geometry.parcels.length) continue;
      traceParcel(idx);
      context.fillStyle = rgba(palette.parcelFill, 0.1);
      context.fill();
      context.strokeStyle = rgba(palette.parcelStroke, 0.5);
      context.lineWidth = 1.5;
      context.stroke();
    }

    // STATIC_ENTITIES + links
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
        context.strokeStyle = rgba(palette.link, (1 - dist / LINK_DIST) * (isDark() ? 0.4 : 0.42));
        context.beginPath();
        context.moveTo(placed[i].x, placed[i].y);
        context.lineTo(placed[j].x, placed[j].y);
        context.stroke();
      }
    }
    for (const p of placed) {
      drawEntityIcon(p.kind, p.x, p.y, p.size);
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

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (isInteractiveTarget(event)) return;
    dragging = true;
    activePointerId = event.pointerId;
    lastPx = event.clientX;
    lastPy = event.clientY;
    lastTouch = null;
    hover = null;
    mouse.strength = 0;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || activePointerId !== event.pointerId) return;
    const dx = event.clientX - lastPx;
    const dy = event.clientY - lastPy;
    lastPx = event.clientX;
    lastPy = event.clientY;
    applyPanDelta(dx, dy);
  };

  const endDrag = (event?: PointerEvent): void => {
    if (event && activePointerId !== null && event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    lastTouch = null;
    if (event) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const onTouchStart = (event: TouchEvent): void => {
    if (isInteractiveTarget(event)) return;
    if (event.touches.length !== 1) {
      lastTouch = null;
      return;
    }
    lastTouch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };

  const onTouchMove = (event: TouchEvent): void => {
    if (!lastTouch || event.touches.length !== 1) return;
    event.preventDefault();
    const dx = event.touches[0].clientX - lastTouch.x;
    const dy = event.touches[0].clientY - lastTouch.y;
    lastTouch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    if (dx !== 0 || dy !== 0) applyPanDelta(dx, dy);
  };

  const onDblClick = (event: MouseEvent): void => {
    if (isInteractiveTarget(event)) return;
    event.preventDefault();
    resetPan();
  };

  const onSchemeChange = (): void => {
    palette = isDark() ? PALETTE_DARK : PALETTE_LIGHT;
    if (reducedMotionQuery.matches) drawStatic();
  };

  darkQuery.addEventListener('change', onSchemeChange);
  reducedMotionQuery.addEventListener('change', start);
  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', onMouseMove);
  document.documentElement.addEventListener('mouseleave', onMouseLeave);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('dblclick', onDblClick);

  resize();
  entities = spawnEntities(geometry);
  start();
}
