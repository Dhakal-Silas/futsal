/** Small text helpers to keep font setup consistent. */
export const FONT = '"Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const MONO = '"Consolas", "Menlo", monospace';

export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'left', weight: 'normal' | 'bold' | '900' = 'normal', baseline: CanvasTextBaseline = 'middle') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = baseline;
  ctx.fillText(s, x, y);
}
export function textShadow(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'left', weight: 'normal' | 'bold' | '900' = 'bold') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(s, x + size * 0.06, y + size * 0.06);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill?: string, stroke?: string, lw = 1) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
export function fmtClock(sec: number) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
