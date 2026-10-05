import { CONFIG, HALF_LENGTH } from '../config';
import { clamp } from '../core/math';
import type { Match } from './match';
import { makeKick } from './kicks';
import { placePlayer, startAction, gainPossession } from './player';
import { resetBall } from './ball';
import type { Player, TeamIndex } from './types';

export interface PenaltyInput { aimX: number; aimY: number; shootHeld: boolean; shootPressed: boolean; shootReleased: boolean; }

/**
 * Penalty shootout. The shooter aims with the move keys (left/right across the goal, up/down for
 * height) and charges a shot; the keeper dives with a probability of guessing right.
 */
export class PenaltyShootout {
  order: [TeamIndex, TeamIndex];
  round = 0;
  turn: TeamIndex;
  scores: [number, number] = [0, 0];
  taken: [number, number] = [0, 0];
  history: [('scored' | 'missed')[], ('scored' | 'missed')[]] = [[], []];
  stage: 'setup' | 'aiming' | 'shot' | 'result' | 'done' = 'setup';
  timer = 0;
  shooterId = -1; keeperId = -1;
  result: 'scored' | 'missed' | null = null;
  winner: TeamIndex | -1 = -1;
  aimX = 0; aimY = 0.3; // -1..1 across the goal, 0..1 height
  power = 0; charging = false;
  input: [PenaltyInput, PenaltyInput] = [this.emptyInput(), this.emptyInput()];
  shotTeam: TeamIndex = 0;
  keeperSave = false;
  cpuTimer = 0;
  /** the goal used for the shootout: always goal at +x side so the camera is fixed */
  goalDir = 1;
  done = false;

  constructor(public match: Match) {
    const first = (match.sim.rng.next() < 0.5 ? 0 : 1) as TeamIndex;
    this.order = [first, first === 0 ? 1 : 0];
    this.turn = first;
    this.setupKick();
  }
  private emptyInput(): PenaltyInput { return { aimX: 0, aimY: 0, shootHeld: false, shootPressed: false, shootReleased: false }; }

  get shooter() { return this.match.player(this.shooterId); }
  get keeper() { return this.match.player(this.keeperId); }

  private setupKick() {
    const m = this.match;
    const team = this.turn;
    const def = (team === 0 ? 1 : 0) as TeamIndex;
    const sim = m.sim;
    // attack direction for this shot is +x; set the attack dirs so helpers agree
    sim.attackDirs = team === 0 ? [1, -1] : [-1, 1];
    const shooters = sim.players.filter((p) => p.team === team && !p.isKeeper);
    const shooter = shooters[this.taken[team] % shooters.length];
    const keeper = sim.players.find((p) => p.team === def && p.isKeeper)!;
    this.shooterId = shooter.id; this.keeperId = keeper.id;
    // everyone else at the center circle
    let i = 0;
    for (const p of sim.players) {
      if (p === shooter || p === keeper) continue;
      const row = p.team === team ? -1 : 1;
      placePlayer(p, -2 + (i % 5) * 1.1 - 2, row * 2.2 + (p.team === 0 ? -0.6 : 0.6), 0);
      i++;
    }
    const spotX = HALF_LENGTH - CONFIG.PENALTY_SPOT;
    placePlayer(shooter, spotX - 1.6, 0, 0);
    placePlayer(keeper, HALF_LENGTH - 0.6, 0, Math.PI);
    resetBall(sim.ball, spotX, 0);
    sim.ballActive = false;
    this.stage = 'aiming'; this.timer = 0; this.result = null;
    this.aimX = 0; this.aimY = 0.3; this.power = 0; this.charging = false; this.keeperSave = false;
    this.cpuTimer = 1.2 + sim.rng.next() * 1.2;
    m.activeIds[team] = m.isHuman(team) ? shooter.id : -1; m.applyControl(team);
    m.activeIds[def] = -1; m.applyControl(def);
    this.shotTeam = team;
  }

