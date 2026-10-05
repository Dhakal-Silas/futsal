import teamsJson from '../data/teams.json';
import type { TeamInfo } from './types';

export const TEAMS: TeamInfo[] = teamsJson.teams as TeamInfo[];
export const teamById = (id: string) => TEAMS.find((t) => t.id === id) ?? TEAMS[0];

/** Overall rating 0..100 used for auto-sim and the star display. */
export function overall(t: TeamInfo) {
  const r = t.ratings;
  return Math.round((r.attack * 1.2 + r.defense + r.passing + r.speed * 0.8 + r.stamina * 0.5 + r.keeper * 0.7) / 5.2);
}
export const stars = (t: TeamInfo) => Math.max(1, Math.min(5, Math.round((overall(t) - 70) / 5)));

/** Relative luminance-ish distance between two hex colors. */
export function colorDistance(a: string, b: string) {
  const pa = hex(a), pb = hex(b);
  return Math.sqrt(((pa[0] - pb[0]) ** 2) * 0.3 + ((pa[1] - pb[1]) ** 2) * 0.59 + ((pa[2] - pb[2]) ** 2) * 0.11);
}
function hex(h: string): [number, number, number] {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
/** Decide if the away team should wear its second kit. */
export function kitsClash(home: TeamInfo, away: TeamInfo) {
  return colorDistance(home.kit.primary, away.kit.primary) < 95;
}

const FIRST = ['Alex', 'Bruno', 'Carlos', 'Dani', 'Eder', 'Falcao', 'Gabi', 'Hugo', 'Ivan', 'Jonas', 'Kai', 'Leo', 'Marco', 'Nico', 'Oscar', 'Pablo', 'Rafa', 'Sergi', 'Tiago', 'Vitor'];
export function playerName(seed: number) { return FIRST[Math.abs(seed) % FIRST.length]; }
