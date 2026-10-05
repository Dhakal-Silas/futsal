import { describe, it, expect } from 'vitest';
import { createBracket, recordResult, nextMatch, champion, drawOrder, roundName, createGroups, groupTable, knockoutFromGroups, isEliminated } from '../src/tournament/bracket';
import { Rng } from '../src/core/rng';
import { autoSimMatch } from '../src/tournament/autosim';
import { TEAMS } from '../src/sim/teams';

const ids = TEAMS.map((t) => t.id);

describe('bracket', () => {
  it('builds 4 rounds for 16 teams and advances winners', () => {
    const br = createBracket(ids);
    expect(br.rounds.map((r) => r.length)).toEqual([8, 4, 2, 1]);
    expect(roundName(0, 4)).toBe('ROUND OF 16');
    expect(roundName(3, 4)).toBe('FINAL');
    let m = nextMatch(br);
    let guard = 0;
    while (m && guard++ < 20) {
      recordResult(br, m.id, 2, 1);
      m = nextMatch(br);
    }
    expect(guard).toBe(15);
    expect(champion(br)).toBe(ids[0]);
    expect(isEliminated(br, ids[1])).toBe(true);
    expect(isEliminated(br, ids[0])).toBe(false);
  });

  it('resolves draws by penalties and refuses unresolved draws', () => {
    const br = createBracket(ids);
    const m = nextMatch(br)!;
    expect(() => recordResult(br, m.id, 1, 1)).toThrow();
    recordResult(br, m.id, 1, 1, true, [4, 3]);
    expect(br.rounds[0][0].winner).toBe(m.a);
    expect(br.rounds[1][0].a).toBe(m.a);
  });

  it('classico draw keeps Madrid and Barcelona in opposite halves', () => {
    for (let s = 1; s < 50; s++) {
      const order = drawOrder(ids, new Rng(s), ['rma', 'fcb']);
      const ix = order.indexOf('rma'), iy = order.indexOf('fcb');
      expect(ix < 8).not.toBe(iy < 8);
      expect(new Set(order).size).toBe(16);
    }
  });

  it('group stage: tables and seeding', () => {
    const { groups, matches } = createGroups(ids, 4);
    expect(groups.length).toBe(4);
    expect(matches.length).toBe(24);
    const rng = new Rng(3);
    for (const m of matches) { const r = autoSimMatch(TEAMS[0], TEAMS[1], rng, false); m.scoreA = r.scoreA; m.scoreB = r.scoreB; m.played = true; }
    const t = groupTable(groups[0], matches, 0);
    expect(t.length).toBe(4);
    expect(t[0].points).toBeGreaterThanOrEqual(t[1].points);
    expect(t.reduce((s, r) => s + r.played, 0)).toBe(12);
    const seeds = knockoutFromGroups(groups, matches);
    expect(seeds.length).toBe(8);
    expect(new Set(seeds).size).toBe(8);
  });

  it('auto-sim favours stronger teams and always produces a knockout winner', () => {
    const rng = new Rng(7);
    let strongWins = 0;
    for (let i = 0; i < 300; i++) {
      const r = autoSimMatch(TEAMS[0], TEAMS[15], rng, true);
      const winner = r.scoreA !== r.scoreB ? (r.scoreA > r.scoreB ? 'a' : 'b') : (r.pens![0] > r.pens![1] ? 'a' : 'b');
      if (winner === 'a') strongWins++;
      if (r.scoreA === r.scoreB) expect(r.pens).not.toBeNull();
    }
    expect(strongWins).toBeGreaterThan(170);
  });
});
