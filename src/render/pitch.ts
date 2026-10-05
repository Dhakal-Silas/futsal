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

/** Draws goal frames and nets. `front` = draw the part that should overlay players (near post + top). */
export function drawGoals(ctx: CanvasRenderingContext2D, cam: Camera, nets: [NetState, NetState], layer: 'back' | 'front') {
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const gx = side * HALF_LENGTH;
    const gw = CONFIG.GOAL_WIDTH / 2;
    const h = CONFIG.GOAL_HEIGHT;
    const d = CONFIG.GOAL_DEPTH;
    const bx = gx + side * d; // back of net x
    const net = nets[i];
    const rip = net.ripple;

    const px0 = cam.sx(gx), px1 = cam.sx(bx);
    const yTop = cam.sy(-gw), yBot = cam.sy(gw);
    const yTopH = cam.sy(-gw, h), yBotH = cam.sy(gw, h);

    if (layer === 'back') {
      // net mesh (back panel & side panels), slightly translucent
      ctx.save();
      ctx.strokeStyle = 'rgba(235,235,245,0.55)';
      ctx.lineWidth = 1;
      const cells = 7;
      // back panel: from (bx, -gw, 0..h) to (bx, gw, 0..h)
      for (let c = 0; c <= cells; c++) {
        const t = c / cells;
        const wy = -gw + 2 * gw * t;
        const wobble = Math.sin(net.phase + t * 6) * rip * 0.25;
        ctx.beginPath();
        ctx.moveTo(px1 + wobble * cam.ppm, cam.sy(wy));
        ctx.lineTo(px1 + wobble * cam.ppm, cam.sy(wy, h));
        ctx.stroke();
      }
      for (let c = 0; c <= cells; c++) {
        const t = c / cells;
        const wz = h * t;
        const wobble = Math.sin(net.phase * 1.3 + t * 5) * rip * 0.25;
        ctx.beginPath();
        ctx.moveTo(px1 + wobble * cam.ppm, cam.sy(-gw, wz));
        ctx.lineTo(px1 + wobble * cam.ppm, cam.sy(gw, wz));
        ctx.stroke();
      }
      // top panel (roof) and side panels as outlines
      ctx.beginPath();
      ctx.moveTo(px0, yTopH); ctx.lineTo(px1, yTopH); ctx.lineTo(px1, yBotH); ctx.lineTo(px0, yBotH);
      ctx.stroke();
      // side nets diagonal mesh
      for (let c = 1; c < 4; c++) {
        const t = c / 4;
        ctx.beginPath();
        ctx.moveTo(px0 + (px1 - px0) * t, yTop); ctx.lineTo(px0 + (px1 - px0) * t, yTopH); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px0 + (px1 - px0) * t, yBot); ctx.lineTo(px0 + (px1 - px0) * t, yBotH); ctx.stroke();
      }
      // back post bases
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(2, 0.1 * cam.ppm);
      ctx.beginPath(); ctx.moveTo(px1, yTop); ctx.lineTo(px1, yTopH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px1, yBot); ctx.lineTo(px1, yBotH); ctx.stroke();
      ctx.restore();
    } else {
      // front frame: posts and crossbar
      ctx.save();
      ctx.strokeStyle = '#f4f4f8';
      ctx.lineWidth = Math.max(2.5, 0.12 * cam.ppm);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px0, yTop); ctx.lineTo(px0, yTopH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px0, yBot); ctx.lineTo(px0, yBotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px0, yTopH); ctx.lineTo(px0, yBotH); ctx.stroke();
      // thin top bars to the back
      ctx.lineWidth = Math.max(1.5, 0.06 * cam.ppm);
      ctx.strokeStyle = 'rgba(244,244,248,0.8)';
      ctx.beginPath(); ctx.moveTo(px0, yTopH); ctx.lineTo(px1, yTopH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px0, yBotH); ctx.lineTo(px1, yBotH); ctx.stroke();
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
