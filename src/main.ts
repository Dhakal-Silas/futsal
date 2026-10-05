import { CONFIG, HALF_LENGTH } from './config';
import { CanvasScaler } from './core/canvas';
import { GameLoop } from './core/loop';
import { InputManager } from './core/input';
import { Camera } from './core/camera';
import { SimWorld } from './sim/sim';
import { createPlayer, placePlayer } from './sim/player';
import { resetBall } from './sim/ball';
import { HumanController } from './control/human';
import { WorldRenderer, TEAM_PLACEHOLDER } from './render/world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const scaler = new CanvasScaler(canvas);
const input = new InputManager();
input.attach(canvas);
const cam = new Camera();
cam.targetZoom = 1; cam.snap();

const sim = new SimWorld(7);
const p1 = sim.addPlayer(createPlayer(0, 0, 1, 7, 'Player', 1, 0.8, 0.6, 1, 0));
placePlayer(p1, -5, 0, 0);
const p2 = sim.addPlayer(createPlayer(0, 0, 2, 9, 'Mate', 1, 0.8, 0.6, 2, 1));
placePlayer(p2, 2, 4, 0);
const d1 = sim.addPlayer(createPlayer(0, 1, 2, 4, 'Def', 1, 0.6, 0.6, 3, 2));
placePlayer(d1, 8, -2, Math.PI);
resetBall(sim.ball, -3, 0);
const human = new HumanController(0, 0, sim, input);
human.activeId = p1.id;
const world = new WorldRenderer();
world.setTeams(TEAM_PLACEHOLDER);

const loop = new GameLoop({
  update(dt) {
    input.tick(dt);
    sim.clearCommands();
    human.update(dt, sim.command(p1.id));
    if (input.ui.pressed.confirm && sim.ball.inNet >= 0) { resetBall(sim.ball, -3, 0); }
    sim.step(dt);
    sim.events.length = 0;
    const b = sim.ball;
    cam.targetX = (b.x + p1.x) / 2 + b.vx * CONFIG.CAM_LOOKAHEAD * 0.5;
    cam.targetY = (b.y + p1.y) / 2;
    cam.update(dt);
  },
  render(alpha, frameDt) {
    world.tick(sim, frameDt);
    scaler.begin();
    const ctx = scaler.ctx;
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, CONFIG.LOGICAL_W, CONFIG.LOGICAL_H);
    world.draw(ctx, cam, sim, { quality: 1, alpha });
    ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.textAlign = 'left';
    const b = sim.ball;
    ctx.fillText(`M2 — FPS ${loop.fps.toFixed(0)} | ball ${b.x.toFixed(1)},${b.y.toFixed(1)} z ${b.z.toFixed(2)} v ${b.speed.toFixed(1)} owner ${b.owner} inNet ${b.inNet} | p1 act ${p1.action} spd ${p1.speed.toFixed(1)} stam ${p1.stamina.toFixed(0)}`, 16, 28);
    if (p1.charging) { ctx.fillStyle = '#ff0'; ctx.fillRect(16, 40, 200 * p1.charging.t, 10); }
    ctx.fillText(`goal at x=${HALF_LENGTH}. WASD move, Shift sprint, L shoot (hold), J pass, I cross, U slide. Enter resets after a goal.`, 16, 70);
  },
});
loop.start();
