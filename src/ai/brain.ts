import { CONFIG, HALF_LENGTH, HALF_WIDTH } from '../config';
import { clamp } from '../core/math';
import type { Match } from '../sim/match';
import { assistedShotDir, makeKick, passSpeedForDistance } from '../sim/kicks';
import type { Kick, Player, PlayerCommand } from '../sim/types';
import type { TeamAI } from './coordinator';
import { clearScore, dribbleScore, passOptions, shootScore, type PassOption } from './evaluate';
import { arrive, interceptPoint, nearestDist, nearestPlayer } from './steering';

const tmp = { x: 0, y: 0 };
const opts: PassOption[] = [];

/** Outfield player state machine + steering. Writes the player's PlayerCommand each tick. */
export class PlayerBrain {
  decisionTimer = 0;
  sprintDecision = false;
  dribbleX = 1; dribbleY = 0;
  slideTimer = 0;
  commit = false;
  supportOffsetX = 0; supportOffsetY = 0;
  supportTimer = 0;

  constructor(public match: Match, public team: TeamAI, public player: Player) {}

  reset() { this.decisionTimer = 0; this.sprintDecision = false; this.supportTimer = 0; }

  get params() { return this.team.params; }

  update(dt: number) {
    const m = this.match;
    const p = this.player;
    const cmd = m.sim.command(p.id);
    const par = this.params;
    if (p.hasBall && !this.hadBall) this.lastReceive = m.sim.time;
    this.hadBall = p.hasBall;
    this.decisionTimer -= dt;
    this.slideTimer -= dt;
    const decide = this.decisionTimer <= 0;
    if (decide) {
      this.decisionTimer = par.decisionInterval * (0.8 + 0.4 * m.sim.rng.next());
      this.sprintDecision = m.sim.rng.next() < par.sprintUsage && p.stamina > 25;
    }

    switch (m.phase) {
      case 'kickoff': case 'restart': this.restartBehaviour(cmd, decide); return;
      case 'foul': cmd.moveX = 0; cmd.moveY = 0; return;
      case 'play': break;
      default: return;
    }

    const b = m.ball;
    const dir = m.attackDir(p.team);
    switch (p.role) {
      case 'Carrier': this.carrier(cmd, decide, dt); break;
      case 'ChaseBall': {
        const t = interceptPoint(p, this.team.perceivedX, this.team.perceivedY, this.team.perceivedVX, this.team.perceivedVY, tmp);
        const d = arrive(p, cmd, tmp.x, tmp.y, 0.6, 0.15);
        cmd.sprint = d > 2.5 && (this.sprintDecision || t > 0.6);
        break;
      }
      case 'PressBallCarrier': this.press(cmd, decide); break;
      case 'Defend': this.defend(cmd); break;
      case 'SupportAttack': this.support(cmd, dt); break;
      case 'MakeRun': {
        const carrier = b.owner >= 0 ? m.player(b.owner) : null;
        const cx = carrier ? carrier.x : b.x;
        let tx = clamp(cx + dir * 9, -HALF_LENGTH + 2, HALF_LENGTH - 3);
        m.anchor(p, 1, tmp);
        let ty = tmp.y;
        // run into the half-space away from the nearest opponent
        const near = nearestPlayer(tx, ty, this.team.opponents);
        if (near && Math.hypot(near.x - tx, near.y - ty) < 2.5) ty += (ty > near.y ? 1 : -1) * 2.5;
        ty = clamp(ty, -HALF_WIDTH + 1, HALF_WIDTH - 1);
        const d = arrive(p, cmd, tx, ty, 1.5, 0.4);
        cmd.sprint = d > 3 && this.sprintDecision;
        break;
      }
      case 'ReturnToFormation': default: {
        m.anchor(p, this.team.phaseBlend, tmp);
        arrive(p, cmd, tmp.x, tmp.y, 1.5, 0.4);
        break;
      }
    }
    // when stationary, face the ball
    if (Math.hypot(cmd.moveX, cmd.moveY) < 0.1) { cmd.hasFace = true; cmd.faceX = b.x - p.x; cmd.faceY = b.y - p.y; }
    this.stayOnPitch(cmd);
  }

  private stayOnPitch(cmd: PlayerCommand) {
    const p = this.player;
    if (p.x > HALF_LENGTH - 0.3 && cmd.moveX > 0) cmd.moveX = 0;
    if (p.x < -HALF_LENGTH + 0.3 && cmd.moveX < 0) cmd.moveX = 0;
    if (p.y > HALF_WIDTH - 0.3 && cmd.moveY > 0) cmd.moveY = 0;
    if (p.y < -HALF_WIDTH + 0.3 && cmd.moveY < 0) cmd.moveY = 0;
  }

