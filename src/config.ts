// Every gameplay constant lives here so the game can be tuned in one place.
// Units: meters, seconds, meters/second unless noted.

export const CONFIG = {
  // --- Rendering / timing ---
  LOGICAL_W: 1280,
  LOGICAL_H: 720,
  TICK_RATE: 60,
  TICK_DT: 1 / 60,
  MAX_FRAME_DT: 0.25,
  Y_FORESHORTEN: 0.92, // pitch y axis scale for the side-angled look
  Z_SCREEN_SCALE: 1.0, // how many world-meters of screen offset per meter of height

  // --- Pitch (futsal, 40 x 20 m) ---
  PITCH_LENGTH: 40,
  PITCH_WIDTH: 20,
  GOAL_WIDTH: 3,
  GOAL_HEIGHT: 2,
  GOAL_DEPTH: 1.0,
  PENALTY_AREA_RADIUS: 6,
  PENALTY_SPOT: 6,
  SECOND_PENALTY_SPOT: 10,
  CENTER_CIRCLE_R: 3,
  OUT_MARGIN: 3.5, // how far beyond the lines the world extends (for runs / kick-ins)

  // --- Ball ---
  BALL_RADIUS: 0.11,
  BALL_GRAVITY: 9.81 * 1.4, // slightly heavy for arcade feel
  BALL_BOUNCE: 0.6,
  BALL_GROUND_FRICTION: 0.85, // velocity fraction kept per second on the ground (rolling)
  BALL_ROLL_DECEL: 3.0, // linear m/s^2 deceleration while rolling
  BALL_AIR_DRAG: 0.96,
  BALL_MIN_SPEED: 0.08,
  BALL_SPIN_BOUNCE_LOSS: 0.85, // horizontal speed kept on bounce
  POST_BOUNCE: 0.55,

  // --- Player movement ---
  PLAYER_RADIUS: 0.35,
  PLAYER_JOG_SPEED: 5.6,
  PLAYER_SPRINT_SPEED: 7.8,
  PLAYER_ACCEL: 22,
  PLAYER_DECEL: 28,
  PLAYER_TURN_RATE: 11, // rad/s
  PLAYER_DRIBBLE_SPEED_MULT: 0.9,
  PLAYER_SEPARATION_RADIUS: 0.8,
  STAMINA_MAX: 100,
  STAMINA_SPRINT_DRAIN: 18, // per second
  STAMINA_REGEN: 9, // per second while not sprinting
  STAMINA_TIRED_THRESHOLD: 15,
  STAMINA_TIRED_SPEED_MULT: 0.8,

  // --- Ball control ---
  CONTROL_RADIUS: 0.75, // where a player can take a first touch
  CONTROL_MAX_BALL_SPEED: 14, // faster balls can't be controlled cleanly
  CONTROL_MAX_BALL_HEIGHT: 1.3,
  DRIBBLE_OFFSET: 0.55, // ball sits this far in front of the carrier
  DRIBBLE_TOUCH_INTERVAL: 0.32, // s between touches while running
  DRIBBLE_TOUCH_SPEED_BONUS: 1.12,
  POSSESSION_TOUCH_COOLDOWN: 0.25, // after kicking, can't immediately re-control

  // --- Kicks ---
  PASS_MIN_SPEED: 9,
  PASS_MAX_SPEED: 17,
  THROUGH_SPEED: 15,
  THROUGH_LEAD_TIME: 0.75,
  SHOT_MIN_SPEED: 14,
  SHOT_MAX_SPEED: 27,
  SHOT_LOFT: 0.18, // vertical component fraction
  CROSS_SPEED: 15,
  CROSS_LOFT: 0.62,
  LOB_PASS_LOFT: 0.45,
  CHARGE_TIME: 0.8, // s to full power
  KICK_WINDUP: 0.12, // s from button to contact
  KICK_FOLLOW_THROUGH: 0.22,
  KICK_REACH: 1.1, // ball must be within this of the kicker at contact
  SHOT_ASSIST_ANGLE: 0.45, // rad; aim is pulled toward goal within this cone
  CLEAR_SPEED: 20,

  // --- Slide tackle ---
  SLIDE_DURATION: 0.45,
  SLIDE_SPEED: 8.5,
  SLIDE_REACH: 1.0,
  SLIDE_RECOVERY: 0.55,
  SLIDE_COOLDOWN: 1.2,
  TACKLE_KNOCKDOWN_TIME: 0.9,
  TACKLE_BALL_WIN_SPEED: 6,
  FOUL_YELLOW_CHANCE: 0.3,

  // --- Keeper ---
  KEEPER_LINE_DEPTH: 0.9, // m in front of goal line when the ball is far
  KEEPER_MAX_STEP_OUT: 3.5,
  KEEPER_SPEED: 5.5,
  KEEPER_DIVE_SPEED: 9,
  KEEPER_DIVE_DURATION: 0.55,
  KEEPER_DIVE_REACH: 1.6,
  KEEPER_CATCH_RADIUS: 0.9,
  KEEPER_HOLD_TIME: 1.4, // s before distributing
  KEEPER_REACTION_BASE: 0.18,
  KEEPER_SAVE_BASE: 0.72,
  KEEPER_THROW_SPEED: 13,
  KEEPER_KICK_SPEED: 20,

  // --- Match ---
  DEFAULT_HALF_MINUTES: 3,
  EXTRA_TIME_HALF_MINUTES: 1,
  KICKOFF_DELAY: 1.2,
  GOAL_CELEBRATION_TIME: 3.2,
  RESTART_DELAY: 0.9,
  RESTART_OPPONENT_DISTANCE: 5,
  SETPIECE_AUTO_DELAY: 1.5, // CPU takes a restart after this long
  HALF_TIME_DURATION: 0, // handled by UI, 0 = wait for input
  REPLAY_RECORD_SECONDS: 2.5,
  REPLAY_PLAY_SECONDS: 2.0,
  REPLAY_SLOWMO: 0.35,

  // --- Switching ---
  AUTO_SWITCH_COOLDOWN: 0.6,
  MANUAL_SWITCH_LOCK: 1.2,

  // --- Camera ---
  CAM_FOLLOW_STIFFNESS: 4.5,
  CAM_LOOKAHEAD: 0.35, // s of ball velocity
  CAM_BASE_ZOOM: 40, // px per meter at zoom 1
  CAM_KICKOFF_ZOOM: 0.78,
  CAM_GOAL_ZOOM: 1.25,
  CAM_ZOOM_STIFFNESS: 2.5,
  CAM_SHAKE_DECAY: 6,

  // --- AI shared ---
  AI_ROLE_UPDATE_INTERVAL: 0.25,
  AI_SHOOT_RANGE: 11,
  AI_PRESS_RADIUS: 7,
  AI_SUPPORT_SPREAD: 5,
} as const;

export type Config = typeof CONFIG;
export const HALF_LENGTH = CONFIG.PITCH_LENGTH / 2;
export const HALF_WIDTH = CONFIG.PITCH_WIDTH / 2;