  step(dt: number) {
    const m = this.match;
    const sim = m.sim;
    const team = this.turn;
    const shooter = this.shooter, keeper = this.keeper;
    this.timer += dt;
    for (const c of sim.commands) { c.moveX = 0; c.moveY = 0; c.kick = null; c.slide = false; c.dive = null; c.sprint = false; c.hasFace = false; }
    const scmd = sim.command(shooter.id), kcmd = sim.command(keeper.id);
    scmd.hasFace = true; scmd.faceX = 1; scmd.faceY = 0;
    kcmd.hasFace = true; kcmd.faceX = -1; kcmd.faceY = 0;
    switch (this.stage) {
      case 'aiming': {
        if (sim.ball.owner !== shooter.id && shooter.action === 'none') { gainPossession(shooter, sim.ball, sim); sim.ball.vx = 0; sim.ball.vy = 0; }
        if (m.isHuman(team)) {
          const inp = this.input[m.opts.humanSlots[team]];
          this.aimX = clamp(this.aimX + inp.aimX * dt * 1.6, -1, 1);
          this.aimY = clamp(this.aimY - inp.aimY * dt * 1.2, 0, 1);
          if (inp.shootHeld) { this.charging = true; this.power = Math.min(1, this.power + dt / CONFIG.CHARGE_TIME); shooter.charging = { type: 'shoot', t: this.power }; }
          else if (this.charging) { this.fire(Math.max(0.3, this.power)); }
        } else {
          this.cpuTimer -= dt;
          const skill = m.params[team].shotNoise;
          if (this.cpuTimer <= 0) {
            this.aimX = (sim.rng.next() < 0.5 ? -1 : 1) * (0.5 + sim.rng.next() * 0.5);
            this.aimY = 0.1 + sim.rng.next() * 0.8;
            this.fire(0.65 + sim.rng.next() * 0.35, skill);
          } else { this.charging = this.cpuTimer < 0.5; this.power = this.charging ? 1 - this.cpuTimer / 0.5 : 0; shooter.charging = this.charging ? { type: 'shoot', t: this.power } : null; }
        }
        break;
      }
      case 'shot': {
        sim.ballActive = true;
        const b = sim.ball;
        // keeper dive logic: when the shot is struck, dive
        if (keeper.action === 'none' && shooter.kickContactDone && this.timer > 0.05) {
          const def = (team === 0 ? 1 : 0) as TeamIndex;
          const kskill = m.keepers[def].skill;
          const guessRight = sim.rng.next() < 0.35 + kskill * 0.4;
          const side = this.aimX >= 0 ? 1 : -1;
          const diveY = (guessRight ? side : -side) * Math.min(1.4, 0.5 + Math.abs(this.aimX) * 1.1);
          const central = Math.abs(this.aimX) < 0.3;
          this.keeperSave = (guessRight || central) && sim.rng.next() < (central ? 0.5 : 0.4 + kskill * 0.25) - (this.aimY > 0.7 ? 0.2 : 0) - (Math.abs(this.aimX) > 0.85 ? 0.15 : 0) - (this.power > 0.9 ? 0.1 : 0);
          kcmd.dive = { x: keeper.x - 0.3, y: central ? (sim.rng.next() < 0.5 ? 0.4 : -0.4) : diveY };
          if (central && this.keeperSave) kcmd.dive = { x: keeper.x, y: 0.2 };
        }
        if (keeper.action === 'dive' && this.keeperSave && b.owner < 0 && Math.abs(b.x - keeper.x) < 0.9 && b.inNet < 0) {
          // save: parry the ball away
          b.vx = -Math.abs(b.vx) * 0.18; b.vy = (b.y >= 0 ? 1 : -1) * 3; b.vz = 1.5; b.x = keeper.x - 0.3;
          b.kickedBy = keeper.id; b.lastTouch = keeper.id; b.lastTouchTeam = keeper.team; b.kickCooldown = 0.5;
          this.keeperSave = false; this.resolve('missed', 'save');
          break;
        }
        if (b.inNet === 1) { this.resolve('scored', 'goal'); break; }
        if (b.x > HALF_LENGTH + 0.3 || Math.abs(b.y) > 6 || (b.speed < 0.5 && this.timer > 1.5)) { this.resolve('missed', 'miss'); break; }
        if (this.timer > 3) this.resolve('missed', 'miss');
        break;
      }
      case 'result': {
        if (this.timer > 2.2) this.next();
        break;
      }
      case 'done': this.done = true; break;
      default: break;
    }
    for (const inp of this.input) { inp.shootPressed = false; inp.shootReleased = false; }
  }

