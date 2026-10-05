import { CONFIG } from '../config';
import type { InputManager } from '../core/input';
import type { AudioManager } from '../core/audio';
import { roundRect, text, textShadow } from '../render/text';

export interface MenuItem {
  label: string;
  /** optional value shown on the right; left/right changes it via onChange */
  value?: () => string;
  onChange?: (dir: -1 | 1) => void;
  onSelect?: () => void;
  disabled?: boolean;
  hint?: string;
}

/** Vertical menu navigable by keyboard/gamepad (both players' inputs + generic keys). */
export class Menu {
  index = 0;
  constructor(public items: MenuItem[]) {}

  update(input: InputManager, audio: AudioManager): 'select' | 'back' | null {
    const ui = input.ui.pressed;
    const n = this.items.length;
    if (!n) return ui.back ? 'back' : null;
    if (ui.down) { this.index = (this.index + 1) % n; audio.ui('move'); }
    if (ui.up) { this.index = (this.index - 1 + n) % n; audio.ui('move'); }
    const it = this.items[this.index];
    if (it.disabled) return ui.back ? 'back' : null;
    if (ui.left && it.onChange) { it.onChange(-1); audio.ui('move'); }
    if (ui.right && it.onChange) { it.onChange(1); audio.ui('move'); }
    if (ui.confirm) {
      if (it.onSelect) { audio.ui('confirm'); it.onSelect(); return 'select'; }
      if (it.onChange) { it.onChange(1); audio.ui('move'); }
    }
    if (ui.back) { audio.ui('back'); return 'back'; }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rowH = 44, t = 0) {
    this.items.forEach((it, i) => {
      const sel = i === this.index;
      const yy = y + i * rowH;
      if (sel) roundRect(ctx, x - 10, yy - rowH / 2 + 4, w + 20, rowH - 8, 8, 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.35)');
      const col = it.disabled ? '#6b7280' : sel ? '#ffffff' : '#d1d5db';
      text(ctx, (sel ? '▶ ' : '   ') + it.label, x, yy, 22, col, 'left', sel ? 'bold' : 'normal');
      if (it.value) {
        const v = it.value();
        text(ctx, sel && it.onChange ? `◀  ${v}  ▶` : v, x + w, yy, 20, sel ? '#fde68a' : '#e5e7eb', 'right', 'bold');
      }
    });
    const it = this.items[this.index];
    if (it?.hint) text(ctx, it.hint, x + w / 2, y + this.items.length * rowH + 10, 14, '#9ca3af', 'center');
  }
}

export function drawBackground(ctx: CanvasRenderingContext2D, t: number) {
  const W = CONFIG.LOGICAL_W, H = CONFIG.LOGICAL_H;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0f2a1a'); g.addColorStop(1, '#071510');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // subtle moving pitch lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const yy = ((t * 20 + i * 120) % (H + 120)) - 60;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy + 40); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 220, 0, Math.PI * 2); ctx.stroke();
}

export function drawTitle(ctx: CanvasRenderingContext2D, title: string, sub?: string) {
  textShadow(ctx, title, CONFIG.LOGICAL_W / 2, 70, 44, '#fde68a', 'center', '900');
  if (sub) text(ctx, sub, CONFIG.LOGICAL_W / 2, 112, 18, '#9ca3af', 'center');
}

export function drawFooter(ctx: CanvasRenderingContext2D, s: string) {
  text(ctx, s, CONFIG.LOGICAL_W / 2, CONFIG.LOGICAL_H - 24, 14, '#9ca3af', 'center');
}

export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title?: string) {
  roundRect(ctx, x, y, w, h, 12, 'rgba(6,12,10,0.78)', 'rgba(255,255,255,0.18)', 1.5);
  if (title) text(ctx, title, x + 18, y + 24, 16, '#fde68a', 'left', 'bold');
}
