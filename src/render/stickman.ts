import { CONFIG } from '../config';
import { Camera } from '../core/camera';
import { angleLerp, clamp, clamp01, damp, lerp } from '../core/math';
import type { Player } from '../sim/types';

/** Joint-angle pose in a local body frame (forward, side, up). Units: meters / radians. */
export interface Pose {
  hipH: number; lean: number; side: number;
  thighL: number; thighR: number; kneeL: number; kneeR: number;
  armL: number; armR: number; elbowL: number; elbowR: number;
  spreadL: number; spreadR: number;
  headTilt: number; bodyZ: number; lying: number; stance: number; twist: number;
}

const KEYS = Object.keys({
  hipH: 0, lean: 0, side: 0, thighL: 0, thighR: 0, kneeL: 0, kneeR: 0, armL: 0, armR: 0, elbowL: 0, elbowR: 0,
  spreadL: 0, spreadR: 0, headTilt: 0, bodyZ: 0, lying: 0, stance: 0, twist: 0,
} satisfies Pose) as (keyof Pose)[];

export function idlePose(): Pose {
  return { hipH: 0.92, lean: 0.04, side: 0, thighL: 0.02, thighR: -0.02, kneeL: 0.08, kneeR: 0.08, armL: 0.05, armR: -0.05, elbowL: 0.35, elbowR: 0.35, spreadL: 0.08, spreadR: 0.08, headTilt: 0, bodyZ: 0, lying: 0, stance: 1, twist: 0 };
}

/** Per-player render-side animation state (blended pose, run phase). */
export class AnimState {
  pose: Pose = idlePose();
  target: Pose = idlePose();
  phase = 0;
  idleT = Math.random() * 10;
  lastAction: Player['action'] = 'none';
  actionAge = 0;
  update(p: Player, dt: number, speed: number) {
    const a = p.action;
    if (a !== this.lastAction) { this.lastAction = a; this.actionAge = 0; } else this.actionAge += dt;
    this.idleT += dt;
    const sprintRatio = clamp01(speed / CONFIG.PLAYER_SPRINT_SPEED);
    if (speed > 0.3 && (a === 'none' || a === 'celebrate' || a === 'catch' || a === 'kick')) {
      this.phase += dt * (1.2 + sprintRatio * 2.1) * Math.PI * 2;
    } else {
      // settle the phase to a neutral pose
      const neutral = Math.round(this.phase / Math.PI) * Math.PI;
      this.phase = damp(this.phase, neutral, 8, dt);
    }
    computeTarget(p, this, speed, sprintRatio, this.target);
    const rate = a === 'kick' || a === 'slide' || a === 'dive' ? 26 : a === 'fallen' ? 14 : 15;
    const k = 1 - Math.exp(-rate * dt);
    const pose = this.pose, t = this.target;
    for (const key of KEYS) pose[key] += (t[key] - pose[key]) * k;
  }
}

