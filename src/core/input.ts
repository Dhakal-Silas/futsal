import { loadRaw, saveJSON } from './storage';

export type GameAction =
  | 'up' | 'down' | 'left' | 'right'
  | 'pass' | 'through' | 'shoot' | 'cross' | 'slide' | 'sprint' | 'switch';

export const GAME_ACTIONS: GameAction[] = [
  'up', 'down', 'left', 'right', 'pass', 'through', 'shoot', 'cross', 'slide', 'sprint', 'switch',
];

export const ACTION_LABELS: Record<GameAction, string> = {
  up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right',
  pass: 'Pass / Press', through: 'Through pass', shoot: 'Shoot / Contain', cross: 'Cross / Lob',
  slide: 'Slide tackle', sprint: 'Sprint', switch: 'Switch player',
};

export type Bindings = Record<GameAction, string[]>;

export const DEFAULT_BINDINGS: [Bindings, Bindings] = [
  {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    pass: ['KeyJ'], through: ['KeyK'], shoot: ['KeyL'], cross: ['KeyI'],
    slide: ['KeyU'], sprint: ['ShiftLeft'], switch: ['Space'],
  },
  {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    pass: ['Numpad1', 'Comma'], through: ['Numpad2', 'Period'], shoot: ['Numpad3', 'Slash'],
    cross: ['Numpad5', 'Semicolon'], slide: ['Numpad0', 'Quote'], sprint: ['ShiftRight'], switch: ['Enter'],
  },
];

/** Standard gamepad mapping (same for both pads). */
const PAD_BUTTONS: Partial<Record<GameAction, number[]>> = {
  pass: [0],      // A / Cross
  through: [1],   // B / Circle
  shoot: [2],     // X / Square
  cross: [3],     // Y / Triangle
  slide: [5],     // RB
  sprint: [7, 4], // RT or LB
  switch: [6],    // LT
  up: [12], down: [13], left: [14], right: [15],
};

export interface PlayerInputState {
  moveX: number; moveY: number;
  held: Record<GameAction, boolean>;
  pressed: Record<GameAction, boolean>;
  released: Record<GameAction, boolean>;
  /** seconds each action has been held (for charging) */
  holdTime: Record<GameAction, number>;
}

export type UiAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'debug' | 'mute' | 'any';

export interface UiInputState {
  pressed: Record<UiAction, boolean>;
  /** which player (0/1) produced the last confirm/back, -1 if generic */
  source: number;
}

function emptyRecord<T>(v: T): Record<GameAction, T> {
  const r = {} as Record<GameAction, T>;
  for (const a of GAME_ACTIONS) r[a] = v;
  return r;
}

export class InputManager {
  bindings: [Bindings, Bindings];
  private down = new Set<string>();
  private pressQueue: string[] = [];
  private releaseQueue: string[] = [];
  private padPrev: boolean[][] = [[], []];
  private padPressQueue: [number[], number[]] = [[], []];
  private padReleaseQueue: [number[], number[]] = [[], []];
  padIndex: [number, number] = [0, 1];
  players: [PlayerInputState, PlayerInputState];
  ui: UiInputState;
  private captureCb: ((code: string) => void) | null = null;
  textQueue: string[] = [];
  anyKeyThisTick = false;
  padConnected: [boolean, boolean] = [false, false];

  constructor() {
    const saved = loadRaw<[Bindings, Bindings]>('bindings');
    this.bindings = saved && saved.length === 2
      ? [{ ...DEFAULT_BINDINGS[0], ...saved[0] }, { ...DEFAULT_BINDINGS[1], ...saved[1] }]
      : [structuredClone(DEFAULT_BINDINGS[0]), structuredClone(DEFAULT_BINDINGS[1])];
    this.players = [this.makeState(), this.makeState()];
    this.ui = { pressed: this.emptyUi(), source: -1 };
  }

  private emptyUi(): Record<UiAction, boolean> {
    return { up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false, debug: false, mute: false, any: false };
  }

  private makeState(): PlayerInputState {
    return { moveX: 0, moveY: 0, held: emptyRecord(false), pressed: emptyRecord(false), released: emptyRecord(false), holdTime: emptyRecord(0) };
  }

