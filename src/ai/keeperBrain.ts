import { CONFIG, HALF_LENGTH } from '../config';
import { clamp, pointSegmentDist } from '../core/math';
import type { Match } from '../sim/match';
import { choosePassTarget, makeKick } from '../sim/kicks';
import { gainPossession, startAction } from '../sim/player';
import type { Player, TeamIndex } from '../sim/types';
import { arrive } from './steering';
import { saveProbability } from './evaluate';
import { launchBall } from '../sim/ball';

/** Automatic goalkeeper: positioning, reaction, dives, catches/parries, distribution. */
export class KeeperBrain {
  keeper: Player;
  skill: number;
  threat = false;
  reaction = 0;
  diveWillSave = false;
  diveT = 0;
  constructor(public match: Match, public team: TeamIndex) {
    this.keeper = match.sim.players.find((p) => p.team === team && p.isKeeper)!;
    const teamSkill = clamp((match.team(team).ratings.keeper - 75) / 25, 0, 1);
    const diff = match.params[team].keeperSkill;
    this.skill = match.isHuman(team) ? teamSkill * 0.75 + 0.2 : teamSkill * 0.4 + diff * 0.6;
    this.keeper.diveSuccessChance = this.skill;
  }

  reset() { this.threat = false; this.reaction = 0; this.keeper.holdTimer = 0; }

  get goalX() { return -this.match.attackDir(this.team) * HALF_LENGTH; }

  update(dt: number) {
    const m = this.match, k = this.keeper, b = m.ball;
    const cmd = m.sim.command(k.id);
    const dir = m.attackDir(this.team);
    const gx = this.goalX;
    if (k.holdTimer > 0) k.holdTimer -= dt;
    if (m.phase !== 'play' && m.phase !== 'restart' && m.phase !== 'kickoff') { cmd.moveX = 0; cmd.moveY = 0; return; }

    // holding the ball: distribute when the timer runs out
    if (b.owner === k.id) {
      cmd.hasFace = true; cmd.faceX = dir; cmd.faceY = 0;
      // step toward the edge of the area while holding
      const tx = gx + dir * 3.2, ty = clamp(k.y, -3, 3);
      if (m.phase === 'play' || (m.restart && m.restart.ready)) arrive(k, cmd, tx, ty, 1, 0.3);
      if (k.holdTimer <= 0 && k.action === 'none') {
        const mates = m.sim.teammates(this.team), opps = m.sim.opponents(this.team);
        const choice = choosePassTarget(k, mates, opps, dir, 0, 'pass', dir);
        if (choice.target && Math.hypot(choice.target.x - k.x, choice.target.y - k.y) < 20) {
          const speed = clamp(6 + Math.hypot(choice.target.x - k.x, choice.target.y - k.y) * 0.7, 9, CONFIG.KEEPER_THROW_SPEED + 3);
          cmd.kick = makeKick('throw', 0.6, choice.aimX, choice.aimY, choice.target.id, 0.03, speed, 0.2);
        } else {
          const ay = (m.sim.rng.next() - 0.5) * 0.8;
          cmd.kick = makeKick('clear', 1, dir, ay, -1, 0.08, CONFIG.KEEPER_KICK_SPEED, 0.45);
        }
      }
      return;
    }
    if (m.phase !== 'play') {
      const r = m.restart;
      if (r && r.takerId === k.id && !r.ready) { const d = arrive(k, cmd, r.x + dir * 0.4, r.y, 0.6, 0.2); cmd.sprint = d > 2; return; }
      this.position(cmd, dt); return;
    }

    // diving: check if the hands reach the ball
    if (k.action === 'dive') {
      const hx = k.x + k.diveX * 1.3, hy = k.y + k.diveY * 1.3;
      const d = pointSegmentDist(b.x, b.y, k.x, k.y, hx, hy);
      if (b.owner < 0 && d < 0.9 && b.z < 2.3 && this.diveWillSave && b.kickCooldown < 0.2) this.save(b.z);
      return;
    }
    if (k.action !== 'none') return;

    const loose = b.owner < 0;
    const distBall = Math.hypot(b.x - k.x, b.y - k.y);
    const distGoalBall = Math.hypot(b.x - gx, b.y);
    const towardGoal = b.vx * dir < -1;

    // catch a slow/loose ball nearby
    if (loose && distBall < CONFIG.KEEPER_CATCH_RADIUS && b.z < 1.8 && b.speed < 12 && b.kickCooldown <= 0) {
      this.catchBall(); return;
    }

    // shot detection
    if (loose && towardGoal && b.speed > 7) {
      const tG = (gx - b.x) / b.vx;
      if (tG > 0 && tG < 1.6) {
        const yG = b.y + b.vy * tG;
        const zG = Math.max(0, b.z + b.vz * tG - 0.5 * CONFIG.BALL_GRAVITY * tG * tG);
        const onTarget = Math.abs(yG) < CONFIG.GOAL_WIDTH / 2 + 0.7 && (zG < CONFIG.GOAL_HEIGHT + 0.4 || b.vz < 0);
        if (onTarget) {
          if (!this.threat) {
            this.threat = true;
            this.reaction = CONFIG.KEEPER_REACTION_BASE + (1 - this.skill) * 0.22 + m.sim.rng.next() * 0.05;
            // reflex saves: react faster when the ball arrives sooner (lower save chance handled by distance)
            this.reaction = Math.min(this.reaction, Math.max(0.03, tG * 0.4));
          }
          this.reaction -= dt;
          if (this.reaction <= 0) { this.decideSave(yG, zG, tG); return; }
          // while reacting: set stance toward the ball
          cmd.moveX = 0; cmd.moveY = 0; cmd.hasFace = true; cmd.faceX = b.x - k.x; cmd.faceY = b.y - k.y;
          return;
        }
      }
    } else this.threat = false;

    // come out to collect a loose ball in the area if we are closest
    if (loose && distGoalBall < CONFIG.PENALTY_AREA_RADIUS + 1.5 && b.speed < 7) {
      const nearestOpp = m.sim.opponents(this.team).reduce((acc, o) => Math.min(acc, Math.hypot(o.x - b.x, o.y - b.y)), Infinity);
      if (distBall < nearestOpp - 0.5 || distBall < 2) {
        const d = arrive(k, cmd, b.x + b.vx * 0.2, b.y + b.vy * 0.2, 0.5, 0.1);
        cmd.sprint = d > 2;
        return;
      }
    }
    this.position(cmd, dt);
  }

