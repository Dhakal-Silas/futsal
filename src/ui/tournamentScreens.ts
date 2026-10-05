import { CONFIG } from '../config';
import type { Screen } from './screen';
import type { App } from './app';
import { Menu, drawBackground, drawFooter, drawPanel, drawTitle } from './widgets';
import { roundRect, text, textShadow } from '../render/text';
import { Tournament } from '../tournament/tournament';
import { roundName, groupTable, type TMatch } from '../tournament/bracket';
import { teamById } from '../sim/teams';
import { drawCrest } from '../render/crest';
import { Effects } from '../render/effects';
import { Camera } from '../core/camera';
import { DIFFICULTIES } from '../ai/difficulty';
import { HALF_OPTIONS } from '../game/settings';
import { FORMATIONS } from '../sim/formation';
import type { TeamInfo } from '../sim/types';

/** Tournament options after picking the team: group stage, classico mode, difficulty, half length. */
export class TournamentSetupScreen implements Screen {
  t = 0; menu: Menu;
  constructor(private app: App, private team: TeamInfo, private onStart: (t: Tournament) => void) {
    const s = app.settings;
    const cycle = <T,>(arr: T[], cur: T, dir: number) => arr[(arr.indexOf(cur) + dir + arr.length) % arr.length];
    this.menu = new Menu([
      { label: 'Group stage first', value: () => (s.groupStage ? 'On' : 'Off'), onChange: () => { s.groupStage = !s.groupStage; app.save(); }, hint: '4 groups of 4, top 2 qualify for the quarter-finals.' },
      { label: 'Clásico mode', value: () => (s.classico ? 'On' : 'Off'), onChange: () => { s.classico = !s.classico; app.save(); }, hint: 'Keeps Real Madrid and FC Barcelona apart until the FINAL.' },
      { label: 'Difficulty', value: () => s.difficulty, onChange: (d) => { s.difficulty = cycle(DIFFICULTIES, s.difficulty, d); app.save(); } },
      { label: 'Half length', value: () => `${s.halfMinutes} min`, onChange: (d) => { s.halfMinutes = cycle(HALF_OPTIONS, s.halfMinutes, d); app.save(); } },
      { label: 'Formation', value: () => FORMATIONS.find((f) => f.id === s.formationP1)?.name ?? s.formationP1, onChange: (d) => { const i = FORMATIONS.findIndex((f) => f.id === s.formationP1); s.formationP1 = FORMATIONS[(i + d + FORMATIONS.length) % FORMATIONS.length].id; app.save(); } },
      { label: 'Start the draw', onSelect: () => { const t = Tournament.create(team.id, s.classico, s.groupStage, s.halfMinutes, s.difficulty, s.formationP1); t.save(); onStart(t); } },
    ]);
  }
  update(dt: number) { this.t += dt; if (this.menu.update(this.app.input, this.app.audio) === 'back') this.app.pop(); }
  render(ctx: CanvasRenderingContext2D) {
    drawBackground(ctx, this.t);
    drawTitle(ctx, 'CHAMPIONS CUP', `Playing as ${this.team.name}`);
    drawPanel(ctx, 290, 150, 700, 400);
    drawCrest(ctx, this.team, CONFIG.LOGICAL_W / 2, 200, 70);
    this.menu.draw(ctx, 330, 270, 620, 44, this.t);
    drawFooter(ctx, '← → change   •   Enter select   •   Esc back');
  }
}