  private fire(power: number, noise = 0.02) {
    const m = this.match, sim = m.sim;
    const shooter = this.shooter;
    const gw = CONFIG.GOAL_WIDTH / 2;
    const targetY = this.aimX * (gw - 0.2); // full aim is just inside the post
    const targetZ = this.aimY * (CONFIG.GOAL_HEIGHT - 0.3);
    const dx = HALF_LENGTH - sim.ball.x, dy = targetY - sim.ball.y;
    const d = Math.hypot(dx, dy);
    const speed = CONFIG.SHOT_MIN_SPEED + power * (CONFIG.SHOT_MAX_SPEED - CONFIG.SHOT_MIN_SPEED);
    const t = d / speed;
    // vertical speed so that the ball is at targetZ at the goal line (parabola)
    const vz = (targetZ + 0.5 * CONFIG.BALL_GRAVITY * t * t) / t;
    const loft = clamp(vz / speed, 0, 0.6);
    sim.command(shooter.id).kick = makeKick('shoot', power, dx / d, dy / d, -1, noise, speed, loft);
    shooter.charging = null; this.charging = false;
    this.stage = 'shot'; this.timer = 0;
    this.power = power;
  }

  private resolve(result: 'scored' | 'missed', why: string) {
    const m = this.match;
    const team = this.turn;
    this.result = result;
    this.history[team].push(result);
    this.taken[team]++;
    if (result === 'scored') { this.scores[team]++; m.events.push({ type: 'penalty_scored', team, playerId: this.shooterId, x: HALF_LENGTH, y: 0, strength: 1 }); startAction(this.shooter, 'celebrate', 2); this.shooter.celebType = 3; }
    else { m.events.push({ type: why === 'save' ? 'save' : 'penalty_missed', team, playerId: this.shooterId, x: HALF_LENGTH, y: 0, strength: 1 }); }
    m.banner = { text: result === 'scored' ? 'GOAL' : why === 'save' ? 'SAVED!' : 'MISSED', sub: `${this.scores[0]} - ${this.scores[1]}`, t: 2, color: result === 'scored' ? m.team(team).kit.primary : '#fff' };
    this.stage = 'result'; this.timer = 0;
    m.sim.ballActive = false;
  }

  private next() {
    const [a, b] = this.order;
    const remaining = (t: TeamIndex) => Math.max(0, 5 - this.taken[t]);
    // decided early?
    const lead = (t: TeamIndex, o: TeamIndex) => this.scores[t] > this.scores[o] + remaining(o);
    if (this.taken[a] >= 5 && this.taken[b] >= 5 && this.taken[a] === this.taken[b]) {
      if (this.scores[a] !== this.scores[b]) { this.finish(this.scores[a] > this.scores[b] ? a : b); return; }
    } else if (lead(a, b)) { this.finish(a); return; }
    else if (lead(b, a)) { this.finish(b); return; }
    this.turn = this.turn === a ? b : a;
    if (this.turn === a) this.round++;
    this.setupKick();
  }

  private finish(w: TeamIndex) {
    this.winner = w; this.stage = 'done'; this.done = true;
    this.match.winner = w; this.match.phaseT = 0;
    this.match.banner = { text: `${this.match.team(w).short} WIN ON PENALTIES`, sub: `${this.scores[0]} - ${this.scores[1]}`, t: 3, color: this.match.team(w).kit.primary };
  }

  get suddenDeath() { return this.taken[0] >= 5 && this.taken[1] >= 5; }
  playersOf(t: TeamIndex): Player[] { return this.match.sim.players.filter((p) => p.team === t); }
}