  private position(cmd: ReturnType<Match['sim']['command']>, dt: number) {
    const m = this.match, k = this.keeper, b = m.ball;
    const dir = m.attackDir(this.team);
    const gx = this.goalX;
    const bx = b.x, by = b.y;
    const dx = bx - gx, dy = by;
    const d = Math.hypot(dx, dy) || 1;
    const onOurHalf = bx * dir < 0;
    const closeness = clamp((18 - d) / 18, 0, 1);
    let depth = CONFIG.KEEPER_LINE_DEPTH + closeness * CONFIG.KEEPER_MAX_STEP_OUT * (onOurHalf ? 1 : 0.35);
    // narrow the angle when an opponent is through on goal
    const owner = b.owner >= 0 ? m.player(b.owner) : null;
    if (owner && owner.team !== this.team && d < 9) depth += 1.0 + (9 - d) * 0.25;
    depth = Math.min(depth, d - 1.6);
    let tx = gx + (dx / d) * depth, ty = (dy / d) * depth;
    ty = clamp(ty, -CONFIG.GOAL_WIDTH / 2 - 0.5, CONFIG.GOAL_WIDTH / 2 + 0.5);
    tx = clamp(tx, Math.min(gx, gx + dir * 7), Math.max(gx, gx + dir * 7));
    if (m.phase !== 'play') { tx = gx + dir * 1.2; ty = 0; }
    arrive(k, cmd, tx, ty, 0.8, 0.12);
    cmd.hasFace = true; cmd.faceX = bx - k.x; cmd.faceY = by - k.y;
  }

