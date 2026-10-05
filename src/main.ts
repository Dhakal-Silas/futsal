import { CONFIG } from './config';
import { CanvasScaler } from './core/canvas';
import { GameLoop } from './core/loop';
import { InputManager } from './core/input';
import { Camera } from './core/camera';
import { drawPitch, drawGoals } from './render/pitch';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const scaler = new CanvasScaler(canvas);
const input = new InputManager();
input.attach(canvas);
const cam = new Camera();
cam.targetZoom = cam.fitPitchZoom();
cam.snap();
let t = 0;

const loop = new GameLoop({
  update(dt) {
    input.tick(dt);
    t += dt;
    const p = input.players[0];
    cam.targetX += p.moveX * 10 * dt;
    cam.targetY += p.moveY * 10 * dt;
    if (p.held.sprint) cam.targetZoom = 1.2; else cam.targetZoom = cam.fitPitchZoom();
    cam.update(dt);
  },
  render() {
    scaler.begin();
    const ctx = scaler.ctx;
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, CONFIG.LOGICAL_W, CONFIG.LOGICAL_H);
    drawPitch(ctx, cam, 1);
    const nets: [any, any] = [{ ripple: 0, phase: t }, { ripple: 0, phase: t }];
    drawGoals(ctx, cam, nets, 'back');
    drawGoals(ctx, cam, nets, 'front');
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.fillText(`Milestone 1 — FPS ${loop.fps.toFixed(0)} — WASD pans, Shift zooms`, 16, 28);
  },
});
loop.start();
