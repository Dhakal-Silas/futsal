import { CONFIG, HALF_LENGTH, HALF_WIDTH } from '../config';
import { clamp } from '../core/math';
import { SimWorld } from './sim';
import { createPlayer, placePlayer, startAction, gainPossession, releaseBall } from './player';
import { resetBall } from './ball';
import { formationAnchor, formationById, kickoffPosition, type Formation } from './formation';
import { playerName } from './teams';
import type { Kick, MatchEvent, Phase, Player, Restart, TeamIndex, TeamInfo, TeamStats, PenaltyState } from './types';
import { emptyStats } from './types';
import { difficultyParams, type Difficulty, type DifficultyParams } from '../ai/difficulty';
import { TeamAI } from '../ai/coordinator';
import { KeeperBrain } from '../ai/keeperBrain';
import { PenaltyShootout } from './penalties';

export interface MatchOptions {
  teams: [TeamInfo, TeamInfo];
  formations: [string, string];
  halfMinutes: number;
  /** which human slot controls each team (-1 = CPU) */
  humanSlots: [number, number];
  difficulty: Difficulty;
  knockout: boolean;
  seed: number;
  isFinal?: boolean;
  /** skip the ET/penalties: used by the demo */
  demo?: boolean;
}

export interface GoalInfo { team: TeamIndex; scorerId: number; ownGoal: boolean; minute: number; }

export interface Snapshot {
  t: number;
  players: { x: number; y: number; h: number; action: Player['action']; actionT: number; speed: number; hasBall: boolean; lying: number }[];
  ball: { x: number; y: number; z: number; speed: number };
}

/** A whole futsal match: sim world + rules + phases + AI. Deterministic given seed + inputs. */
export class Match {
  sim: SimWorld;
  phase: Phase = 'prematch';
  phaseT = 0;
  score: [number, number] = [0, 0];
  clock = 0;              // seconds elapsed in the current period
  half = 1;               // 1, 2, 3 (ET1), 4 (ET2)
  halfLength: number;
  stats: [TeamStats, TeamStats] = [emptyStats(), emptyStats()];
  restart: Restart | null = null;
  formations: [Formation, Formation];
  params: [DifficultyParams, DifficultyParams];
  ai: [TeamAI, TeamAI];
  keepers: [KeeperBrain, KeeperBrain];
  /** active (human-controlled) player per team, -1 if CPU */
  activeIds: [number, number] = [-1, -1];
  private switchCooldown: [number, number] = [0, 0];
  private manualLock: [number, number] = [0, 0];
  goals: GoalInfo[] = [];
  lastGoal: GoalInfo | null = null;
  /** presentation events (consumed by the game layer each tick) */
  events: MatchEvent[] = [];
  banner: { text: string; sub: string; t: number; color: string } | null = null;
  foulCount: [number, number] = [0, 0];
  penalties: PenaltyShootout | null = null;
  winner: TeamIndex | -1 = -1;
  /** ring buffer of recent snapshots for the goal replay */
  replay: Snapshot[] = [];
  private replayHead = 0;
  totalTicks = 0;
  humanPress: [boolean, boolean] = [false, false];
  humanJockey: [boolean, boolean] = [false, false];
  kickoffTeam: TeamIndex = 0;
  attackingAtGoal = false;
  pendingPenalty = false;
  readonly maxReplay = Math.round(CONFIG.REPLAY_RECORD_SECONDS * CONFIG.TICK_RATE);

