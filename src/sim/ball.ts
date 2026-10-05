import { CONFIG, HALF_LENGTH } from '../config';
import type { Ball, MatchEvent } from './types';

export function createBall(): Ball {
  return {
    x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0,
    owner: -1, lastTouch: -1, lastTouchTeam: -1, prevTouch: -1, kickedBy: -1, kickCooldown: 0,
    kickType: null, inNet: -1, speed: 0, restFrames: 0,
  };
}

export function resetBall(b: Ball, x: number, y: number) {
  b.x = b.px = x; b.y = b.py = y; b.z = b.pz = 0;
  b.vx = b.vy = b.vz = 0; b.owner = -1; b.kickCooldown = 0; b.inNet = -1; b.speed = 0; b.kickType = null;
}

export function launchBall(b: Ball, dirX: number, dirY: number, speed: number, loft: number, kickerId: number, team: 0 | 1, type: Ball['kickType']) {
  const l = Math.hypot(dirX, dirY) || 1;
  const horiz = speed * Math.sqrt(Math.max(0, 1 - loft * loft));
  b.vx = (dirX / l) * horiz;
  b.vy = (dirY / l) * horiz;
  b.vz = speed * loft;
  b.owner = -1;
  b.kickedBy = kickerId;
  b.prevTouch = b.lastTouch;
  b.lastTouch = kickerId;
  b.lastTouchTeam = team;
  b.kickCooldown = CONFIG.POSSESSION_TOUCH_COOLDOWN;
  b.kickType = type;
  b.restFrames = 0;
}

/**
 * Advance the ball physics by dt. 2.5D: gravity on z, bounce, ground friction, air drag.
 * Handles collisions with the goal frame and nets. Returns events (post hits, bounces).
 */
export function stepBall(b: Ball, dt: number, events?: MatchEvent[]) {
  b.px = b.x; b.py = b.y; b.pz = b.z;
  if (b.kickCooldown > 0) b.kickCooldown = Math.max(0, b.kickCooldown - dt);
  // substep fast balls so they cannot tunnel through posts / the crossbar
  const sp3 = Math.hypot(b.vx, b.vy, b.vz);
  const n = Math.min(6, Math.max(1, Math.ceil((sp3 * dt) / 0.08)));
  const sdt = dt / n;
  for (let i = 0; i < n; i++) integrate(b, sdt, events);
  b.speed = Math.hypot(b.vx, b.vy);
  if (b.speed < 0.01 && b.z === 0) b.restFrames++; else b.restFrames = 0;
}

function integrate(b: Ball, dt: number, events?: MatchEvent[]) {

  const onGround = b.z <= 0.0005 && Math.abs(b.vz) < 0.5;
  if (onGround) {
    b.z = 0; b.vz = 0;
    // rolling friction: exponential + linear deceleration
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) {
      const keep = Math.pow(CONFIG.BALL_GROUND_FRICTION, dt);
      let nsp = sp * keep - CONFIG.BALL_ROLL_DECEL * dt;
      if (nsp < CONFIG.BALL_MIN_SPEED) nsp = 0;
      const k = nsp / sp;
      b.vx *= k; b.vy *= k;
    }
  } else {
    b.vz -= CONFIG.BALL_GRAVITY * dt;
    const keep = Math.pow(CONFIG.BALL_AIR_DRAG, dt);
    b.vx *= keep; b.vy *= keep;
  }

  const nx = b.x + b.vx * dt;
  const ny = b.y + b.vy * dt;
  let nz = b.z + b.vz * dt;

  // goal frame collisions (both ends)
  collideGoal(b, nx, ny, nz, events);

  b.x += b.vx * dt;
  b.y += b.vy * dt;
  nz = b.z + b.vz * dt;
  if (nz <= 0) {
    if (b.vz < -1.2) {
      b.vz = -b.vz * CONFIG.BALL_BOUNCE;
      b.vx *= CONFIG.BALL_SPIN_BOUNCE_LOSS; b.vy *= CONFIG.BALL_SPIN_BOUNCE_LOSS;
      b.z = 0;
      events?.push({ type: 'bounce', team: -1, playerId: -1, x: b.x, y: b.y, strength: Math.min(1, -b.vz / 8) });
    } else { b.z = 0; b.vz = 0; }
  } else b.z = nz;

  // keep the ball inside the net box once it is in
  if (b.inNet >= 0) {
    const side = b.inNet === 0 ? -1 : 1;
    const gl = side * HALF_LENGTH;
    const back = gl + side * (CONFIG.GOAL_DEPTH - 0.05);
    const gw = CONFIG.GOAL_WIDTH / 2 - 0.1;
    if (side < 0 ? b.x < back : b.x > back) { b.x = back; b.vx = -b.vx * 0.2; b.vy *= 0.5; }
    if (b.y > gw) { b.y = gw; b.vy = -Math.abs(b.vy) * 0.3; }
    if (b.y < -gw) { b.y = -gw; b.vy = Math.abs(b.vy) * 0.3; }
    if (b.z > CONFIG.GOAL_HEIGHT - 0.1) { b.z = CONFIG.GOAL_HEIGHT - 0.1; b.vz = -Math.abs(b.vz) * 0.2; }
    b.vx *= Math.pow(0.2, dt); b.vy *= Math.pow(0.2, dt);
    b.vz *= Math.pow(0.3, dt);
  } else {
    // detect entering the net: crossing the line inside the mouth
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const gl = side * HALF_LENGTH;
      const inside = side < 0 ? b.x < gl - CONFIG.BALL_RADIUS : b.x > gl + CONFIG.BALL_RADIUS;
      if (inside && Math.abs(b.y) < CONFIG.GOAL_WIDTH / 2 && b.z < CONFIG.GOAL_HEIGHT) {
        b.inNet = i as 0 | 1;
      }
    }
  }
}

