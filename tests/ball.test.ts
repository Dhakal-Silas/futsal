import { describe, it, expect } from 'vitest';
import { createBall, stepBall, launchBall, predictBallPos, timeToReach } from '../src/sim/ball';
import { CONFIG, HALF_LENGTH } from '../src/config';

const DT = 1 / 60;

describe('ball physics', () => {
  it('rolls and slows down on the ground', () => {
    const b = createBall();
    launchBall(b, 1, 0, 10, 0, 1, 0, 'pass');
    for (let i = 0; i < 60; i++) stepBall(b, DT);
    expect(b.x).toBeGreaterThan(5);
    expect(b.speed).toBeLessThan(10);
    expect(b.z).toBe(0);
    for (let i = 0; i < 600; i++) stepBall(b, DT);
    expect(b.speed).toBe(0);
  });

  it('flies, falls under gravity and bounces with ~0.6 restitution', () => {
    const b = createBall();
    launchBall(b, 1, 0, 15, 0.6, 1, 0, 'cross');
    let maxZ = 0, bounced = false, vzBefore = 0, vzAfter = 0;
    for (let i = 0; i < 300; i++) {
      const prevVz = b.vz;
      stepBall(b, DT);
      maxZ = Math.max(maxZ, b.z);
      if (!bounced && prevVz < -1 && b.vz > 0) { bounced = true; vzBefore = prevVz; vzAfter = b.vz; }
    }
    expect(maxZ).toBeGreaterThan(1.5);
    expect(bounced).toBe(true);
    expect(vzAfter / -vzBefore).toBeCloseTo(CONFIG.BALL_BOUNCE, 1);
  });

  it('never goes below the ground', () => {
    const b = createBall();
    launchBall(b, 0.3, 1, 20, 0.5, 1, 0, 'shoot');
    for (let i = 0; i < 600; i++) { stepBall(b, DT); expect(b.z).toBeGreaterThanOrEqual(0); }
  });

  it('enters the net when shot into the goal mouth and stays inside', () => {
    const b = createBall();
    b.x = HALF_LENGTH - 5; b.y = 0.5;
    launchBall(b, 1, 0, 20, 0.1, 1, 0, 'shoot');
    for (let i = 0; i < 120; i++) stepBall(b, DT);
    expect(b.inNet).toBe(1);
    expect(b.x).toBeLessThanOrEqual(HALF_LENGTH + CONFIG.GOAL_DEPTH);
    expect(Math.abs(b.y)).toBeLessThan(CONFIG.GOAL_WIDTH / 2);
  });

  it('bounces off the post', () => {
    const b = createBall();
    b.x = HALF_LENGTH - 4; b.y = CONFIG.GOAL_WIDTH / 2; // aimed straight at the post
    const ev: any[] = [];
    launchBall(b, 1, 0, 18, 0.05, 1, 0, 'shoot');
    for (let i = 0; i < 90; i++) stepBall(b, DT, ev);
    expect(ev.some((e) => e.type === 'post')).toBe(true);
    expect(b.inNet).toBe(-1);
    expect(b.vx).toBeLessThan(0);
  });

  it('hits the crossbar when shot high', () => {
    const b = createBall();
    b.x = HALF_LENGTH - 3; b.y = 0; b.z = CONFIG.GOAL_HEIGHT - 0.05; // level with the bar
    const ev: any[] = [];
    launchBall(b, 1, 0, 18, 0, 1, 0, 'shoot');
    b.vz = 1.2;
    for (let i = 0; i < 40; i++) stepBall(b, DT, ev);
    expect(ev.some((e) => e.type === 'post')).toBe(true);
  });

  it('predicts the rolling position roughly', () => {
    const b = createBall();
    launchBall(b, 1, 0, 12, 0, 1, 0, 'pass');
    const out = { x: 0, y: 0 };
    predictBallPos(b, 1, out);
    for (let i = 0; i < 60; i++) stepBall(b, DT);
    expect(Math.abs(out.x - b.x)).toBeLessThan(0.4);
    expect(timeToReach(b, b.x + 2, 0, 0.5)).toBeGreaterThan(0);
    expect(timeToReach(b, b.x - 20, 0, 0.5)).toBe(-1);
  });
});
