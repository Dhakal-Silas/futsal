import { loadJSON, saveJSON } from './storage';

/** Procedural WebAudio sounds: kicks, whistle, crowd, hits. No assets. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdNode: AudioBufferSourceNode | null = null;
  muted = false;
  volume = 0.7;
  crowdLevel = 0;
  private targetCrowd = 0;

  constructor() {
    const s = loadJSON('audio', { muted: false, volume: 0.7 });
    this.muted = s.muted; this.volume = s.volume;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.startCrowd();
    } catch { this.ctx = null; }
  }

  resume() { this.ctx?.resume(); }

  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; saveJSON('audio', { muted: this.muted, volume: this.volume }); }
  setVolume(v: number) { this.volume = v; if (this.master && !this.muted) this.master.gain.value = v; saveJSON('audio', { muted: this.muted, volume: this.volume }); }
  toggleMute() { this.setMuted(!this.muted); }

  private startCrowd() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.08;
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 900;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0;
    src.connect(filt); filt.connect(this.crowdGain); this.crowdGain.connect(this.master);
    src.start();
    this.crowdNode = src;
  }

  /** 0..1 ambient crowd intensity */
  setCrowd(level: number) { this.targetCrowd = level; }
  update(dt: number) {
    if (!this.crowdGain || !this.ctx) return;
    this.crowdLevel += (this.targetCrowd - this.crowdLevel) * Math.min(1, dt * 2);
    this.crowdGain.gain.setTargetAtTime(this.crowdLevel * 0.9, this.ctx.currentTime, 0.1);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, attack = 0.005, slideTo?: number) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + dur + 0.05);
  }
  private noise(dur: number, gain: number, freq = 1200) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }

  kick(strength: number) { this.noise(0.08 + strength * 0.08, 0.5 + strength * 0.6, 300 + strength * 500); this.tone(90, 0.08, 'sine', 0.4 * (0.4 + strength)); }
  bounce(strength: number) { this.tone(140, 0.05, 'sine', 0.15 * strength); }
  post() { this.tone(1800, 0.35, 'triangle', 0.35, 0.002, 1200); this.noise(0.05, 0.3, 2000); }
  whistle(long = false) { this.tone(2600, long ? 0.9 : 0.35, 'square', 0.12, 0.01); this.tone(2650, long ? 0.9 : 0.35, 'sine', 0.1, 0.01); }
  goal() { this.whistle(); this.noise(1.2, 0.9, 500); setTimeout(() => this.noise(1.5, 0.6, 400), 300); }
  tackle() { this.noise(0.12, 0.5, 250); this.tone(70, 0.12, 'sine', 0.5); }
  catchBall() { this.noise(0.06, 0.4, 600); }
  ui(kind: 'move' | 'confirm' | 'back') {
    if (kind === 'move') this.tone(660, 0.05, 'square', 0.06);
    else if (kind === 'confirm') { this.tone(520, 0.08, 'square', 0.08); this.tone(780, 0.14, 'square', 0.08); }
    else this.tone(400, 0.1, 'square', 0.07, 0.005, 250);
  }
  crowdCheer() { this.noise(0.8, 0.5, 450); }
  save() { this.noise(0.15, 0.4, 900); }
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, 'triangle', 0.18), i * 130)); }
}