function collideGoal(b: Ball, nx: number, ny: number, nz: number, events?: MatchEvent[]) {
  const r = CONFIG.BALL_RADIUS;
  const gw = CONFIG.GOAL_WIDTH / 2;
  const h = CONFIG.GOAL_HEIGHT;
  const postR = 0.06;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const gl = side * HALF_LENGTH;
    if (Math.abs(nx - gl) > 1.5) continue;
    // posts: vertical cylinders at (gl, ±gw)
    for (const py of [-gw, gw]) {
      const dx = nx - gl, dy = ny - py;
      const d = Math.hypot(dx, dy);
      if (d < r + postR && nz < h + 0.1) {
        const nxn = dx / (d || 1), nyn = dy / (d || 1);
        const vn = b.vx * nxn + b.vy * nyn;
        if (vn < 0) {
          b.vx -= (1 + CONFIG.POST_BOUNCE) * vn * nxn;
          b.vy -= (1 + CONFIG.POST_BOUNCE) * vn * nyn;
          events?.push({ type: 'post', team: -1, playerId: -1, x: nx, y: ny, strength: Math.min(1, -vn / 15) });
        }
      }
    }
    // crossbar: horizontal cylinder at x = gl, z = h, y in [-gw, gw]
    if (Math.abs(ny) <= gw) {
      const dx = nx - gl, dz = nz - h;
      const d = Math.hypot(dx, dz);
      if (d < r + postR) {
        const nxn = dx / (d || 1), nzn = dz / (d || 1);
        const vn = b.vx * nxn + b.vz * nzn;
        if (vn < 0) {
          b.vx -= (1 + CONFIG.POST_BOUNCE) * vn * nxn;
          b.vz -= (1 + CONFIG.POST_BOUNCE) * vn * nzn;
          events?.push({ type: 'post', team: -1, playerId: -1, x: nx, y: ny, strength: Math.min(1, -vn / 15) });
        }
      }
    }
    // side netting from the outside: block the ball from passing through the side of the goal box
    const behind = side < 0 ? nx < gl : nx > gl;
    const withinDepth = side < 0 ? nx > gl - CONFIG.GOAL_DEPTH : nx < gl + CONFIG.GOAL_DEPTH;
    if (behind && withinDepth && nz < h && b.inNet < 0) {
      // ball came from outside the mouth (e.g. around the post) -> treat side net as a wall
      if (Math.abs(b.y) >= gw && Math.abs(ny) < gw) { b.vy = -b.vy * 0.3; }
    }
  }
}

/** Where the ball will be after t seconds, ignoring bounces (ground roll approximation). */
export function predictBallPos(b: Ball, t: number, out: { x: number; y: number }) {
  // integrate friction analytically-ish by stepping coarse
  let x = b.x, y = b.y, vx = b.vx, vy = b.vy;
  const step = 1 / 20;
  let rem = t;
  while (rem > 0) {
    const d = Math.min(step, rem);
    x += vx * d; y += vy * d;
    const sp = Math.hypot(vx, vy);
    if (sp > 0) {
      const keep = Math.pow(CONFIG.BALL_GROUND_FRICTION, d);
      let nsp = sp * keep - CONFIG.BALL_ROLL_DECEL * d;
      if (nsp < 0) nsp = 0;
      vx *= nsp / sp; vy *= nsp / sp;
    }
    rem -= d;
  }
  out.x = x; out.y = y;
}

/** Time for the ball to come within `radius` of point (px,py), or -1. */
export function timeToReach(b: Ball, px: number, py: number, radius: number, maxT = 3): number {
  let x = b.x, y = b.y, vx = b.vx, vy = b.vy;
  const step = 1 / 30;
  for (let t = 0; t < maxT; t += step) {
    if (Math.hypot(x - px, y - py) <= radius) return t;
    x += vx * step; y += vy * step;
    const sp = Math.hypot(vx, vy);
    if (sp > 0) {
      const keep = Math.pow(CONFIG.BALL_GROUND_FRICTION, step);
      let nsp = sp * keep - CONFIG.BALL_ROLL_DECEL * step;
      if (nsp < 0) nsp = 0;
      vx *= nsp / sp; vy *= nsp / sp;
    } else if (Math.hypot(x - px, y - py) > radius) return -1;
  }
  return -1;
}