  constructor(public opts: MatchOptions) {
    this.sim = new SimWorld(opts.seed);
    this.halfLength = opts.halfMinutes * 60;
    this.formations = [formationById(opts.formations[0]), formationById(opts.formations[1])];
    const cpu = difficultyParams(opts.difficulty);
    // human teams: teammates behave at a solid, low-noise level regardless of difficulty
    const mate = difficultyParams('Hard');
    this.params = [opts.humanSlots[0] >= 0 ? mate : cpu, opts.humanSlots[1] >= 0 ? mate : cpu];
    this.createPlayers();
    this.ai = [new TeamAI(this, 0), new TeamAI(this, 1)];
    this.keepers = [new KeeperBrain(this, 0), new KeeperBrain(this, 1)];
    this.sim.onKick = (p, k) => this.onKick(p, k);
    this.sim.onFoul = (t, v) => this.onFoul(t, v);
    this.sim.onTackleWon = (t) => { this.stats[t.team].tackles++; };
    for (let i = 0; i < this.maxReplay; i++) this.replay.push(this.makeSnapshot());
    this.sim.attackDirs = [1, -1];
    this.kickoffTeam = (this.sim.rng.next() < 0.5 ? 0 : 1) as TeamIndex;
    this.setupKickoff(this.kickoffTeam);
    this.phase = 'prematch';
  }

  get knockout() { return this.opts.knockout; }
  isHuman(team: TeamIndex) { return this.opts.humanSlots[team] >= 0; }
  attackDir(team: TeamIndex) { return this.sim.attackDir(team); }
  team(i: TeamIndex) { return this.opts.teams[i]; }
  player(id: number) { return this.sim.players[id]; }
  get ball() { return this.sim.ball; }
  get inExtraTime() { return this.half > 2; }
  get periodLength() { return this.half > 2 ? CONFIG.EXTRA_TIME_HALF_MINUTES * 60 : this.halfLength; }
  /** total displayed clock in seconds */
  get displayClock() {
    if (this.half <= 2) return (this.half - 1) * this.halfLength + this.clock;
    return 2 * this.halfLength + (this.half - 3) * CONFIG.EXTRA_TIME_HALF_MINUTES * 60 + this.clock;
  }
  get ballTeam(): TeamIndex | -1 { const o = this.ball.owner; return o >= 0 ? this.player(o).team : -1; }

  private createPlayers() {
    const rng = this.sim.rng;
    for (let t = 0; t < 2; t++) {
      const info = this.opts.teams[t];
      const r = info.ratings;
      const par = this.params[t];
      const numbers = [1, 4, 7, 10, 9];
      for (let i = 0; i < 5; i++) {
        const speedMult = (0.9 + (r.speed - 80) / 100) * (this.isHuman(t as TeamIndex) ? 1 : par.speedMult);
        const skill = clamp(0.45 + (r.passing + r.attack - 160) / 60, 0.3, 1);
        const tackle = clamp(0.4 + (r.defense - 80) / 40, 0.3, 1) * (this.isHuman(t as TeamIndex) ? 0.85 : 0.5 + par.tackleSkill * 0.6);
        const p = createPlayer(0, t as TeamIndex, i, numbers[i], playerName(t * 7 + i * 3 + info.id.length), clamp(speedMult, 0.8, 1.15), skill, clamp(tackle, 0.2, 1), rng.int(0, 6), rng.int(0, 5));
        this.sim.addPlayer(p);
      }
    }
  }

  /* ------------------------------------------------------------------ setup */

  private setupKickoff(kicking: TeamIndex) {
    const pos = { x: 0, y: 0 };
    for (const p of this.sim.players) {
      kickoffPosition(this.formations[p.team], p.index, this.attackDir(p.team), p.team === kicking, pos);
      placePlayer(p, pos.x, pos.y, this.attackDir(p.team) > 0 ? 0 : Math.PI);
      p.stamina = Math.max(p.stamina, 60);
    }
    resetBall(this.ball, 0, 0);
    const taker = this.sim.players.find((p) => p.team === kicking && p.index === 4)!;
    this.restart = { type: 'kickoff', team: kicking, x: 0, y: 0, takerId: taker.id, timer: 0, ready: false };
    this.sim.ballActive = false;
    this.phase = 'kickoff'; this.phaseT = 0;
    for (const a of this.ai) a.reset();
    for (const k of this.keepers) k.reset();
    this.pickActive(0, true); this.pickActive(1, true);
  }

