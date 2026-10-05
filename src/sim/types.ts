import type { Vec2 } from '../core/math';

export type TeamIndex = 0 | 1;

export type KickType = 'pass' | 'through' | 'shoot' | 'cross' | 'clear' | 'throw' | 'tap';

export type PlayerAction = 'none' | 'kick' | 'slide' | 'fallen' | 'getup' | 'dive' | 'catch' | 'celebrate' | 'throw';

export interface Kick {
  type: KickType;
  power: number;      // 0..1
  aimX: number; aimY: number; // unit direction (may be refined at contact)
  targetId: number;   // intended receiver, -1 if none
  loft: number;       // vertical fraction
  speed: number;      // resolved launch speed
  noise: number;      // angular noise (radians, sd) applied at contact
}

export interface PlayerCommand {
  moveX: number; moveY: number; // -1..1
  sprint: boolean;
  kick: Kick | null;            // execute a kick this tick
  slide: boolean;               // start a slide tackle this tick
  /** desired facing (unit vector) when not moving, e.g. toward the ball for keepers */
  faceX: number; faceY: number; hasFace: boolean;
  /** keeper only: start a dive toward this point */
  dive: { x: number; y: number } | null;
}

export function emptyCommand(): PlayerCommand {
  return { moveX: 0, moveY: 0, sprint: false, kick: null, slide: false, faceX: 1, faceY: 0, hasFace: false, dive: null };
}

export type AIRole =
  | 'Keeper' | 'ChaseBall' | 'SupportAttack' | 'MakeRun' | 'Defend' | 'PressBallCarrier'
  | 'ReturnToFormation' | 'SetPiece' | 'Carrier' | 'Human';

export interface Player {
  id: number;
  team: TeamIndex;
  index: number;        // 0 = keeper, 1..4 outfield
  number: number;
  name: string;
  isKeeper: boolean;
  x: number; y: number;
  px: number; py: number; // previous tick (render interpolation)
  vx: number; vy: number;
  heading: number;      // radians, facing
  pheading: number;
  speed: number;
  stamina: number;
  // ratings-derived multipliers
  speedMult: number;
  skill: number;        // 0..1 general technical skill (passing/shooting noise)
  tackleSkill: number;

  action: PlayerAction;
  actionT: number;      // seconds into the action
  actionDur: number;
  kick: Kick | null;    // pending/active kick
  kickContactDone: boolean;
  slideX: number; slideY: number;
  slideHitBall: boolean;
  slideCooldown: number;
  controlCooldown: number;
  dribbleTimer: number;
  hasBall: boolean;
  charging: { type: KickType; t: number } | null;
  // celebration variant / keeper dive info
  celebType: number;
  diveX: number; diveY: number; diveDirY: number;
  holdTimer: number;    // keeper holding the ball
  // AI
  role: AIRole;
  targetX: number; targetY: number;
  aiTimer: number;
  aiMemoryBallX: number; aiMemoryBallY: number;
  reactionTimer: number;
  markId: number;
  // control
  controlledBy: -1 | 0 | 1;
  // cosmetic
  hair: number; skin: number;
  // stats
  yellow: boolean;
  // anim hint
  lastKickT: number;
  // keeper
  diveSuccessChance: number;
}

export interface Ball {
  x: number; y: number; z: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  owner: number;      // player id or -1
  lastTouch: number;  // player id
  lastTouchTeam: TeamIndex | -1;
  prevTouch: number;
  kickedBy: number;   // last kicker id (cooldown applies)
  kickCooldown: number;
  kickType: KickType | null;
  inNet: -1 | 0 | 1;  // which goal the ball is in
  speed: number;      // cached horizontal speed
  restFrames: number;
}

export interface TeamStats {
  shots: number; shotsOnTarget: number; passes: number; passesCompleted: number;
  tackles: number; fouls: number; possessionTicks: number; saves: number; corners: number;
}

export function emptyStats(): TeamStats {
  return { shots: 0, shotsOnTarget: 0, passes: 0, passesCompleted: 0, tackles: 0, fouls: 0, possessionTicks: 0, saves: 0, corners: 0 };
}

export interface TeamInfo {
  id: string;
  name: string;
  short: string;
  kit: { primary: string; secondary: string; shorts: string; keeper: string };
  ratings: { attack: number; defense: number; passing: number; speed: number; stamina: number; keeper: number };
}

export interface MatchEvent {
  type: 'goal' | 'foul' | 'yellow' | 'save' | 'kickin' | 'corner' | 'goalkick' | 'whistle' | 'kick' | 'tackle' | 'post' | 'bounce' | 'halftime' | 'fulltime' | 'miss' | 'penalty_scored' | 'penalty_missed' | 'extratime' | 'shootout' | 'catch';
  team: TeamIndex | -1;
  playerId: number;
  x: number; y: number;
  strength: number;
  text?: string;
}

export type Phase =
  | 'prematch' | 'kickoff' | 'play' | 'goal' | 'restart' | 'halftime' | 'fulltime'
  | 'extratime_break' | 'penalties' | 'finished' | 'foul';

export type RestartType = 'kickoff' | 'kickin' | 'corner' | 'goalclear' | 'freekick' | 'none';

export interface Restart {
  type: RestartType;
  team: TeamIndex;
  x: number; y: number;
  takerId: number;
  timer: number;      // seconds until the taker auto-plays (CPU) or ball becomes active
  ready: boolean;     // taker has arrived and can play the ball
}

export interface PenaltyState {
  order: TeamIndex[];           // who shoots first
  round: number;                // 0-based kick index per team
  turn: TeamIndex;
  scores: [number, number];
  taken: [number, number];
  history: [('scored' | 'missed')[], ('scored' | 'missed')[]];
  stage: 'setup' | 'aiming' | 'shot' | 'result' | 'done';
  timer: number;
  shooterId: number;
  keeperId: number;
  suddenDeath: boolean;
  result: 'scored' | 'missed' | null;
  winner: TeamIndex | -1;
  aimX: number; aimY: number;
}

export interface Vec3 extends Vec2 { z: number; }