/** Animated draw: team cards fly into bracket slots one by one. */
export class DrawScreen implements Screen {
  t = 0;
  revealed = 0;
  constructor(private app: App, private tour: Tournament, private onDone: () => void) {}
  update(dt: number) {
    this.t += dt;
    const total = this.tour.state.drawOrder.length;
    const target = Math.min(total, Math.floor(this.t / 0.35));
    if (target > this.revealed) { this.revealed = target; this.app.audio.ui('move'); }
    if (this.app.input.ui.pressed.confirm) {
      if (this.revealed < total) { this.revealed = total; this.t = total * 0.35; }
      else { this.app.audio.ui('confirm'); this.tour.beginPlay(); this.onDone(); }
    }
  }
  render(ctx: CanvasRenderingContext2D) {
    drawBackground(ctx, this.t);
    const st = this.tour.state;
    drawTitle(ctx, 'THE DRAW', st.groupStage ? 'Group stage' : 'Round of 16');
    const order = st.drawOrder;
    if (st.groupStage) {
      for (let g = 0; g < 4; g++) {
        const x = 70 + g * 300, y = 150;
        drawPanel(ctx, x, y, 270, 300, `GROUP ${'ABCD'[g]}`);
        for (let i = 0; i < 4; i++) {
          const idx = g * 4 + i;
          if (idx >= this.revealed) continue;
          const team = teamById(order[idx]);
          const yy = y + 60 + i * 56;
          const mine = team.id === st.userTeam;
          roundRect(ctx, x + 14, yy - 20, 242, 44, 6, mine ? 'rgba(253,230,138,0.2)' : 'rgba(255,255,255,0.06)', mine ? '#fde68a' : undefined);
          drawCrest(ctx, team, x + 40, yy, 32);
          text(ctx, team.name, x + 66, yy, 15, '#fff', 'left', 'bold');
        }
      }
    } else {
      for (let i = 0; i < 8; i++) {
        const col = i < 4 ? 0 : 1;
        const row = i % 4;
        const x = 120 + col * 560, y = 150 + row * 115;
        drawPanel(ctx, x, y, 480, 100);
        for (let k = 0; k < 2; k++) {
          const idx = i * 2 + k;
          if (idx >= this.revealed) { text(ctx, '?', x + 60 + k * 240, y + 50, 30, '#4b5563', 'center', '900'); continue; }
          const team = teamById(order[idx]);
          const mine = team.id === st.userTeam;
          drawCrest(ctx, team, x + 50 + k * 240, y + 50, 44);
          text(ctx, team.name, x + 82 + k * 240, y + 50, 14, mine ? '#fde68a' : '#fff', 'left', 'bold');
        }
        text(ctx, 'vs', x + 240, y + 50, 16, '#9ca3af', 'center', 'bold');
      }
    }
    drawFooter(ctx, this.revealed < order.length ? 'Enter to skip' : 'Enter to continue');
  }
}

