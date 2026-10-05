import { CONFIG } from '../config';
import { damp, lerp } from './math';

/** Smooth camera in world coordinates. Converts world (x, y, z) to screen pixels. */
export class Camera {
  x = 0; y = 0;
  zoom = 1;
  targetX = 0; targetY = 0; targetZoom = 1;
  shake = 0;
  shakeX = 0; shakeY = 0;
  private shakePhase = 0;
  viewW = CONFIG.LOGICAL_W;
  viewH = CONFIG.LOGICAL_H;
  /** world units visible per logical pixel at zoom 1 */
  get ppm() { return CONFIG.CAM_BASE_ZOOM * this.zoom; }

  snap() { this.x = this.targetX; this.y = this.targetY; this.zoom = this.targetZoom; }

  update(dt: number) {
    this.x = damp(this.x, this.targetX, CONFIG.CAM_FOLLOW_STIFFNESS, dt);
    this.y = damp(this.y, this.targetY, CONFIG.CAM_FOLLOW_STIFFNESS, dt);
    this.zoom = damp(this.zoom, this.targetZoom, CONFIG.CAM_ZOOM_STIFFNESS, dt);
    this.clampToPitch();
    if (this.shake > 0.001) {
      this.shakePhase += dt * 40;
      this.shakeX = Math.sin(this.shakePhase * 1.3) * this.shake * 8;
      this.shakeY = Math.cos(this.shakePhase * 1.7) * this.shake * 6;
      this.shake = damp(this.shake, 0, CONFIG.CAM_SHAKE_DECAY, dt);
    } else { this.shake = 0; this.shakeX = 0; this.shakeY = 0; }
  }

  addShake(amount: number) { this.shake = Math.min(1.5, this.shake + amount); }

  private clampToPitch() {
    // keep the camera from showing too much beyond the pitch
    const halfW = this.viewW / 2 / this.ppm;
    const halfH = this.viewH / 2 / (this.ppm * CONFIG.Y_FORESHORTEN);
    const maxX = CONFIG.PITCH_LENGTH / 2 + CONFIG.OUT_MARGIN - halfW;
    const maxY = CONFIG.PITCH_WIDTH / 2 + CONFIG.OUT_MARGIN - halfH;
    if (maxX > 0) this.x = Math.max(-maxX, Math.min(maxX, this.x)); else this.x = 0;
    if (maxY > 0) this.y = Math.max(-maxY, Math.min(maxY, this.y)); else this.y = 0;
  }

  /** Fit the whole pitch into view. */
  fitPitchZoom(): number {
    const zx = this.viewW / ((CONFIG.PITCH_LENGTH + 2 * 2.2) * CONFIG.CAM_BASE_ZOOM);
    const zy = this.viewH / ((CONFIG.PITCH_WIDTH + 2 * 3) * CONFIG.CAM_BASE_ZOOM * CONFIG.Y_FORESHORTEN);
    return Math.min(zx, zy);
  }

  sx(wx: number) { return this.viewW / 2 + (wx - this.x) * this.ppm + this.shakeX; }
  sy(wy: number, wz = 0) {
    return this.viewH / 2 + (wy - this.y) * this.ppm * CONFIG.Y_FORESHORTEN - wz * this.ppm * CONFIG.Z_SCREEN_SCALE + this.shakeY;
  }
  /** screen -> world (ground plane) */
  wx(sx: number) { return (sx - this.viewW / 2 - this.shakeX) / this.ppm + this.x; }
  wy(sy: number) { return (sy - this.viewH / 2 - this.shakeY) / (this.ppm * CONFIG.Y_FORESHORTEN) + this.y; }

  static lerpCam(a: Camera, b: Camera, t: number) { return lerp(a.x, b.x, t); }
}