  private decideSave(yG: number, zG: number, tG: number) {
    const m = this.match, k = this.keeper, b = m.ball;
    const cmd = m.sim.command(k.id);
    this.threat = false;
    // intercept at the keeper's x plane
    const tI = clamp((k.x - b.x) / (b.vx || 1e-6), 0, tG);
    const yI = b.y + b.vy * tI;
    const zI = Math.max(0, b.z + b.vz * tI - 0.5 * CONFIG.BALL_GRAVITY * tI * tI);
    const offset = Math.abs(yI - k.y);
    const distance = Math.hypot(b.x - k.x, b.y - k.y);
    const p = saveProbability(b.speed, offset, yG, zI, this.skill, distance);
    this.diveWillSave = m.sim.rng.next() < p;
    if (offset < 0.45 && zI < 1.9) {
      // no need to dive: catch when it arrives (or let it through on a failed roll)
      if (this.diveWillSave) { this.catchWhenClose = true; }
      else { this.catchWhenClose = false; this.dodge = true; }
      cmd.moveX = 0; cmd.moveY = 0;
      cmd.dive = { x: k.x + (b.x - k.x) * 0.2, y: yI + (this.diveWillSave ? 0 : (yI > k.y ? -1 : 1) * 0.9) };
      cmd.dive = null;
      // a small dive/stance even for central shots looks better
      cmd.dive = { x: k.x, y: this.diveWillSave ? yI : k.y + (yI >= k.y ? -0.6 : 0.6) };
      return;
    }
    // dive toward the intercept point (or deliberately short / wrong side when the roll fails)
    const side = yI > k.y ? 1 : -1;
    let ty = yI;
    if (!this.diveWillSave) {
      const wrongSide = m.sim.rng.next() < 0.35;
      ty = wrongSide ? k.y - side * 1.2 : k.y + side * Math.max(0.4, offset - 1.3);
    }
    cmd.dive = { x: k.x + (b.x - k.x) * 0.15, y: ty };
  }
  private catchWhenClose = false;
  private dodge = false;

  private catchBall() {
    const m = this.match, k = this.keeper, b = m.ball;
    gainPossession(k, b, m.sim);
    b.vx = 0; b.vy = 0; b.vz = 0; b.z = 0;
    startAction(k, 'catch', 0.4);
    k.holdTimer = CONFIG.KEEPER_HOLD_TIME;
    this.threat = false;
    m.events.push({ type: 'catch', team: this.team, playerId: k.id, x: k.x, y: k.y, strength: 0.4 });
  }

  private save(height: number) {
    const m = this.match, k = this.keeper, b = m.ball;
    const r = m.sim.rng.next();
    const dir = m.attackDir(this.team);
    m.stats[this.team].saves++;
    if (b.kickType === 'shoot' && b.lastTouchTeam !== this.team && b.lastTouchTeam >= 0) m.stats[b.lastTouchTeam as TeamIndex].shotsOnTarget++;
    m.events.push({ type: 'save', team: this.team, playerId: k.id, x: k.x, y: k.y, strength: 1 });
    if (r < 0.42 && height < 1.6) {
      // hold
      gainPossession(k, b, m.sim);
      b.vx = 0; b.vy = 0; b.vz = 0;
      k.holdTimer = CONFIG.KEEPER_HOLD_TIME;
      this.diveWillSave = false;
      k.action = 'catch'; k.actionT = 0; k.actionDur = 0.5;
    } else if (r < 0.82) {
      // parry away to the side / forward
      const side = k.diveY >= 0 ? 1 : -1;
      launchBall(b, dir * 0.6 + (m.sim.rng.next() - 0.5) * 0.4, side * 0.8, 7 + m.sim.rng.next() * 4, 0.25, k.id, this.team, 'tap');
    } else {
      // spill: the ball drops near the keeper
      launchBall(b, dir, (m.sim.rng.next() - 0.5), 3, 0.3, k.id, this.team, 'tap');
    }
    this.diveWillSave = false;
  }
}
