import { CONFIG, HALF_LENGTH, HALF_WIDTH } from '../config';
import { clamp, turnToward } from '../core/math';
import type { Ball, Kick, MatchEvent, Player, PlayerCommand, TeamIndex } from './types';
import { launchBall } from './ball';
import type { Rng } from '../core/rng';

export interface SimContext {
  ball: Ball;
  players: Player[];
  rng: Rng;
  events: MatchEvent[];
  attackDir(team: TeamIndex): number;
  onKick?(p: Player, kick: Kick): void;
  onFoul?(tackler: Player, victim: Player): void;
  onTackleWon?(tackler: Player, victim: Player): void;
  ballActive: boolean; // false during dead-ball phases: no possession changes
}

export function createPlayer(id: number, team: TeamIndex, index: number, number: number, name: string, speedMult: number, skill: number, tackleSkill: number, hair: number, skin: number): Player {
  return {
    id, team, index, number, name, isKeeper: index === 0,
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, heading: team === 0 ? 0 : Math.PI, pheading: team === 0 ? 0 : Math.PI, speed: 0,
    stamina: CONFIG.STAMINA_MAX, speedMult, skill, tackleSkill,
    action: 'none', actionT: 0, actionDur: 0, kick: null, kickContactDone: false,
    slideX: 1, slideY: 0, slideHitBall: false, slideCooldown: 0, controlCooldown: 0, dribbleTimer: 0, hasBall: false,
    charging: null, celebType: 0, diveX: 0, diveY: 0, diveDirY: 0, diveDist: 1, holdTimer: 0,
    role: index === 0 ? 'Keeper' : 'ReturnToFormation', targetX: 0, targetY: 0, aiTimer: 0,
    aiMemoryBallX: 0, aiMemoryBallY: 0, reactionTimer: 0, markId: -1, aiSprint: false, aiDirX: 1, aiDirY: 0, controlledBy: -1,
    hair, skin, yellow: false, lastKickT: 99, diveSuccessChance: 0.5,
  };
}

export function placePlayer(p: Player, x: number, y: number, heading?: number) {
  p.x = p.px = x; p.y = p.py = y; p.vx = p.vy = 0; p.speed = 0;
  if (heading !== undefined) { p.heading = p.pheading = heading; }
  p.action = 'none'; p.actionT = 0; p.kick = null; p.charging = null; p.hasBall = false;
}

export function startAction(p: Player, action: Player['action'], dur: number) {
  p.action = action; p.actionT = 0; p.actionDur = dur;
}

