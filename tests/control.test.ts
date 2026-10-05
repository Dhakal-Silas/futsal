import { describe, it, expect } from 'vitest';
import { Match } from '../src/sim/match';
import { TEAMS } from '../src/sim/teams';
import { CONFIG } from '../src/config';
import { InputManager } from '../src/core/input';
import { HumanController } from '../src/control/human';
import { gainPossession, placePlayer } from '../src/sim/player';

function setup() {
  const m = new Match({ teams: [TEAMS[0], TEAMS[1]], formations: ['2-2-2', '3-2-1'], halfMinutes: 1, humanSlots: [0, -1], difficulty: 'Medium', knockout: false, seed: 3 });
  m.start();
  const input = new InputManager();
  const h = new HumanController(0, 0, m.sim, input);
  // get into open play: let the kick-off happen
  for (let i = 0; i < 60 * 4; i++) { h.activeId = m.activeIds[0]; if (h.activeId >= 0) { const c = m.sim.command(h.activeId); h.update(CONFIG.TICK_DT, c); if (m.phase === 'kickoff' && m.restart?.ready) c.kick = { type: 'pass', power: 0.5, aimX: -1, aimY: 0, targetId: -1, loft: 0, speed: 9, noise: 0 }; } m.step(CONFIG.TICK_DT); m.events.length = 0; }
  return { m, input, h };
}

describe('human control', () => {
  it('gives the human the keeper after a catch and executes a throw to the chosen teammate', () => {
    const { m, input, h } = setup();
    expect(m.phase).toBe('play');
    const keeper = m.sim.players.find((p) => p.team === 0 && p.isKeeper)!;
    const b = m.ball;
    b.x = keeper.x + 0.3; b.y = keeper.y; b.vx = 0; b.vy = 0;
    gainPossession(keeper, b, m.sim);
    keeper.holdTimer = CONFIG.KEEPER_HOLD_TIME;
    m.step(CONFIG.TICK_DT);
    expect(m.activeIds[0]).toBe(keeper.id);
    // hold for 2 s without input: the CPU brain must not distribute for a human keeper
    for (let i = 0; i < 120; i++) { h.activeId = m.activeIds[0]; h.update(CONFIG.TICK_DT, m.sim.command(h.activeId)); m.step(CONFIG.TICK_DT); m.events.length = 0; }
    expect(b.owner).toBe(keeper.id);
    expect(b.z).toBeGreaterThan(0.5); // carried in the hands
    // press pass -> throw
    input.players[0].pressed.pass = true;
    h.activeId = m.activeIds[0];
    const cmd = h.update(CONFIG.TICK_DT, m.sim.command(h.activeId));
    expect(cmd.kick?.type).toBe('throw');
    expect(cmd.kick?.targetId).toBeGreaterThanOrEqual(0);
    const target = cmd.kick!.targetId;
    input.players[0].pressed.pass = false;
    for (let i = 0; i < 30; i++) { m.step(CONFIG.TICK_DT); m.events.length = 0; }
    expect(b.owner).not.toBe(keeper.id);
    expect(b.lastTouch).toBe(keeper.id);
    // control moved to the receiver
    expect(m.activeIds[0]).toBe(target);
  });

  it('auto-distributes a human keeper that waits too long', () => {
    const { m, h } = setup();
    const keeper = m.sim.players.find((p) => p.team === 0 && p.isKeeper)!;
    const b = m.ball;
    b.x = keeper.x + 0.3; b.y = keeper.y; b.vx = 0; b.vy = 0;
    gainPossession(keeper, b, m.sim); keeper.holdTimer = CONFIG.KEEPER_HOLD_TIME;
    for (let i = 0; i < 60 * (CONFIG.KEEPER_HUMAN_HOLD_MAX + 1.5); i++) { h.activeId = m.activeIds[0]; if (h.activeId >= 0) h.update(CONFIG.TICK_DT, m.sim.command(h.activeId)); m.step(CONFIG.TICK_DT); m.events.length = 0; }
    expect(b.owner).not.toBe(keeper.id);
  });

  it('a human receiver runs to meet a pass when no direction is held', () => {
    const { m, input, h } = setup();
    const mates = m.sim.players.filter((p) => p.team === 0 && !p.isKeeper);
    const passer = mates[0], receiver = mates[1];
    placePlayer(passer, -5, 0, 0); placePlayer(receiver, 3, 4, 0);
    for (const o of m.sim.players) if (o.team === 1 && !o.isKeeper) placePlayer(o, 10 + o.index, -6, 0);
    for (const o of mates) if (o !== passer && o !== receiver) placePlayer(o, -16 + o.index, (o.index % 2 ? 8 : -8), 0);
    const b = m.ball; b.x = passer.x + 0.5; b.y = 0; b.vx = 0; b.vy = 0; b.z = 0;
    gainPossession(passer, b, m.sim);
    m.step(CONFIG.TICK_DT);
    expect(m.activeIds[0]).toBe(passer.id);
    // pass toward the receiver's general direction (ball aimed slightly short so the receiver must move)
    input.players[0].moveX = 0.9; input.players[0].moveY = 0.45; input.players[0].held.pass = true; input.players[0].pressed.pass = true;
    h.activeId = passer.id;
    h.update(CONFIG.TICK_DT, m.sim.command(passer.id));
    input.players[0].pressed.pass = false; input.players[0].held.pass = false;
    const cmd = h.update(CONFIG.TICK_DT, m.sim.command(passer.id)); // release -> kick
    expect(cmd.kick?.type).toBe('pass');
    expect(cmd.kick?.targetId).toBe(receiver.id);
    m.step(CONFIG.TICK_DT); m.events.length = 0; // consume the kick command
    input.players[0].moveX = 0; input.players[0].moveY = 0;
    const startD = Math.hypot(receiver.x - b.x, receiver.y - b.y);
    let moved = false;
    for (let i = 0; i < 90; i++) {
      h.activeId = m.activeIds[0];
      const lp = m.lastPass;
      h.receiving = !!lp && lp.targetId === h.activeId && m.sim.time - lp.t < 2;
      if (h.activeId >= 0) { const c = h.update(CONFIG.TICK_DT, m.sim.command(h.activeId)); if (h.activeId === receiver.id && Math.hypot(c.moveX, c.moveY) > 0.2) moved = true; }
      m.step(CONFIG.TICK_DT); m.events.length = 0;
      if (b.owner === receiver.id) break;
    }
    expect(m.activeIds[0]).toBe(receiver.id);
    expect(moved).toBe(true);
    expect(b.owner).toBe(receiver.id);
    void startD;
  });
});
