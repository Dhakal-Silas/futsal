import { CONFIG, HALF_LENGTH } from '../config';
import { clamp, normalizeAngle } from '../core/math';
import type { Ball, Kick, KickType, Player } from './types';
import { predictBallPos } from './ball';

const scratch = { x: 0, y: 0 };

export interface PassChoice { target: Player | null; aimX: number; aimY: number; speed: number; loft: number; }

/** Goal center x for the goal that `team` attacks, given its attack direction. */
export const goalX = (attackDir: number) => attackDir * HALF_LENGTH;

/**
 * Pick the teammate to pass to given an aim direction. Scores candidates by angular closeness to
 * the aim, distance and (for through passes) whether they are ahead. Pure: usable by HUD and AI.
 */
export function choosePassTarget(
  passer: Player, teammates: Player[], opponents: Player[], dirX: number, dirY: number, type: 'pass' | 'through' | 'cross', attackDir: number,
): PassChoice {
  const dl = Math.hypot(dirX, dirY);
  if (dl < 0.01) { dirX = Math.cos(passer.heading); dirY = Math.sin(passer.heading); } else { dirX /= dl; dirY /= dl; }
  let best: Player | null = null, bestScore = -Infinity;
  const aimAng = Math.atan2(dirY, dirX);
  for (const t of teammates) {
    if (t.id === passer.id || t.action === 'fallen' || t.action === 'slide') continue;
    let tx = t.x, ty = t.y;
    if (type === 'through') { tx += t.vx * CONFIG.THROUGH_LEAD_TIME; ty += t.vy * CONFIG.THROUGH_LEAD_TIME; }
    const dx = tx - passer.x, dy = ty - passer.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.8) continue;
    const ang = Math.abs(normalizeAngle(Math.atan2(dy, dx) - aimAng));
    const maxAng = type === 'through' ? 0.9 : 1.25;
    if (ang > maxAng) continue;
    let score = 10 - ang * 7;
    // prefer medium distances
    const ideal = type === 'cross' ? 12 : type === 'through' ? 10 : 7;
    score -= Math.abs(d - ideal) * 0.25;
    if (type === 'through' || type === 'cross') {
      const forward = dx * attackDir;
      score += forward * 0.3;
    }
    // lane blocked?
    for (const o of opponents) {
      const ldist = pointLineDist(o.x, o.y, passer.x, passer.y, tx, ty);
      if (ldist < 0.9) score -= type === 'cross' ? 1 : 4;
    }
    if (t.isKeeper) score -= 3;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (!best) return { target: null, aimX: dirX, aimY: dirY, speed: CONFIG.PASS_MIN_SPEED, loft: 0 };
  let tx = best.x, ty = best.y;
  if (type === 'through') { tx += best.vx * CONFIG.THROUGH_LEAD_TIME * 1.2; ty += best.vy * CONFIG.THROUGH_LEAD_TIME * 1.2; }
  else if (type === 'pass') { tx += best.vx * 0.25; ty += best.vy * 0.25; }
  else { tx += best.vx * 0.5; ty += best.vy * 0.5; }
  const dx = tx - passer.x, dy = ty - passer.y;
  const d = Math.hypot(dx, dy) || 1;
  return { target: best, aimX: dx / d, aimY: dy / d, speed: passSpeedForDistance(d, type), loft: type === 'cross' ? CONFIG.CROSS_LOFT : 0 };
}

/** Launch speed so a ground pass arrives at distance d with a bit of pace left. */
export function passSpeedForDistance(d: number, type: KickType): number {
  if (type === 'cross') return clamp(8 + d * 0.75, 12, 20);
  // empirical: rolling ball with friction travels about v*1.25 meters before stopping
  const v = Math.sqrt(Math.max(0, 2 * CONFIG.BALL_ROLL_DECEL * d)) * 0.9 + d * 0.35 + 3;
  return clamp(v, CONFIG.PASS_MIN_SPEED, type === 'through' ? CONFIG.THROUGH_SPEED + 3 : CONFIG.PASS_MAX_SPEED);
}

/**
 * Shot aim assist: if the aim direction points roughly at the goal, pull it toward a point inside
 * the goal mouth. Returns a unit direction.
 */
export function assistedShotDir(fromX: number, fromY: number, dirX: number, dirY: number, attackDir: number, assistAngle = CONFIG.SHOT_ASSIST_ANGLE) {
  const gx = goalX(attackDir);
  const gw = CONFIG.GOAL_WIDTH / 2;
  const dl = Math.hypot(dirX, dirY) || 1;
  dirX /= dl; dirY /= dl;
  const toGoalX = gx - fromX, toGoalY = -fromY;
  const toGoalAng = Math.atan2(toGoalY, toGoalX);
  const aimAng = Math.atan2(dirY, dirX);
  const diff = normalizeAngle(aimAng - toGoalAng);
  if (Math.abs(diff) > assistAngle || Math.abs(toGoalX) < 0.5) return { x: dirX, y: dirY, assisted: false };
  // pick the target y inside the goal based on which way the aim leans
  const lean = clamp(diff / assistAngle, -1, 1) * (attackDir > 0 ? 1 : -1);
  const targetY = lean * gw * 0.72;
  const tx = gx - fromX, ty = targetY - fromY;
  const tl = Math.hypot(tx, ty) || 1;
  return { x: tx / tl, y: ty / tl, assisted: true };
}

export function makeKick(type: KickType, power: number, aimX: number, aimY: number, targetId: number, noise: number, speedOverride?: number, loftOverride?: number): Kick {
  let speed: number, loft: number;
  switch (type) {
    case 'pass': speed = CONFIG.PASS_MIN_SPEED + power * (CONFIG.PASS_MAX_SPEED - CONFIG.PASS_MIN_SPEED); loft = 0; break;
    case 'through': speed = CONFIG.THROUGH_SPEED * (0.8 + 0.45 * power); loft = 0; break;
    case 'shoot': speed = CONFIG.SHOT_MIN_SPEED + power * (CONFIG.SHOT_MAX_SPEED - CONFIG.SHOT_MIN_SPEED); loft = CONFIG.SHOT_LOFT * (0.4 + power * 0.9); break;
    case 'cross': speed = CONFIG.CROSS_SPEED * (0.8 + 0.5 * power); loft = CONFIG.CROSS_LOFT; break;
    case 'clear': speed = CONFIG.CLEAR_SPEED; loft = 0.45; break;
    case 'throw': speed = CONFIG.KEEPER_THROW_SPEED; loft = 0.25; break;
    default: speed = 6; loft = 0; break;
  }
  if (speedOverride !== undefined) speed = speedOverride;
  if (loftOverride !== undefined) loft = loftOverride;
  const l = Math.hypot(aimX, aimY) || 1;
  return { type, power, aimX: aimX / l, aimY: aimY / l, targetId, loft, speed, noise };
}

export function pointLineDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Count opponents inside the shooting lane (a cone/corridor from shooter to the goal). */
export function laneBlockers(fromX: number, fromY: number, toX: number, toY: number, opponents: Player[], width = 0.8): number {
  let n = 0;
  for (const o of opponents) {
    if (o.isKeeper) continue;
    if (pointLineDist(o.x, o.y, fromX, fromY, toX, toY) < width) n++;
  }
  return n;
}

export function ballFuture(ball: Ball, t: number) { predictBallPos(ball, t, scratch); return scratch; }
