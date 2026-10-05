import { CONFIG, HALF_LENGTH } from '../config';
import { Camera } from '../core/camera';
import type { InputManager } from '../core/input';
import type { AudioManager } from '../core/audio';
import { HumanController } from '../control/human';
import { Match, type MatchOptions, type Snapshot } from '../sim/match';
import type { Ball, Player, TeamIndex } from '../sim/types';
import { createBall } from '../sim/ball';
import { WorldRenderer, type WorldLike } from '../render/world';
import { Effects } from '../render/effects';
import { Hud } from '../render/hud';
import { kitsClash } from '../sim/teams';
import { text, textShadow } from '../render/text';
import { clamp, lerp } from '../core/math';

export interface SessionSettings { quality: number; showHints: boolean; minimap: boolean; }

/**
 * One match on screen: match sim + human controllers + camera + rendering + presentation
 * (replays, effects, sounds). The app layer owns menus and pause.
 */
export class MatchSession {
  match: Match;
  cam = new Camera();
  world = new WorldRenderer();
  replayWorld = new WorldRenderer();
  effects = new Effects();
  hud = new Hud();
  humans: HumanController[] = [];
  paused = false;
  /** replay state */
  replaying = false;
  private replayFrames: Snapshot[] = [];
  private replayPos = 0;
  private replayView: WorldLike;
  private replayDelay = 0;
  private pendingReplay = false;
  t = 0;
  private dustTimer = 0;
  finished = false;
  introT = 0;
  /** final presentation */
  intro = false;

  constructor(opts: MatchOptions, public input: InputManager, public audio: AudioManager, public settings: SessionSettings) {
    this.match = new Match(opts);
    const clash = kitsClash(opts.teams[0], opts.teams[1]);
    this.world.setTeams(opts.teams, [false, clash]);
    this.replayWorld.setTeams(opts.teams, [false, clash]);
    for (let t = 0; t < 2; t++) {
      const slot = opts.humanSlots[t];
      if (slot >= 0) this.humans.push(new HumanController(slot as 0 | 1, t as TeamIndex, this.match.sim, input));
    }
    // replay view: shallow player copies
    this.replayView = { players: this.match.sim.players.map((p) => ({ ...p })), ball: createBall() };
    this.cam.targetZoom = CONFIG.CAM_KICKOFF_ZOOM; this.cam.targetX = 0; this.cam.targetY = 0; this.cam.snap();
    this.effects.enabled = settings.quality > 0;
    this.hud.showHints = settings.showHints; this.hud.minimap = settings.minimap;
    this.intro = !!opts.isFinal;
    this.introT = 0;
    if (!this.intro) this.match.start();
  }

  get sim() { return this.match.sim; }

  /** Fixed-step update. Returns true if the match wants the pause menu. */
  update(dt: number) {
    const m = this.match;
    this.t += dt;
    if (this.intro) {
      this.introT += dt;
      if (this.introT > 5 || this.input.ui.pressed.confirm) { this.intro = false; m.start(); this.audio.whistle(); }
      this.cam.targetZoom = CONFIG.CAM_KICKOFF_ZOOM; this.cam.update(dt);
      return;
    }
    if (this.replaying) { this.updateReplay(dt); return; }
    if (this.pendingReplay) { this.replayDelay -= dt; if (this.replayDelay <= 0) { this.pendingReplay = false; this.startReplay(); return; } }

    // human input
    for (const h of this.humans) {
      const team = h.team;
      h.activeId = m.activeIds[team];
      if (m.phase === 'penalties' && m.penalties) {
        const st = h.inputState;
        const pi = m.penalties.input[h.slot];
        pi.aimX = st.moveX; pi.aimY = st.moveY; pi.shootHeld = st.held.shoot; pi.shootPressed = st.pressed.shoot; pi.shootReleased = st.released.shoot;
        continue;
      }
      if (h.activeId >= 0) {
        const cmd = this.sim.command(h.activeId);
        h.update(dt, cmd);
        m.humanPress[team] = h.pressRequest; m.humanJockey[team] = h.jockey;
        if (h.inputState.pressed.switch && m.phase === 'play') {
          const owner = m.ball.owner;
          const ours = owner >= 0 && m.player(owner).team === team;
          if (!ours || !m.player(owner).hasBall) m.manualSwitch(team);
        }
      }
    }
    if ((m.phase === 'halftime' || m.phase === 'extratime_break') && this.input.ui.pressed.confirm) { m.continue(); this.audio.whistle(); }
    if (m.phase === 'fulltime' && m.phaseT > 2.5 && this.input.ui.pressed.confirm) m.continue();

    m.step(dt);
    this.handleEvents();
    this.updateCamera(dt);
    this.effects.update(dt);
    this.emitDust(dt);
    this.audio.update(dt);
    if (m.phase === 'finished') this.finished = true;
    // crowd intensity
    const base = this.match.opts.isFinal ? 0.5 : 0.3;
    const excite = m.phase === 'goal' ? 1 : m.phase === 'play' ? base + clamp(Math.abs(m.ball.x) / HALF_LENGTH, 0, 1) * 0.3 : base * 0.7;
    this.audio.setCrowd(excite);
  }

