import { CONFIG } from './config';
import { CanvasScaler } from './core/canvas';
import { GameLoop } from './core/loop';
import { InputManager } from './core/input';
import { AudioManager } from './core/audio';
import { App, type MatchResult } from './ui/app';
import { TitleScreen, MainMenuScreen, SettingsScreen, ControlsScreen } from './ui/menus';
import { TeamSelectScreen } from './ui/teamSelect';
import { FormationSelectScreen } from './ui/formationSelect';
import { MatchScreen } from './ui/matchScreens';
import { TournamentSetupScreen, DrawScreen, BracketScreen, ChampionScreen } from './ui/tournamentScreens';
import { Tournament } from './tournament/tournament';
import { teamById, TEAMS } from './sim/teams';
import { Menu, drawBackground, drawFooter, drawPanel, drawTitle } from './ui/widgets';
import type { Screen } from './ui/screen';
import type { TeamInfo } from './sim/types';
import type { MatchOptions } from './sim/match';
import { text } from './render/text';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const scaler = new CanvasScaler(canvas);
const input = new InputManager();
input.attach(canvas);
const audio = new AudioManager();
const unlock = () => { audio.init(); audio.resume(); };
window.addEventListener('keydown', unlock, { once: true });
window.addEventListener('pointerdown', unlock, { once: true });

const app = new App(input, audio);
(window as any).__app = app;

/* ---------------------------------------------------------------- flows */

function mainMenu() {
  app.replace(new MainMenuScreen(app, {
    quick: () => app.push(new TeamSelectScreen(app, 'quick', (teams) => {
      const t = teams as [TeamInfo, TeamInfo];
      app.push(new FormationSelectScreen(app, t, [0, -1], true, (f) => {
        startMatch(app.matchOptions(t, [f[0], app.settings.formationP2], [0, -1], false), () => mainMenu());
      }));
    })),
    twoPlayer: () => app.push(new TeamSelectScreen(app, '2p', (teams) => {
      const t = teams as [TeamInfo, TeamInfo];
      app.push(new FormationSelectScreen(app, t, [0, 1], false, (f) => {
        startMatch(app.matchOptions(t, f, [0, 1], false), () => mainMenu());
      }));
    })),
    tournament: () => tournamentMenu(),
    demo: () => app.push(new TeamSelectScreen(app, 'demo', (teams) => {
      const t = teams as [TeamInfo, TeamInfo];
      startMatch(app.matchOptions(t, ['2-2', '1-2-1'], [-1, -1], false, { difficulty: 'Hard' }), () => mainMenu());
    })),
    settings: () => app.push(new SettingsScreen(app)),
    controls: () => app.push(new ControlsScreen(app)),
  }));
}
app.goToMainMenu = mainMenu;

function startMatch(opts: MatchOptions, onDone: (r: MatchResult) => void) {
  app.push(new MatchScreen(app, opts, (r) => { app.pop(); onDone(r); }));
}

/** Tournament sub-menu: continue a saved cup or start a new one. */
class TournamentMenuScreen implements Screen {
  t = 0; menu: Menu;
  constructor() {
    const saved = Tournament.load();
    const items = [];
    if (saved && !saved.champion) items.push({ label: `Continue (${teamById(saved.state.userTeam).name})`, onSelect: () => runTournament(saved) });
    items.push({ label: 'New tournament', onSelect: () => app.push(new TeamSelectScreen(app, 'tournament', (teams) => {
      app.push(new TournamentSetupScreen(app, teams[0], (tour) => {
        app.push(new DrawScreen(app, tour, () => runTournament(tour)));
      }));
    })) });
    items.push({ label: 'Back', onSelect: () => app.pop() });
    this.menu = new Menu(items);
  }
  update(dt: number) { this.t += dt; if (this.menu.update(input, audio) === 'back') app.pop(); }
  render(ctx: CanvasRenderingContext2D) {
    drawBackground(ctx, this.t); drawTitle(ctx, 'CHAMPIONS CUP', '16 teams • single-leg knockout • extra time and penalties');
    drawPanel(ctx, 340, 160, 600, 260); this.menu.draw(ctx, 380, 210, 520, 50);
    drawFooter(ctx, 'Progress is saved automatically after every match');
  }
}
function tournamentMenu() { app.push(new TournamentMenuScreen()); }

