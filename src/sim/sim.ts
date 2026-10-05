import { CONFIG } from '../config';
import { Rng } from '../core/rng';
import type { Ball, Kick, MatchEvent, Player, PlayerCommand, TeamIndex } from './types';
import { emptyCommand } from './types';
import { createBall, stepBall } from './ball';
import { stepPlayer, updatePossession, type SimContext } from './player';

/**
 * Minimal simulation world: players + ball + commands. The Match (rules, phases) wraps this.
 */
export class SimWorld implements SimContext {
  ball: Ball = createBall();
  players: Player[] = [];
  commands: PlayerCommand[] = [];
  rng: Rng;
  events: MatchEvent[] = [];
  ballActive = true;
  /** +1 if team attacks toward +x */
  attackDirs: [number, number] = [1, -1];
  time = 0;
  onKick?: (p: Player, kick: Kick) => void;
  onFoul?: (tackler: Player, victim: Player) => void;
  onTackleWon?: (tackler: Player, victim: Player) => void;

  constructor(seed = 1) { this.rng = new Rng(seed); }

  attackDir(team: TeamIndex) { return this.attackDirs[team]; }

  addPlayer(p: Player) {
    p.id = this.players.length;
    this.players.push(p);
    this.commands.push(emptyCommand());
    return p;
  }

  command(id: number) { return this.commands[id]; }

  clearCommands() {
    for (const c of this.commands) { c.moveX = 0; c.moveY = 0; c.sprint = false; c.kick = null; c.slide = false; c.hasFace = false; c.dive = null; }
  }

  step(dt: number) {
    this.time += dt;
    for (let i = 0; i < this.players.length; i++) stepPlayer(this.players[i], this.commands[i], this, dt);
    updatePossession(this, dt);
    stepBall(this.ball, dt, this.events);
  }

  teammates(team: TeamIndex) { return this.players.filter((p) => p.team === team); }
  opponents(team: TeamIndex) { return this.players.filter((p) => p.team !== team); }
  nearestPlayerTo(x: number, y: number, team?: TeamIndex, excludeKeeper = false): Player | null {
    let best: Player | null = null, bd = Infinity;
    for (const p of this.players) {
      if (team !== undefined && p.team !== team) continue;
      if (excludeKeeper && p.isKeeper) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}

export const TICK = CONFIG.TICK_DT;
