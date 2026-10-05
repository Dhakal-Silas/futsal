import { CONFIG } from '../config';
import type { InputManager, PlayerInputState } from '../core/input';
import type { SimWorld } from '../sim/sim';
import type { KickType, Player, PlayerCommand } from '../sim/types';
import { assistedShotDir, choosePassTarget, makeKick } from '../sim/kicks';
import { interceptPoint } from '../ai/steering';
import { clamp } from '../core/math';

const tmp = { x: 0, y: 0 };

/** Translates human input into a PlayerCommand for the active player of one side. */
export class HumanController {
  activeId = -1;
  /** teammate that would receive a pass right now (for the HUD) */
  passTargetId = -1;
  chargeType: KickType | null = null;
  chargeT = 0;
  jockey = false;
  pressRequest = false;
  /** set by the session: a pass is on its way to the active player */
  receiving = false;
  constructor(public slot: 0 | 1, public team: 0 | 1, private sim: SimWorld, private input: InputManager) {}

  get inputState(): PlayerInputState { return this.input.players[this.slot]; }
  get player(): Player | null { return this.activeId >= 0 ? this.sim.players[this.activeId] : null; }

  /** Fill `cmd` for the active player. Returns the command. */
  update(dt: number, cmd: PlayerCommand): PlayerCommand {
    const p = this.player;
    const st = this.inputState;
    cmd.moveX = st.moveX; cmd.moveY = st.moveY; cmd.sprint = st.held.sprint; cmd.kick = null; cmd.slide = false; cmd.dive = null; cmd.hasFace = false;
    this.pressRequest = false; this.jockey = false;
    if (!p) return cmd;
    const ball = this.sim.ball;
    const attackDirK = this.sim.attackDir(p.team);

    // goalkeeper in hand: choose the distribution (pass = throw, shoot/cross = long kick)
    if (p.isKeeper) {
      cmd.moveX *= 0.8; cmd.moveY *= 0.8; cmd.sprint = false;
      this.passTargetId = -1;
      if (p.hasBall && p.action === 'none') {
        let ax = st.moveX, ay = st.moveY;
        if (Math.hypot(ax, ay) < 0.1) { ax = attackDirK; ay = 0; }
        const choice = choosePassTarget(p, this.sim.teammates(p.team), this.sim.opponents(p.team), ax, ay, 'pass', attackDirK);
        this.passTargetId = choice.target ? choice.target.id : -1;
        if (st.pressed.pass || st.pressed.through) {
          const d = choice.target ? Math.hypot(choice.target.x - p.x, choice.target.y - p.y) : 10;
          cmd.kick = makeKick('throw', 0.6, choice.aimX, choice.aimY, this.passTargetId, 0.02, clamp(6 + d * 0.7, 9, 16), 0.2);
        } else if (st.pressed.shoot || st.pressed.cross) {
          const l = Math.hypot(ax, ay) || 1;
          cmd.kick = makeKick('clear', 1, ax / l, ay / l, -1, 0.05, CONFIG.KEEPER_KICK_SPEED, 0.42);
        }
      }
      return cmd;
    }

    // receiving a pass: run to meet the ball unless the player deliberately steers away
    if (this.receiving && ball.owner < 0 && p.action === 'none') {
      interceptPoint(p, ball.x, ball.y, ball.vx, ball.vy, tmp, CONFIG.PLAYER_JOG_SPEED);
      const dx = tmp.x - p.x, dy = tmp.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.2) {
        const ux = dx / d, uy = dy / d;
        const il = Math.hypot(st.moveX, st.moveY);
        const dot = il > 0.3 ? (st.moveX * ux + st.moveY * uy) / il : 1;
        if (il < 0.3) { cmd.moveX = ux * Math.min(1, d / 1.2); cmd.moveY = uy * Math.min(1, d / 1.2); }
        else if (dot > -0.4) { cmd.moveX = ux * 0.6 + st.moveX * 0.4; cmd.moveY = uy * 0.6 + st.moveY * 0.4; }
        cmd.sprint = st.held.sprint && d > 3;
      } else { cmd.moveX = 0; cmd.moveY = 0; cmd.hasFace = true; cmd.faceX = ball.x - p.x; cmd.faceY = ball.y - p.y; }
    }
    const nearBall = Math.hypot(ball.x - p.x, ball.y - p.y) < CONFIG.KICK_REACH + 0.4 && ball.z < 1.4;
    const canKick = p.hasBall || (nearBall && ball.owner < 0) || (nearBall && ball.owner >= 0 && this.sim.players[ball.owner].team !== p.team && ball.z < 0.6);
    const attackDir = this.sim.attackDir(p.team);

