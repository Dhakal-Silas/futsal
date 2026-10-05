import { CONFIG } from './config';
import { CanvasScaler } from './core/canvas';
import { GameLoop } from './core/loop';
import { InputManager } from './core/input';
import { AudioManager } from './core/audio';
import { MatchSession } from './game/session';
import { TEAMS } from './sim/teams';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const scaler = new CanvasScaler(canvas);
const input = new InputManager();
input.attach(canvas);
const audio = new AudioManager();
window.addEventListener('keydown', () => { audio.init(); audio.resume(); }, { once: true });

const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const session = new MatchSession({
  teams: [TEAMS[0], TEAMS[1]], formations: ['2-2', '1-2-1'], halfMinutes: 1,
  humanSlots: demo ? [-1, -1] : [0, -1], difficulty: 'Medium', knockout: false, seed: 42,
}, input, audio, { quality: 1, showHints: true, minimap: true });
(window as any).__session = session;

let debug = false;
const loop = new GameLoop({
  update(dt) {
    input.tick(dt);
    if (input.ui.pressed.debug) debug = !debug;
    if (input.ui.pressed.mute) audio.toggleMute();
    session.update(dt);
  },
  render(alpha, frameDt) {
    scaler.begin();
    const ctx = scaler.ctx;
    session.render(ctx, alpha, frameDt);
    if (debug) {
      const m = session.match;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 100, 420, 240);
      ctx.fillStyle = '#0f0'; ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const b = m.ball;
      const lines = [
        `FPS ${loop.fps.toFixed(0)}  phase ${m.phase} ${m.phaseT.toFixed(1)}  tick ${m.totalTicks}`,
        `ball (${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(2)}) v=${b.speed.toFixed(1)} owner=${b.owner} net=${b.inNet}`,
        `active ${m.activeIds}  restart ${m.restart ? m.restart.type + (m.restart.ready ? ' ready' : '') : '-'}`,
        ...m.sim.players.map((p) => `${p.team}/${p.index} #${p.number} ${p.role.padEnd(16)} ${p.action.padEnd(9)} spd ${p.speed.toFixed(1)} st ${p.stamina.toFixed(0)} ${p.hasBall ? '●' : ''}`),
      ];
      lines.forEach((l, i) => ctx.fillText(l, 8, 106 + i * 15));
    }
  },
});
loop.start();
