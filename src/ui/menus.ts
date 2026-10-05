import { VIEW } from '../core/view';
import { CONFIG } from '../config';
import type { Screen } from './screen';
import type { App } from './app';
import { Menu, drawBackground, drawFooter, drawPanel, drawTitle } from './widgets';
import { text, textShadow } from '../render/text';
import { DIFFICULTIES } from '../ai/difficulty';
import { HALF_OPTIONS } from '../game/settings';
import { GAME_ACTIONS, ACTION_LABELS, InputManager, type GameAction } from '../core/input';
import { TEAMS } from '../sim/teams';
import { MatchSession } from '../game/session';
import { roundRect } from '../render/text';

/** Title screen with a CPU vs CPU demo match running behind it. */
export class TitleScreen implements Screen {
  t = 0;
  demo: MatchSession | null = null;
  constructor(private app: App, private onStart: () => void) {}
  enter() {
    const a = TEAMS[Math.floor(Math.random() * TEAMS.length)];
    let b = TEAMS[Math.floor(Math.random() * TEAMS.length)];
    if (b === a) b = TEAMS[(TEAMS.indexOf(a) + 1) % TEAMS.length];
    this.demo = this.app.createSession(this.app.matchOptions([a, b], ['2-2-2', '3-2-1'], [-1, -1], false, { halfMinutes: 2, difficulty: 'Hard', demo: true }));
    this.demo.hud.showHints = false; this.demo.hud.minimap = false;
  }
  update(dt: number) {
    this.t += dt;
    if (this.demo) {
      this.demo.update(dt);
      const m = this.demo.match;
      if (m.phase === 'halftime' || m.phase === 'fulltime') m.continue();
      if (m.phase === 'finished') this.enter();
    }
    if (this.app.input.ui.pressed.confirm || this.app.input.ui.pressed.any) { this.app.audio.init(); this.app.audio.ui('confirm'); this.onStart(); }
  }
  render(ctx: CanvasRenderingContext2D, alpha: number, frameDt: number) {
    if (this.demo) this.demo.render(ctx, alpha, frameDt); else drawBackground(ctx, this.t);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    const W = VIEW.w, H = VIEW.h;
    textShadow(ctx, 'STICKMAN', W / 2, H * 0.3, 92, '#fde68a', 'center', '900');
    textShadow(ctx, 'FUTSAL 5v5', W / 2, H * 0.3 + 86, 64, '#ffffff', 'center', '900');
    const blink = Math.sin(this.t * 4) > -0.2;
    if (blink) text(ctx, 'PRESS ENTER / START', W / 2, H * 0.72, 26, '#e5e7eb', 'center', 'bold');
    text(ctx, 'CPU vs CPU demo running behind the title', W / 2, H - 28, 13, '#9ca3af', 'center');
  }
}

export class MainMenuScreen implements Screen {
  t = 0; menu: Menu;
  constructor(private app: App, actions: { quick: () => void; twoPlayer: () => void; tournament: () => void; demo: () => void; settings: () => void; controls: () => void }) {
    this.menu = new Menu([
      { label: 'Quick Match (1P vs CPU)', onSelect: actions.quick, hint: 'Pick two teams and play a single match against the CPU.' },
      { label: 'Local 2 Players', onSelect: actions.twoPlayer, hint: 'Two humans on one keyboard or two gamepads.' },
      { label: 'Champions Cup (Tournament)', onSelect: actions.tournament, hint: 'Round of 16 to the FINAL. Extra time and penalties on draws.' },
      { label: 'CPU vs CPU (Spectate)', onSelect: actions.demo, hint: 'Watch the AI play.' },
      { label: 'Settings', onSelect: actions.settings },
      { label: 'Controls', onSelect: actions.controls },
    ]);
  }
  update(dt: number) { this.t += dt; this.menu.update(this.app.input, this.app.audio); }
  render(ctx: CanvasRenderingContext2D) {
    drawBackground(ctx, this.t);
    drawTitle(ctx, 'STICKMAN FUTSAL 5v5', 'Main menu');
    drawPanel(ctx, 340, 150, 600, 360);
    this.menu.draw(ctx, 380, 195, 520, 50, this.t);
    drawFooter(ctx, `Difficulty: ${this.app.settings.difficulty}  •  Halves: ${this.app.settings.halfMinutes} min  •  ${this.app.settings.teamSize}-a-side  •  F = fullscreen  •  M = mute  •  F3 = debug`);
  }
}