/** Bracket / group view with a "next match" action. */
export class BracketScreen implements Screen {
  t = 0; menu: Menu;
  constructor(private app: App, private tour: Tournament, private onNext: () => void, private onQuit: () => void) {
    this.menu = new Menu([]);
    this.rebuild();
  }
  private rebuild() {
    const tour = this.tour;
    tour.simOthersUntilUser();
    const items = [];
    const next = tour.nextUserMatch();
    if (tour.champion) {
      items.push({ label: tour.champion === tour.state.userTeam ? 'Celebrate!' : 'Back to menu', onSelect: () => this.onQuit() });
    } else if (next) {
      const m = next.match;
      const opp = m.a === tour.state.userTeam ? m.b : m.a;
      items.push({ label: `Next match: vs ${teamById(opp!).name}${next.kind === 'knockout' && tour.userInFinal ? '  —  THE FINAL' : ''}`, onSelect: () => this.onNext() });
    } else if (tour.userEliminated || tour.state.stage === 'done') {
      items.push({ label: 'Simulate the rest of the tournament', onSelect: () => { this.simulateAll(); this.rebuild(); } });
    } else {
      items.push({ label: 'Continue', onSelect: () => { tour.simOthersUntilUser(); this.rebuild(); } });
    }
    items.push({ label: 'Quit to menu (progress is saved)', onSelect: () => this.onQuit() });
    this.menu = new Menu(items);
  }
  private simulateAll() {
    const tour = this.tour;
    let guard = 0;
    while (!tour.champion && guard++ < 40) {
      const nm = tour.nextUserMatch();
      if (nm) {
        // user is out but a match still awaits? (should not happen) – auto-resolve as a loss
        tour.recordUserResult(0, 1, false, null);
      } else tour.simOthersUntilUser();
      if (tour.state.stage === 'done' && !tour.champion) break;
    }
    tour.save();
  }
  update(dt: number) { this.t += dt; if (this.menu.update(this.app.input, this.app.audio) === 'back') this.onQuit(); }
  render(ctx: CanvasRenderingContext2D) {
    drawBackground(ctx, this.t);
    const st = this.tour.state;
    drawTitle(ctx, 'CHAMPIONS CUP', st.stage === 'groups' ? 'Group stage' : this.tour.champion ? 'Champion crowned' : `${teamById(st.userTeam).name} — ${roundName(this.tour.bracket ? currentRoundIdx(this.tour) : 0, this.tour.bracket?.rounds.length ?? 4)}`);
    if (st.stage === 'groups' && st.groups && st.groupMatches) this.renderGroups(ctx);
    else if (st.bracket) this.renderBracket(ctx);
    this.menu.draw(ctx, 380, 620, 520, 36);
    if (this.tour.userEliminated && !this.tour.champion) text(ctx, 'You have been eliminated.', CONFIG.LOGICAL_W / 2, 590, 16, '#f87171', 'center', 'bold');
  }
  private renderGroups(ctx: CanvasRenderingContext2D) {
    const st = this.tour.state;
    for (let g = 0; g < 4; g++) {
      const x = 40 + g * 305, y = 130;
      drawPanel(ctx, x, y, 290, 300, `GROUP ${'ABCD'[g]}`);
      const table = groupTable(st.groups![g], st.groupMatches!, g);
      text(ctx, 'P  W  D  L   GD  Pts', x + 275, y + 24, 11, '#9ca3af', 'right');
      table.forEach((r, i) => {
        const yy = y + 56 + i * 34;
        const team = teamById(r.team);
        const mine = r.team === st.userTeam;
        if (i < 2) roundRect(ctx, x + 10, yy - 14, 270, 28, 4, 'rgba(74,222,128,0.08)');
        drawCrest(ctx, team, x + 26, yy, 22);
        text(ctx, team.short, x + 44, yy, 14, mine ? '#fde68a' : '#fff', 'left', 'bold');
        text(ctx, `${r.played}  ${r.won}  ${r.drawn}  ${r.lost}   ${r.gf - r.ga >= 0 ? '+' : ''}${r.gf - r.ga}  ${String(r.points).padStart(2)}`, x + 275, yy, 13, '#e5e7eb', 'right');
      });
      // fixtures
      const fx = st.groupMatches!.filter((m) => m.group === g);
      fx.forEach((m, i) => {
        const yy = y + 200 + i * 16;
        const mine = m.a === st.userTeam || m.b === st.userTeam;
        text(ctx, `${teamById(m.a).short} ${m.played ? m.scoreA : '-'} : ${m.played ? m.scoreB : '-'} ${teamById(m.b).short}`, x + 145, yy, 11, mine ? '#fde68a' : '#9ca3af', 'center');
      });
    }
  }
  private renderBracket(ctx: CanvasRenderingContext2D) {
    const br = this.tour.bracket!;
    const st = this.tour.state;
    const rounds = br.rounds.length;
    const W = CONFIG.LOGICAL_W;
    const colW = Math.min(300, (W - 80) / rounds);
    const top = 160, bottom = 580;
    br.rounds.forEach((r, ri) => {
      const x = 40 + ri * colW + (W - 80 - rounds * colW) / 2;
      text(ctx, roundName(ri, rounds), x + colW / 2, top - 14, 12, '#fde68a', 'center', 'bold');
      const n = r.length;
      const slotH = (bottom - top) / n;
      r.forEach((m, mi) => {
        const y = top + slotH * (mi + 0.5);
        this.drawMatchCard(ctx, m, x + 6, y, colW - 12, st.userTeam);
        // connector to the next round
        if (ri < rounds - 1) {
          const nx = x + colW + 6;
          const nslotH = (bottom - top) / (n / 2);
          const ny = top + nslotH * (Math.floor(mi / 2) + 0.5);
          ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x + colW - 6, y); ctx.lineTo(x + colW, y); ctx.lineTo(x + colW, ny); ctx.lineTo(nx, ny); ctx.stroke();
        }
      });
    });
    const ch = this.tour.champion;
    if (ch) {
      const team = teamById(ch);
      const x = 40 + (rounds - 1) * colW + (W - 80 - rounds * colW) / 2 + colW / 2;
      textShadow(ctx, '🏆', x, bottom - 40, 36, '#fde68a', 'center');
      text(ctx, `${team.name}`, x, bottom - 4, 14, '#fde68a', 'center', 'bold');
    }
  }
  private drawMatchCard(ctx: CanvasRenderingContext2D, m: TMatch, x: number, cy: number, w: number, user: string) {
    const h = 46;
    const mine = m.a === user || m.b === user;
    roundRect(ctx, x, cy - h / 2, w, h, 6, mine ? 'rgba(253,230,138,0.16)' : 'rgba(255,255,255,0.07)', mine ? '#fde68a' : 'rgba(255,255,255,0.2)');
    const row = (id: string | null, score: number, yy: number, winner: boolean) => {
      const team = id ? teamById(id) : null;
      if (team) { drawCrest(ctx, team, x + 14, yy, 16); }
      text(ctx, team ? team.short : '—', x + 28, yy, 13, winner ? '#fff' : team ? '#cbd5e1' : '#6b7280', 'left', winner ? 'bold' : 'normal');
      if (m.played) text(ctx, String(score), x + w - 10, yy, 13, winner ? '#fff' : '#cbd5e1', 'right', winner ? 'bold' : 'normal');
    };
    row(m.a, m.scoreA, cy - 11, m.played && m.winner === m.a);
    row(m.b, m.scoreB, cy + 11, m.played && m.winner === m.b);
    if (m.played && (m.aet || m.pens)) text(ctx, m.pens ? `p ${m.pens[0]}-${m.pens[1]}` : 'aet', x + w - 36, cy, 9, '#9ca3af', 'right');
  }
}

