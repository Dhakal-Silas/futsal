import { CONFIG } from '../config';
import { damp } from '../core/math';
import type { Match } from '../sim/match';
import type { Player, TeamIndex } from '../sim/types';
import { PlayerBrain } from './brain';

export type TeamState = 'attack' | 'defend' | 'loose';

/**
 * Team-level coordinator: assigns roles every ~250 ms (one chaser, optional second presser,
 * markers, runner, supporters) and runs each AI player's brain.
 */
export class TeamAI {
  roleTimer = 0;
  state: TeamState = 'loose';
  /** 0 = deep defensive shape, 1 = full attack shape */
  phaseBlend = 0.5;
  perceivedX = 0; perceivedY = 0; perceivedVX = 0; perceivedVY = 0;
  private perceiveTimer = 0;
  brains: PlayerBrain[] = [];

  constructor(public match: Match, public team: TeamIndex) {
    for (const p of match.sim.players) if (p.team === team && !p.isKeeper) this.brains.push(new PlayerBrain(match, this, p));
  }

  get params() { return this.match.params[this.team]; }
  get players() { return this.match.sim.players.filter((p) => p.team === this.team); }
  get opponents() { return this.match.sim.players.filter((p) => p.team !== this.team); }

  reset() {
    this.roleTimer = 0; this.perceiveTimer = 0;
    const b = this.match.ball;
    this.perceivedX = b.x; this.perceivedY = b.y; this.perceivedVX = 0; this.perceivedVY = 0;
    for (const br of this.brains) br.reset();
  }

  update(dt: number) {
    const m = this.match;
    const b = m.ball;
    // delayed perception of the ball (reaction time)
    this.perceiveTimer -= dt;
    if (this.perceiveTimer <= 0) {
      this.perceiveTimer = this.params.reactionTime * (0.7 + 0.6 * m.sim.rng.next());
      this.perceivedX = b.x; this.perceivedY = b.y; this.perceivedVX = b.vx; this.perceivedVY = b.vy;
    }
    const owner = b.owner >= 0 ? m.player(b.owner) : null;
    const newState: TeamState = owner ? (owner.team === this.team ? 'attack' : 'defend') : 'loose';
    const target = newState === 'attack' ? 1 : newState === 'defend' ? 0 : 0.45;
    this.phaseBlend = damp(this.phaseBlend, target, 1.5, dt);
    this.roleTimer -= dt;
    if (newState !== this.state || this.roleTimer <= 0) {
      this.state = newState;
      this.roleTimer = CONFIG.AI_ROLE_UPDATE_INTERVAL;
      this.assignRoles(owner);
    }
    for (const br of this.brains) {
      const p = br.player;
      if (p.controlledBy >= 0) { p.role = 'Human'; continue; }
      br.update(dt);
    }
  }

  private assignRoles(owner: Player | null) {
    const m = this.match;
    const mine = this.players.filter((p) => !p.isKeeper);
    const opps = this.opponents;
    const bx = this.perceivedX, by = this.perceivedY;
    const dir = m.attackDir(this.team);
    for (const p of mine) { p.markId = -1; }
    const humanId = m.activeIds[this.team];
    if (this.state === 'attack' && owner) {
      let runner: Player | null = null, best = -Infinity;
      for (const p of mine) {
        if (p === owner) { p.role = 'Carrier'; continue; }
        p.role = 'SupportAttack';
        const adv = p.x * dir + (p.index === m.teamSize - 1 ? 3 : 0);
        if (adv > best) { best = adv; runner = p; }
      }
      if (runner && runner !== owner && runner.x * dir < (CONFIG.PITCH_LENGTH / 2) - 4) runner.role = 'MakeRun';
      return;
    }
    // defend / loose: sort by distance to the (perceived) ball
    const sorted = [...mine].sort((p, q) => Math.hypot(p.x - bx, p.y - by) - Math.hypot(q.x - bx, q.y - by));
    const pressRole = this.state === 'loose' ? 'ChaseBall' : 'PressBallCarrier';
    let pressers = 0;
    // a pass is on its way to one of us: that player collects it
    const lp = m.lastPass;
    if (this.state === 'loose' && lp && lp.team === this.team && lp.targetId >= 0 && m.sim.time - lp.t < 2.5) {
      const receiver = mine.find((p) => p.id === lp.targetId);
      if (receiver && receiver.id !== humanId) {
        receiver.role = 'ChaseBall'; pressers++;
        const idx = sorted.indexOf(receiver); if (idx >= 0) sorted.splice(idx, 1);
      }
    }
    const humanPress = m.humanPress[this.team];
    const maxPressers = (this.params.pressAggression > 0.7 || humanPress) ? 2 : 1;
    for (const p of sorted) {
      if (p.id === humanId) { pressers++; continue; } // the human counts as the first presser
      const dBall = Math.hypot(p.x - bx, p.y - by);
      // a second presser only joins when already close to the ball
      if (pressers < maxPressers && (pressers === 0 || dBall < 6)) { p.role = pressRole; pressers++; }
      else p.role = 'Defend';
    }
    // marking: assign the most dangerous unmarked opponents (closest to our goal) to defenders
    const ownGoalX = -dir * CONFIG.PITCH_LENGTH / 2;
    const danger = opps.filter((o) => !o.isKeeper && o !== owner).sort((a, b) => Math.hypot(a.x - ownGoalX, a.y) - Math.hypot(b.x - ownGoalX, b.y));
    const defenders = mine.filter((p) => p.role === 'Defend' && p.id !== humanId);
    for (const o of danger) {
      let bestD: Player | null = null, bd = Infinity;
      for (const d of defenders) {
        if (d.markId >= 0) continue;
        const dist = Math.hypot(d.x - o.x, d.y - o.y);
        if (dist < bd) { bd = dist; bestD = d; }
      }
      if (bestD) bestD.markId = o.id;
    }
  }
}
