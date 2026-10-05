import type { InputManager } from '../core/input';
import type { AudioManager } from '../core/audio';
import { ScreenManager, type Screen } from './screen';
import { loadSettings, saveSettings, type Settings } from '../game/settings';
import type { MatchOptions } from '../sim/match';
import { MatchSession } from '../game/session';
import type { TeamInfo } from '../sim/types';

export interface MatchResult { score: [number, number]; aet: boolean; pens: [number, number] | null; winner: -1 | 0 | 1; }

/** Shared application context passed to every screen. */
export class App {
  screens = new ScreenManager();
  settings: Settings;
  /** Hook for the main menu so screens can return to it. */
  goToMainMenu: () => void = () => {};
  fps = 0;
  debug = false;
  constructor(public input: InputManager, public audio: AudioManager) {
    this.settings = loadSettings();
    audio.setVolume(this.settings.volume);
    input.padIndex = [this.settings.padP1, this.settings.padP2];
  }
  save() { saveSettings(this.settings); }
  push(s: Screen) { this.screens.push(s); }
  pop() { this.screens.pop(); }
  replace(s: Screen) { this.screens.replace(s); }
  createSession(opts: MatchOptions) {
    return new MatchSession(opts, this.input, this.audio, { quality: this.settings.quality, showHints: this.settings.showHints, minimap: this.settings.minimap });
  }
  matchOptions(teams: [TeamInfo, TeamInfo], formations: [string, string], humanSlots: [number, number], knockout: boolean, extra: Partial<MatchOptions> = {}): MatchOptions {
    return { teams, formations, halfMinutes: this.settings.halfMinutes, humanSlots, difficulty: this.settings.difficulty, knockout, seed: (Date.now() & 0xffffff) ^ 0x51, teamSize: this.settings.teamSize, ...extra };
  }
}
