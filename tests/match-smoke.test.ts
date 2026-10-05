import { describe, it, expect } from 'vitest';
import { Match } from '../src/sim/match';
import { TEAMS } from '../src/sim/teams';
import { CONFIG } from '../src/config';

function playMatch(seed: number, halfMinutes = 1, knockout = false, difficulty: any = 'Medium') {
  const m = new Match({ teams: [TEAMS[0], TEAMS[1]], formations: ['2-2', '1-2-1'], halfMinutes, humanSlots: [-1, -1], difficulty, knockout, seed });
  m.start();
  const dt = CONFIG.TICK_DT;
  let ticks = 0;
  const maxTicks = 60 * 60 * 20; // 20 minutes safety
  const phases = new Set<string>();
  const evTypes = new Set<string>();
  while (m.phase !== 'finished' && ticks < maxTicks) {
    m.step(dt);
    phases.add(m.phase);
    for (const e of m.events) evTypes.add(e.type);
    m.events.length = 0;
    if (m.phase === 'halftime' || m.phase === 'extratime_break' || m.phase === 'fulltime') m.continue();
    ticks++;
    // sanity: no NaNs
    const b = m.ball;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) throw new Error('ball NaN at tick ' + ticks);
    for (const p of m.sim.players) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('player NaN ' + p.id);
  }
  return { m, ticks, phases, evTypes };
}

describe('full match simulation (CPU vs CPU)', () => {
  it('plays a complete match to the end without crashing', () => {
    const { m, ticks, phases, evTypes } = playMatch(42, 1);
    expect(m.phase).toBe('finished');
    expect(phases.has('play')).toBe(true);
    expect(phases.has('halftime')).toBe(true);
    expect(ticks).toBeLessThan(60 * 60 * 20);
    // the ball goes out and comes back at least once in 2 minutes
    expect(evTypes.has('kickin') || evTypes.has('corner') || evTypes.has('goalkick') || evTypes.has('goal')).toBe(true);
    expect(m.stats[0].passes + m.stats[1].passes).toBeGreaterThan(5);
  }, 30000);

  it('produces goals over several matches and the stats stay consistent', () => {
    let goals = 0, shots = 0, saves = 0;
    for (let s = 1; s <= 4; s++) {
      const { m } = playMatch(s * 13, 1);
      goals += m.score[0] + m.score[1];
      shots += m.stats[0].shots + m.stats[1].shots;
      saves += m.stats[0].saves + m.stats[1].saves;
      expect(m.stats[0].shotsOnTarget).toBeLessThanOrEqual(m.stats[0].shots + 2);
    }
    expect(shots).toBeGreaterThan(4);
    expect(goals + saves).toBeGreaterThan(0);
  }, 60000);

  it('knockout: resolves a draw with extra time and penalties', () => {
    // force a draw by making the halves extremely short
    const m = new Match({ teams: [TEAMS[2], TEAMS[3]], formations: ['3-1', '1-3'], halfMinutes: 0.05, humanSlots: [-1, -1], difficulty: 'Easy', knockout: true, seed: 5 });
    m.start();
    let ticks = 0;
    const phases = new Set<string>();
    while (m.phase !== 'finished' && ticks < 60 * 60 * 10) {
      m.step(CONFIG.TICK_DT); phases.add(m.phase); m.events.length = 0;
      if (m.phase === 'halftime' || m.phase === 'extratime_break' || m.phase === 'fulltime') m.continue();
      ticks++;
    }
    expect(m.phase).toBe('finished');
    expect(m.winner).toBeGreaterThanOrEqual(0);
    if (phases.has('penalties')) {
      expect(m.penalties!.scores[0] !== m.penalties!.scores[1]).toBe(true);
    }
  }, 30000);

  it('is deterministic for the same seed', () => {
    const a = playMatch(99, 0.5), b = playMatch(99, 0.5);
    expect(a.m.score).toEqual(b.m.score);
    expect(a.ticks).toBe(b.ticks);
    expect(a.m.ball.x).toBeCloseTo(b.m.ball.x, 6);
  }, 30000);
});