  private handleEvents() {
    const m = this.match;
    for (const e of m.events) {
      switch (e.type) {
        case 'kick': this.audio.kick(e.strength); if (e.strength > 0.8) this.cam.addShake(0.25 * e.strength); this.effects.dust(e.x, e.y, 2, 0.6); break;
        case 'bounce': if (e.strength > 0.15) { this.audio.bounce(e.strength); this.effects.dust(e.x, e.y, 2, e.strength); } break;
        case 'post': this.audio.post(); this.cam.addShake(0.3); this.effects.sparks(e.x, e.y, 1, 6); break;
        case 'goal': {
          this.audio.goal(); this.cam.addShake(0.6);
          const netIdx: 0 | 1 = m.ball.inNet >= 0 ? (m.ball.inNet as 0 | 1) : (e.x > 0 ? 1 : 0);
          this.world.nets[netIdx].ripple = 1;
          this.pendingReplay = true; this.replayDelay = 0.9;
          const team = m.team((e.team >= 0 ? e.team : 0) as TeamIndex);
          this.effects.confetti(e.x, e.y, 40, [team.kit.primary, team.kit.secondary, '#ffffff']);
          break;
        }
        case 'tackle': this.audio.tackle(); this.effects.dust(e.x, e.y, 6, 1.2); break;
        case 'foul': this.audio.whistle(); break;
        case 'save': this.audio.save(); this.audio.crowdCheer(); break;
        case 'catch': this.audio.catchBall(); break;
        case 'kickin': case 'corner': case 'goalkick': this.audio.whistle(); break;
        case 'whistle': break;
        case 'halftime': case 'fulltime': this.audio.whistle(true); break;
        case 'penalty_scored': this.audio.goal(); this.world.nets[1].ripple = 1; break;
        case 'penalty_missed': this.audio.crowdCheer(); break;
        case 'miss': break;
        default: break;
      }
    }
    m.events.length = 0;
  }

  private emitDust(dt: number) {
    this.dustTimer -= dt;
    if (this.dustTimer > 0) return;
    this.dustTimer = 0.09;
    for (const p of this.sim.players) {
      if (p.action === 'slide') this.effects.dust(p.x - Math.cos(p.heading) * 0.3, p.y, 2, 1);
      else if (p.speed > CONFIG.PLAYER_JOG_SPEED * 1.08) this.effects.dust(p.x - Math.cos(p.heading) * 0.2, p.y - Math.sin(p.heading) * 0.2, 1, 0.5);
    }
  }