/** Advance one player by dt given its command. */
export function stepPlayer(p: Player, cmd: PlayerCommand, ctx: SimContext, dt: number) {
  p.px = p.x; p.py = p.y; p.pheading = p.heading;
  if (p.slideCooldown > 0) p.slideCooldown = Math.max(0, p.slideCooldown - dt);
  if (p.controlCooldown > 0) p.controlCooldown = Math.max(0, p.controlCooldown - dt);
  if (p.dribbleTimer > 0) p.dribbleTimer -= dt;
  p.lastKickT += dt;

  let moveX = cmd.moveX, moveY = cmd.moveY;
  let speedScale = 1;
  let canAct = p.action === 'none';

  switch (p.action) {
    case 'fallen':
      p.actionT += dt; moveX = 0; moveY = 0; speedScale = 0;
      if (p.actionT >= p.actionDur) startAction(p, 'getup', 0.45);
      break;
    case 'getup':
      p.actionT += dt; speedScale = 0.25;
      if (p.actionT >= p.actionDur) { p.action = 'none'; }
      break;
    case 'slide': {
      p.actionT += dt;
      const t = p.actionT / p.actionDur;
      const sp = CONFIG.SLIDE_SPEED * Math.max(0, 1 - t * t);
      p.vx = p.slideX * sp; p.vy = p.slideY * sp;
      moveX = 0; moveY = 0; speedScale = 0;
      checkSlideContact(p, ctx);
      if (p.actionT >= p.actionDur) { startAction(p, 'getup', CONFIG.SLIDE_RECOVERY); p.vx = 0; p.vy = 0; }
      break;
    }
    case 'kick': {
      p.actionT += dt;
      speedScale = 0.35;
      if (!p.kickContactDone && p.actionT >= CONFIG.KICK_WINDUP) {
        p.kickContactDone = true;
        if (p.kick) executeKick(p, p.kick, ctx);
      }
      if (p.actionT >= CONFIG.KICK_WINDUP + CONFIG.KICK_FOLLOW_THROUGH) { p.action = 'none'; p.kick = null; }
      break;
    }
    case 'dive': {
      p.actionT += dt;
      const t = p.actionT / p.actionDur;
      // total travel = speed * dur * 2/3, so scale the speed to reach the dive target
      const want = p.diveDist / (p.actionDur * 2 / 3);
      const sp = Math.min(CONFIG.KEEPER_DIVE_SPEED * 1.3, want) * Math.max(0, 1 - t * t);
      p.vx = p.diveX * sp; p.vy = p.diveY * sp;
      moveX = 0; moveY = 0; speedScale = 0;
      if (p.actionT >= p.actionDur) { startAction(p, 'getup', 0.5); p.vx = 0; p.vy = 0; }
      break;
    }
    case 'catch':
      p.actionT += dt; speedScale = 0.3;
      if (p.actionT >= p.actionDur) p.action = 'none';
      break;
    case 'throw':
      p.actionT += dt; speedScale = 0.2;
      if (!p.kickContactDone && p.actionT >= CONFIG.KICK_WINDUP * 1.5) {
        p.kickContactDone = true;
        if (p.kick) executeKick(p, p.kick, ctx);
      }
      if (p.actionT >= p.actionDur) { p.action = 'none'; p.kick = null; }
      break;
    case 'celebrate':
      p.actionT += dt; speedScale = 0.8;
      break;
    case 'none':
    default:
      break;
  }

  if (canAct) {
    if (cmd.kick && !(p.isKeeper && p.holdTimer > 0 && cmd.kick.type !== 'throw' && cmd.kick.type !== 'clear')) {
      p.kick = cmd.kick; p.kickContactDone = false; startAction(p, 'kick', CONFIG.KICK_WINDUP + CONFIG.KICK_FOLLOW_THROUGH);
      p.charging = null; p.lastKickT = 0;
      // face the kick direction immediately-ish
      p.heading = turnToward(p.heading, Math.atan2(cmd.kick.aimY, cmd.kick.aimX), 1.2);
      speedScale = 0.35;
    } else if (cmd.slide && p.slideCooldown <= 0 && !p.isKeeper) {
      const l = Math.hypot(moveX, moveY);
      if (l > 0.1) { p.slideX = moveX / l; p.slideY = moveY / l; }
      else { p.slideX = Math.cos(p.heading); p.slideY = Math.sin(p.heading); }
      p.heading = Math.atan2(p.slideY, p.slideX);
      startAction(p, 'slide', CONFIG.SLIDE_DURATION);
      p.slideHitBall = false; p.slideCooldown = CONFIG.SLIDE_COOLDOWN + CONFIG.SLIDE_DURATION + CONFIG.SLIDE_RECOVERY;
      p.charging = null;
      if (p.hasBall) releaseBall(p, ctx.ball);
      return finishMove(p, ctx, dt, 0, 0, 0, cmd, false);
    } else if (cmd.dive && p.isKeeper) {
      const dx = cmd.dive.x - p.x, dy = cmd.dive.y - p.y;
      const l = Math.hypot(dx, dy) || 1;
      p.diveX = dx / l; p.diveY = dy / l; p.diveDirY = dy; p.diveDist = Math.max(0.5, l);
      p.heading = Math.atan2(p.diveY, p.diveX);
      startAction(p, 'dive', CONFIG.KEEPER_DIVE_DURATION);
      return finishMove(p, ctx, dt, 0, 0, 0, cmd, false);
    }
  }
  if (p.charging) speedScale = Math.min(speedScale, 0.7);

  finishMove(p, ctx, dt, moveX, moveY, speedScale, cmd, p.action === 'none' || p.action === 'getup' || p.action === 'kick' || p.action === 'catch' || p.action === 'celebrate');
}