  start() { if (this.phase === 'prematch') { this.phase = 'kickoff'; this.phaseT = 0; } }

  /* ------------------------------------------------------------------ main step */

  /**
   * Advance the match by one tick. `humanCmds` are filled by the game layer for the active players
   * before calling this. The match fills the rest with AI.
   */
  step(dt: number) {
    const sim = this.sim;
    this.phaseT += dt;
    this.totalTicks++;
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    for (let t = 0; t < 2; t++) { this.switchCooldown[t] = Math.max(0, this.switchCooldown[t] - dt); this.manualLock[t] = Math.max(0, this.manualLock[t] - dt); }

    switch (this.phase) {
      case 'prematch':
        return;
      case 'penalties':
        this.penalties?.step(dt);
        sim.step(dt);
        for (const e of sim.events) this.events.push(e);
        sim.events.length = 0;
        if (this.penalties?.done && this.phaseT > 3) { this.winner = this.penalties.winner; this.phase = 'finished'; this.phaseT = 0; }
        if (this.penalties?.done && this.phaseT <= 3 && this.phaseT - dt <= 0) this.phaseT = 0;
        return;
      case 'halftime': case 'fulltime': case 'extratime_break': case 'finished':
        return;
      default:
        break;
    }

    // AI + keepers fill commands for everyone not human-controlled
    for (const p of sim.players) {
      if (p.controlledBy >= 0 && p.controlledBy === this.opts.humanSlots[p.team]) continue; // human filled it
      const cmd = sim.command(p.id);
      cmd.moveX = 0; cmd.moveY = 0; cmd.sprint = false; cmd.kick = null; cmd.slide = false; cmd.hasFace = false; cmd.dive = null;
    }
    this.ai[0].update(dt); this.ai[1].update(dt);
    this.keepers[0].update(dt); this.keepers[1].update(dt);

    if (this.phase === 'goal') this.updateGoalPhase(dt);
    if (this.phase === 'kickoff' || this.phase === 'restart') this.updateRestart(dt);

    sim.step(dt);
    this.recordSnapshot();
    if (this.phase === 'foul') this.resolveFoul();

    // possession stats
    const bt = this.ballTeam;
    if (bt >= 0 && this.phase === 'play') this.stats[bt as TeamIndex].possessionTicks++;

    if (this.phase === 'play') {
      this.clock += dt;
      this.checkRules();
      if (this.clock >= this.periodLength) this.endPeriod();
    }

    // consume sim events into presentation events
    for (const e of sim.events) this.events.push(e);
    sim.events.length = 0;

    this.updateSwitching(dt);
  }

  /* ------------------------------------------------------------------ rules */

  private checkRules() {
    const b = this.ball;
    const r = CONFIG.BALL_RADIUS;
    if (b.inNet >= 0) {
      // goal in net index 0 (x<0) means team attacking -x scored
      const scoring = (this.attackDir(0) < 0 ? (b.inNet === 0 ? 0 : 1) : (b.inNet === 0 ? 1 : 0)) as TeamIndex;
      this.scoreGoal(scoring);
      return;
    }
    if (Math.abs(b.y) > HALF_WIDTH + r) {
      const side = b.y > 0 ? 1 : -1;
      const team = this.otherTeam(b.lastTouchTeam);
      this.beginRestart('kickin', team, clamp(b.x, -HALF_LENGTH + 0.5, HALF_LENGTH - 0.5), side * (HALF_WIDTH - 0.1));
      this.events.push({ type: 'kickin', team, playerId: -1, x: b.x, y: b.y, strength: 0.5 });
      return;
    }
    if (Math.abs(b.x) > HALF_LENGTH + r) {
      const endSide = b.x > 0 ? 1 : -1; // which goal line
      const defending = (this.attackDir(0) === endSide ? 1 : 0) as TeamIndex; // team whose goal is at this end
      const attacking = this.otherTeam(defending);
      if (b.lastTouchTeam === defending) {
        // corner for the attackers
        this.stats[attacking].corners++;
        this.beginRestart('corner', attacking, endSide * (HALF_LENGTH - 0.3), (b.y >= 0 ? 1 : -1) * (HALF_WIDTH - 0.3));
        this.events.push({ type: 'corner', team: attacking, playerId: -1, x: b.x, y: b.y, strength: 0.5 });
        if (b.kickType === 'shoot' && b.lastTouchTeam !== attacking) { /* deflected shot */ }
      } else {
        if (b.kickType === 'shoot' && b.lastTouchTeam === attacking) this.events.push({ type: 'miss', team: attacking, playerId: b.lastTouch, x: b.x, y: b.y, strength: 0.5 });
        this.beginRestart('goalclear', defending, endSide * (HALF_LENGTH - 2.5), 0);
        this.events.push({ type: 'goalkick', team: defending, playerId: -1, x: b.x, y: b.y, strength: 0.5 });
      }
    }
  }

