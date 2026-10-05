import { CONFIG, HALF_LENGTH, HALF_WIDTH } from '../config';
import { clamp, clamp01 } from '../core/math';
import { laneBlockers, pointLineDist } from '../sim/kicks';
import type { Player } from '../sim/types';
import { nearestDist } from './steering';

/** Pure scoring helpers for the ball-carrier decision. All return roughly 0..1.5 scores. */

export function shootScore(p: Player, opponents: Player[], attackDir: number, eagerness: number): { score: number; aimY: number } {
  const gx = attackDir * HALF_LENGTH;
  const dx = gx - p.x, dy = -p.y;
  const d = Math.hypot(dx, dy);
  if (d > CONFIG.AI_SHOOT_RANGE * 1.25) return { score: 0, aimY: 0 };
  const angle = Math.abs(Math.atan2(dy, dx * attackDir)); // 0 = straight at goal
  // sweet spot around 7 m: close enough to beat the keeper, far enough that he cannot smother it
  let s = 1.25 * clamp01(1 - Math.abs(d - 7) / 8);
  s *= clamp01(1 - angle / 1.25);
  const keeper = opponents.find((o) => o.isKeeper);
  // aim at the corner further from the keeper
  const gw = CONFIG.GOAL_WIDTH / 2;
  let aimY = keeper ? (keeper.y > 0 ? -gw * 0.7 : gw * 0.7) : (p.y > 0 ? -gw * 0.6 : gw * 0.6);
  const blockers = laneBlockers(p.x, p.y, gx, aimY, opponents, 0.7);
  s -= blockers * 0.45;
  if (keeper) {
    const kd = Math.hypot(keeper.x - gx, keeper.y);
    if (kd > 4) s += 0.4; // keeper off his line
    if (d < 5 && Math.hypot(keeper.x - p.x, keeper.y - p.y) < 2) s -= 0.3; // keeper closing down
  }
  if (d < 9 && blockers === 0) s += 0.2;
  const pressure = nearestDist(p.x, p.y, opponents);
  if (pressure < 1.3) s += 0.15; // better to shoot than lose it
  return { score: Math.max(0, s * eagerness), aimY };
}

export interface PassOption { target: Player; score: number; type: 'pass' | 'through' | 'cross'; leadX: number; leadY: number; }