  /* ---------------------------------------------------------------- carrier */

  private carrier(cmd: PlayerCommand, decide: boolean, dt: number) {
    const m = this.match, p = this.player, par = this.params;
    const dir = m.attackDir(p.team);
    const teammates = this.team.players, opponents = this.team.opponents;
    if (decide) {
      const shoot = shootScore(p, opponents, dir, par.shootEagerness);
      passOptions(p, teammates, opponents, dir, par.throughPassSkill, opts);
      const drib = dribbleScore(p, opponents, dir);
      const clear = clearScore(p, opponents, dir);
      const rng = m.sim.rng;
      const bestPass = opts.length ? opts[0] : null;
      // a bit of randomness so the AI is not fully predictable
      const jitter = () => (rng.next() - 0.5) * 0.2;
      const sShoot = shoot.score + jitter(), sPass = (bestPass ? bestPass.score : 0) + jitter(), sDrib = drib.score + jitter(), sClear = clear + jitter();
      const pressure = nearestDist(p.x, p.y, opponents);
      // hold the ball briefly after receiving it (looks natural), unless under pressure or a great chance
      const held = m.sim.time - this.lastReceive;
      const justGot = held < 0.35 && sShoot < 0.9;
      (globalThis as any).__aiLog?.(`t=${m.sim.time.toFixed(1)} p=${p.team}/${p.index} held=${held.toFixed(2)} press=${pressure.toFixed(1)} shoot=${sShoot.toFixed(2)} pass=${sPass.toFixed(2)} drib=${sDrib.toFixed(2)} clear=${sClear.toFixed(2)} justGot=${justGot} xdir=${(p.x*dir).toFixed(1)}`);
      if (!justGot) {
        if (sShoot > 0.5 && sShoot >= sPass * 0.8) { cmd.kick = this.makeShot(shoot.aimY); return; }
        if (sClear > 0.6 && sClear > sPass) { cmd.kick = this.makeClear(); return; }
        if (bestPass && sPass > Math.max(0.6, sDrib + 0.12)) { cmd.kick = this.makePass(bestPass); return; }
        if (bestPass && held > 2.5 && sPass > 0.45) { cmd.kick = this.makePass(bestPass); return; }
      }
      this.dribbleX = drib.dirX; this.dribbleY = drib.dirY;
    }
    // dribble
    cmd.moveX = this.dribbleX; cmd.moveY = this.dribbleY;
    const space = nearestDist(p.x + this.dribbleX * 3, p.y + this.dribbleY * 3, opponents);
    cmd.sprint = space > 5 && this.sprintDecision && p.stamina > 30;
  }
  lastReceive = -10;
  hadBall = false;

  private noise(base: number) { return base * (1.25 - this.player.skill * 0.5); }

  private makeShot(aimY: number): Kick {
    const m = this.match, p = this.player, par = this.params;
    const dir = m.attackDir(p.team);
    const gx = dir * HALF_LENGTH;
    const d = Math.hypot(gx - p.x, aimY - p.y);
    const power = clamp(0.45 + d / 25 + m.sim.rng.next() * 0.25, 0.4, 0.95);
    const a = assistedShotDir(p.x, p.y, gx - p.x, aimY - p.y, dir, 0.01);
    const k = makeKick('shoot', power, a.x, a.y, -1, this.noise(par.shotNoise));
    return k;
  }

  private makePass(o: PassOption): Kick {
    const m = this.match, p = this.player, par = this.params;
    const dx = o.leadX - p.x, dy = o.leadY - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const noise = this.noise(par.passNoise);
    if (o.type === 'cross') return makeKick('cross', clamp(d / 18, 0.4, 1), dx / d, dy / d, o.target.id, noise * 1.3);
    if (o.type === 'through') return makeKick('through', 0.7, dx / d, dy / d, o.target.id, noise, passSpeedForDistance(d, 'through') * 1.1);
    return makeKick('pass', 0.5, dx / d, dy / d, o.target.id, noise, passSpeedForDistance(d, 'pass'), 0);
  }

  private makeClear(): Kick {
    const m = this.match, p = this.player;
    const dir = m.attackDir(p.team);
    const ang = (m.sim.rng.next() - 0.5) * 1.2;
    const ax = dir * Math.cos(ang), ay = Math.sin(ang) * (p.y > 0 ? 1 : -1) * 0.8;
    return makeKick('clear', 1, ax, ay, -1, 0.1);
  }

  /* ---------------------------------------------------------------- defending */

