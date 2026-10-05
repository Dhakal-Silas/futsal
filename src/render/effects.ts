import { CONFIG } from '../config';
import { Camera } from '../core/camera';

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; maxLife: number; size: number; color: string; gravity: number; }

/** Pool-based particle system drawn in world space (dust, confetti, sparks). */
export class Effects {
  private pool: Particle[] = [];
  private active: Particle[] = [];
  enabled = true;
  constructor() { for (let i = 0; i < 600; i++) this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0.1, color: '#fff', gravity: 0 }); }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string, gravity = 0) {
    if (!this.enabled) return;
    const p = this.pool.pop(); if (!p) return;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.maxLife = life; p.size = size; p.color = color; p.gravity = gravity;
    this.active.push(p);
  }

  dust(x: number, y: number, amount = 3, strength = 1) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.2, 0.05, Math.cos(a) * 0.6 * strength, Math.sin(a) * 0.4 * strength, 0.5 + Math.random() * 0.6, 0.35 + Math.random() * 0.25, 0.12 + Math.random() * 0.1, 'rgba(210,190,150,0.55)', 1.5);
    }
  }
  sparks(x: number, y: number, z: number, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(x, y, z, Math.cos(a) * 3, Math.sin(a) * 3, 2 + Math.random() * 2, 0.4, 0.05, '#ffffff', 9);
    }
  }
  confetti(x: number, y: number, n = 120, colors = ['#ffd700', '#ff4d4d', '#4dd2ff', '#7cfc00', '#ff8cff'], size = 0.12) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 4;
      this.spawn(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 2, 2 + Math.random() * 2, Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.3, 3 + Math.random() * 5, 2.5 + Math.random() * 1.5, size, colors[i % colors.length], 2.2);
    }
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      p.vz -= p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.3; p.vx *= 0.8; p.vy *= 0.8; }
      if (p.life <= 0) { this.active.splice(i, 1); this.pool.push(p); }
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera) {
    for (const p of this.active) {
      const a = Math.min(1, p.life / p.maxLife * 2);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const sx = cam.sx(p.x), sy = cam.sy(p.y, p.z);
      const r = p.size * cam.ppm;
      if (p.gravity > 2) { ctx.fillRect(sx - r, sy - r * 0.6, r * 2, r * 1.2); }
      else { ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
  clear() { while (this.active.length) this.pool.push(this.active.pop()!); }
  get count() { return this.active.length; }
}

export const _c = CONFIG;
