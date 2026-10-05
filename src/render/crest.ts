import type { TeamInfo } from '../sim/types';
import { text } from './text';

/** Procedural crest placeholder: a shield in the team colors with the short name. */
export function drawCrest(ctx: CanvasRenderingContext2D, team: TeamInfo, x: number, y: number, size: number) {
  const w = size, h = size * 1.15;
  ctx.save();
  ctx.translate(x, y);
  const shield = () => {
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2, h * 0.1);
    ctx.quadraticCurveTo(w / 2, h * 0.4, 0, h / 2);
    ctx.quadraticCurveTo(-w / 2, h * 0.4, -w / 2, h * 0.1);
    ctx.closePath();
  };
  shield(); ctx.fillStyle = team.kit.primary; ctx.fill();
  ctx.save(); shield(); ctx.clip();
  ctx.fillStyle = team.kit.secondary;
  // pattern: vertical stripes on one half
  for (let i = 0; i < 3; i++) ctx.fillRect(-w / 2 + i * (w / 3) + (i % 2 ? 0 : w / 6), -h / 2, w / 6, h);
  ctx.fillStyle = team.kit.primary;
  ctx.fillRect(-w / 2, -h * 0.15, w, h * 0.3);
  ctx.restore();
  shield(); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = Math.max(1.5, size * 0.05); ctx.stroke();
  shield(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, size * 0.02); ctx.stroke();
  const lum = luminance(team.kit.primary);
  text(ctx, team.short, 0, 0, size * 0.26, lum > 0.5 ? '#111' : '#fff', 'center', '900');
  ctx.restore();
}

export function luminance(hex: string) {
  const v = parseInt(hex.replace('#', ''), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
export const contrastText = (hex: string) => (luminance(hex) > 0.55 ? '#111' : '#fff');
