import { Rng } from '../core/rng';

export interface TMatch {
  id: string;
  round: number;        // 0 = first knockout round
  index: number;        // position within the round
  a: string | null;     // team id
  b: string | null;
  scoreA: number; scoreB: number;
  played: boolean;
  aet: boolean;         // decided after extra time
  pens: [number, number] | null;
  winner: string | null;
}

export interface GroupMatch { id: string; group: number; a: string; b: string; scoreA: number; scoreB: number; played: boolean; }
export interface GroupRow { team: string; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; points: number; }

export interface Bracket {
  rounds: TMatch[][];
}

/** Round names for a knockout with n rounds (last = final). */
export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - 1 - round;
  if (fromEnd === 0) return 'FINAL';
  if (fromEnd === 1) return 'SEMI-FINALS';
  if (fromEnd === 2) return 'QUARTER-FINALS';
  if (fromEnd === 3) return 'ROUND OF 16';
  return `ROUND ${round + 1}`;
}

/** Create a single-elimination bracket from an ordered list of team ids (power of two). */
export function createBracket(teams: string[]): Bracket {
  const n = teams.length;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('team count must be a power of two');
  const rounds: TMatch[][] = [];
  let count = n / 2;
  let round = 0;
  while (count >= 1) {
    const r: TMatch[] = [];
    for (let i = 0; i < count; i++) {
      r.push({ id: `r${round}m${i}`, round, index: i, a: round === 0 ? teams[i * 2] : null, b: round === 0 ? teams[i * 2 + 1] : null, scoreA: 0, scoreB: 0, played: false, aet: false, pens: null, winner: null });
    }
    rounds.push(r);
    count = Math.floor(count / 2);
    round++;
  }
  return { rounds };
}

/** Record a result and push the winner into the next round. */
export function recordResult(br: Bracket, matchId: string, scoreA: number, scoreB: number, aet = false, pens: [number, number] | null = null) {
  const m = findMatch(br, matchId);
  if (!m || !m.a || !m.b) throw new Error('match not ready: ' + matchId);
  m.scoreA = scoreA; m.scoreB = scoreB; m.aet = aet; m.pens = pens; m.played = true;
  if (scoreA === scoreB) {
    if (!pens || pens[0] === pens[1]) throw new Error('knockout matches need a winner');
    m.winner = pens[0] > pens[1] ? m.a : m.b;
  } else m.winner = scoreA > scoreB ? m.a : m.b;
  const next = br.rounds[m.round + 1];
  if (next) {
    const nm = next[Math.floor(m.index / 2)];
    if (m.index % 2 === 0) nm.a = m.winner; else nm.b = m.winner;
  }
  return m;
}

export function findMatch(br: Bracket, id: string): TMatch | null {
  for (const r of br.rounds) for (const m of r) if (m.id === id) return m;
  return null;
}

/** Next unplayed match in bracket order (round by round). */
export function nextMatch(br: Bracket): TMatch | null {
  for (const r of br.rounds) for (const m of r) if (!m.played && m.a && m.b) return m;
  return null;
}
export function currentRound(br: Bracket): number {
  for (const r of br.rounds) if (r.some((m) => !m.played)) return r[0].round;
  return br.rounds.length - 1;
}
export function champion(br: Bracket): string | null {
  const f = br.rounds[br.rounds.length - 1][0];
  return f.played ? f.winner : null;
}
export function matchesOf(br: Bracket, team: string): TMatch[] {
  const out: TMatch[] = [];
  for (const r of br.rounds) for (const m of r) if (m.a === team || m.b === team) out.push(m);
  return out;
}
export function isEliminated(br: Bracket, team: string): boolean {
  return matchesOf(br, team).some((m) => m.played && m.winner !== team);
}

/**
 * Draw: shuffle teams into bracket slots. With `classico`, the two named teams are placed in
 * opposite halves so they can only meet in the final.
 */
export function drawOrder(teams: string[], rng: Rng, classico: [string, string] | null): string[] {
  const order = rng.shuffle([...teams]);
  if (classico) {
    const [x, y] = classico;
    const half = order.length / 2;
    const ix = order.indexOf(x), iy = order.indexOf(y);
    if (ix >= 0 && iy >= 0 && (ix < half) === (iy < half)) {
      // move y to a random slot in the other half
      const target = ix < half ? half + rng.int(0, half - 1) : rng.int(0, half - 1);
      const t = order[target]; order[target] = y; order[iy] = t;
    }
  }
  return order;
}

/* ------------------------------------------------------------------ groups */

export function createGroups(teams: string[], groupCount = 4): { groups: string[][]; matches: GroupMatch[] } {
  const groups: string[][] = [];
  const per = teams.length / groupCount;
  for (let g = 0; g < groupCount; g++) groups.push(teams.slice(g * per, (g + 1) * per));
  const matches: GroupMatch[] = [];
  groups.forEach((g, gi) => {
    // round robin
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      matches.push({ id: `g${gi}m${matches.length}`, group: gi, a: g[i], b: g[j], scoreA: 0, scoreB: 0, played: false });
    }
  });
  return { groups, matches };
}

export function groupTable(group: string[], matches: GroupMatch[], gi: number): GroupRow[] {
  const rows = new Map<string, GroupRow>();
  for (const t of group) rows.set(t, { team: t, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 });
  for (const m of matches) {
    if (m.group !== gi || !m.played) continue;
    const a = rows.get(m.a)!, b = rows.get(m.b)!;
    a.played++; b.played++; a.gf += m.scoreA; a.ga += m.scoreB; b.gf += m.scoreB; b.ga += m.scoreA;
    if (m.scoreA > m.scoreB) { a.won++; b.lost++; a.points += 3; }
    else if (m.scoreA < m.scoreB) { b.won++; a.lost++; b.points += 3; }
    else { a.drawn++; b.drawn++; a.points++; b.points++; }
  }
  return [...rows.values()].sort((x, y) => y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team.localeCompare(y.team));
}

/** Seed the knockout from group winners/runners-up: A1-B2, C1-D2, B1-A2, D1-C2. */
export function knockoutFromGroups(groups: string[][], matches: GroupMatch[]): string[] {
  const tables = groups.map((g, i) => groupTable(g, matches, i));
  const w = tables.map((t) => t[0].team), r = tables.map((t) => t[1].team);
  return [w[0], r[1], w[2], r[3], w[1], r[0], w[3], r[2]];
}
