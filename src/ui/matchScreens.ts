import { VIEW } from '../core/view';
import { CONFIG } from '../config';
import type { Screen } from './screen';
import type { App, MatchResult } from './app';
import { Menu, drawBackground, drawFooter, drawPanel, drawTitle } from './widgets';
import { roundRect, text, textShadow } from '../render/text';
import type { MatchOptions } from '../sim/match';
import { MatchSession } from '../game/session';
import { FormationSelectScreen } from './formationSelect';
import { ControlsScreen } from './menus';
import { drawCrest, contrastText } from '../render/crest';
import type { TeamIndex } from '../sim/types';

/** Runs a MatchSession; handles pause and the post-match flow. */
export class MatchScreen implements Screen {
  session: MatchSession;
  private done = false;
  constructor(private app: App, private opts: MatchOptions, private onFinished: (r: MatchResult) => void) {
    this.session = app.createSession(opts);
  }
  enter() { this.app.audio.whistle(); }
  update(dt: number) {
    const s = this.session;
    const ui = this.app.input.ui.pressed;
    if (ui.pause && !s.finished) { this.app.push(new PauseScreen(this.app, this)); return; }
    s.update(dt);
    if (s.finished && !this.done) {
      this.done = true;
      const m = s.match;
      const pens = m.penalties ? ([m.penalties.scores[0], m.penalties.scores[1]] as [number, number]) : null;
      const r: MatchResult = { score: [m.score[0], m.score[1]], aet: m.half > 2, pens, winner: m.winner };
      this.app.push(new PostMatchScreen(this.app, this, () => { this.app.pop(); this.onFinished(r); }));
    }
  }
  render(ctx: CanvasRenderingContext2D, alpha: number, frameDt: number) { this.session.render(ctx, alpha, frameDt); }
  restart() { this.session = this.app.createSession({ ...this.opts, seed: (this.opts.seed + 1) | 0 }); this.done = false; }
}

export class PauseScreen implements Screen {
  overlay = true;
  menu: Menu;
  constructor(private app: App, private ms: MatchScreen) {
    const m = ms.session.match;
    const humanTeams = [0, 1].filter((t) => m.opts.humanSlots[t] >= 0) as TeamIndex[];
    const items = [
      { label: 'Resume', onSelect: () => app.pop() },
    ];
    for (const t of humanTeams) {
      items.push({ label: `Formation — ${m.team(t).short} (${m.formations[t].name})`, onSelect: () => {
        app.push(new FormationSelectScreen(app, m.opts.teams, m.opts.humanSlots as [number, number], false, (f) => { m.setFormation(t, f[t]); app.pop(); }, t));
      } });
    }
    items.push(
      { label: 'Controls', onSelect: () => app.push(new ControlsScreen(app)) },
      { label: 'Restart match', onSelect: () => { ms.restart(); app.pop(); } },
      { label: 'Quit to menu', onSelect: () => app.goToMainMenu() },
    );
    this.menu = new Menu(items);
  }
  update(dt: number) {
    const r = this.menu.update(this.app.input, this.app.audio);
    if (r === 'back' || this.app.input.ui.pressed.pause) this.app.pop();
  }
  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    drawPanel(ctx, 340, 170, 600, 380, 'PAUSED');
    this.menu.draw(ctx, 380, 230, 520, 50);
    drawFooter(ctx, 'Esc / P resume');
  }
}

export class PostMatchScreen implements Screen {
  overlay = true;
  t = 0;
  constructor(private app: App, private ms: MatchScreen, private onContinue: () => void) {}
  update(dt: number) {
    this.t += dt;
    if (this.t > 0.8 && (this.app.input.ui.pressed.confirm || this.app.input.ui.pressed.back)) { this.app.audio.ui('confirm'); this.onContinue(); }
  }
  render(ctx: CanvasRenderingContext2D) {
    const m = this.ms.session.match;
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    const W = VIEW.w;
    drawPanel(ctx, 190, 70, 900, 580);
    textShadow(ctx, 'FULL TIME', W / 2, 110, 36, '#fde68a', 'center', '900');
    const t0 = m.team(0), t1 = m.team(1);
    drawCrest(ctx, t0, 330, 190, 70); drawCrest(ctx, t1, W - 330, 190, 70);
    text(ctx, t0.name, 330, 250, 18, '#fff', 'center', 'bold'); text(ctx, t1.name, W - 330, 250, 18, '#fff', 'center', 'bold');
    textShadow(ctx, `${m.score[0]}  -  ${m.score[1]}`, W / 2, 190, 64, '#fff', 'center', '900');
    let sub = '';
    if (m.penalties) sub = `Penalties ${m.penalties.scores[0]} - ${m.penalties.scores[1]}`;
    else if (m.half > 2) sub = 'After extra time';
    if (sub) text(ctx, sub, W / 2, 240, 18, '#e5e7eb', 'center', 'bold');
    if (m.winner >= 0) { const wt = m.team(m.winner as TeamIndex); text(ctx, `${wt.name} win`, W / 2, 268, 16, wt.kit.primary, 'center', 'bold'); }
    // stats
    const s0 = m.stats[0], s1 = m.stats[1];
    const total = s0.possessionTicks + s1.possessionTicks || 1;
    const rows: [string, string, string][] = [
      ['Possession', `${Math.round((s0.possessionTicks / total) * 100)}%`, `${Math.round((s1.possessionTicks / total) * 100)}%`],
      ['Shots', `${s0.shots}`, `${s1.shots}`],
      ['Shots on target', `${s0.shotsOnTarget}`, `${s1.shotsOnTarget}`],
      ['Passes', `${s0.passes}`, `${s1.passes}`],
      ['Tackles', `${s0.tackles}`, `${s1.tackles}`],
      ['Fouls', `${s0.fouls}`, `${s1.fouls}`],
      ['Saves', `${s0.saves}`, `${s1.saves}`],
      ['Corners', `${s0.corners}`, `${s1.corners}`],
    ];
    rows.forEach((r, i) => {
      const y = 310 + i * 34;
      if (i % 2 === 0) roundRect(ctx, 240, y - 14, 800, 28, 4, 'rgba(255,255,255,0.05)');
      text(ctx, r[1], 330, y, 18, '#fff', 'center', 'bold');
      text(ctx, r[0], W / 2, y, 16, '#cbd5e1', 'center');
      text(ctx, r[2], W - 330, y, 18, '#fff', 'center', 'bold');
    });
    // scorers
    const scorers = m.goals.map((g) => `${g.minute}' ${g.scorerId >= 0 ? m.player(g.scorerId).name + (g.ownGoal ? ' (og)' : '') : 'Goal'} (${m.team(g.team).short})`);
    if (scorers.length) text(ctx, scorers.join('   •   '), W / 2, 596, 13, '#9ca3af', 'center');
    if (this.t > 0.8) text(ctx, 'Press Enter to continue', W / 2, 630, 16, '#fde68a', 'center', 'bold');
  }
}

export const _ct = contrastText;
export const _bg = drawBackground;
export const _title = drawTitle;