  private press(cmd: PlayerCommand, decide: boolean) {
    const m = this.match, p = this.player, par = this.params;
    const b = m.ball;
    const dir = m.attackDir(p.team);
    const carrier = b.owner >= 0 ? m.player(b.owner) : null;
    const bx = this.team.perceivedX, by = this.team.perceivedY;
    // target: a point goal-side of the ball; jockey at a distance unless committing to win it
    const goalX = -dir * HALF_LENGTH;
    if (decide) this.commit = m.sim.rng.next() < 0.25 + par.pressAggression * 0.5 || !carrier;
    const jockeyDist = this.commit ? 0.2 : 2.3 - par.pressAggression * 1.0;
    const tgx = bx - dir * jockeyDist, tgy = by + (0 - by) * 0.08;
    const dBall = Math.hypot(b.x - p.x, b.y - p.y);
    const d = arrive(p, cmd, tgx, tgy, 1.0, 0.2);
    cmd.sprint = d > 3 && (this.sprintDecision || par.pressAggression > 0.7);
    if (dBall < 2.2 && !this.commit) {
      // jockey: slow and face the ball
      cmd.moveX *= 0.6; cmd.moveY *= 0.6;
      cmd.hasFace = true; cmd.faceX = b.x - p.x; cmd.faceY = b.y - p.y;
    }
    // slide tackle when the timing is good
    if (decide && carrier && this.slideTimer <= 0 && p.slideCooldown <= 0) {
      const relx = b.x - p.x, rely = b.y - p.y;
      const dist = Math.hypot(relx, rely);
      const facing = (relx * Math.cos(p.heading) + rely * Math.sin(p.heading)) / (dist || 1);
      const carrierAway = (carrier.vx * dir) < 1.0; // not sprinting past us
      const nearOwnGoal = Math.abs(p.x - goalX) < 9;
      if (dist > 0.9 && dist < 2.1 && facing > 0.75 && carrierAway) {
        const quality = par.tackleTiming * (nearOwnGoal ? 1.2 : 0.8) * (dist < 1.6 ? 1 : 0.7);
        if (m.sim.rng.next() < quality * 0.3) { cmd.slide = true; this.slideTimer = 4; }
      }
    }
  }

  private defend(cmd: PlayerCommand) {
    const m = this.match, p = this.player, par = this.params;
    const dir = m.attackDir(p.team);
    const goalX = -dir * HALF_LENGTH;
    m.anchor(p, this.team.phaseBlend * 0.5, tmp);
    let tx = tmp.x, ty = tmp.y;
    if (p.markId >= 0) {
      const o = m.player(p.markId);
      // between the opponent and our goal
      const gdx = goalX - o.x, gdy = -o.y;
      const gl = Math.hypot(gdx, gdy) || 1;
      const tight = 1.2 + (1 - par.markingTightness) * 2.5;
      const mx = o.x + (gdx / gl) * tight, my = o.y + (gdy / gl) * tight;
      const w = par.positionDiscipline;
      // discipline blends between pure marking and the formation anchor
      tx = mx * (1 - w * 0.35) + tx * w * 0.35;
      ty = my * (1 - w * 0.35) + ty * w * 0.35;
    }
    const d = arrive(p, cmd, tx, ty, 1.5, 0.3);
    cmd.sprint = d > 6 && this.sprintDecision;
  }

  /* ---------------------------------------------------------------- attacking support */

  private support(cmd: PlayerCommand, dt: number) {
    const m = this.match, p = this.player;
    const b = m.ball;
    const dir = m.attackDir(p.team);
    const opponents = this.team.opponents;
    this.supportTimer -= dt;
    m.anchor(p, this.team.phaseBlend, tmp);
    if (this.supportTimer <= 0) {
      this.supportTimer = 0.6 + m.sim.rng.next() * 0.4;
      // sample offsets around the anchor and pick the most open one with a clear lane from the carrier
      let bestS = -Infinity, bx = 0, by = 0;
      const carrier = b.owner >= 0 ? m.player(b.owner) : null;
      for (let i = 0; i < 7; i++) {
        const ox = i === 0 ? 0 : (m.sim.rng.next() - 0.5) * 7, oy = i === 0 ? 0 : (m.sim.rng.next() - 0.5) * 7;
        const x = clamp(tmp.x + ox, -HALF_LENGTH + 1, HALF_LENGTH - 1), y = clamp(tmp.y + oy, -HALF_WIDTH + 0.8, HALF_WIDTH - 0.8);
        let s = Math.min(6, nearestDist(x, y, opponents)) * 0.4;
        if (carrier) {
          const dc = Math.hypot(carrier.x - x, carrier.y - y);
          if (dc < 4) s -= (4 - dc);
          if (dc > 15) s -= (dc - 15) * 0.3;
          // lane from carrier
          let lane = 3;
          for (const o of opponents) {
            const abx = x - carrier.x, aby = y - carrier.y; const l2 = abx * abx + aby * aby || 1;
            const t = clamp(((o.x - carrier.x) * abx + (o.y - carrier.y) * aby) / l2, 0, 1);
            lane = Math.min(lane, Math.hypot(o.x - (carrier.x + abx * t), o.y - (carrier.y + aby * t)));
          }
          s += lane * 0.4;
        }
        s -= (Math.abs(ox) + Math.abs(oy)) * 0.08; // prefer staying near the anchor
        s += (x - tmp.x) * dir * 0.05;
        if (s > bestS) { bestS = s; bx = x - tmp.x; by = y - tmp.y; }
      }
      this.supportOffsetX = bx; this.supportOffsetY = by;
    }
    const d = arrive(p, cmd, tmp.x + this.supportOffsetX, tmp.y + this.supportOffsetY, 1.5, 0.4);
    cmd.sprint = d > 7 && this.sprintDecision;
  }