function runTournament(tour: Tournament) {
  const show = () => {
    app.replace(new BracketScreen(app, tour, () => playNext(), () => { tour.save(); mainMenu(); }));
    const ch = tour.champion;
    if (ch) {
      app.push(new ChampionScreen(app, teamById(ch), ch === tour.state.userTeam, () => { Tournament.clear(); mainMenu(); }));
    }
  };
  const playNext = () => {
    const nm = tour.nextUserMatch();
    if (!nm) { show(); return; }
    const a = teamById(nm.match.a!), b = teamById(nm.match.b!);
    const userIsA = a.id === tour.state.userTeam;
    const teams: [TeamInfo, TeamInfo] = [a, b];
    const humanSlots: [number, number] = userIsA ? [0, -1] : [-1, 0];
    const userFormation = tour.state.formation;
    const cpuFormation = ['2-2', '1-2-1', '3-1', '1-3'][Math.floor(Math.random() * 4)];
    const formations: [string, string] = userIsA ? [userFormation, cpuFormation] : [cpuFormation, userFormation];
    const knockout = nm.kind === 'knockout';
    const isFinal = knockout && tour.userInFinal;
    const opts = app.matchOptions(teams, formations, humanSlots, knockout, { halfMinutes: tour.state.halfMinutes, difficulty: tour.state.difficulty as any, isFinal });
    startMatch(opts, (r) => {
      tour.state.formation = app.settings.formationP1;
      tour.recordUserResult(r.score[0], r.score[1], r.aet, r.pens);
      show();
    });
  };
  show();
}

/* ---------------------------------------------------------------- boot */

const params = new URLSearchParams(location.search);
if (params.has('quick')) {
  // dev shortcut: straight into a match (optional ?demo for CPU vs CPU)
  const demo = params.has('demo');
  const ms = new MatchScreen(app, app.matchOptions([TEAMS[0], TEAMS[1]], ['2-2', '1-2-1'], demo ? [-1, -1] : [0, -1], params.has('ko'), { halfMinutes: Number(params.get('half') ?? 1), seed: 42 }), () => mainMenu());
  app.push(ms);
  if (params.has('pens')) ms.session.match.startPenaltiesNow();
} else if (params.has('champion')) {
  app.push(new ChampionScreen(app, TEAMS[0], true, () => mainMenu()));
} else {
  app.push(new TitleScreen(app, () => mainMenu()));
}

const loop = new GameLoop({
  update(dt) {
    input.tick(dt);
    if (input.ui.pressed.debug) app.debug = !app.debug;
    if (input.ui.pressed.mute) audio.toggleMute();
    app.screens.update(dt);
    app.fps = loop.fps;
  },
  render(alpha, frameDt) {
    scaler.begin();
    const ctx = scaler.ctx;
    ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, CONFIG.LOGICAL_W, CONFIG.LOGICAL_H);
    app.screens.render(ctx, alpha, frameDt);
    if (app.debug) drawDebug(ctx);
  },
});
loop.start();

function drawDebug(ctx: CanvasRenderingContext2D) {
  const top = app.screens.top as any;
  const session = top?.session ?? top?.ms?.session ?? top?.demo;
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 100, 470, 260);
  ctx.fillStyle = '#4ade80'; ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const lines = [`FPS ${app.fps.toFixed(0)}   screens ${app.screens.stack.length}   particles ${session?.effects?.count ?? 0}`];
  if (session?.match) {
    const m = session.match, b = m.ball;
    lines.push(`phase ${m.phase} ${m.phaseT.toFixed(1)}  tick ${m.totalTicks}  restart ${m.restart ? m.restart.type + (m.restart.ready ? ' ready' : '') : '-'}`);
    lines.push(`ball (${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(2)}) v=${b.speed.toFixed(1)} owner=${b.owner} net=${b.inNet}  active ${m.activeIds}`);
    lines.push(`cam (${session.cam.x.toFixed(1)},${session.cam.y.toFixed(1)}) z=${session.cam.zoom.toFixed(2)}  teamAI phase ${m.ai[0].phaseBlend.toFixed(2)}/${m.ai[1].phaseBlend.toFixed(2)}`);
    for (const p of m.sim.players) lines.push(`${p.team}/${p.index} #${String(p.number).padStart(2)} ${p.role.padEnd(16)} ${p.action.padEnd(9)} spd ${p.speed.toFixed(1)} st ${p.stamina.toFixed(0).padStart(3)} ${p.hasBall ? '●' : ' '} tgt(${p.targetX.toFixed(0)},${p.targetY.toFixed(0)})`);
  }
  lines.forEach((l, i) => ctx.fillText(l, 8, 106 + i * 15));
  // formation anchors
  if (session?.match && session.cam) {
    const m = session.match; const cam = session.cam; const tmp = { x: 0, y: 0 };
    for (const p of m.sim.players) {
      if (p.isKeeper) continue;
      m.anchor(p, m.ai[p.team].phaseBlend, tmp);
      ctx.strokeStyle = p.team === 0 ? '#38bdf8' : '#fb7185'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cam.sx(tmp.x), cam.sy(tmp.y), 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.font = '10px monospace'; ctx.fillText(String(p.number), cam.sx(tmp.x) + 8, cam.sy(tmp.y) - 4);
    }
  }
}
export { text };
