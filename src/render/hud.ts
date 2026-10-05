import { CONFIG, HALF_LENGTH, HALF_WIDTH } from '../config';
import { Camera } from '../core/camera';
import type { InputManager, GameAction } from '../core/input';
import type { Match } from '../sim/match';
import type { Player } from '../sim/types';
import { contrastText } from './crest';
import { fmtClock, roundRect, text, textShadow } from './text';
import { InputManager as IM } from '../core/input';

export const P_COLORS = ['#38bdf8', '#fb7185'];

/** In-match heads-up display. Pure drawing; reads match state. */
export class Hud {
  showHints = true;
  minimap = true;

  drawScoreboard(ctx: CanvasRenderingContext2D, m: Match) {
    const W = CONFIG.LOGICAL_W;
    const t0 = m.team(0), t1 = m.team(1);
    const x = W / 2, y = 22;
    roundRect(ctx, x - 190, 6, 380, 36, 8, 'rgba(10,14,20,0.82)', 'rgba(255,255,255,0.15)');
    // team blocks
    roundRect(ctx, x - 186, 9, 70, 30, 6, t0.kit.primary);
    text(ctx, t0.short, x - 151, 24, 17, contrastText(t0.kit.primary), 'center', '900');
    roundRect(ctx, x + 116, 9, 70, 30, 6, t1.kit.primary);
    text(ctx, t1.short, x + 151, 24, 17, contrastText(t1.kit.primary), 'center', '900');
    text(ctx, `${m.score[0]}  -  ${m.score[1]}`, x, 24, 22, '#fff', 'center', '900');
    // clock
    const clock = fmtClock(m.displayClock);
    const half = m.half === 1 ? '1ST' : m.half === 2 ? '2ND' : m.half === 3 ? 'ET1' : 'ET2';
    text(ctx, clock, x - 75, 24, 18, '#f3f4f6', 'center', 'bold');
    text(ctx, half, x + 75, 24, 13, '#cbd5e1', 'center', 'bold');
    if (m.penalties) {
      const p = m.penalties;
      roundRect(ctx, x - 150, 46, 300, 26, 6, 'rgba(10,14,20,0.8)');
      const h0 = p.history[0].map((r) => (r === 'scored' ? '●' : '○')).join(' ');
      const h1 = p.history[1].map((r) => (r === 'scored' ? '●' : '○')).join(' ');
      text(ctx, `${h0}  ${p.scores[0]} PENS ${p.scores[1]}  ${h1}`, x, 59, 14, '#fff', 'center', 'bold');
    }
  }

  drawBanner(ctx: CanvasRenderingContext2D, m: Match) {
    const b = m.banner; if (!b) return;
    const W = CONFIG.LOGICAL_W, H = CONFIG.LOGICAL_H;
    const a = Math.min(1, b.t * 2.5);
    ctx.save(); ctx.globalAlpha = a;
    const big = b.text.length <= 6;
    roundRect(ctx, W / 2 - 260, H * 0.3 - 44, 520, 88, 14, 'rgba(8,10,16,0.78)', b.color, 3);
    textShadow(ctx, b.text, W / 2, H * 0.3 - (b.sub ? 10 : 0), big ? 54 : 34, b.color, 'center', '900');
    if (b.sub) text(ctx, b.sub, W / 2, H * 0.3 + 26, 18, '#e5e7eb', 'center', 'bold');
    ctx.restore();
  }