export class SettingsScreen implements Screen {
  t = 0; menu: Menu;
  constructor(private app: App) {
    const s = app.settings;
    const cycle = <T,>(arr: T[], cur: T, dir: number) => arr[(arr.indexOf(cur) + dir + arr.length) % arr.length];
    this.menu = new Menu([
      { label: 'Difficulty', value: () => s.difficulty, onChange: (d) => { s.difficulty = cycle(DIFFICULTIES, s.difficulty, d); app.save(); }, hint: 'Easy is clearly beatable; Legend is hard but fair.' },
      { label: 'Half length', value: () => `${s.halfMinutes} min`, onChange: (d) => { s.halfMinutes = cycle(HALF_OPTIONS, s.halfMinutes, d); app.save(); } },
      { label: 'Players per side', value: () => `${s.teamSize} (${s.teamSize - 1} + GK)`, onChange: () => { s.teamSize = s.teamSize === 7 ? 5 : 7; app.save(); }, hint: '7-a-side (default) or classic 5-a-side futsal.' },
      { label: 'Sound volume', value: () => `${Math.round(s.volume * 100)}%`, onChange: (d) => { s.volume = Math.max(0, Math.min(1, Math.round((s.volume + d * 0.1) * 10) / 10)); app.audio.setVolume(s.volume); app.save(); } },
      { label: 'Mute', value: () => (app.audio.muted ? 'On' : 'Off'), onChange: () => app.audio.toggleMute() },
      { label: 'Particles', value: () => (s.quality > 0 ? 'On' : 'Off'), onChange: () => { s.quality = s.quality > 0 ? 0 : 1; app.save(); } },
      { label: 'Control hints', value: () => (s.showHints ? 'On' : 'Off'), onChange: () => { s.showHints = !s.showHints; app.save(); } },
      { label: 'Minimap', value: () => (s.minimap ? 'On' : 'Off'), onChange: () => { s.minimap = !s.minimap; app.save(); } },
      { label: 'Gamepad for P1', value: () => `Pad ${s.padP1 + 1}`, onChange: (d) => { s.padP1 = (s.padP1 + d + 4) % 4; app.input.padIndex[0] = s.padP1; app.save(); } },
      { label: 'Gamepad for P2', value: () => `Pad ${s.padP2 + 1}`, onChange: (d) => { s.padP2 = (s.padP2 + d + 4) % 4; app.input.padIndex[1] = s.padP2; app.save(); } },
      { label: 'Back', onSelect: () => app.pop() },
    ]);
  }
  update(dt: number) { this.t += dt; if (this.menu.update(this.app.input, this.app.audio) === 'back') this.app.pop(); }
  render(ctx: CanvasRenderingContext2D) {
    drawBackground(ctx, this.t);
    drawTitle(ctx, 'SETTINGS');
    drawPanel(ctx, VIEW.w / 2 - 350, 140, 700, 560);
    this.menu.draw(ctx, VIEW.w / 2 - 310, 180, 620, 46, this.t);
    drawFooter(ctx, '← → change   •   Enter select   •   Esc back');
  }
}