  private updateCamera(dt: number) {
    const m = this.match, b = m.ball, cam = this.cam;
    let tx = b.x, ty = b.y, zoom = 1;
    switch (m.phase) {
      case 'kickoff': case 'prematch': zoom = CONFIG.CAM_KICKOFF_ZOOM; tx = 0; ty = 0; break;
      case 'goal': zoom = CONFIG.CAM_GOAL_ZOOM; {
        const g = m.lastGoal; const scorer = g && g.scorerId >= 0 ? m.player(g.scorerId) : null;
        if (scorer && m.phaseT > 1.0) { tx = scorer.x; ty = scorer.y; } break;
      }
      case 'penalties': zoom = 1.15; tx = HALF_LENGTH - 4; ty = 0; break;
      case 'halftime': case 'fulltime': case 'extratime_break': case 'finished': zoom = CONFIG.CAM_KICKOFF_ZOOM; tx = 0; ty = 0; break;
      default: {
        // follow the ball, biased toward the active human player, with velocity look-ahead
        const h = this.humans[0];
        const active = h && h.activeId >= 0 ? m.player(h.activeId) : null;
        if (active) { tx = lerp(b.x, active.x, 0.3); ty = lerp(b.y, active.y, 0.3); }
        tx += b.vx * CONFIG.CAM_LOOKAHEAD; ty += b.vy * CONFIG.CAM_LOOKAHEAD * 0.6;
        zoom = 1;
      }
    }
    cam.targetX = tx; cam.targetY = ty; cam.targetZoom = zoom;
    cam.update(dt);
  }

  /* ------------------------------------------------------------- replay */

  private startReplay() {
    const frames = this.match.replayFrames();
    const n = Math.round(1.5 * CONFIG.TICK_RATE);
    this.replayFrames = frames.slice(frames.length - n);
    this.replayPos = 0;
    this.replaying = true;
    this.applyFrame(this.replayFrames[0], true);
    this.cam.targetZoom = CONFIG.CAM_GOAL_ZOOM;
  }
  private applyFrame(f: Snapshot, snap: boolean) {
    const v = this.replayView;
    for (let i = 0; i < v.players.length; i++) {
      const p = v.players[i], s = f.players[i];
      p.px = snap ? s.x : p.x; p.py = snap ? s.y : p.y; p.pheading = snap ? s.h : p.heading;
      p.x = s.x; p.y = s.y; p.heading = s.h; p.action = s.action; p.actionT = s.actionT; p.speed = s.speed; p.hasBall = s.hasBall;
      p.actionDur = this.match.sim.players[i].actionDur || 1;
    }
    const b = v.ball;
    b.px = snap ? f.ball.x : b.x; b.py = snap ? f.ball.y : b.y; b.pz = snap ? f.ball.z : b.z;
    b.x = f.ball.x; b.y = f.ball.y; b.z = f.ball.z; b.speed = f.ball.speed;
  }
  private updateReplay(dt: number) {
    this.replayPos += dt * CONFIG.TICK_RATE * CONFIG.REPLAY_SLOWMO * 1.4;
    const i = Math.floor(this.replayPos);
    if (i >= this.replayFrames.length) { this.replaying = false; return; }
    this.applyFrame(this.replayFrames[i], false);
    const b = this.replayView.ball;
    this.cam.targetX = b.x; this.cam.targetY = b.y; this.cam.targetZoom = CONFIG.CAM_GOAL_ZOOM;
    this.cam.update(dt);
    this.effects.update(dt * 0.4);
  }

  /* ------------------------------------------------------------- render */