function computeTarget(p: Player, anim: AnimState, speed: number, sprint: number, out: Pose) {
  Object.assign(out, idlePose());
  const ph = anim.phase;
  const A = clamp01(speed / CONFIG.PLAYER_JOG_SPEED) * 0.7 + sprint * 0.35; // swing amplitude
  const moving = speed > 0.3;

  const runPose = () => {
    const s = Math.sin(ph), c = Math.cos(ph);
    out.thighL = A * s; out.thighR = -A * s;
    out.kneeL = 0.12 + A * (1.1 * Math.max(0, c) + 0.25);
    out.kneeR = 0.12 + A * (1.1 * Math.max(0, -c) + 0.25);
    out.armL = -A * 0.8 * s; out.armR = A * 0.8 * s;
    out.elbowL = 0.4 + A * 1.3; out.elbowR = 0.4 + A * 1.3;
    out.lean = 0.06 + A * 0.28 + sprint * 0.12;
    out.hipH = 0.92 - A * 0.06 + Math.abs(Math.sin(ph * 2)) * 0.02 * A;
    out.bodyZ = Math.abs(Math.sin(ph)) * 0.035 * A;
    out.spreadL = out.spreadR = 0.12;
    out.twist = A * 0.15 * s;
  };

  switch (p.action) {
    case 'none':
    case 'getup':
    case 'catch':
    case 'celebrate':
    default: {
      if (moving) runPose();
      else {
        // idle breathing sway
        const b = Math.sin(anim.idleT * 1.6);
        out.hipH = 0.92 + b * 0.006;
        out.armL = 0.05 + b * 0.02; out.armR = -0.05 - b * 0.02;
        out.thighL = 0.03; out.thighR = -0.03;
        out.lean = 0.04;
      }
      if (p.isKeeper && p.action === 'none' && !moving) {
        // ready stance: crouched, arms out
        out.hipH = 0.78; out.kneeL = out.kneeR = 0.7; out.thighL = out.thighR = 0.45; out.stance = 1.8;
        out.lean = 0.3; out.armL = out.armR = 0.5; out.elbowL = out.elbowR = 1.2; out.spreadL = out.spreadR = 0.55;
      }
      if (p.action === 'catch') {
        out.armL = out.armR = 1.3; out.elbowL = out.elbowR = 1.3; out.spreadL = out.spreadR = 0.15; out.lean = 0.15;
      }
      if (p.action === 'getup') {
        const t = clamp01(p.actionT / Math.max(0.01, p.actionDur));
        out.lying = (1 - t) * 0.6; out.hipH = lerp(0.35, 0.92, t); out.kneeL = out.kneeR = (1 - t) * 1.2 + 0.1;
        out.thighL = out.thighR = (1 - t) * 0.9; out.lean = (1 - t) * 0.7; out.armL = out.armR = (1 - t) * 0.8;
      }
      if (p.action === 'celebrate') celebratePose(p, anim, out, moving, runPose);
      break;
    }
    case 'kick': {
      if (moving) runPose();
      const total = CONFIG.KICK_WINDUP + CONFIG.KICK_FOLLOW_THROUGH;
      const t = clamp01(p.actionT / total);
      const tc = CONFIG.KICK_WINDUP / total; // contact
      const big = p.kick?.type === 'shoot' || p.kick?.type === 'clear' || p.kick?.type === 'cross';
      const amp = big ? 1.0 : 0.65;
      let swing: number; // -1 (back) .. 1 (forward)
      if (t < tc) swing = -1 * (t / tc);
      else swing = -1 + 2 * Math.min(1, (t - tc) / (1 - tc) * 1.3);
      const kneeBend = t < tc ? 1.2 * (t / tc) : Math.max(0.1, 1.2 * (1 - (t - tc) / (1 - tc) * 2));
      out.thighR = swing * 1.15 * amp;
      out.kneeR = kneeBend * amp;
      out.thighL = -0.15; out.kneeL = 0.25;
      out.lean = (big ? -0.15 : 0.05) + swing * 0.12;
      out.armL = 0.6 * amp; out.armR = -0.4 * amp;
      out.spreadL = 0.7 * amp; out.spreadR = 0.5 * amp;
      out.elbowL = 0.5; out.elbowR = 0.6;
      out.hipH = 0.9 - 0.04 * amp;
      out.twist = -swing * 0.2;
      out.stance = 1.1;
      break;
    }
    case 'slide': {
      const t = clamp01(p.actionT / p.actionDur);
      out.lying = -0.8; out.hipH = 0.32; out.stance = 1.1;
      out.thighR = 1.5; out.kneeR = 0.05; // extended leg
      out.thighL = 0.6; out.kneeL = 1.9;
      out.armL = -1.2; out.armR = -0.6; out.spreadL = 0.7; out.spreadR = 0.9; out.elbowL = 0.4; out.elbowR = 0.6;
      out.lean = 0.2 + t * 0.2; out.headTilt = 0.3;
      break;
    }
    case 'fallen': {
      out.lying = 1; out.hipH = 0.12; out.lean = 0.05;
      out.thighL = -0.1; out.thighR = 0.1; out.kneeL = 0.3; out.kneeR = 0.2;
      out.armL = 1.6; out.armR = 1.2; out.spreadL = 0.5; out.spreadR = 0.4; out.elbowL = 0.8; out.elbowR = 1.0;
      out.headTilt = 0.4;
      break;
    }
    case 'dive': {
      const t = clamp01(p.actionT / p.actionDur);
      out.lying = 0.3 + t * 0.6; out.hipH = lerp(0.7, 0.2, t);
      out.armL = out.armR = 2.9; out.elbowL = out.elbowR = 0.1; out.spreadL = 0.25; out.spreadR = 0.1;
      out.thighL = 0.2; out.thighR = -0.3; out.kneeL = 0.5; out.kneeR = 0.2; out.lean = 0.5;
      out.bodyZ = Math.sin(t * Math.PI) * 0.25;
      break;
    }
    case 'throw': {
      const t = clamp01(p.actionT / p.actionDur);
      out.armR = 2.6 - t * 3.2; out.elbowR = 0.6; out.armL = 0.8 - t * 0.5; out.spreadL = 0.5;
      out.lean = -0.2 + t * 0.5; out.thighL = 0.4; out.kneeL = 0.3; out.thighR = -0.3;
      break;
    }
  }
}

