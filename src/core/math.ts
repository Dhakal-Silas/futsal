export interface Vec2 { x: number; y: number; }

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const len = (x: number, y: number) => Math.sqrt(x * x + y * y);
export const dist = (a: Vec2, b: Vec2) => len(a.x - b.x, a.y - b.y);
export const distSq = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;
export const sign = (v: number) => (v < 0 ? -1 : 1);
export const TAU = Math.PI * 2;

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function angleLerp(a: number, b: number, t: number): number {
  return a + normalizeAngle(b - a) * t;
}

/** Rotate angle `a` toward `b` by at most `maxDelta`. */
export function turnToward(a: number, b: number, maxDelta: number): number {
  const d = normalizeAngle(b - a);
  if (Math.abs(d) <= maxDelta) return b;
  return normalizeAngle(a + sign(d) * maxDelta);
}

/** Exponential smoothing toward a target; `rate` ~ stiffness per second. */
export function damp(cur: number, target: number, rate: number, dt: number): number {
  return lerp(cur, target, 1 - Math.exp(-rate * dt));
}

export function moveToward(cur: number, target: number, maxDelta: number): number {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + sign(d) * maxDelta;
}

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeIn = (t: number) => t * t * t;
export const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

/** Distance from point p to segment ab. */
export function pointSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
  t = clamp01(t);
  return len(px - (ax + abx * t), py - (ay + aby * t));
}