  render(ctx: CanvasRenderingContext2D, alpha: number, frameDt: number) {
    const m = this.match;
    const cam = this.cam;
    ctx.fillStyle = '#1b4d2b';
    ctx.fillRect(0, 0, CONFIG.LOGICAL_W, CONFIG.LOGICAL_H);
    if (this.replaying) {
      const frac = this.replayPos - Math.floor(this.replayPos);
      this.replayWorld.tick(this.replayView, frameDt * CONFIG.REPLAY_SLOWMO * 1.4);
      this.replayWorld.nets[0].ripple = this.world.nets[0].ripple; this.replayWorld.nets[1].ripple = this.world.nets[1].ripple;
      this.replayWorld.draw(ctx, cam, this.replayView, { quality: this.settings.quality, alpha: frac, overlays: () => this.effects.draw(ctx, cam) });
      this.drawLetterbox(ctx);
      textShadow(ctx, 'REPLAY', CONFIG.LOGICAL_W - 40, 60, 26, '#fff', 'right', '900');
      const blink = Math.floor(this.t * 2) % 2 === 0;
      if (blink) { ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(CONFIG.LOGICAL_W - 150, 60, 7, 0, Math.PI * 2); ctx.fill(); }
      this.hud.drawScoreboard(ctx, m);
      return;
    }
    if (!this.paused) this.world.tick(this.sim, frameDt);
    const humansByTeam: (HumanController | null)[] = [null, null];
    for (const h of this.humans) humansByTeam[h.team] = h;
    this.world.draw(ctx, cam, this.sim, {
      quality: this.settings.quality,
      alpha,
      markers: (p, sx, sy, headY) => {
        if (p.controlledBy >= 0 && m.phase !== 'penalties') {
          this.hud.drawActiveMarker(ctx, cam, p, p.controlledBy, headY, sx, sy, this.t);
        }
        if (p.charging) this.hud.drawPowerBar(ctx, cam, p, sx, sy);
        // pass target marker
        for (const h of this.humans) {
          if (h.passTargetId === p.id && h.activeId >= 0 && m.phase === 'play') {
            const from = m.player(h.activeId);
            if (from.hasBall || this.sim.ball.owner < 0) this.hud.drawPassTarget(ctx, cam, from, p, h.slot, headY, sx, sy);
          }
        }
      },
      overlays: () => this.effects.draw(ctx, cam),
    });
    // rings under active players are drawn before the stickman: emulate by drawing after with low alpha
    for (const p of this.sim.players) {
      if (p.controlledBy >= 0 && m.phase !== 'penalties') {
        const px = lerp(p.px, p.x, alpha), py = lerp(p.py, p.y, alpha);
        ctx.save(); ctx.globalAlpha = 0.9; this.hud.drawRing(ctx, cam, cam.sx(px), cam.sy(py), p.controlledBy); ctx.restore();
      }
    }
    // HUD
    this.hud.drawScoreboard(ctx, m);
    this.hud.drawBanner(ctx, m);
    this.hud.drawMinimap(ctx, m);
    this.hud.drawWaitPrompt(ctx, m, this.input);
    if (m.phase === 'penalties') this.hud.drawPenaltyAim(ctx, cam, m);
    for (const h of this.humans) {
      const owner = this.sim.ball.owner;
      const attacking = owner >= 0 ? m.player(owner).team === h.team : (h.activeId >= 0 && Math.hypot(this.sim.ball.x - m.player(h.activeId).x, this.sim.ball.y - m.player(h.activeId).y) < 2);
      const taker = !!m.restart && m.restart.team === h.team && (m.phase === 'kickoff' || m.phase === 'restart');
      this.hud.drawHints(ctx, m, this.input, h.slot, h.team, attacking, taker);
    }
    if (this.intro) this.drawIntro(ctx);
    if (m.phase === 'fulltime' && m.phaseT > 2.5) text(ctx, 'Press Enter to continue', CONFIG.LOGICAL_W / 2, CONFIG.LOGICAL_H * 0.62, 18, '#fff', 'center', 'bold');
  }

  private drawLetterbox(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CONFIG.LOGICAL_W, 50); ctx.fillRect(0, CONFIG.LOGICAL_H - 50, CONFIG.LOGICAL_W, 50);
  }

  private drawIntro(ctx: CanvasRenderingContext2D) {
    const m = this.match;
    const W = CONFIG.LOGICAL_W, H = CONFIG.LOGICAL_H;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
    const t = this.introT;
    const a = Math.min(1, t * 1.5);
    ctx.save(); ctx.globalAlpha = a;
    textShadow(ctx, 'CHAMPIONS CUP', W / 2, 90, 30, '#f5d76e', 'center', '900');
    textShadow(ctx, 'THE FINAL', W / 2, 140, 60, '#ffffff', 'center', '900');
    for (let i = 0; i < 2; i++) {
      const team = m.team(i as TeamIndex);
      const x = i === 0 ? W * 0.28 : W * 0.72;
      textShadow(ctx, team.name, x, 220, 28, team.kit.primary, 'center', '900');
      const players = this.sim.players.filter((p) => p.team === i);
      players.forEach((p, j) => {
        const show = t > 0.8 + j * 0.25;
        if (!show) return;
        text(ctx, `${p.number}  ${p.name}${p.isKeeper ? ' (GK)' : ''}`, x, 270 + j * 34, 22, '#fff', 'center', 'bold');
      });
    }
    text(ctx, 'Press Enter to kick off', W / 2, H - 60, 18, '#e5e7eb', 'center', 'bold');
    ctx.restore();
  }
}

export type { Ball, Player };