  otherTeam(t: TeamIndex | -1): TeamIndex { return t === 0 ? 1 : 0; }

  private scoreGoal(team: TeamIndex) {
    const b = this.ball;
    const scorer = b.lastTouch >= 0 ? this.player(b.lastTouch) : null;
    const ownGoal = !!scorer && scorer.team !== team;
    const info: GoalInfo = { team, scorerId: scorer ? scorer.id : -1, ownGoal, minute: Math.floor(this.displayClock / 60) + 1 };
    this.score[team]++;
    this.goals.push(info); this.lastGoal = info;
    if (b.kickType === 'shoot' && !ownGoal) this.stats[team].shotsOnTarget++;
    this.phase = 'goal'; this.phaseT = 0;
    this.sim.ballActive = false;
    this.events.push({ type: 'goal', team, playerId: info.scorerId, x: b.x, y: b.y, strength: 1 });
    this.banner = { text: 'GOAL!', sub: ownGoal ? `Own goal` : scorer ? `${scorer.name} #${scorer.number}` : '', t: CONFIG.GOAL_CELEBRATION_TIME, color: this.team(team).kit.primary };
    this.startCelebration(team, scorer && !ownGoal ? scorer : null);
    this.kickoffTeam = this.otherTeam(team);
  }

  private startCelebration(team: TeamIndex, scorer: Player | null) {
    const rng = this.sim.rng;
    const celeb = rng.int(0, 3);
    for (const p of this.sim.players) {
      if (p.isKeeper) continue;
      if (p.team === team) {
        startAction(p, 'celebrate', CONFIG.GOAL_CELEBRATION_TIME);
        p.celebType = scorer && p === scorer ? celeb : celeb === 1 ? 2 : rng.int(0, 3);
        p.hasBall = false;
      }
    }
    releaseBall(scorer ?? this.sim.players[0], this.ball);
    this.ball.owner = -1;
  }

