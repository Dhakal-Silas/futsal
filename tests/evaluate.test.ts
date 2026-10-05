import { describe, it, expect } from 'vitest';
import { createPlayer, placePlayer } from '../src/sim/player';
import { shootScore, passOptions, dribbleScore, clearScore, saveProbability } from '../src/ai/evaluate';
import { assistedShotDir, choosePassTarget, passSpeedForDistance } from '../src/sim/kicks';
import { CONFIG, HALF_LENGTH } from '../src/config';
import type { Player } from '../src/sim/types';

function mk(id: number, team: 0 | 1, index: number, x: number, y: number, vx = 0, vy = 0): Player {
  const p = createPlayer(id, team, index, index + 1, 'P' + id, 1, 0.8, 0.6, 0, 0);
  placePlayer(p, x, y, 0);
  p.vx = vx; p.vy = vy; p.speed = Math.hypot(vx, vy);
  return p;
}

describe('AI decision helpers', () => {
  it('shooting is more attractive close to goal with a clear lane than far away or blocked', () => {
    const near = mk(0, 0, 4, HALF_LENGTH - 7, 0);
    const far = mk(1, 0, 4, 0, 0);
    const keeper = mk(2, 1, 0, HALF_LENGTH - 1, 0);
    const clear = shootScore(near, [keeper], 1, 1).score;
    expect(clear).toBeGreaterThan(shootScore(far, [keeper], 1, 1).score);
    const blocker = mk(3, 1, 2, HALF_LENGTH - 3.5, 0.2);
    const blocked = shootScore(near, [keeper, blocker], 1, 1).score;
    expect(blocked).toBeLessThan(clear);
    // aims at the corner away from the keeper
    keeper.y = 1.0;
    expect(shootScore(near, [keeper], 1, 1).aimY).toBeLessThan(0);
  });

  it('pass options prefer open, forward teammates with a clear lane', () => {
    const me = mk(0, 0, 3, 0, 0);
    const openForward = mk(1, 0, 4, 8, 3);
    const markedBackward = mk(2, 0, 1, -6, -2);
    const marker = mk(3, 1, 2, -6.5, -2.2);
    const laneBlocker = mk(4, 1, 3, 4, 1.4);
    const out: any[] = [];
    passOptions(me, [me, openForward, markedBackward], [marker], 1, 0.5, out);
    expect(out[0].target).toBe(openForward);
    const scoreOpen = out.find((o) => o.target === openForward && o.type === 'pass').score;
    passOptions(me, [me, openForward, markedBackward], [marker, laneBlocker], 1, 0.5, out);
    const scoreBlocked = out.find((o) => o.target === openForward && o.type === 'pass').score;
    expect(scoreBlocked).toBeLessThan(scoreOpen);
  });

  it('through pass appears for a teammate running into space', () => {
    const me = mk(0, 0, 3, 0, 0);
    const runner = mk(1, 0, 4, 6, 2, 6, 0);
    const out: any[] = [];
    passOptions(me, [me, runner], [], 1, 0.9, out);
    expect(out.some((o) => o.type === 'through' && o.target === runner)).toBe(true);
  });

  it('dribbling steers away from a defender in front', () => {
    const me = mk(0, 0, 3, 0, 0);
    const def = mk(1, 1, 2, 3, 0);
    const d = dribbleScore(me, [def], 1);
    expect(Math.abs(d.dirY)).toBeGreaterThan(0.2);
    const free = dribbleScore(me, [], 1);
    expect(free.score).toBeGreaterThan(d.score);
  });

  it('clearing is only considered in the defensive third under pressure', () => {
    const deep = mk(0, 0, 1, -15, 0);
    const presser = mk(1, 1, 4, -14, 0.5);
    expect(clearScore(deep, [presser], 1)).toBeGreaterThan(0.5);
    expect(clearScore(deep, [], 1)).toBe(0);
    const mid = mk(2, 0, 1, 0, 0);
    expect(clearScore(mid, [presser], 1)).toBe(0);
  });

  it('save probability responds to speed, placement and skill', () => {
    const slowCentral = saveProbability(14, 0.3, 0, 0.5, 0.8, 10);
    const fastCorner = saveProbability(27, 1.5, 1.4, 1.7, 0.8, 10);
    expect(slowCentral).toBeGreaterThan(fastCorner);
    expect(saveProbability(20, 0.5, 0.5, 0.5, 0.9, 10)).toBeGreaterThan(saveProbability(20, 0.5, 0.5, 0.5, 0.3, 10));
    expect(fastCorner).toBeGreaterThanOrEqual(0.06);
    expect(slowCentral).toBeLessThanOrEqual(0.95);
  });

  it('shot assist pulls the aim into the goal when roughly on target', () => {
    const a = assistedShotDir(10, 2, 1, 0.1, 1);
    expect(a.assisted).toBe(true);
    // the assisted direction must hit the goal line inside the posts
    const t = (HALF_LENGTH - 10) / a.x;
    const yAtGoal = 2 + a.y * t;
    expect(Math.abs(yAtGoal)).toBeLessThan(CONFIG.GOAL_WIDTH / 2);
    const off = assistedShotDir(10, 2, 0, 1, 1);
    expect(off.assisted).toBe(false);
  });

  it('pass target selection follows the aim direction and leads runners', () => {
    const me = mk(0, 0, 3, 0, 0);
    const up = mk(1, 0, 4, 1, -6);
    const right = mk(2, 0, 2, 7, 0, 5, 0);
    const c1 = choosePassTarget(me, [me, up, right], [], 0, -1, 'pass', 1);
    expect(c1.target).toBe(up);
    const c2 = choosePassTarget(me, [me, up, right], [], 1, 0, 'through', 1);
    expect(c2.target).toBe(right);
    expect(c2.aimX).toBeGreaterThan(0.9);
    expect(passSpeedForDistance(12, 'pass')).toBeGreaterThan(passSpeedForDistance(5, 'pass'));
  });
});