    // aim direction: movement input, else facing
    let aimX = st.moveX, aimY = st.moveY;
    if (Math.hypot(aimX, aimY) < 0.1) { aimX = Math.cos(p.heading); aimY = Math.sin(p.heading); }

    // pass target preview
    if (p.hasBall || nearBall) {
      const choice = choosePassTarget(p, this.sim.teammates(p.team), this.sim.opponents(p.team), aimX, aimY, this.chargeType === 'through' ? 'through' : 'pass', attackDir);
      this.passTargetId = choice.target ? choice.target.id : -1;
    } else this.passTargetId = -1;

    const offense = p.hasBall || (ball.owner >= 0 && this.sim.players[ball.owner].team === p.team) || (ball.owner < 0 && nearBall);

    // start charging
    if (!this.chargeType && p.action === 'none') {
      const order: KickType[] = ['shoot', 'pass', 'through', 'cross'];
      for (const t of order) {
        const a = t === 'shoot' ? 'shoot' : t === 'pass' ? 'pass' : t === 'through' ? 'through' : 'cross';
        if (st.pressed[a] && (offense || canKick)) { this.chargeType = t; this.chargeT = 0; break; }
      }
    }
    if (this.chargeType) {
      const a = this.chargeType === 'shoot' ? 'shoot' : this.chargeType === 'pass' ? 'pass' : this.chargeType === 'through' ? 'through' : 'cross';
      this.chargeT = Math.min(CONFIG.CHARGE_TIME, this.chargeT + dt);
      p.charging = { type: this.chargeType, t: this.chargeT / CONFIG.CHARGE_TIME };
      const released = !st.held[a];
      // through passes fire quickly; shots, passes and crosses charge
      if (released || (this.chargeType === 'through' && this.chargeT >= 0.25)) {
        const power = this.chargeType === 'through' ? Math.max(0.4, this.chargeT / 0.25) : Math.max(0.15, this.chargeT / CONFIG.CHARGE_TIME);
        cmd.kick = this.buildKick(p, this.chargeType, Math.min(1, power), aimX, aimY);
        this.chargeType = null; p.charging = null;
      }
    } else p.charging = null;

    if (!offense) {
      // defensive context
      if (st.pressed.slide) cmd.slide = true;
      if (st.held.shoot) { this.jockey = true; cmd.moveX *= 0.6; cmd.moveY *= 0.6; cmd.hasFace = true; cmd.faceX = ball.x - p.x; cmd.faceY = ball.y - p.y; }
      if (st.held.pass) this.pressRequest = true;
    } else if (st.pressed.slide && !p.hasBall) cmd.slide = true;
    return cmd;
  }

  private buildKick(p: Player, type: KickType, power: number, aimX: number, aimY: number) {
    const attackDir = this.sim.attackDir(p.team);
    const noiseBase = 0.025 + (1 - p.skill) * 0.03;
    if (type === 'shoot') {
      const dir = assistedShotDir(p.x, p.y, aimX, aimY, attackDir);
      return makeKick('shoot', power, dir.x, dir.y, -1, noiseBase * 1.4 + power * 0.03);
    }
    const choice = choosePassTarget(p, this.sim.teammates(p.team), this.sim.opponents(p.team), aimX, aimY, type as 'pass' | 'through' | 'cross', attackDir);
    const targetId = choice.target ? choice.target.id : -1;
    if (type === 'cross') return makeKick('cross', power, choice.aimX, choice.aimY, targetId, noiseBase * 1.5);
    if (type === 'through') return makeKick('through', power, choice.aimX, choice.aimY, targetId, noiseBase, Math.max(CONFIG.THROUGH_SPEED * (0.75 + 0.4 * power), choice.speed * 1.1));
    const speed = choice.target
      ? Math.max(choice.speed, CONFIG.PASS_MIN_SPEED + power * (CONFIG.PASS_MAX_SPEED - CONFIG.PASS_MIN_SPEED) * 0.6)
      : CONFIG.PASS_MIN_SPEED + power * (CONFIG.PASS_MAX_SPEED - CONFIG.PASS_MIN_SPEED);
    return makeKick('pass', power, choice.aimX, choice.aimY, targetId, noiseBase, speed, 0);
  }

  cancelCharge() { this.chargeType = null; const p = this.player; if (p) p.charging = null; }
}