function celebratePose(p: Player, anim: AnimState, out: Pose, moving: boolean, runPose: () => void) {
  const t = p.actionT;
  switch (p.celebType % 4) {
    case 0: { // arms up, jumping
      const j = Math.max(0, Math.sin(t * 7));
      out.armL = out.armR = 3.0; out.elbowL = out.elbowR = 0.2; out.spreadL = out.spreadR = 0.35;
      out.bodyZ = j * 0.3; out.kneeL = out.kneeR = 0.3 - j * 0.2; out.hipH = 0.9;
      out.headTilt = -0.2;
      break;
    }
    case 1: { // knee slide
      if (t < 0.5 && moving) { runPose(); break; }
      out.lying = -0.35; out.hipH = 0.42; out.kneeL = out.kneeR = 2.2; out.thighL = out.thighR = 0.5;
      out.armL = out.armR = 2.4; out.spreadL = out.spreadR = 0.9; out.elbowL = out.elbowR = 0.3; out.headTilt = -0.4;
      break;
    }
    case 2: { // airplane run
      if (moving) runPose();
      out.armL = out.armR = 1.5; out.spreadL = out.spreadR = 1.0; out.elbowL = out.elbowR = 0.1; out.lean = 0.35;
      break;
    }
    case 3: { // fist pump
      const pump = Math.sin(t * 9) * 0.5 + 0.5;
      out.armR = 2.0 + pump * 0.8; out.elbowR = 1.6; out.armL = 0.3; out.elbowL = 0.6; out.spreadR = 0.3;
      out.kneeL = out.kneeR = 0.4 - pump * 0.2; out.hipH = 0.88;
      break;
    }
  }
}

export interface StickmanStyle {
  kit: string; shorts: string; number: string; skin: string; hair: string; boots: string;
}

const SKINS = ['#f1c9a5', '#d9a577', '#b07b4f', '#7a4b2a', '#f7d9b8', '#5c3a21'];
const HAIRS = ['#1a1a1a', '#3b2416', '#6b4423', '#d4a84b', '#a0522d', '#2b2b2b', '#e7e3d8'];
export const skinColor = (i: number) => SKINS[Math.abs(i) % SKINS.length];
export const hairColor = (i: number) => HAIRS[Math.abs(i) % HAIRS.length];

// Body dimensions (meters)
const TORSO = 0.52, THIGH = 0.42, SHIN = 0.42, UPPER_ARM = 0.3, FOREARM = 0.28, NECK = 0.1, HEAD_R = 0.135;

/** Scratch joint buffer to avoid allocation. */
const J = {
  hipL: [0, 0, 0], hipR: [0, 0, 0], kneeL: [0, 0, 0], kneeR: [0, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0],
  hip: [0, 0, 0], shoulder: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0], elL: [0, 0, 0], elR: [0, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], head: [0, 0, 0],
};
type Joint = number[];

/**
 * Draw a stickman at world position (wx, wy) with the given heading and pose.
 * Local frame: f = forward, s = side (left is +), u = up.
 */
