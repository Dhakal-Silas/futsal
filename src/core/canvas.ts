import { VIEW, updateViewSize } from './view';

/** Scales the logical canvas (720 px tall, width follows the window aspect) to fill the window with devicePixelRatio. */
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
    updateViewSize(ww, wh);
    const s = Math.min(ww / VIEW.w, wh / VIEW.h);
    this.scale = s;
    const cssW = Math.floor(VIEW.w * s), cssH = Math.floor(VIEW.h * s);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  }
  begin() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }
}
