import { CONFIG } from '../config';
import { Camera } from '../core/camera';
import { clamp01 } from '../core/math';

export class BallTrail {
  pts: { x: number; y: number; z: number; a: number }[] = [];
  push(x: number, y: number, z: number, strength: number) {
    this.pts.push({ x, y, z, a: strength });
    if (this.pts.length > 18) this.pts.shift();
  }
  fade(dt: number) {
    for (const p of this.pts) p.a -= dt * 2.5;
    while (this.pts.length && this.pts[0].a <= 0) this.pts.shift();
  }
}

export function drawBallShadow(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, z: number) {
  const ppm = cam.ppm;
  const k = clamp01(1 - z * 0.25);
  ctx.fillStyle = `rgba(0,0,0,${0.3 * k + 0.05})`;
  ctx.beginPath();
  ctx.ellipse(cam.sx(x), cam.sy(y) + 0.02 * ppm, (0.14 + z * 0.05) * ppm, (0.07 + z * 0.02) * ppm, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawBall(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, z: number, roll: number, trail?: BallTrail) {
  const ppm = cam.ppm;
  const r = CONFIG.BALL_RADIUS * 1.35 * ppm;
  if (trail) {
    for (const p of trail.pts) {
      if (p.a <= 0) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.35 * p.a})`;
      ctx.beginPath(); ctx.arc(cam.sx(p.x), cam.sy(p.y, p.z), r * (0.5 + 0.5 * p.a), 0, Math.PI * 2); ctx.fill();
    }
  }
  const sx = cam.sx(x), sy = cam.sy(y, z);
  ctx.fillStyle = '#f6f6f2';
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  // panels
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#2b2b2b';
  for (let i = 0; i < 3; i++) {
    const a = roll + (i * Math.PI * 2) / 3;
    const px = sx + Math.cos(a) * r * 0.55, py = sy + Math.sin(a) * r * 0.55;
    ctx.beginPath(); ctx.arc(px, py, r * 0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
}