export function drawStickman(ctx: CanvasRenderingContext2D, cam: Camera, wx: number, wy: number, heading: number, pose: Pose, style: StickmanStyle, opts: { number?: number; hasBall?: boolean; highlight?: string | null; shadow?: boolean; scale?: number } = {}) {
  const ppm = cam.ppm * (opts.scale ?? 1);
  const sx = cam.sx(wx), sy = cam.sy(wy);
  const fx = Math.cos(heading), fy = Math.sin(heading) * CONFIG.Y_FORESHORTEN;
  const sxv = -Math.sin(heading), syv = Math.cos(heading) * CONFIG.Y_FORESHORTEN;
  const lyingA = pose.lying * Math.PI * 0.5;
  const cosL = Math.cos(lyingA), sinL = Math.sin(lyingA);
  // depth cue: when the figure faces away from the camera (up the screen), draw right side first etc. (ignored for simplicity)
  const project = (f: number, s: number, u: number, out: Joint) => {
    // rotate (f,u) for lying
    const f2 = f * cosL + u * sinL;
    const u2 = -f * sinL + u * cosL;
    out[0] = sx + (f2 * fx + s * sxv) * ppm;
    out[1] = sy + (f2 * fy + s * syv) * ppm - (u2 + pose.bodyZ) * ppm;
    out[2] = f2 * fy + s * syv; // depth for ordering (bigger = closer to camera)
  };

  const stance = 0.11 * pose.stance;
  const lean = pose.lean;
  // hips
  project(0, 0, pose.hipH, J.hip);
  project(0, stance, pose.hipH, J.hipL);
  project(0, -stance, pose.hipH, J.hipR);
  // legs
  const leg = (thigh: number, knee: number, side: number, kneeOut: Joint, footOut: Joint) => {
    const kf = Math.sin(thigh) * THIGH, ku = pose.hipH - Math.cos(thigh) * THIGH;
    project(kf, side, ku, kneeOut);
    const shinA = thigh - knee; // knee bends backward
    const ff = kf + Math.sin(shinA) * SHIN, fu = ku - Math.cos(shinA) * SHIN;
    project(ff, side, Math.max(fu, pose.lying !== 0 ? fu : -0.02), footOut);
  };
  leg(pose.thighL, pose.kneeL, stance, J.kneeL, J.footL);
  leg(pose.thighR, pose.kneeR, -stance, J.kneeR, J.footR);
  // torso
  const shF = Math.sin(lean) * TORSO, shS = Math.sin(pose.side) * TORSO, shU = pose.hipH + Math.cos(lean) * TORSO;
  project(shF, shS, shU, J.shoulder);
  const shoulderW = 0.17;
  const tw = pose.twist;
  project(shF + Math.sin(tw) * shoulderW, shS + Math.cos(tw) * shoulderW, shU, J.shL);
  project(shF - Math.sin(tw) * shoulderW, shS - Math.cos(tw) * shoulderW, shU, J.shR);
  // arms
  const arm = (ang: number, elbow: number, spread: number, sideSign: number, shJ: [number, number, number], elOut: Joint, handOut: Joint) => {
    const sp = spread * Math.PI * 0.5;
    // upper arm: hangs down, rotated forward by ang and outward by spread
    const ef = shJ[0] + Math.sin(ang) * Math.cos(sp) * UPPER_ARM;
    const es = shJ[1] + sideSign * Math.sin(sp) * UPPER_ARM;
    const eu = shJ[2] - Math.cos(ang) * Math.cos(sp) * UPPER_ARM;
    project(ef, es, eu, elOut);
    const fa = ang + elbow; // forearm bends forward
    const hf = ef + Math.sin(fa) * Math.cos(sp * 0.6) * FOREARM;
    const hs = es + sideSign * Math.sin(sp * 0.6) * FOREARM;
    const hu = eu - Math.cos(fa) * Math.cos(sp * 0.6) * FOREARM;
    project(hf, hs, hu, handOut);
  };
  arm(pose.armL, pose.elbowL, pose.spreadL, 1, [shF + Math.sin(tw) * shoulderW, shS + Math.cos(tw) * shoulderW, shU], J.elL, J.handL);
  arm(pose.armR, pose.elbowR, pose.spreadR, -1, [shF - Math.sin(tw) * shoulderW, shS - Math.cos(tw) * shoulderW, shU], J.elR, J.handR);
  // head
  const headU = shU + Math.cos(lean + pose.headTilt) * (NECK + HEAD_R);
  const headF = shF + Math.sin(lean + pose.headTilt) * (NECK + HEAD_R);
  project(headF, shS, headU, J.head);

  const lw = Math.max(1.5, 0.085 * ppm);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // shadow
  if (opts.shadow !== false) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    const shx = sx + (pose.lying !== 0 ? fx * 0.4 * ppm * pose.lying : 0);
    ctx.ellipse(shx, sy + 0.02 * ppm, (0.38 + Math.abs(pose.lying) * 0.4) * ppm, 0.14 * ppm, pose.lying !== 0 ? heading : 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (opts.highlight) {
    ctx.strokeStyle = opts.highlight; ctx.lineWidth = Math.max(2, 0.06 * ppm);
    ctx.beginPath(); ctx.ellipse(sx, sy + 0.02 * ppm, 0.55 * ppm, 0.22 * ppm, 0, 0, Math.PI * 2); ctx.stroke();
  }

  // order: far arm/leg first based on depth
  const leftCloser = J.shL[2] > J.shR[2];
  const drawLeg = (hip: Joint, knee: Joint, foot: Joint) => {
    // thigh in shorts color, shin in skin, boot dark
    stroke(ctx, hip, knee, style.shorts, lw * 1.7);
    stroke(ctx, knee, foot, style.skin, lw);
    ctx.fillStyle = style.boots; ctx.beginPath(); ctx.arc(foot[0], foot[1], lw * 0.75, 0, Math.PI * 2); ctx.fill();
  };
  const drawArm = (sh: Joint, el: Joint, hand: Joint) => {
    stroke(ctx, sh, el, style.kit, lw * 1.25);
    stroke(ctx, el, hand, style.skin, lw);
  };
  // outline for contrast
  ctx.save();
  ctx.globalAlpha = 0.35;
  for (const [a, b] of [[J.hipL, J.kneeL], [J.kneeL, J.footL], [J.hipR, J.kneeR], [J.kneeR, J.footR], [J.hip, J.shoulder], [J.shL, J.elL], [J.elL, J.handL], [J.shR, J.elR], [J.elR, J.handR]]) stroke(ctx, a, b, '#000', lw * 2.4);
  ctx.restore();

  if (!leftCloser) { drawLeg(J.hipL, J.kneeL, J.footL); drawArm(J.shL, J.elL, J.handL); }
  else { drawLeg(J.hipR, J.kneeR, J.footR); drawArm(J.shR, J.elR, J.handR); }
  // torso (kit)
  stroke(ctx, J.hip, J.shoulder, style.kit, lw * 2.6);
  stroke(ctx, J.shL, J.shR, style.kit, lw * 1.6);
  // shorts band
  stroke(ctx, J.hipL, J.hipR, style.shorts, lw * 1.9);
  if (leftCloser) { drawLeg(J.hipL, J.kneeL, J.footL); drawArm(J.shL, J.elL, J.handL); }
  else { drawLeg(J.hipR, J.kneeR, J.footR); drawArm(J.shR, J.elR, J.handR); }
  // head
  ctx.fillStyle = style.skin;
  ctx.beginPath(); ctx.arc(J.head[0], J.head[1], HEAD_R * ppm, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(1, lw * 0.5); ctx.stroke();
  // hair: a cap on top, oriented by heading (slightly toward facing)
  ctx.fillStyle = style.hair;
  ctx.beginPath();
  const hr = HEAD_R * ppm;
  ctx.arc(J.head[0] - fx * hr * 0.15, J.head[1] - hr * 0.1, hr * 1.02, Math.PI + 0.25, Math.PI * 2 - 0.25);
  ctx.fill();
  // number on torso
  if (opts.number !== undefined && ppm > 14) {
    const mx = (J.hip[0] + J.shoulder[0]) / 2, my = (J.hip[1] + J.shoulder[1]) / 2;
    ctx.fillStyle = style.number;
    ctx.font = `bold ${Math.max(7, 0.18 * ppm)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(opts.number), mx, my);
  }
}

function stroke(ctx: CanvasRenderingContext2D, a: Joint, b: Joint, color: string, width: number) {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}

export function headScreenPos(cam: Camera, wx: number, wy: number, pose: Pose) {
  const u = pose.hipH + TORSO + NECK + HEAD_R * 2 + pose.bodyZ;
  return { x: cam.sx(wx), y: cam.sy(wy, u * Math.max(0.2, 1 - Math.abs(pose.lying))) };
}

export { angleLerp, clamp };
