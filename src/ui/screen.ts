import type { InputManager } from '../core/input';
import type { AudioManager } from '../core/audio';

export interface Screen {
  enter?(): void;
  exit?(): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D, alpha: number, frameDt: number): void;
  /** true if the screen below should still render (overlay) */
  overlay?: boolean;
}

export interface AppContext {
  input: InputManager;
  audio: AudioManager;
  push(s: Screen): void;
  pop(): void;
  replace(s: Screen): void;
}

/** Simple screen stack. */
export class ScreenManager {
  stack: Screen[] = [];
  push(s: Screen) { this.stack.push(s); s.enter?.(); }
  pop() { const s = this.stack.pop(); s?.exit?.(); }
  replace(s: Screen) { while (this.stack.length) this.pop(); this.push(s); }
  get top() { return this.stack[this.stack.length - 1]; }
  update(dt: number) { this.top?.update(dt); }
  render(ctx: CanvasRenderingContext2D, alpha: number, frameDt: number) {
    // find the lowest screen that must be drawn
    let start = this.stack.length - 1;
    while (start > 0 && this.stack[start].overlay) start--;
    for (let i = start; i < this.stack.length; i++) this.stack[i].render(ctx, alpha, frameDt);
  }
}