/** Controls screen: shows bindings for both players and allows rebinding. */
export class ControlsScreen implements Screen {
  t = 0;
  player: 0 | 1 = 0;
  index = 0;
  capturing = false;
  constructor(private app: App) {}
  update(dt: number) {
    this.t += dt;
    const input = this.app.input, ui = input.ui.pressed;
    if (this.capturing) { if (!input.isCapturing()) this.capturing = false; return; }
    const n = GAME_ACTIONS.length + 2; // + reset + back
    if (ui.down) { this.index = (this.index + 1) % n; this.app.audio.ui('move'); }
    if (ui.up) { this.index = (this.index - 1 + n) % n; this.app.audio.ui('move'); }
    if (ui.left || ui.right) { this.player = this.player === 0 ? 1 : 0; this.app.audio.ui('move'); }
    if (ui.confirm) {
      if (this.index < GAME_ACTIONS.length) {
        const action = GAME_ACTIONS[this.index];
        const p = this.player;
        this.capturing = true;
        this.app.audio.ui('confirm');
        input.captureNextKey((code) => { input.rebind(p, action, code); this.capturing = false; });
      } else if (this.index === GAME_ACTIONS.length) { input.resetBindings(); this.app.audio.ui('confirm'); }
      else this.app.pop();
    }
    if (ui.back && !this.capturing) { this.app.audio.ui('back'); this.app.pop(); }
  }
  render(ctx: CanvasRenderingContext2D) {
    drawBackground(ctx, this.t);
    drawTitle(ctx, 'CONTROLS', 'Enter on a row to rebind (press the new key, Esc cancels). ← → switches player column.');
    drawPanel(ctx, 120, 130, 1040, 540);
    const cols = [360, 640, 920];
    text(ctx, 'ACTION', 180, 165, 15, '#fde68a', 'left', 'bold');
    text(ctx, 'PLAYER 1', cols[0], 165, 15, this.player === 0 ? '#38bdf8' : '#9ca3af', 'center', 'bold');
    text(ctx, 'PLAYER 2', cols[1], 165, 15, this.player === 1 ? '#fb7185' : '#9ca3af', 'center', 'bold');
    text(ctx, 'GAMEPAD', cols[2], 165, 15, '#9ca3af', 'center', 'bold');
    const padNames: Record<GameAction, string> = { up: 'Stick/D-pad', down: 'Stick/D-pad', left: 'Stick/D-pad', right: 'Stick/D-pad', pass: 'A / Cross', through: 'B / Circle', shoot: 'X / Square', cross: 'Y / Triangle', slide: 'RB', sprint: 'RT / LB', switch: 'LT' };
    GAME_ACTIONS.forEach((a, i) => {
      const y = 195 + i * 34;
      const sel = i === this.index;
      if (sel) roundRect(ctx, 150, y - 14, 980, 28, 6, 'rgba(255,255,255,0.1)');
      text(ctx, ACTION_LABELS[a], 180, y, 17, sel ? '#fff' : '#d1d5db', 'left', sel ? 'bold' : 'normal');
      for (let p = 0; p < 2; p++) {
        const keys = this.app.input.bindings[p][a].map(InputManager.keyName).join(' / ');
        const active = sel && this.player === p;
        const label = active && this.capturing ? 'press a key…' : keys;
        text(ctx, label, cols[p], y, 17, active ? (p === 0 ? '#38bdf8' : '#fb7185') : '#e5e7eb', 'center', active ? 'bold' : 'normal');
      }
      text(ctx, padNames[a], cols[2], y, 15, '#9ca3af', 'center');
    });
    const ry = 195 + GAME_ACTIONS.length * 34 + 10;
    for (const [i, label] of [[GAME_ACTIONS.length, 'Reset to defaults'], [GAME_ACTIONS.length + 1, 'Back']] as [number, string][]) {
      const y = ry + (i - GAME_ACTIONS.length) * 34;
      const sel = i === this.index;
      if (sel) roundRect(ctx, 150, y - 14, 980, 28, 6, 'rgba(255,255,255,0.1)');
      text(ctx, (sel ? '▶ ' : '') + label, 180, y, 17, sel ? '#fff' : '#d1d5db', 'left', 'bold');
    }
    const pads = this.app.input.padConnected;
    drawFooter(ctx, `Gamepads: P1 ${pads[0] ? 'connected' : '—'}   P2 ${pads[1] ? 'connected' : '—'}   •   Context: on defense Pass = press, Shoot = contain, Slide = tackle`);
  }
}