  /* ---------------------------------------------------------------- restarts */

  private restartBehaviour(cmd: PlayerCommand, decide: boolean) {
    const m = this.match, p = this.player;
    const r = m.restart;
    if (!r) return;
    const dir = m.attackDir(p.team);
    if (r.takerId === p.id) {
      if (!r.ready) { arrive(p, cmd, r.x - dir * 0.5, r.y, 0.8, 0.3); cmd.sprint = true; return; }
      cmd.hasFace = true; cmd.faceX = dir; cmd.faceY = 0;
      if (r.timer >= CONFIG.SETPIECE_AUTO_DELAY * (m.isHuman(p.team) ? 0.6 : 1) && decide) {
        // pick a pass (kick-off: short to the nearest teammate)
        const teammates = this.team.players, opponents = this.team.opponents;
        passOptions(p, teammates, opponents, dir, this.params.throughPassSkill, opts);
        let choice = opts.find((o) => o.type === 'pass' && o.target.index !== 0) ?? opts[0];
        if (r.type === 'kickoff') {
          const mate = nearestPlayer(p.x, p.y, teammates.filter((t) => t !== p && !t.isKeeper));
          if (mate) choice = { target: mate, score: 1, type: 'pass', leadX: mate.x, leadY: mate.y };
        }
        if (r.type === 'corner') {
          const inBox = teammates.filter((t) => !t.isKeeper && t !== p && Math.abs(t.x - dir * HALF_LENGTH) < 9);
          const tgt = inBox.length ? inBox[Math.floor(m.sim.rng.next() * inBox.length)] : null;
          if (tgt) { cmd.kick = makeKick('cross', 0.8, tgt.x - p.x, tgt.y - p.y, tgt.id, this.noise(this.params.passNoise)); return; }
        }
        if (choice) cmd.kick = this.makePass(choice);
        else cmd.kick = makeKick('pass', 0.5, dir, 0, -1, 0.05);
      }
      return;
    }
    // everyone else: shape up
    if (r.type === 'kickoff') { cmd.moveX = 0; cmd.moveY = 0; cmd.hasFace = true; cmd.faceX = dir; cmd.faceY = 0; return; }
    const attacking = r.team === p.team;
    if (r.type === 'corner' && attacking) {
      // crowd the box
      const gx = dir * HALF_LENGTH;
      const tx = gx - dir * (4 + (p.index % 3) * 1.5), ty = (p.index % 2 ? 1 : -1) * (1.5 + p.index * 0.5);
      arrive(p, cmd, tx, ty, 1.2, 0.4);
      return;
    }
    m.anchor(p, attacking ? 0.9 : 0.15, tmp);
    let tx = tmp.x, ty = tmp.y;
    if (!attacking) {
      const dx = tx - r.x, dy = ty - r.y;
      const d = Math.hypot(dx, dy);
      if (d < CONFIG.RESTART_OPPONENT_DISTANCE + 0.5) { tx = r.x + (dx / (d || 1)) * (CONFIG.RESTART_OPPONENT_DISTANCE + 0.5); ty = r.y + (dy / (d || 1)) * (CONFIG.RESTART_OPPONENT_DISTANCE + 0.5); }
      if (r.type === 'corner') { const gx = -dir * HALF_LENGTH; tx = gx + dir * (2.5 + (p.index % 3) * 1.5); ty = (p.index % 2 ? 1 : -1) * (1 + p.index * 0.4); }
    }
    arrive(p, cmd, tx, ty, 1.2, 0.4);
    cmd.sprint = Math.hypot(tx - p.x, ty - p.y) > 8;
  }
}
