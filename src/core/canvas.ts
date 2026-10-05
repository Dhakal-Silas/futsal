import { CONFIG } from '../config';

/** Handles pixel-perfect scaling of a 1280x720 logical canvas to the window with devicePixelRatio. */
export class CanvasScaler {
  ctx: CanvasRenderingContext2D;
  scale = 1;
  constructor(public canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ww = window.innerWidth, wh = window.innerHeight;
    const s = Math.min(ww / CONFIG.LOGICAL_W, wh / CONFIG.LOGICAL_H);
    this.scale = s;
    const cssW = Math.floor(CONFIG.LOGICAL_W * s), cssH = Math.floor(CONFIG.LOGICAL_H * s);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  }
  /** Reset the transform each frame (in case any code messed with it). */
  begin() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }
}
