import formationsJson from '../data/formations.json';
import { CONFIG, HALF_LENGTH, HALF_WIDTH } from '../config';
import { clamp } from '../core/math';

export interface Formation { id: string; size: number; name: string; description: string; defense: number[][]; attack: number[][]; }
export const FORMATIONS: Formation[] = formationsJson.formations as Formation[];
export const formationsForSize = (size: number) => FORMATIONS.filter((f) => f.size === size);
/** Find a formation by id; if it does not match the team size, fall back to the first formation of that size. */
export function formationById(id: string, size: number = CONFIG.DEFAULT_TEAM_SIZE): Formation {
  const f = FORMATIONS.find((x) => x.id === id);
  if (f && f.size === size) return f;
  return formationsForSize(size)[0] ?? FORMATIONS[0];
}

/**
 * World-space anchor for player `index` of a team attacking in `attackDir`, blended between the
 * defense and attack shapes by `phase` (0 = defending deep, 1 = attacking), and shifted toward the
 * ball so the team moves as a compact unit.
 */
export function formationAnchor(f: Formation, index: number, attackDir: number, phase: number, ballX: number, ballY: number, out: { x: number; y: number }) {
  const d = f.defense[Math.min(index, f.defense.length - 1)], a = f.attack[Math.min(index, f.attack.length - 1)];
  const nx = d[0] + (a[0] - d[0]) * phase;
  const ny = d[1] + (a[1] - d[1]) * phase;
  // own goal line at -attackDir * HALF_LENGTH; x grows toward the opponent goal
  let wx = -attackDir * HALF_LENGTH + attackDir * nx * CONFIG.PITCH_LENGTH;
  let wy = ny * HALF_WIDTH * 0.85;
  if (index > 0) {
    // shift laterally toward the ball (compact shape), and a little along the length
    wy += ballY * 0.22;
    const ballRel = (ballX * attackDir + HALF_LENGTH) / CONFIG.PITCH_LENGTH; // 0 own goal .. 1 opp goal
    wx += attackDir * (ballRel - 0.5) * 4;
  }
  out.x = clamp(wx, -HALF_LENGTH + 0.8, HALF_LENGTH - 0.8);
  out.y = clamp(wy, -HALF_WIDTH + 0.6, HALF_WIDTH - 0.6);
  return out;
}

/** Kick-off / restart positions: everyone in own half, taker(s) at the center. */
export function kickoffPosition(f: Formation, index: number, attackDir: number, isKickingTeam: boolean, out: { x: number; y: number }) {
  const d = f.defense[Math.min(index, f.defense.length - 1)];
  const last = f.defense.length - 1;
  let nx = d[0] * 0.8, ny = d[1];
  if (index === 0) { nx = 0.04; ny = 0; }
  if (isKickingTeam) {
    if (index === last) { nx = 0.49; ny = 0.0; }
    else if (index === last - 1) { nx = 0.44; ny = 0.18; }
  } else if (index === last) { nx = 0.36; }
  out.x = -attackDir * HALF_LENGTH + attackDir * nx * CONFIG.PITCH_LENGTH;
  out.y = ny * HALF_WIDTH * 0.85;
  return out;
}
