import { CONFIG } from '../config';
import type { Screen } from './screen';
import type { App } from './app';
import { drawBackground, drawFooter, drawPanel, drawTitle } from './widgets';
import { roundRect, text } from '../render/text';
import { FORMATIONS, type Formation } from '../sim/formation';
import { P_COLORS } from '../render/hud';
import type { TeamInfo } from '../sim/types';
import { DIFFICULTIES } from '../ai/difficulty';

/**
 * Formation picker with a mini-pitch preview. One column per human player. In quick match the
 * difficulty can also be changed here. Also used from the pause menu / half time (single team).
 */
export class FormationSelectScreen implements Screen {
  t = 0;
  idx: [number, number];
  confirmed: [boolean, boolean] = [false, false];
  focusRow = 0; // 0 = formation, 1 = difficulty (quick only)
  constructor(private app: App, private teams: [TeamInfo, TeamInfo], private humanSlots: [number, number], private showDifficulty: boolean, private onDone: (formations: [string, string]) => void, private single: 0 | 1 | null = null) {
    const f = (id: string) => Math.max(0, FORMATIONS.findIndex((x) => x.id === id));
    this.idx = [f(app.settings.formationP1), f(app.settings.formationP2)];
    if (single !== null) this.idx[single] = f(single === 0 ? app.settings.formationP1 : app.settings.formationP2);
  }
  get overlay() { return this.single !== null; }
  private humanTeams(): number[] { return [0, 1].filter((t) => this.humanSlots[t] >= 0); }
  update(dt: number) {
    this.t += dt;
    const input = this.app.input;
    const teams = this.single !== null ? [this.single] : this.humanTeams();
    if (teams.length === 0) teams.push(0);
    const ui = input.ui.pressed;
    if (teams.length === 2 && this.single === null) {
      for (const tm of teams) {
        const slot = this.humanSlots[tm] as 0 | 1;
        const st = input.players[slot];
        if (this.confirmed[tm]) { if (st.pressed.through || st.pressed.cross) this.confirmed[tm] = false; continue; }
        if (st.pressed.up) { this.idx[tm] = (this.idx[tm] - 1 + FORMATIONS.length) % FORMATIONS.length; this.app.audio.ui('move'); }
        if (st.pressed.down) { this.idx[tm] = (this.idx[tm] + 1) % FORMATIONS.length; this.app.audio.ui('move'); }
        if (st.pressed.pass || st.pressed.shoot || (slot === 0 && ui.confirm && input.ui.source === -1)) { this.confirmed[tm] = true; this.app.audio.ui('confirm'); }
      }
      if (ui.back && !this.confirmed[0] && !this.confirmed[1]) { this.app.audio.ui('back'); this.app.pop(); return; }
      if (this.confirmed[0] && this.confirmed[1]) this.finish();
      return;
    }
    const tm = teams[0];
    const rows = this.showDifficulty ? 2 : 1;
    if (ui.left || ui.right) {
      if (this.focusRow === 0) { this.idx[tm] = (this.idx[tm] + (ui.right ? 1 : -1) + FORMATIONS.length) % FORMATIONS.length; }
      else { const s = this.app.settings; s.difficulty = DIFFICULTIES[(DIFFICULTIES.indexOf(s.difficulty) + (ui.right ? 1 : -1) + 4) % 4]; this.app.save(); }
      this.app.audio.ui('move');
    }
    if (ui.up || ui.down) {
      if (rows > 1) { this.focusRow = (this.focusRow + 1) % rows; this.app.audio.ui('move'); }
      else { this.idx[tm] = (this.idx[tm] + (ui.down ? 1 : -1) + FORMATIONS.length) % FORMATIONS.length; this.app.audio.ui('move'); }
    }
    if (ui.confirm) { this.app.audio.ui('confirm'); this.finish(); }
    if (ui.back) { this.app.audio.ui('back'); this.app.pop(); }
  }
  private finish() {
    const s = this.app.settings;
    const f0 = FORMATIONS[this.idx[0]].id, f1 = FORMATIONS[this.idx[1]].id;
    if (this.single === null) {
      if (this.humanSlots[0] >= 0 || this.humanSlots[1] < 0) s.formationP1 = f0;
      if (this.humanSlots[1] >= 0) s.formationP2 = f1;
    } else { if (this.single === 0) s.formationP1 = f0; else s.formationP2 = f1; }
    this.app.save();
    this.onDone([f0, f1]);
  }
  render(ctx: CanvasRenderingContext2D) {
    if (this.single === null) drawBackground(ctx, this.t); else { ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, CONFIG.LOGICAL_W, CONFIG.LOGICAL_H); }
    drawTitle(ctx, this.single !== null ? 'CHANGE FORMATION' : 'FORMATION', '↑ ↓ / ← → choose   •   Enter confirm');
    const teams = this.single !== null ? [this.single] : this.humanTeams().length ? this.humanTeams() : [0];
    const W = CONFIG.LOGICAL_W;
    const colW = teams.length === 2 ? 560 : 760;
    teams.forEach((tm, ci) => {
      const x = teams.length === 2 ? 60 + ci * 600 : (W - colW) / 2;
      const y = 135;
      const team = this.teams[tm];
      const slot = this.humanSlots[tm];
      drawPanel(ctx, x, y, colW, 500, `${slot >= 0 ? 'P' + (slot + 1) + ' — ' : ''}${team.name}`);
      const f = FORMATIONS[this.idx[tm]];
      // list
      FORMATIONS.forEach((ff, i) => {
        const yy = y + 60 + i * 40;
        const sel = i === this.idx[tm];
        if (sel) roundRect(ctx, x + 14, yy - 16, 230, 32, 6, this.confirmed[tm] ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.12)', slot >= 0 ? P_COLORS[slot] : '#fff');
        text(ctx, ff.name, x + 26, yy, 18, sel ? '#fff' : '#d1d5db', 'left', sel ? 'bold' : 'normal');
      });
      text(ctx, f.description, x + 20, y + 60 + FORMATIONS.length * 40 + 10, 13, '#9ca3af', 'left');
      if (this.confirmed[tm]) text(ctx, 'READY ✓', x + 130, y + 60 + FORMATIONS.length * 40 + 36, 16, '#4ade80', 'center', 'bold');
      // preview
      drawMiniPitch(ctx, f, x + 270, y + 50, colW - 290, 200, team.kit.primary, 'attack');
      text(ctx, 'ATTACK SHAPE', x + 270 + (colW - 290) / 2, y + 265, 12, '#9ca3af', 'center', 'bold');
      drawMiniPitch(ctx, f, x + 270, y + 285, colW - 290, 200, team.kit.primary, 'defense');
      text(ctx, 'DEFENSIVE SHAPE', x + 270 + (colW - 290) / 2, y + 498, 12, '#9ca3af', 'center', 'bold');
      if (this.showDifficulty && ci === 0 && this.single === null) {
        const yy = y + 60 + FORMATIONS.length * 40 + 70;
        const sel = this.focusRow === 1;
        if (sel) roundRect(ctx, x + 14, yy - 16, 230, 32, 6, 'rgba(255,255,255,0.12)', '#fde68a');
        text(ctx, `Difficulty: ◀ ${this.app.settings.difficulty} ▶`, x + 26, yy, 17, sel ? '#fde68a' : '#d1d5db', 'left', 'bold');
      }
    });
    drawFooter(ctx, this.single !== null ? 'Esc to cancel' : 'Formations can be changed at half time and from the pause menu');
  }
}

export function drawMiniPitch(ctx: CanvasRenderingContext2D, f: Formation, x: number, y: number, w: number, h: number, color: string, phase: 'attack' | 'defense') {
  roundRect(ctx, x, y, w, h, 6, '#2f8f4a', 'rgba(255,255,255,0.7)', 1.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, h * 0.15, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y + h / 2, h * 0.3, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + w, y + h / 2, h * 0.3, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
  const pts = phase === 'attack' ? f.attack : f.defense;
  pts.forEach((p, i) => {
    const px = x + p[0] * w, py = y + h / 2 + p[1] * (h / 2) * 0.85;
    ctx.fillStyle = i === 0 ? '#facc15' : color;
    ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    text(ctx, i === 0 ? 'GK' : String(i), px, py, 9, '#111', 'center', 'bold');
  });
  // attack direction arrow
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.moveTo(x + w - 30, y + h - 14); ctx.lineTo(x + w - 12, y + h - 8); ctx.lineTo(x + w - 30, y + h - 2); ctx.closePath(); ctx.fill();
}
