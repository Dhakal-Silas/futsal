import { CONFIG } from '../config';
import type { Screen } from './screen';
import type { App } from './app';
import { drawBackground, drawFooter, drawPanel, drawTitle } from './widgets';
import { roundRect, text } from '../render/text';
import { TEAMS, stars, kitsClash } from '../sim/teams';
import { drawCrest, contrastText } from '../render/crest';
import { drawStickman, idlePose, type StickmanStyle } from '../render/stickman';
import { Camera } from '../core/camera';
import type { TeamInfo } from '../sim/types';
import { P_COLORS } from '../render/hud';

export type SelectMode = 'quick' | '2p' | 'tournament' | 'demo';

/**
 * Team selection grid. Quick match: P1 picks their team, then the opponent. 2P: each player has
 * their own cursor and confirms independently. Tournament/demo: single pick.
 */
export class TeamSelectScreen implements Screen {
  t = 0;
  cursors: [number, number];
  confirmed: [boolean, boolean] = [false, false];
  step = 0; // quick/demo: 0 = first team, 1 = second team
  picks: TeamInfo[] = [];
  private previewCam = new Camera();
  private previewAnim = 0;
  constructor(private app: App, private mode: SelectMode, private onDone: (teams: [TeamInfo, TeamInfo] | [TeamInfo]) => void) {
    const i1 = Math.max(0, TEAMS.findIndex((t) => t.id === app.settings.lastTeamP1));
    const i2 = Math.max(0, TEAMS.findIndex((t) => t.id === app.settings.lastTeamP2));
    this.cursors = [i1, i2];
    this.previewCam.viewW = 0; this.previewCam.viewH = 0; this.previewCam.zoom = 2.6;
  }
  private cols = 4;
  update(dt: number) {
    this.t += dt; this.previewAnim += dt;
    const input = this.app.input;
    const move = (slot: 0 | 1, dx: number, dy: number) => {
      const n = TEAMS.length;
      let c = this.cursors[slot];
      const col = c % this.cols, row = Math.floor(c / this.cols);
      const rows = Math.ceil(n / this.cols);
      c = ((row + dy + rows) % rows) * this.cols + ((col + dx + this.cols) % this.cols);
      if (c >= n) c = n - 1;
      this.cursors[slot] = c;
      this.app.audio.ui('move');
    };
    if (this.mode === '2p') {
      for (let s = 0; s < 2; s++) {
        const slot = s as 0 | 1;
        const st = input.players[slot];
        if (this.confirmed[slot]) { if (st.pressed.through || st.pressed.cross) { this.confirmed[slot] = false; this.app.audio.ui('back'); } continue; }
        if (st.pressed.left) move(slot, -1, 0); if (st.pressed.right) move(slot, 1, 0);
        if (st.pressed.up) move(slot, 0, -1); if (st.pressed.down) move(slot, 0, 1);
        if (st.pressed.pass || st.pressed.shoot || (slot === 0 && input.ui.pressed.confirm && input.ui.source === -1)) { this.confirmed[slot] = true; this.app.audio.ui('confirm'); }
      }
      if (input.ui.pressed.back && !this.confirmed[0] && !this.confirmed[1]) { this.app.audio.ui('back'); this.app.pop(); return; }
      if (this.confirmed[0] && this.confirmed[1]) {
        const a = TEAMS[this.cursors[0]], b = TEAMS[this.cursors[1]];
        this.app.settings.lastTeamP1 = a.id; this.app.settings.lastTeamP2 = b.id; this.app.save();
        this.onDone([a, b]);
      }
      return;
    }
    // single cursor modes
    const ui = input.ui.pressed;
    if (ui.left) move(0, -1, 0); if (ui.right) move(0, 1, 0); if (ui.up) move(0, 0, -1); if (ui.down) move(0, 0, 1);
    if (ui.confirm) {
      this.app.audio.ui('confirm');
      const team = TEAMS[this.cursors[0]];
      if (this.mode === 'tournament') { this.app.settings.lastTeamP1 = team.id; this.app.save(); this.onDone([team]); return; }
      this.picks.push(team);
      if (this.picks.length === 1) {
        this.step = 1;
        // default opponent: a different team
        const other = Math.max(0, TEAMS.findIndex((t) => t.id === this.app.settings.lastTeamP2));
        this.cursors[0] = other === this.cursors[0] ? (other + 1) % TEAMS.length : other;
      } else {
        this.app.settings.lastTeamP1 = this.picks[0].id; this.app.settings.lastTeamP2 = this.picks[1].id; this.app.save();
        this.onDone([this.picks[0], this.picks[1]]);
      }
    }
    if (ui.back) {
      this.app.audio.ui('back');
      if (this.step === 1) { this.step = 0; this.cursors[0] = TEAMS.indexOf(this.picks[0]); this.picks.length = 0; }
      else this.app.pop();
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    drawBackground(ctx, this.t);
    const title = this.mode === '2p' ? 'SELECT TEAMS' : this.mode === 'tournament' ? 'SELECT YOUR TEAM' : this.step === 0 ? (this.mode === 'demo' ? 'SELECT HOME TEAM' : 'SELECT YOUR TEAM') : (this.mode === 'demo' ? 'SELECT AWAY TEAM' : 'SELECT OPPONENT');
    drawTitle(ctx, title, this.mode === '2p' ? 'P1: WASD + J   •   P2: Arrows + Numpad 1 / ,' : 'Arrows / WASD move   •   Enter confirm   •   Esc back');
    // grid
    const gx = 60, gy = 140, cw = 200, ch = 118, gap = 10;
    TEAMS.forEach((team, i) => {
      const col = i % this.cols, row = Math.floor(i / this.cols);
      const x = gx + col * (cw + gap), y = gy + row * (ch + gap);
      const sel0 = this.cursors[0] === i && (this.mode !== '2p' || !this.confirmed[0] || true);
      const sel1 = this.mode === '2p' && this.cursors[1] === i;
      const picked = this.picks.includes(team);
      roundRect(ctx, x, y, cw, ch, 10, picked ? 'rgba(253,230,138,0.18)' : 'rgba(255,255,255,0.06)', sel0 ? P_COLORS[0] : sel1 ? P_COLORS[1] : 'rgba(255,255,255,0.15)', sel0 || sel1 ? 3 : 1);
      if (sel0 && sel1) { ctx.strokeStyle = P_COLORS[1]; ctx.lineWidth = 3; ctx.setLineDash([8, 8]); roundRect(ctx, x, y, cw, ch, 10, undefined, P_COLORS[1], 3); ctx.setLineDash([]); }
      drawCrest(ctx, team, x + 36, y + 52, 46);
      text(ctx, team.name, x + 70, y + 32, 15, '#fff', 'left', 'bold');
      text(ctx, '★'.repeat(stars(team)) + '☆'.repeat(5 - stars(team)), x + 70, y + 56, 15, '#fde68a', 'left');
      const r = team.ratings;
      text(ctx, `ATT ${r.attack}  DEF ${r.defense}  PAS ${r.passing}`, x + 70, y + 78, 11, '#cbd5e1', 'left');
      text(ctx, `SPD ${r.speed}  STA ${r.stamina}  GK ${r.keeper}`, x + 70, y + 94, 11, '#cbd5e1', 'left');
      if (this.mode === '2p') {
        if (this.cursors[0] === i) text(ctx, this.confirmed[0] ? 'P1 ✓' : 'P1', x + cw - 8, y + 14, 12, P_COLORS[0], 'right', 'bold');
        if (this.cursors[1] === i) text(ctx, this.confirmed[1] ? 'P2 ✓' : 'P2', x + cw - 8, y + ch - 12, 12, P_COLORS[1], 'right', 'bold');
      }
    });
    // kit previews on the right
    const px = 950;
    drawPanel(ctx, px, 140, 290, 500, 'KIT PREVIEW');
    const slots: { team: TeamInfo; label: string; color: string; swap: boolean }[] = [];
    if (this.mode === '2p') {
      const a = TEAMS[this.cursors[0]], b = TEAMS[this.cursors[1]];
      slots.push({ team: a, label: 'P1', color: P_COLORS[0], swap: false }, { team: b, label: 'P2', color: P_COLORS[1], swap: kitsClash(a, b) });
    } else if (this.step === 1 && this.picks[0]) {
      const a = this.picks[0], b = TEAMS[this.cursors[0]];
      slots.push({ team: a, label: 'HOME', color: '#fff', swap: false }, { team: b, label: 'AWAY', color: '#fff', swap: kitsClash(a, b) });
    } else slots.push({ team: TEAMS[this.cursors[0]], label: this.mode === 'tournament' ? 'YOUR TEAM' : 'HOME', color: '#fff', swap: false });
    slots.forEach((s, i) => {
      const cx = px + 80 + i * 130, cy = 330;
      const k = s.team.kit;
      const style: StickmanStyle = { kit: s.swap ? k.secondary : k.primary, shorts: s.swap ? k.primary : k.shorts, number: s.swap ? k.primary : k.secondary, skin: '#f1c9a5', hair: '#222', boots: '#111' };
      const cam = this.previewCam;
      cam.viewW = cx * 2; cam.viewH = cy * 2; cam.x = 0; cam.y = 0; cam.zoom = 2.4;
      const pose = idlePose();
      pose.armL = 0.3 + Math.sin(this.previewAnim * 2) * 0.1; pose.armR = -0.3 - Math.sin(this.previewAnim * 2) * 0.1;
      drawStickman(ctx, cam, 0, 0, Math.PI * 0.5 + Math.sin(this.previewAnim) * 0.5, pose, style, { number: 10, shadow: true });
      text(ctx, s.label, cx, 390, 13, s.color, 'center', 'bold');
      text(ctx, s.team.short + (s.swap ? ' (2nd kit)' : ''), cx, 410, 13, '#e5e7eb', 'center');
      roundRect(ctx, cx - 40, 425, 80, 16, 4, style.kit, 'rgba(255,255,255,0.4)');
      text(ctx, 'KIT', cx, 433, 10, contrastText(style.kit), 'center', 'bold');
    });
    drawFooter(ctx, this.mode === 'quick' ? `Difficulty ${this.app.settings.difficulty} (change in Settings)` : 'No official logos: crests are procedural placeholders');
  }
}
