import { CONFIG } from '../config';
import { Camera } from '../core/camera';
import { angleLerp, lerp } from '../core/math';
import type { SimWorld } from '../sim/sim';
import type { Player, TeamInfo } from '../sim/types';
import { AnimState, drawStickman, hairColor, skinColor, type StickmanStyle } from './stickman';
import { BallTrail, drawBall, drawBallShadow } from './ballRender';
import { drawGoals, drawPitch, type NetState } from './pitch';

export interface WorldRenderOptions {
  quality: number;
  alpha: number;
  markers?: (p: Player, sx: number, sy: number, headY: number) => void;
  overlays?: () => void;
}

/** Keeps per-player animation state and draws the world with interpolation. */
export class WorldRenderer {
  anims = new Map<number, AnimState>();
  trail = new BallTrail();
  nets: [NetState, NetState] = [{ ripple: 0, phase: 0 }, { ripple: 0, phase: 0 }];
  ballRoll = 0;
  styles: [StickmanStyle, StickmanStyle] | null = null;
  keeperStyles: [StickmanStyle, StickmanStyle] | null = null;
  private order: Player[] = [];
  private lastFrameTime = 0;

  setTeams(teams: [TeamInfo, TeamInfo], swapKit: [boolean, boolean] = [false, false]) {
    const mk = (t: TeamInfo, swap: boolean, keeper: boolean): StickmanStyle => ({
      kit: keeper ? t.kit.keeper : swap ? t.kit.secondary : t.kit.primary,
      shorts: keeper ? '#222' : swap ? t.kit.primary : t.kit.shorts,
      number: keeper ? '#fff' : swap ? t.kit.primary : t.kit.secondary,
      skin: '#f1c9a5', hair: '#222', boots: '#1b1b1b',
    });
    this.styles = [mk(teams[0], swapKit[0], false), mk(teams[1], swapKit[1], false)];
    this.keeperStyles = [mk(teams[0], false, true), mk(teams[1], false, true)];
  }

  anim(p: Player) {
    let a = this.anims.get(p.id);
    if (!a) { a = new AnimState(); this.anims.set(p.id, a); }
    return a;
  }

  /** Advance animation states by real frame time. */
  tick(sim: SimWorld, frameDt: number) {
    for (const p of sim.players) this.anim(p).update(p, frameDt, p.speed);
    this.trail.fade(frameDt);
    const b = sim.ball;
    if (b.speed > 16 || (b.z > 0.5 && b.speed > 12)) this.trail.push(b.x, b.y, b.z, 1);
    this.ballRoll += b.speed * frameDt * 3 * (b.vx >= 0 ? 1 : -1);
    for (const n of this.nets) { n.phase += frameDt * 14; n.ripple = Math.max(0, n.ripple - frameDt * 0.8); }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, sim: SimWorld, opts: WorldRenderOptions) {
    const a = opts.alpha;
    drawPitch(ctx, cam, opts.quality);
    drawGoals(ctx, cam, this.nets, 'back');
    const b = sim.ball;
    const bx = lerp(b.px, b.x, a), by = lerp(b.py, b.y, a), bz = lerp(b.pz, b.z, a);
    drawBallShadow(ctx, cam, bx, by, bz);
    // sort entities by y (depth)
    this.order.length = 0;
    for (const p of sim.players) this.order.push(p);
    this.order.sort((p, q) => (p.py + (p.y - p.py) * a) - (q.py + (q.y - q.py) * a));
    let ballDrawn = false;
    const drawBallNow = () => { drawBall(ctx, cam, bx, by, bz, this.ballRoll, this.trail); ballDrawn = true; };
    for (const p of this.order) {
      const py = lerp(p.py, p.y, a);
      if (!ballDrawn && by + 0.05 < py && bz < 1.2) drawBallNow();
      const px = lerp(p.px, p.x, a);
      const h = angleLerp(p.pheading, p.heading, a);
      const anim = this.anim(p);
      const base = (p.isKeeper ? this.keeperStyles : this.styles)?.[p.team];
      const style: StickmanStyle = base ? { ...base, skin: skinColor(p.skin), hair: hairColor(p.hair) } : { kit: '#fff', shorts: '#222', number: '#000', skin: skinColor(p.skin), hair: hairColor(p.hair), boots: '#111' };
      const headU = anim.pose.hipH + 0.52 + 0.1 + 0.27 + anim.pose.bodyZ;
      const sx = cam.sx(px), sy = cam.sy(py);
      drawStickman(ctx, cam, px, py, h, anim.pose, style, { number: p.number, hasBall: p.hasBall });
      opts.markers?.(p, sx, sy, cam.sy(py, headU * Math.max(0.25, 1 - Math.abs(anim.pose.lying))));
    }
    if (!ballDrawn) drawBallNow();
    drawGoals(ctx, cam, this.nets, 'front');
    opts.overlays?.();
  }
}

export const TEAM_PLACEHOLDER: [TeamInfo, TeamInfo] = [
  { id: 'a', name: 'Team A', short: 'TMA', kit: { primary: '#e8e8ee', secondary: '#1f3b8f', shorts: '#e8e8ee', keeper: '#2fb36a' }, ratings: { attack: 80, defense: 80, passing: 80, speed: 80, stamina: 80, keeper: 80 } },
  { id: 'b', name: 'Team B', short: 'TMB', kit: { primary: '#d62828', secondary: '#f5f5f5', shorts: '#1a1a1a', keeper: '#f2c94c' }, ratings: { attack: 80, defense: 80, passing: 80, speed: 80, stamina: 80, keeper: 80 } },
];
export const _cfg = CONFIG;