function finishMove(p: Player, ctx: SimContext, dt: number, moveX: number, moveY: number, speedScale: number, cmd: PlayerCommand, controlsVelocity: boolean) {
  if (controlsVelocity) {
    const ml = Math.hypot(moveX, moveY);
    const wantsSprint = cmd.sprint && ml > 0.1 && p.stamina > 0;
    let maxSpeed = (wantsSprint ? CONFIG.PLAYER_SPRINT_SPEED : CONFIG.PLAYER_JOG_SPEED) * p.speedMult * speedScale;
    if (p.isKeeper) maxSpeed = Math.min(maxSpeed, CONFIG.KEEPER_SPEED * 1.15);
    if (p.hasBall) maxSpeed *= CONFIG.PLAYER_DRIBBLE_SPEED_MULT;
    if (p.stamina < CONFIG.STAMINA_TIRED_THRESHOLD) maxSpeed *= CONFIG.STAMINA_TIRED_SPEED_MULT;
    const dvx = (ml > 0 ? moveX / Math.max(1, ml) : 0) * maxSpeed * Math.min(1, ml);
    const dvy = (ml > 0 ? moveY / Math.max(1, ml) : 0) * maxSpeed * Math.min(1, ml);
    const ddx = dvx - p.vx, ddy = dvy - p.vy;
    const dl = Math.hypot(ddx, ddy);
    const desiredSpeed = Math.hypot(dvx, dvy);
    const accel = desiredSpeed > p.speed ? CONFIG.PLAYER_ACCEL : CONFIG.PLAYER_DECEL;
    const maxD = accel * dt;
    if (dl <= maxD) { p.vx = dvx; p.vy = dvy; }
    else { p.vx += (ddx / dl) * maxD; p.vy += (ddy / dl) * maxD; }
    // stamina
    if (wantsSprint && p.speed > CONFIG.PLAYER_JOG_SPEED * 0.9) p.stamina = Math.max(0, p.stamina - CONFIG.STAMINA_SPRINT_DRAIN * dt);
    else p.stamina = Math.min(CONFIG.STAMINA_MAX, p.stamina + CONFIG.STAMINA_REGEN * dt * (p.speed < 1 ? 1.6 : 1));
    // heading
    let targetHeading: number | null = null;
    if (ml > 0.1) targetHeading = Math.atan2(moveY, moveX);
    else if (cmd.hasFace) targetHeading = Math.atan2(cmd.faceY, cmd.faceX);
    else if (p.speed > 0.5) targetHeading = Math.atan2(p.vy, p.vx);
    if (targetHeading !== null && p.action !== 'kick') {
      p.heading = turnToward(p.heading, targetHeading, CONFIG.PLAYER_TURN_RATE * dt);
    }
  } else {
    p.stamina = Math.min(CONFIG.STAMINA_MAX, p.stamina + CONFIG.STAMINA_REGEN * 0.5 * dt);
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  // soft separation from other players
  separate(p, ctx.players);
  // world bounds
  const mx = HALF_LENGTH + CONFIG.OUT_MARGIN - 0.5, my = HALF_WIDTH + CONFIG.OUT_MARGIN - 0.5;
  if (p.x < -mx) { p.x = -mx; p.vx = Math.max(0, p.vx); }
  if (p.x > mx) { p.x = mx; p.vx = Math.min(0, p.vx); }
  if (p.y < -my) { p.y = -my; p.vy = Math.max(0, p.vy); }
  if (p.y > my) { p.y = my; p.vy = Math.min(0, p.vy); }
  p.speed = Math.hypot(p.vx, p.vy);
}

function separate(p: Player, players: Player[]) {
  const r = CONFIG.PLAYER_SEPARATION_RADIUS;
  for (const o of players) {
    if (o === p) continue;
    const dx = p.x - o.x, dy = p.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = (r - d) * 0.5 * 0.5; // half each, softened
      p.x += (dx / d) * push; p.y += (dy / d) * push;
    } else if (d2 <= 1e-6) { p.x += 0.01 * (p.id % 2 ? 1 : -1); }
  }
}

function checkSlideContact(p: Player, ctx: SimContext) {
  if (p.slideHitBall || !ctx.ballActive) return;
  const ball = ctx.ball;
  const footX = p.x + p.slideX * 0.75, footY = p.y + p.slideY * 0.75;
  const dBall = Math.hypot(ball.x - footX, ball.y - footY);
  const reach = CONFIG.SLIDE_REACH * (0.75 + 0.25 * p.tackleSkill);
  if (dBall <= reach && ball.z < 0.6) {
    p.slideHitBall = true;
    const owner = ball.owner >= 0 ? ctx.players[ball.owner] : null;
    // knock the ball away in the slide direction
    launchBall(ball, p.slideX + (ctx.rng.next() - 0.5) * 0.4, p.slideY + (ctx.rng.next() - 0.5) * 0.4, CONFIG.TACKLE_BALL_WIN_SPEED, 0.05, p.id, p.team, 'tap');
    ball.kickCooldown = 0.1;
    if (owner && owner.team !== p.team) {
      owner.hasBall = false;
      const dOwner = Math.hypot(owner.x - footX, owner.y - footY);
      if (dOwner < 0.9) startAction(owner, 'fallen', CONFIG.TACKLE_KNOCKDOWN_TIME * 0.8);
      ctx.onTackleWon?.(p, owner);
      ctx.events.push({ type: 'tackle', team: p.team, playerId: p.id, x: p.x, y: p.y, strength: 0.6 });
    }
    return;
  }
  // hitting an opponent before the ball = foul
  for (const o of ctx.players) {
    if (o.team === p.team || o.action === 'fallen' || o.action === 'getup' || o.action === 'slide') continue;
    const d = Math.hypot(o.x - footX, o.y - footY);
    if (d < 0.55) {
      p.slideHitBall = true; // the slide is spent
      if (o.hasBall) { o.hasBall = false; if (ball.owner === o.id) { ball.owner = -1; launchBall(ball, p.slideX, p.slideY, 2.5, 0, o.id, o.team, 'tap'); } }
      startAction(o, 'fallen', CONFIG.TACKLE_KNOCKDOWN_TIME);
      ctx.onFoul?.(p, o);
      return;
    }
  }
}