  attach(target: HTMLElement | Window) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this.shouldPrevent(e.code)) e.preventDefault(); return; }
      if (this.captureCb) {
        const cb = this.captureCb; this.captureCb = null;
        if (e.code !== 'Escape') cb(e.code);
        e.preventDefault();
        return;
      }
      this.down.add(e.code);
      this.pressQueue.push(e.code);
      if (this.shouldPrevent(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releaseQueue.push(e.code);
    });
    window.addEventListener('blur', () => { this.down.clear(); });
    window.addEventListener('gamepadconnected', () => {});
    (target as HTMLElement).focus?.();
  }

  private shouldPrevent(code: string) {
    return code.startsWith('Arrow') || code === 'Space' || code === 'Tab' || code.startsWith('Numpad') || code === 'Slash' || code === 'Quote';
  }

  captureNextKey(cb: (code: string) => void) { this.captureCb = cb; }
  cancelCapture() { this.captureCb = null; }
  isCapturing() { return this.captureCb !== null; }

  rebind(player: 0 | 1, action: GameAction, code: string) {
    // remove the code from any other action of the same player
    for (const a of GAME_ACTIONS) {
      this.bindings[player][a] = this.bindings[player][a].filter((c) => c !== code);
    }
    this.bindings[player][action] = [code];
    saveJSON('bindings', this.bindings);
  }

  resetBindings() {
    this.bindings = [structuredClone(DEFAULT_BINDINGS[0]), structuredClone(DEFAULT_BINDINGS[1])];
    saveJSON('bindings', this.bindings);
  }

  private pads(): (Gamepad | null)[] {
    try { return navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch { return []; }
  }

  /** Call once per simulation tick. Computes held/pressed/released and clears queues. */
  tick(dt: number) {
    const pads = this.pads();
    this.anyKeyThisTick = this.pressQueue.length > 0;
    const ui = this.emptyUi();
    let source = -1;

    // gamepad edge detection
    for (let p = 0; p < 2; p++) {
      const pad = pads[this.padIndex[p]];
      this.padConnected[p] = !!pad;
      this.padPressQueue[p].length = 0; this.padReleaseQueue[p].length = 0;
      if (!pad) continue;
      for (let b = 0; b < pad.buttons.length; b++) {
        const now = pad.buttons[b].pressed;
        const prev = this.padPrev[p][b] ?? false;
        if (now && !prev) this.padPressQueue[p].push(b);
        if (!now && prev) this.padReleaseQueue[p].push(b);
        this.padPrev[p][b] = now;
      }
    }

    for (let p = 0; p < 2; p++) {
      const st = this.players[p];
      const b = this.bindings[p];
      const pad = pads[this.padIndex[p]];
      for (const a of GAME_ACTIONS) {
        const codes = b[a];
        let held = false, pressed = false, released = false;
        for (const c of codes) {
          if (this.down.has(c)) held = true;
          if (this.pressQueue.includes(c)) pressed = true;
          if (this.releaseQueue.includes(c)) released = true;
        }
        if (pad) {
          const btns = PAD_BUTTONS[a];
          if (btns) {
            for (const bi of btns) {
              if (pad.buttons[bi]?.pressed) held = true;
              if (this.padPressQueue[p].includes(bi)) pressed = true;
              if (this.padReleaseQueue[p].includes(bi)) released = true;
            }
          }
        }
        st.held[a] = held; st.pressed[a] = pressed; st.released[a] = released;
        st.holdTime[a] = held ? st.holdTime[a] + dt : 0;
        if (pressed) this.anyKeyThisTick = true;
      }
      let mx = (st.held.right ? 1 : 0) - (st.held.left ? 1 : 0);
      let my = (st.held.down ? 1 : 0) - (st.held.up ? 1 : 0);
      if (pad) {
        const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
        if (Math.abs(ax) > 0.2 || Math.abs(ay) > 0.2) { mx = ax; my = ay; }
      }
      const l = Math.hypot(mx, my);
      if (l > 1) { mx /= l; my /= l; }
      st.moveX = mx; st.moveY = my;

      // UI navigation contributions from each player
      if (st.pressed.up) ui.up = true;
      if (st.pressed.down) ui.down = true;
      if (st.pressed.left) ui.left = true;
      if (st.pressed.right) ui.right = true;
      if (st.pressed.pass || st.pressed.shoot) { ui.confirm = true; source = p; }
      if (st.pressed.through || st.pressed.cross) { ui.back = true; source = p; }
      if (pad) {
        if (this.padPressQueue[p].includes(9)) ui.pause = true; // Start
        if (this.padPressQueue[p].includes(1)) { ui.back = true; source = p; }
        if (this.padPressQueue[p].includes(0)) { ui.confirm = true; source = p; }
        // stick as dpad for menus
        const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
        const prevAx = this.stickPrev[p].x, prevAy = this.stickPrev[p].y;
        if (ay < -0.6 && prevAy >= -0.6) ui.up = true;
        if (ay > 0.6 && prevAy <= 0.6) ui.down = true;
        if (ax < -0.6 && prevAx >= -0.6) ui.left = true;
        if (ax > 0.6 && prevAx <= 0.6) ui.right = true;
        this.stickPrev[p].x = ax; this.stickPrev[p].y = ay;
      }
    }

    for (const c of this.pressQueue) {
      if (c === 'Enter' || c === 'Space' || c === 'NumpadEnter') { ui.confirm = true; }
      if (c === 'Escape' || c === 'Backspace') { ui.back = true; }
      if (c === 'Escape' || c === 'KeyP') ui.pause = true;
      if (c === 'F3') ui.debug = true;
      if (c === 'KeyM' ) ui.mute = true;
      if (c === 'ArrowUp' || c === 'KeyW') ui.up = true;
      if (c === 'ArrowDown' || c === 'KeyS') ui.down = true;
      if (c === 'ArrowLeft' || c === 'KeyA') ui.left = true;
      if (c === 'ArrowRight' || c === 'KeyD') ui.right = true;
      ui.any = true;
    }
    this.ui.pressed = ui; this.ui.source = source;
    this.pressQueue.length = 0;
    this.releaseQueue.length = 0;
  }

  private stickPrev = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

  isDown(code: string) { return this.down.has(code); }

  static keyName(code: string): string {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
    const map: Record<string, string> = {
      ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
      Space: 'Space', Enter: 'Enter', Comma: ',', Period: '.', Slash: '/', Quote: "'", Semicolon: ';',
      BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
      AltLeft: 'L-Alt', AltRight: 'R-Alt', Tab: 'Tab', Escape: 'Esc', Backspace: 'Bksp',
    };
    return map[code] ?? code;
  }
}
