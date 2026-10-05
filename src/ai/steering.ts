import { CONFIG } from '../config';
import type { Player, PlayerCommand } from '../sim/types';

/** Arrive steering: fills cmd.move toward (tx,ty), slowing within `slowRadius`. Returns distance. */
export function arrive(p: Player, cmd: PlayerCommand, tx: number, ty: number, slowRadius = 1.2, stopRadius = 0.25): number {
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < stopRadius) { cmd.moveX = 0; cmd.moveY = 0; return d; }
  const k = d < slowRadius ? Math.max(0.25, d / slowRadius) : 1;
  cmd.moveX = (dx / d) * k; cmd.moveY = (dy / d) * k;
  return d;
}

/** Point where the player can intercept the rolling ball (first reachable future position). */
export function interceptPoint(p: Player, bx: number, by: number, bvx: number, bvy: number, out: { x: number; y: number }, maxSpeed: number = CONFIG.PLAYER_SPRINT_SPEED) {
  let x = bx, y = by, vx = bvx, vy = bvy;
  const step = 1 / 20;
  for (let t = 0; t < 2.5; t += step) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d / maxSpeed <= t + 0.08) { out.x = x; out.y = y; return t; }
    x += vx * step; y += vy * step;
    const sp = Math.hypot(vx, vy);
    if (sp > 0) {
      const keep = Math.pow(CONFIG.BALL_GROUND_FRICTION, step);
      let nsp = sp * keep - CONFIG.BALL_ROLL_DECEL * step;
      if (nsp < 0) nsp = 0;
      vx *= nsp / sp; vy *= nsp / sp;
    }
  }
  out.x = x; out.y = y; return 2.5;
}

/** Nearest distance from (x,y) to any player in the list (optionally excluding one). */
export function nearestDist(x: number, y: number, list: Player[], exclude?: Player): number {
  let best = Infinity;
  for (const o of list) { if (o === exclude) continue; const d = Math.hypot(o.x - x, o.y - y); if (d < best) best = d; }
  return best;
}
export function nearestPlayer(x: number, y: number, list: Player[], exclude?: Player): Player | null {
  let best: Player | null = null, bd = Infinity;
  for (const o of list) { if (o === exclude) continue; const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = o; } }
  return best;
}