export function releaseBall(p: Player, ball: Ball) {
  if (ball.owner === p.id) ball.owner = -1;
  p.hasBall = false;
}

/** Apply the kick at the contact frame. */
export function executeKick(p: Player, kick: Kick, ctx: SimContext) {
  const ball = ctx.ball;
  const d = Math.hypot(ball.x - p.x, ball.y - p.y);
  if (d > CONFIG.KICK_REACH || ball.z > 1.4) return; // whiff
  if (ball.owner >= 0 && ball.owner !== p.id && ctx.players[ball.owner].isKeeper && ctx.players[ball.owner].holdTimer > 0) return;
  if (ball.owner >= 0 && ball.owner !== p.id) {
    const o = ctx.players[ball.owner];
    if (o.team !== p.team) { o.hasBall = false; }
  }
  releaseBall(p, ball);
  // noise
  let ang = Math.atan2(kick.aimY, kick.aimX);
  const n = ctx.rng.gauss() * kick.noise;
  ang += n;
  let loft = kick.loft;
  if (kick.type === 'shoot') loft = clamp(loft + ctx.rng.gauss() * kick.noise * 0.8, 0, 0.6);
  else if (kick.type === 'cross') loft = clamp(loft + ctx.rng.gauss() * 0.06, 0.4, 0.8);
  ball.z = Math.max(0, Math.min(ball.z, 0.1));
  launchBall(ball, Math.cos(ang), Math.sin(ang), kick.speed, loft, p.id, p.team, kick.type);
  p.controlCooldown = CONFIG.POSSESSION_TOUCH_COOLDOWN;
  p.heading = ang;
  ctx.onKick?.(p, kick);
  ctx.events.push({ type: 'kick', team: p.team, playerId: p.id, x: ball.x, y: ball.y, strength: kick.speed / CONFIG.SHOT_MAX_SPEED });
}

/**
 * Possession: dribbling spring + touches for the owner, first-touch control for loose balls,
 * and contests between the owner and nearby opponents.
 */
export function updatePossession(ctx: SimContext, dt: number) {
  const ball = ctx.ball;
  const players = ctx.players;
  if (!ctx.ballActive) {
    if (ball.owner >= 0) dribble(players[ball.owner], ball, dt, true);
    return;
  }
  if (ball.owner >= 0) {
    const o = players[ball.owner];
    if (o.action === 'fallen' || o.action === 'slide' || o.action === 'dive' || o.action === 'getup') { releaseBall(o, ball); }
    else {
      dribble(o, ball, dt, false);
      if (Math.hypot(ball.x - o.x, ball.y - o.y) > 1.4) releaseBall(o, ball);
      else contest(o, ball, ctx, dt);
    }
  }
  if (ball.owner < 0) {
    let best: Player | null = null, bestD = Infinity;
    for (const p of players) {
      if (p.action !== 'none' && p.action !== 'getup' && p.action !== 'kick' && p.action !== 'celebrate') continue;
      if (p.action === 'kick' && !p.kickContactDone) continue;
      if (p.controlCooldown > 0) continue;
      if (ball.kickedBy === p.id && ball.kickCooldown > 0) continue;
      if (p.isKeeper) continue; // keepers handled by the keeper brain (catch)
      if (ball.z > CONFIG.CONTROL_MAX_BALL_HEIGHT) continue;
      const d = Math.hypot(ball.x - p.x, ball.y - p.y);
      const radius = CONFIG.CONTROL_RADIUS * (ball.speed > 9 ? 0.85 : 1);
      if (d < radius && d < bestD) { best = p; bestD = d; }
    }
    if (best) {
      const relSpeed = Math.hypot(ball.vx - best.vx, ball.vy - best.vy);
      if (relSpeed <= CONFIG.CONTROL_MAX_BALL_SPEED * (0.7 + 0.5 * best.skill)) {
        gainPossession(best, ball, ctx);
      } else {
        // poor first touch: ball deflects and slows
        if (ball.restFrames === 0 && ball.kickCooldown <= 0) {
          ball.vx = best.vx + (ball.vx - best.vx) * 0.35 + (ctx.rng.next() - 0.5) * 2;
          ball.vy = best.vy + (ball.vy - best.vy) * 0.35 + (ctx.rng.next() - 0.5) * 2;
          ball.kickCooldown = 0.15; ball.kickedBy = best.id;
          ball.prevTouch = ball.lastTouch; ball.lastTouch = best.id; ball.lastTouchTeam = best.team;
        }
      }
    }
  }
  for (const p of players) p.hasBall = ball.owner === p.id;
}