function currentRoundIdx(t: Tournament): number {
  const br = t.bracket!;
  for (const r of br.rounds) if (r.some((m) => !m.played)) return r[0].round;
  return br.rounds.length - 1;
}

/** Champion celebration: trophy + confetti. */
export class ChampionScreen implements Screen {
  t = 0;
  effects = new Effects();
  cam = new Camera();
  constructor(private app: App, private team: TeamInfo, private userWon: boolean, private onDone: () => void) {
    this.cam.targetZoom = 1; this.cam.snap();
  }
  enter() { this.app.audio.fanfare(); }
  update(dt: number) {
    this.t += dt;
    if (this.userWon && this.t < 10) this.effects.confetti(this.cam.wx(Math.random() * CONFIG.LOGICAL_W), this.cam.wy(-40), 3, [this.team.kit.primary, this.team.kit.secondary, '#fde68a', '#fff'], 0.3);
    this.effects.update(dt);
    if (this.t > 1.5 && this.app.input.ui.pressed.confirm) { this.app.audio.ui('confirm'); this.onDone(); }
  }
  render(ctx: CanvasRenderingContext2D) {
    drawBackground(ctx, this.t);
    const W = CONFIG.LOGICAL_W, H = CONFIG.LOGICAL_H;
    textShadow(ctx, this.userWon ? 'CHAMPIONS!' : 'TOURNAMENT OVER', W / 2, 90, 60, '#fde68a', 'center', '900');
    text(ctx, this.userWon ? `${this.team.name} win the Champions Cup!` : `${this.team.name} are the champions.`, W / 2, 145, 22, '#fff', 'center', 'bold');
    drawTrophy(ctx, W / 2, H * 0.55, 1 + Math.sin(this.t * 2) * 0.03, this.t);
    drawCrest(ctx, this.team, W / 2, H * 0.55 + 150, 60);
    this.effects.draw(ctx, this.cam);
    if (this.t > 1.5) text(ctx, 'Press Enter to continue', W / 2, H - 40, 18, '#e5e7eb', 'center', 'bold');
  }
}

/** Procedurally drawn trophy (cup, handles, stem, base) with a shine sweep. */
export function drawTrophy(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const gold = ctx.createLinearGradient(-80, -160, 80, 60);
  gold.addColorStop(0, '#fff2a8'); gold.addColorStop(0.5, '#f5c542'); gold.addColorStop(1, '#b8860b');
  ctx.fillStyle = gold; ctx.strokeStyle = '#8a6508'; ctx.lineWidth = 3;
  // cup
  ctx.beginPath();
  ctx.moveTo(-70, -150); ctx.lineTo(70, -150);
  ctx.bezierCurveTo(75, -60, 40, -20, 0, -10);
  ctx.bezierCurveTo(-40, -20, -75, -60, -70, -150); ctx.closePath(); ctx.fill(); ctx.stroke();
  // handles
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(side * 92, -105, 26, 38, 0, 0, Math.PI * 2); ctx.lineWidth = 10; ctx.strokeStyle = '#d4a017'; ctx.stroke();
  }
  ctx.strokeStyle = '#8a6508'; ctx.lineWidth = 3;
  // stem + base
  ctx.fillRect(-10, -10, 20, 40);
  ctx.beginPath(); ctx.moveTo(-50, 30); ctx.lineTo(50, 30); ctx.lineTo(60, 55); ctx.lineTo(-60, 55); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3b2a0a'; ctx.fillRect(-64, 55, 128, 14);
  // shine sweep
  const sh = ((t * 120) % 400) - 200;
  ctx.save(); ctx.beginPath(); ctx.moveTo(-70, -150); ctx.lineTo(70, -150); ctx.bezierCurveTo(75, -60, 40, -20, 0, -10); ctx.bezierCurveTo(-40, -20, -75, -60, -70, -150); ctx.closePath(); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.moveTo(sh - 20, -160); ctx.lineTo(sh + 10, -160); ctx.lineTo(sh - 30, 0); ctx.lineTo(sh - 60, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
}
