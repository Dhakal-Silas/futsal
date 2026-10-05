import type { Rng } from '../core/rng';
import type { TeamInfo } from '../sim/types';
import { overall } from '../sim/teams';

export interface SimResult { scoreA: number; scoreB: number; aet: boolean; pens: [number, number] | null; }

/** Quick score generation from team ratings for matches the human does not play. */
export function autoSimMatch(a: TeamInfo, b: TeamInfo, rng: Rng, knockout: boolean, halfMinutes = 3): SimResult {
  const ra = overall(a), rb = overall(b);
  const diff = (ra - rb) / 10; // ~ -2..2
  const base = 1.6 * (halfMinutes / 3) + 0.4;
  const expA = Math.max(0.3, base + diff * 0.45);
  const expB = Math.max(0.3, base - diff * 0.45);
  let scoreA = poisson(expA, rng), scoreB = poisson(expB, rng);
  let aet = false, pens: [number, number] | null = null;
  if (knockout && scoreA === scoreB) {
    aet = true;
    const ea = poisson(expA * 0.35, rng), eb = poisson(expB * 0.35, rng);
    scoreA += ea; scoreB += eb;
    if (scoreA === scoreB) {
      let pa = 0, pb = 0;
      for (let i = 0; i < 5; i++) { if (rng.chance(0.75)) pa++; if (rng.chance(0.75)) pb++; }
      while (pa === pb) { if (rng.chance(0.75)) pa++; if (rng.chance(0.75)) pb++; }
      pens = [pa, pb];
    }
  }
  return { scoreA, scoreB, aet, pens };
}

function poisson(lambda: number, rng: Rng): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L);
  return k - 1;
}