export function passOptions(p: Player, teammates: Player[], opponents: Player[], attackDir: number, throughSkill: number, out: PassOption[]) {
  out.length = 0;
  const pressure = nearestDist(p.x, p.y, opponents);
  for (const t of teammates) {
    if (t === p || t.action === 'fallen' || t.action === 'slide' || t.action === 'getup') continue;
    const dx = t.x - p.x, dy = t.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 1.5) continue;
    const openness = clamp01(nearestDist(t.x, t.y, opponents) / 5);
    let lane = 2;
    for (const o of opponents) lane = Math.min(lane, pointLineDist(o.x, o.y, p.x, p.y, t.x, t.y));
    const laneClear = clamp01(lane / 1.6);
    const progress = clamp((dx * attackDir) / 14, -1, 1);
    let s = 0.1 + openness * 0.35 + laneClear * 0.35 + progress * 0.35;
    if (d < 3) s -= 0.4;
    if (d > 17) s -= 0.5;
    if (t.isKeeper) s -= 0.7 + (pressure > 2 ? 0.5 : 0);
    if (pressure < 1.5) s += 0.3; // under pressure: passing becomes attractive
    if (s > 0) out.push({ target: t, score: s, type: 'pass', leadX: t.x + t.vx * 0.3, leadY: t.y + t.vy * 0.3 });
    // through pass: receiver running forward into space
    if (!t.isKeeper && t.vx * attackDir > 1.5 && d > 4 && d < 18) {
      const lx = t.x + t.vx * CONFIG.THROUGH_LEAD_TIME, ly = t.y + t.vy * CONFIG.THROUGH_LEAD_TIME;
      if (Math.abs(lx) < HALF_LENGTH - 1 && Math.abs(ly) < HALF_WIDTH - 0.5) {
        const space = clamp01(nearestDist(lx, ly, opponents) / 4);
        let lane2 = 2;
        for (const o of opponents) lane2 = Math.min(lane2, pointLineDist(o.x, o.y, p.x, p.y, lx, ly));
        const ts = (0.05 + space * 0.5 + clamp01(lane2 / 1.5) * 0.35 + clamp((lx - p.x) * attackDir / 12, 0, 1) * 0.4) * (0.4 + 0.7 * throughSkill);
        if (ts > 0) out.push({ target: t, score: ts, type: 'through', leadX: lx, leadY: ly });
      }
    }
    // cross from wide to the box
    if (Math.abs(p.y) > 5 && p.x * attackDir > 6 && !t.isKeeper && t.x * attackDir > 11 && Math.abs(t.y) < 5.5) {
      const cs = 0.35 + openness * 0.5;
      out.push({ target: t, score: cs, type: 'cross', leadX: t.x + t.vx * 0.5, leadY: t.y + t.vy * 0.5 });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function dribbleScore(p: Player, opponents: Player[], attackDir: number): { score: number; dirX: number; dirY: number } {
  const gx = attackDir * HALF_LENGTH;
  const baseAng = Math.atan2(-p.y * 0.4, gx - p.x);
  let bestAng = baseAng, bestS = -Infinity;
  const pressure = nearestDist(p.x, p.y, opponents);
  for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
    const a = baseAng + off;
    const px = p.x + Math.cos(a) * 4, py = p.y + Math.sin(a) * 4;
    if (Math.abs(py) > HALF_WIDTH - 0.8 || Math.abs(px) > HALF_LENGTH - 0.8) continue;
    let space = Math.min(6, nearestDist(px, py, opponents));
    // check the probe line too
    for (const o of opponents) space = Math.min(space, pointLineDist(o.x, o.y, p.x, p.y, px, py) + 1.2);
    const forward = Math.cos(off) * 0.9;
    const s = space * 0.25 + forward - Math.abs(off) * 0.15;
    if (s > bestS) { bestS = s; bestAng = a; }
  }
  const score = clamp(0.5 + bestS * 0.25 - (pressure < 1.2 ? 0.5 : pressure < 2.5 ? 0.2 : 0), 0, 1.2);
  return { score, dirX: Math.cos(bestAng), dirY: Math.sin(bestAng) };
}

export function clearScore(p: Player, opponents: Player[], attackDir: number): number {
  const ownThird = p.x * attackDir < -HALF_LENGTH * 0.45;
  if (!ownThird) return 0;
  const pressure = nearestDist(p.x, p.y, opponents);
  if (pressure > 2.2) return 0;
  return 0.75 + (pressure < 1.2 ? 0.4 : 0);
}

/** Save probability for a keeper facing a shot. */
export function saveProbability(shotSpeed: number, lateralOffset: number, placementY: number, height: number, skill: number, distance: number): number {
  const speedF = clamp(1.5 - shotSpeed / 40, 0.5, 1);
  const offsetF = clamp(1.1 - lateralOffset / (CONFIG.KEEPER_DIVE_REACH + 1.6), 0.15, 1);
  const gw = CONFIG.GOAL_WIDTH / 2;
  const placeF = clamp(1 - (Math.abs(placementY) / gw) * 0.35, 0.5, 1);
  const heightF = height > 1.6 ? 0.75 : height > 1.2 ? 0.9 : 1;
  const distF = clamp(0.5 + distance / 16, 0.5, 1.1);
  const p = CONFIG.KEEPER_SAVE_BASE * (0.55 + 0.6 * skill) * speedF * offsetF * placeF * heightF * distF;
  return clamp(p, 0.06, 0.95);
}