  private updateGoalPhase(dt: number) {
    const g = this.lastGoal!;
    const scorer = g.scorerId >= 0 && !g.ownGoal ? this.player(g.scorerId) : null;
    const dir = this.attackDir(g.team);
    for (const p of this.sim.players) {
      const cmd = this.sim.command(p.id);
      cmd.kick = null; cmd.slide = false;
      if (p.team !== g.team || p.isKeeper) { cmd.moveX = 0; cmd.moveY = 0; cmd.sprint = false; continue; }
      if (p.action !== 'celebrate') startAction(p, 'celebrate', CONFIG.GOAL_CELEBRATION_TIME);
      let tx: number, ty: number;
      if (scorer && p === scorer) {
        // run toward the corner flag area, then stop
        tx = dir * (HALF_LENGTH - 4); ty = (scorer.y > 0 ? 1 : -1) * (HALF_WIDTH - 2.5);
        if (this.phaseT > 1.3) { tx = p.x; ty = p.y; }
      } else if (scorer) {
        tx = scorer.x - dir * 0.8; ty = scorer.y + (p.index % 2 ? 1 : -1) * 0.7;
      } else { tx = p.x; ty = p.y; }
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.9) { cmd.moveX = dx / d; cmd.moveY = dy / d; cmd.sprint = d > 4; }
      else { cmd.moveX = 0; cmd.moveY = 0; }
    }
    if (this.phaseT >= CONFIG.GOAL_CELEBRATION_TIME) {
      for (const p of this.sim.players) if (p.action === 'celebrate') p.action = 'none';
      this.setupKickoff(this.kickoffTeam);
    }
  }

  private onFoul(tackler: Player, victim: Player) {
    if (this.phase !== 'play') return;
    this.stats[tackler.team].fouls++;
    this.foulCount[tackler.team]++;
    const yellow = this.sim.rng.next() < CONFIG.FOUL_YELLOW_CHANCE && !tackler.yellow;
    if (yellow) tackler.yellow = true;
    this.events.push({ type: 'foul', team: tackler.team, playerId: tackler.id, x: victim.x, y: victim.y, strength: 1 });
    if (yellow) this.events.push({ type: 'yellow', team: tackler.team, playerId: tackler.id, x: tackler.x, y: tackler.y, strength: 1 });
    this.banner = { text: 'FOUL', sub: yellow ? `Yellow card: ${tackler.name} #${tackler.number}` : `${tackler.name} #${tackler.number}`, t: 1.8, color: yellow ? '#f2c94c' : '#ffffff' };
    // free kick for the victim's team from the spot (kept at least 7 m from the goal line)
    const dir = this.attackDir(victim.team);
    let fx = victim.x, fy = victim.y;
    const maxX = HALF_LENGTH - 7;
    if (dir > 0) fx = Math.min(fx, maxX); else fx = Math.max(fx, -maxX);
    fy = clamp(fy, -HALF_WIDTH + 1, HALF_WIDTH - 1);
    this.phase = 'foul'; this.phaseT = 0;
    this.sim.ballActive = false;
    this.pendingFreeKick = { team: victim.team, x: fx, y: fy };
  }
  private pendingFreeKick: { team: TeamIndex; x: number; y: number } | null = null;

  private beginRestart(type: Restart['type'], team: TeamIndex, x: number, y: number) {
    const b = this.ball;
    releaseBall(this.sim.players[0], b);
    b.owner = -1;
    this.sim.ballActive = false;
    // choose a taker: keeper for goal clearances, otherwise the nearest outfield player
    let taker: Player;
    if (type === 'goalclear') taker = this.sim.players.find((p) => p.team === team && p.isKeeper)!;
    else {
      const human = this.isHuman(team) && this.activeIds[team] >= 0 ? this.player(this.activeIds[team]) : null;
      const near = this.sim.nearestPlayerTo(x, y, team, true)!;
      taker = human && !human.isKeeper && Math.hypot(human.x - x, human.y - y) < Math.hypot(near.x - x, near.y - y) + 6 ? human : near;
    }
    this.restart = { type, team, x, y, takerId: taker.id, timer: 0, ready: false };
    // ball moves to the spot quickly but smoothly (velocity-based)
    b.vx = (x - b.x) * 4; b.vy = (y - b.y) * 4; b.vz = 0; b.z = Math.min(b.z, 0.2); b.inNet = -1;
    this.phase = 'restart'; this.phaseT = 0;
    if (this.isHuman(team)) { this.activeIds[team] = taker.isKeeper ? this.activeIds[team] : taker.id; this.applyControl(team); }
  }

  /** Called while in 'kickoff' / 'restart': move the ball to the spot, make the taker own it, wait for the kick. */
  private updateRestart(dt: number) {
    const r = this.restart!;
    const b = this.ball;
    const taker = this.player(r.takerId);
    r.timer += dt;
    const dx = r.x - b.x, dy = r.y - b.y;
    const d = Math.hypot(dx, dy);
    if (!r.ready) {
      // slide the ball into place
      if (d > 0.05) { b.vx = dx * 6; b.vy = dy * 6; b.vz = 0; if (b.z > 0.05) b.z *= 0.8; }
      else { b.vx = 0; b.vy = 0; b.z = 0; b.vz = 0; b.x = r.x; b.y = r.y; }
      b.owner = -1;
      const td = Math.hypot(taker.x - b.x, taker.y - b.y);
      if (td < 0.75 && d <= 0.1 && taker.action === 'none') {
        gainPossession(taker, b, this.sim);
        b.vx = 0; b.vy = 0;
        if (r.type === 'goalclear') { taker.holdTimer = r.type === 'goalclear' ? 0.9 : 0; }
        r.ready = true; r.timer = 0;
      }
    } else {
      // keep the ball at the taker while waiting
      if (b.owner !== taker.id && taker.action !== 'kick' && taker.action !== 'throw') { gainPossession(taker, b, this.sim); }
    }
    // keep opponents away from the ball
    for (const p of this.sim.players) {
      if (p.team === r.team) continue;
      const ox = p.x - r.x, oy = p.y - r.y;
      const od = Math.hypot(ox, oy);
      const minD = r.type === 'kickoff' ? CONFIG.CENTER_CIRCLE_R + 0.3 : CONFIG.RESTART_OPPONENT_DISTANCE;
      if (od < minD) {
        const push = (minD - od) * 3 * dt;
        p.x += (ox / (od || 1)) * push; p.y += (oy / (od || 1)) * push;
      }
      if (r.type === 'kickoff') {
        // stay in own half
        const dir = this.attackDir(p.team);
        if (p.x * dir > -0.6) p.x -= dir * 2 * dt;
      }
    }
  }

  /** Set the taker free: the kick happened. */
  private onKick(p: Player, k: Kick) {
    if (this.phase === 'kickoff' || this.phase === 'restart') {
      if (this.restart && p.id === this.restart.takerId) {
        this.phase = 'play'; this.phaseT = 0;
        this.sim.ballActive = true;
        this.restart = null;
        p.holdTimer = 0;
        this.events.push({ type: 'whistle', team: p.team, playerId: p.id, x: p.x, y: p.y, strength: 0.3 });
      }
    }
    if (this.phase !== 'play') return;
    if (k.type === 'shoot') { this.stats[p.team].shots++; }
    else if (k.type === 'pass' || k.type === 'through' || k.type === 'cross' || k.type === 'throw') {
      this.stats[p.team].passes++;
      this.lastPass = { team: p.team, targetId: k.targetId, t: this.sim.time };
      // control goes to the receiver immediately (human team)
      if (this.isHuman(p.team) && k.targetId >= 0 && this.player(k.targetId).team === p.team && !this.player(k.targetId).isKeeper) {
        this.activeIds[p.team] = k.targetId; this.applyControl(p.team); this.switchCooldown[p.team] = CONFIG.AUTO_SWITCH_COOLDOWN;
      }
    }
  }
  lastPass: { team: TeamIndex; targetId: number; t: number } | null = null;

  /** Call when the ball is gained to credit completed passes. */
  private creditPass(p: Player) {
    const lp = this.lastPass;
    if (lp && lp.team === p.team && this.sim.time - lp.t < 3) this.stats[p.team].passesCompleted++;
    this.lastPass = null;
  }

  /* ------------------------------------------------------------------ periods */

  private endPeriod() {
    this.sim.ballActive = false;
    this.ball.owner = -1;
    for (const p of this.sim.players) { p.charging = null; p.hasBall = false; }
    if (this.half === 1) { this.phase = 'halftime'; this.events.push({ type: 'halftime', team: -1, playerId: -1, x: 0, y: 0, strength: 1 }); }
    else if (this.half === 2) {
      if (this.knockout && this.score[0] === this.score[1] && !this.opts.demo) { this.phase = 'extratime_break'; this.events.push({ type: 'extratime', team: -1, playerId: -1, x: 0, y: 0, strength: 1 }); }
      else this.finish();
    } else if (this.half === 3) { this.phase = 'halftime'; }
    else {
      if (this.score[0] === this.score[1]) { this.beginPenalties(); }
      else this.finish();
    }
    this.phaseT = 0;
  }

  private finish() {
    this.phase = 'fulltime'; this.phaseT = 0;
    this.winner = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : -1;
    this.events.push({ type: 'fulltime', team: -1, playerId: -1, x: 0, y: 0, strength: 1 });
    this.banner = { text: 'FULL TIME', sub: `${this.score[0]} - ${this.score[1]}`, t: 3, color: '#fff' };
  }

  /** Continue after half time / extra time break. */
  continue() {
    if (this.phase === 'halftime' || this.phase === 'extratime_break') {
      this.half++;
      this.clock = 0;
      // swap ends
      this.sim.attackDirs = [-this.sim.attackDirs[0], -this.sim.attackDirs[1]] as [number, number];
      const kick = this.half === 2 ? this.otherTeam(this.kickoffTeamFirst) : this.half === 3 ? this.kickoffTeamFirst : this.otherTeam(this.kickoffTeamFirst);
      this.setupKickoff(kick);
      this.banner = { text: this.half === 2 ? '2ND HALF' : this.half === 3 ? 'EXTRA TIME' : 'ET 2ND HALF', sub: '', t: 2, color: '#fff' };
    } else if (this.phase === 'fulltime') { this.phase = 'finished'; }
  }
  private get kickoffTeamFirst(): TeamIndex { return this.goals.length ? this.kickoffTeamInitial : this.kickoffTeam; }
  private kickoffTeamInitial: TeamIndex = 0;

  /** Dev helper: jump straight to a penalty shootout. */
  startPenaltiesNow() { if (this.phase === 'prematch') this.start(); this.sim.ballActive = false; this.half = 4; this.beginPenalties(); }

  private beginPenalties() {
    this.phase = 'penalties'; this.phaseT = 0;
    this.penalties = new PenaltyShootout(this);
    this.events.push({ type: 'shootout', team: -1, playerId: -1, x: 0, y: 0, strength: 1 });
    this.banner = { text: 'PENALTY SHOOTOUT', sub: '', t: 2.5, color: '#fff' };
  }

  /* ------------------------------------------------------------------ control / switching */

  /** Ensure `controlledBy` flags match activeIds. */
  applyControl(team: TeamIndex) {
    const slot = this.opts.humanSlots[team];
    for (const p of this.sim.players) if (p.team === team) p.controlledBy = (slot >= 0 && p.id === this.activeIds[team]) ? (slot as 0 | 1) : -1;
  }

  /** Choose the best player to control for a human team. */
  private pickActive(team: TeamIndex, force: boolean) {
    if (!this.isHuman(team)) { this.activeIds[team] = -1; this.applyControl(team); return; }
    const b = this.ball;
    const dir = this.attackDir(team);
    let best: Player | null = null, bestScore = Infinity;
    const cur = this.activeIds[team] >= 0 ? this.player(this.activeIds[team]) : null;
    for (const p of this.sim.players) {
      if (p.team !== team || p.isKeeper) continue;
      if (p.action === 'fallen') continue;
      const bx = b.x + b.vx * 0.3, by = b.y + b.vy * 0.3;
      let s = Math.hypot(p.x - bx, p.y - by);
      // prefer players goal-side of the ball when defending
      if ((p.x - bx) * dir > 0.5) s += 2.5;
      if (p === cur) s -= 1.6; // hysteresis
      if (s < bestScore) { bestScore = s; best = p; }
    }
    if (best && (force || best !== cur)) { this.activeIds[team] = best.id; this.applyControl(team); }
  }

  private updateSwitching(dt: number) {
    for (let t = 0; t < 2; t++) {
      const team = t as TeamIndex;
      if (!this.isHuman(team)) continue;
      if (this.phase !== 'play') { if (this.activeIds[team] < 0 || this.player(this.activeIds[team]).isKeeper) this.pickActive(team, true); continue; }
      const owner = this.ball.owner;
      if (owner >= 0 && this.player(owner).team === team) {
        // our player has it: control them (unless the keeper)
        if (!this.player(owner).isKeeper && this.activeIds[team] !== owner) { this.activeIds[team] = owner; this.applyControl(team); this.switchCooldown[team] = CONFIG.AUTO_SWITCH_COOLDOWN; }
        if (this.activeIds[team] === owner) this.creditPassOnce(this.player(owner));
        continue;
      }
      // the pass receiver keeps control while the ball travels to them
      if (this.lastPass && this.lastPass.team === team && this.lastPass.targetId === this.activeIds[team] && this.sim.time - this.lastPass.t < 1.6) continue;
      if (this.manualLock[team] > 0 || this.switchCooldown[team] > 0) continue;
      this.pickActive(team, false);
      this.switchCooldown[team] = CONFIG.AUTO_SWITCH_COOLDOWN * 0.5;
    }
  }
  private creditedOwner = -1;
  private creditPassOnce(p: Player) { if (this.creditedOwner !== p.id) { this.creditedOwner = p.id; this.creditPass(p); } }

  /** Manual switch: cycle to the next-nearest teammate to the ball. */
  manualSwitch(team: TeamIndex) {
    if (!this.isHuman(team)) return;
    const b = this.ball;
    const cur = this.activeIds[team];
    const cands = this.sim.players.filter((p) => p.team === team && !p.isKeeper && p.id !== cur && p.action !== 'fallen');
    cands.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
    if (cands.length) { this.activeIds[team] = cands[0].id; this.applyControl(team); this.manualLock[team] = CONFIG.MANUAL_SWITCH_LOCK; }
  }

  /** Change a team's formation (half time / pause). */
  setFormation(team: TeamIndex, id: string) { this.formations[team] = formationById(id); this.opts.formations[team] = id; }

  /* ------------------------------------------------------------------ replay */

  private makeSnapshot(): Snapshot {
    return { t: 0, players: this.sim.players.map(() => ({ x: 0, y: 0, h: 0, action: 'none', actionT: 0, speed: 0, hasBall: false, lying: 0 })), ball: { x: 0, y: 0, z: 0, speed: 0 } };
  }
  private recordSnapshot() {
    const s = this.replay[this.replayHead];
    this.replayHead = (this.replayHead + 1) % this.maxReplay;
    s.t = this.sim.time;
    for (let i = 0; i < this.sim.players.length; i++) {
      const p = this.sim.players[i], d = s.players[i];
      d.x = p.x; d.y = p.y; d.h = p.heading; d.action = p.action; d.actionT = p.actionT; d.speed = p.speed; d.hasBall = p.hasBall;
    }
    s.ball.x = this.ball.x; s.ball.y = this.ball.y; s.ball.z = this.ball.z; s.ball.speed = this.ball.speed;
  }
  /** Snapshots in chronological order (oldest first). */
  replayFrames(): Snapshot[] {
    const out: Snapshot[] = [];
    for (let i = 0; i < this.maxReplay; i++) out.push(this.replay[(this.replayHead + i) % this.maxReplay]);
    return out;
  }

  /** Process the pending foul (called from step via phase 'foul'). */
  resolveFoul() {
    if (this.phase === 'foul' && this.pendingFreeKick) {
      if (this.phaseT >= 1.2) {
        const fk = this.pendingFreeKick; this.pendingFreeKick = null;
        this.beginRestart('freekick', fk.team, fk.x, fk.y);
      }
    }
  }

  /** Formation anchor for a player with the current ball position and team phase. */
  anchor(p: Player, phaseBlend: number, out: { x: number; y: number }) {
    return formationAnchor(this.formations[p.team], p.index, this.attackDir(p.team), phaseBlend, this.ball.x, this.ball.y, out);
  }
}

export type { PenaltyState };
