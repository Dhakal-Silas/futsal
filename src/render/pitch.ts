import { CONFIG, HALF_LENGTH, HALF_WIDTH } from '../config';
import { Camera } from '../core/camera';

export interface NetState { ripple: number; phase: number; }

const GRASS_A = '#2f8f4a';
const GRASS_B = '#2a8243';
const LINE = 'rgba(255,255,255,0.92)';

/** Draws the futsal pitch, lines, and goals in world coordinates through the camera. */
export function drawPitch(ctx: CanvasRenderingContext2D, cam: Camera, quality: number) {
  const L = HALF_LENGTH, W = HALF_WIDTH;
  const m = CONFIG.OUT_MARGIN + 6;
  // surround
  ctx.fillStyle = '#23703a';
  ctx.fillRect(cam.sx(-L - m), cam.sy(-W - m), (2 * L + 2 * m) * cam.ppm, (2 * W + 2 * m) * cam.ppm * CONFIG.Y_FORESHORTEN);

  // stripes
  const stripes = 10;
  const sw = (2 * L) / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? GRASS_A : GRASS_B;
    const x0 = cam.sx(-L + i * sw), x1 = cam.sx(-L + (i + 1) * sw);
    ctx.fillRect(x0, cam.sy(-W), x1 - x0 + 0.5, 2 * W * cam.ppm * CONFIG.Y_FORESHORTEN);
  }
  // subtle vignette shading toward the edges (quality > 0)
  if (quality > 0) {
    const g = ctx.createLinearGradient(0, cam.sy(-W), 0, cam.sy(W));
    g.addColorStop(0, 'rgba(0,0,0,0.10)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(cam.sx(-L), cam.sy(-W), 2 * L * cam.ppm, 2 * W * cam.ppm * CONFIG.Y_FORESHORTEN);
  }

  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.5, 0.08 * cam.ppm);
  ctx.lineJoin = 'round';

  // boundary
  rectPath(ctx, cam, -L, -W, L, W); ctx.stroke();
  // halfway line
  ctx.beginPath(); ctx.moveTo(cam.sx(0), cam.sy(-W)); ctx.lineTo(cam.sx(0), cam.sy(W)); ctx.stroke();
  // center circle & spot
  ellipse(ctx, cam, 0, 0, CONFIG.CENTER_CIRCLE_R); ctx.stroke();
  spot(ctx, cam, 0, 0);

  // penalty areas: quarter circles from each post joined by a straight line (futsal D)
  for (const side of [-1, 1]) {
    const gx = side * L;
    const r = CONFIG.PENALTY_AREA_RADIUS;
    const gw = CONFIG.GOAL_WIDTH / 2;
    ctx.beginPath();
    // top arc from (gx, -gw) sweeping toward the pitch interior
    const sxc = cam.sx(gx);
    const rx = r * cam.ppm, ry = r * cam.ppm * CONFIG.Y_FORESHORTEN;
    if (side < 0) {
      ctx.ellipse(sxc, cam.sy(-gw), rx, ry, 0, -Math.PI / 2, 0, false);
      ctx.lineTo(cam.sx(gx + r), cam.sy(gw));
      ctx.ellipse(sxc, cam.sy(gw), rx, ry, 0, 0, Math.PI / 2, false);
    } else {
      ctx.ellipse(sxc, cam.sy(-gw), rx, ry, 0, -Math.PI / 2, Math.PI, true);
      ctx.lineTo(cam.sx(gx - r), cam.sy(gw));
      ctx.ellipse(sxc, cam.sy(gw), rx, ry, 0, Math.PI, Math.PI / 2, true);
    }
    ctx.stroke();
    spot(ctx, cam, gx - side * CONFIG.PENALTY_SPOT, 0);
    spot(ctx, cam, gx - side * CONFIG.SECOND_PENALTY_SPOT, 0);
    // substitution zone marks / corner arcs
    const ca = 0.25;
    for (const cy of [-W, W]) {
      ctx.beginPath();
      ctx.ellipse(cam.sx(gx), cam.sy(cy), ca * cam.ppm, ca * cam.ppm * CONFIG.Y_FORESHORTEN, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Draws goal frames and nets. 'back' = net and far frame (behind players), 'front' = posts and crossbar. */
export function drawGoals(ctx: CanvasRenderingContext2D, cam: Camera, nets: [NetState, NetState], layer: 'back' | 'front') {
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const gx = side * HALF_LENGTH;
    const gw = CONFIG.GOAL_WIDTH / 2;
    const h = CONFIG.GOAL_HEIGHT;
    const d = CONFIG.GOAL_DEPTH;
    const bx = gx + side * d;
    const net = nets[i];
    const rip = net.ripple;
    const wob = (t: number, k: number) => Math.sin(net.phase * k + t * 7) * rip * 0.2 * cam.ppm;
    const fx = cam.sx(gx), rx = cam.sx(bx);
    const yT = cam.sy(-gw), yB = cam.sy(gw), yTH = cam.sy(-gw, h), yBH = cam.sy(gw, h);
    const postW = Math.max(3, 0.13 * cam.ppm);

    if (layer === 'back') {
      // dark net interior (ground + back panel) to read as a box
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.moveTo(fx, yT); ctx.lineTo(rx, yT); ctx.lineTo(rx, yB); ctx.lineTo(fx, yB); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(20,30,25,0.35)';
      ctx.beginPath(); ctx.moveTo(rx, yT); ctx.lineTo(rx, yTH); ctx.lineTo(rx, yBH); ctx.lineTo(rx, yB); ctx.closePath(); ctx.fill();
      // mesh: back panel (vertical + horizontal), roof (depth lines), side panels (diagonals)
      ctx.strokeStyle = 'rgba(240,240,250,0.5)'; ctx.lineWidth = 1;
      const cells = 8, rows = 5;
      for (let c = 0; c <= cells; c++) {
        const t = c / cells, wy = -gw + 2 * gw * t;
        const w = wob(t, 1.0);
        ctx.beginPath(); ctx.moveTo(rx + w, cam.sy(wy)); ctx.lineTo(rx + w, cam.sy(wy, h)); ctx.stroke();
        // roof depth line
        ctx.beginPath(); ctx.moveTo(fx, cam.sy(wy, h)); ctx.lineTo(rx + w, cam.sy(wy, h)); ctx.stroke();
      }
      for (let r = 0; r <= rows; r++) {
        const t = r / rows, wz = h * t;
        const w = wob(t, 1.3);
        ctx.beginPath(); ctx.moveTo(rx + w, cam.sy(-gw, wz)); ctx.lineTo(rx + w, cam.sy(gw, wz)); ctx.stroke();
      }
      for (let c = 1; c <= 4; c++) {
        const t = c / 4;
        const xx = fx + (rx - fx) * t;
        for (const [y0, y1] of [[yT, yTH], [yB, yBH]]) { ctx.beginPath(); ctx.moveTo(xx, y0); ctx.lineTo(xx, y1); ctx.stroke(); }
      }
      for (let r = 1; r < rows; r++) {
        const wz = h * r / rows;
        ctx.beginPath(); ctx.moveTo(fx, cam.sy(-gw, wz)); ctx.lineTo(rx, cam.sy(-gw, wz)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(fx, cam.sy(gw, wz)); ctx.lineTo(rx, cam.sy(gw, wz)); ctx.stroke();
      }
      // back frame (grey, thinner) + ground bar
      ctx.strokeStyle = '#cfd3da'; ctx.lineWidth = postW * 0.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(rx, yT); ctx.lineTo(rx, yTH); ctx.lineTo(rx, yBH); ctx.lineTo(rx, yB); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx, yT); ctx.lineTo(rx, yT); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx, yB); ctx.lineTo(rx, yB); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx, yTH); ctx.lineTo(rx, yTH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx, yBH); ctx.lineTo(rx, yBH); ctx.stroke();
      ctx.restore();
    } else {
      // front frame: two posts and the crossbar with a shaded edge
      ctx.save(); ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = postW + 2;
      ctx.beginPath(); ctx.moveTo(fx, yT); ctx.lineTo(fx, yTH); ctx.lineTo(fx, yBH); ctx.lineTo(fx, yB); ctx.stroke();
      ctx.strokeStyle = '#f7f7fb'; ctx.lineWidth = postW;
      ctx.beginPath(); ctx.moveTo(fx, yT); ctx.lineTo(fx, yTH); ctx.lineTo(fx, yBH); ctx.lineTo(fx, yB); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = Math.max(1, postW * 0.3);
      ctx.beginPath(); ctx.moveTo(fx + postW * 0.35, yT); ctx.lineTo(fx + postW * 0.35, yTH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx + postW * 0.35, yB); ctx.lineTo(fx + postW * 0.35, yBH); ctx.stroke();
      ctx.restore();
    }
  }
}

function rectPath(ctx: CanvasRenderingContext2D, cam: Camera, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.rect(cam.sx(x0), cam.sy(y0), (x1 - x0) * cam.ppm, (y1 - y0) * cam.ppm * CONFIG.Y_FORESHORTEN);
}
function ellipse(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.ellipse(cam.sx(x), cam.sy(y), r * cam.ppm, r * cam.ppm * CONFIG.Y_FORESHORTEN, 0, 0, Math.PI * 2);
}
function spot(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number) {
  ctx.fillStyle = LINE;
  ctx.beginPath();
  ctx.ellipse(cam.sx(x), cam.sy(y), Math.max(2, 0.1 * cam.ppm), Math.max(1.5, 0.1 * cam.ppm * CONFIG.Y_FORESHORTEN), 0, 0, Math.PI * 2);
  ctx.fill();
}
