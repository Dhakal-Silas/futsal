import { CONFIG } from '../config';

export interface LoopCallbacks {
  update: (dt: number) => void;          // fixed step
  render: (alpha: number, frameDt: number) => void; // interpolation factor
}

/** Fixed-timestep loop (60 Hz) with render interpolation. */
export class GameLoop {
  private acc = 0;
  private last = 0;
  private running = false;
  private raf = 0;
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  timeScale = 1;

  constructor(private cb: LoopCallbacks) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      let frameDt = (now - this.last) / 1000;
      this.last = now;
      if (frameDt > CONFIG.MAX_FRAME_DT) frameDt = CONFIG.MAX_FRAME_DT;
      this.fpsAcc += frameDt; this.fpsFrames++;
      if (this.fpsAcc >= 0.5) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }
      this.acc += frameDt * this.timeScale;
      const step = CONFIG.TICK_DT;
      let steps = 0;
      while (this.acc >= step && steps < 8) {
        this.cb.update(step);
        this.acc -= step;
        steps++;
      }
      if (steps >= 8) this.acc = 0; // spiral-of-death guard
      this.cb.render(this.acc / step, frameDt);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); }
}