  /** Marker above the human-controlled player + ring under feet. */
  drawActiveMarker(ctx: CanvasRenderingContext2D, cam: Camera, p: Player, slot: number, headY: number, sx: number, sy: number, t: number) {
    const col = P_COLORS[slot];
    const bob = Math.sin(t * 5) * 3;
    const y = headY - 14 + bob;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(sx, y + 6); ctx.lineTo(sx - 9, y - 8); ctx.lineTo(sx + 9, y - 8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    text(ctx, `P${slot + 1}  #${p.number}`, sx, y - 20, 12, col, 'center', 'bold');
    // stamina bar under the name
    const sw = 40, sh = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(sx - sw / 2, y - 12, sw, sh);
    const st = p.stamina / CONFIG.STAMINA_MAX;
    ctx.fillStyle = st > 0.3 ? '#4ade80' : '#f87171'; ctx.fillRect(sx - sw / 2, y - 12, sw * st, sh);
  }
  drawRing(ctx: CanvasRenderingContext2D, cam: Camera, sx: number, sy: number, slot: number) {
    ctx.strokeStyle = P_COLORS[slot]; ctx.lineWidth = Math.max(2, 0.07 * cam.ppm);
    ctx.beginPath(); ctx.ellipse(sx, sy + 0.02 * cam.ppm, 0.55 * cam.ppm, 0.24 * cam.ppm, 0, 0, Math.PI * 2); ctx.stroke();
  }
  drawPassTarget(ctx: CanvasRenderingContext2D, cam: Camera, from: Player, to: Player, slot: number, headY: number, sx: number, sy: number) {
    const col = P_COLORS[slot];
    ctx.save(); ctx.globalAlpha = 0.85;
    ctx.setLineDash([6, 6]); ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cam.sx(from.x), cam.sy(from.y)); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(sx, sy + 0.02 * cam.ppm, 0.45 * cam.ppm, 0.2 * cam.ppm, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(sx, headY - 8); ctx.lineTo(sx - 6, headY - 18); ctx.lineTo(sx + 6, headY - 18); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  drawPowerBar(ctx: CanvasRenderingContext2D, cam: Camera, p: Player, sx: number, sy: number) {
    if (!p.charging) return;
    const w = 50, h = 7;
    const x = sx - w / 2, y = sy + 0.35 * cam.ppm;
    roundRect(ctx, x - 1, y - 1, w + 2, h + 2, 3, 'rgba(0,0,0,0.6)');
    const t = p.charging.t;
    const col = t < 0.5 ? '#4ade80' : t < 0.85 ? '#facc15' : '#f87171';
    ctx.fillStyle = col; ctx.fillRect(x, y, w * t, h);
    text(ctx, p.charging.type.toUpperCase(), sx, y + 16, 10, '#fff', 'center', 'bold');
  }

  drawHints(ctx: CanvasRenderingContext2D, m: Match, input: InputManager, slot: number, team: 0 | 1, attacking: boolean, taker: boolean) {
    if (!this.showHints) return;
    const b = input.bindings[slot];
    const k = (a: GameAction) => IM.keyName(b[a][0]);
    const lines = taker
      ? [`${k('pass')} pass`, `${k('cross')} cross`, `${k('shoot')} shoot`]
      : attacking
        ? [`${k('pass')} pass`, `${k('through')} through`, `${k('shoot')} shoot (hold)`, `${k('cross')} cross`, `${k('sprint')} sprint`]
        : [`${k('pass')} press`, `${k('shoot')} contain`, `${k('slide')} slide`, `${k('switch')} switch`, `${k('sprint')} sprint`];
    const x = slot === 0 ? 14 : CONFIG.LOGICAL_W - 14;
    const y = CONFIG.LOGICAL_H - 14 - lines.length * 16;
    roundRect(ctx, slot === 0 ? 8 : CONFIG.LOGICAL_W - 8 - 150, y - 20, 150, lines.length * 16 + 26, 6, 'rgba(8,10,16,0.55)');
    text(ctx, `P${slot + 1} ${m.team(team).short} — ${taker ? 'SET PIECE' : attacking ? 'ATTACK' : 'DEFEND'}`, x, y - 8, 11, P_COLORS[slot], slot === 0 ? 'left' : 'right', 'bold');
    lines.forEach((l, i) => text(ctx, l, x, y + 10 + i * 16, 12, '#e5e7eb', slot === 0 ? 'left' : 'right'));
  }

  drawMinimap(ctx: CanvasRenderingContext2D, m: Match) {
    if (!this.minimap) return;
    const w = 160, h = 80;
    const x = CONFIG.LOGICAL_W / 2 - w / 2, y = CONFIG.LOGICAL_H - h - 10;
    roundRect(ctx, x, y, w, h, 4, 'rgba(20,80,40,0.7)', 'rgba(255,255,255,0.5)');
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
    const mx = (wx: number) => x + ((wx + HALF_LENGTH) / CONFIG.PITCH_LENGTH) * w;
    const my = (wy: number) => y + ((wy + HALF_WIDTH) / CONFIG.PITCH_WIDTH) * h;
    for (const p of m.sim.players) {
      ctx.fillStyle = p.isKeeper ? m.team(p.team).kit.keeper : m.team(p.team).kit.primary;
      ctx.beginPath(); ctx.arc(mx(p.x), my(p.y), p.controlledBy >= 0 ? 4 : 3, 0, Math.PI * 2); ctx.fill();
      if (p.controlledBy >= 0) { ctx.strokeStyle = P_COLORS[p.controlledBy]; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx(m.ball.x), my(m.ball.y), 2.5, 0, Math.PI * 2); ctx.fill();
  }

  drawPenaltyAim(ctx: CanvasRenderingContext2D, cam: Camera, m: Match) {
    const p = m.penalties; if (!p || p.stage !== 'aiming') return;
    const gw = CONFIG.GOAL_WIDTH / 2;
    const ty = p.aimX * (gw + 0.25), tz = p.aimY * (CONFIG.GOAL_HEIGHT + 0.5);
    const sx = cam.sx(HALF_LENGTH), sy = cam.sy(ty, tz);
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 16, sy); ctx.lineTo(sx + 16, sy); ctx.moveTo(sx, sy - 16); ctx.lineTo(sx, sy + 16); ctx.stroke();
    const shooter = p.shooter;
    if (m.isHuman(shooter.team as 0 | 1)) {
      const slot = m.opts.humanSlots[shooter.team];
      const b = m.sim && (null as any);
      text(ctx, `P${slot + 1}: aim with move keys, hold SHOOT to charge, release to kick`, CONFIG.LOGICAL_W / 2, CONFIG.LOGICAL_H - 40, 15, '#fff', 'center', 'bold');
      void b;
    } else text(ctx, `${m.team(shooter.team).name} to shoot`, CONFIG.LOGICAL_W / 2, CONFIG.LOGICAL_H - 40, 15, '#fff', 'center', 'bold');
  }

  drawWaitPrompt(ctx: CanvasRenderingContext2D, m: Match, input: InputManager) {
    if ((m.phase === 'kickoff' || m.phase === 'restart') && m.restart && m.restart.ready) {
      const r = m.restart;
      if (m.isHuman(r.team) && !m.player(r.takerId).isKeeper) {
        const slot = m.opts.humanSlots[r.team];
        const k = IM.keyName(input.bindings[slot].pass[0]);
        const name = r.type === 'kickoff' ? 'KICK-OFF' : r.type === 'kickin' ? 'KICK-IN' : r.type === 'corner' ? 'CORNER' : r.type === 'freekick' ? 'FREE KICK' : 'RESTART';
        text(ctx, `${name} — P${slot + 1} press ${k} to pass (or shoot / cross)`, CONFIG.LOGICAL_W / 2, 86, 15, '#fff', 'center', 'bold');
      }
    }
    if (m.phase === 'halftime') text(ctx, 'HALF TIME — press Enter to continue', CONFIG.LOGICAL_W / 2, CONFIG.LOGICAL_H * 0.5, 22, '#fff', 'center', '900');
    if (m.phase === 'extratime_break') text(ctx, 'EXTRA TIME — press Enter to continue', CONFIG.LOGICAL_W / 2, CONFIG.LOGICAL_H * 0.5, 22, '#fff', 'center', '900');
  }
}