export function gainPossession(p: Player, ball: Ball, ctx: SimContext) {
  ball.owner = p.id;
  ball.prevTouch = ball.lastTouch;
  ball.lastTouch = p.id; ball.lastTouchTeam = p.team;
  ball.kickType = null;
  ball.z = 0; ball.vz = 0;
  // first touch: kill most of the ball's relative velocity
  ball.vx = p.vx + (ball.vx - p.vx) * 0.15;
  ball.vy = p.vy + (ball.vy - p.vy) * 0.15;
  p.hasBall = true;
  p.dribbleTimer = 0.1;
  for (const o of ctx.players) if (o !== p) o.hasBall = false;
}

function dribble(p: Player, ball: Ball, dt: number, frozen: boolean) {
  const moving = p.speed > 0.8;
  const hx = Math.cos(p.heading), hy = Math.sin(p.heading);
  const dirX = moving ? p.vx / p.speed : hx;
  const dirY = moving ? p.vy / p.speed : hy;
  const off = CONFIG.DRIBBLE_OFFSET + (moving ? p.speed * 0.04 : 0);
  const tx = p.x + dirX * off, ty = p.y + dirY * off;
  if (frozen) {
    ball.vx = (tx - ball.x) / 0.12; ball.vy = (ty - ball.y) / 0.12;
    return;
  }
  // small touch ahead while running (visual knock), then the spring gathers the ball again
  if (moving && p.dribbleTimer <= 0) {
    const sp = p.speed * 1.05 + 0.6;
    ball.vx = dirX * sp; ball.vy = dirY * sp;
    p.dribbleTimer = CONFIG.DRIBBLE_TOUCH_INTERVAL;
  }
  const recentlyTouched = p.dribbleTimer > CONFIG.DRIBBLE_TOUCH_INTERVAL * 0.5;
  const tau = 0.12;
  const wantVx = (tx - ball.x) / tau, wantVy = (ty - ball.y) / tau;
  const maxV = p.speed + 6;
  const l = Math.hypot(wantVx, wantVy);
  const k = l > maxV ? maxV / l : 1;
  const blend = Math.min(1, dt * (recentlyTouched ? 5 : 20));
  ball.vx += (wantVx * k - ball.vx) * blend;
  ball.vy += (wantVy * k - ball.vy) * blend;
}

function contest(owner: Player, ball: Ball, ctx: SimContext, dt: number) {
  if (owner.isKeeper && owner.holdTimer > 0) return;
  for (const o of ctx.players) {
    if (o.team === owner.team || o.isKeeper) continue;
    if (o.action !== 'none' && o.action !== 'getup') continue;
    if (o.controlCooldown > 0) continue;
    const d = Math.hypot(ball.x - o.x, ball.y - o.y);
    if (d < 0.6) {
      // standing tackle / poke: probability per second
      const facing = ((ball.x - o.x) * Math.cos(o.heading) + (ball.y - o.y) * Math.sin(o.heading)) / (d || 1);
      if (facing < 0.2 || ball.z > 0.5) continue;
      const rate = 0.9 * (0.45 + 0.75 * o.tackleSkill) * (0.6 + 0.6 * (1 - owner.skill));
      if (ctx.rng.next() < rate * dt) {
        owner.hasBall = false; owner.controlCooldown = 0.35;
        gainPossession(o, ball, ctx);
        ball.vx += (o.x - owner.x) * 2; ball.vy += (o.y - owner.y) * 2;
        ctx.onTackleWon?.(o, owner);
        ctx.events.push({ type: 'tackle', team: o.team, playerId: o.id, x: o.x, y: o.y, strength: 0.3 });
        return;
      }
    }
  }
}
