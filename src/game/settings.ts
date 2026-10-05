import { loadJSON, saveJSON } from '../core/storage';
import type { Difficulty } from '../ai/difficulty';

export interface Settings {
  difficulty: Difficulty;
  halfMinutes: number;
  volume: number;
  quality: number;      // 0 = particles off, 1 = on
  showHints: boolean;
  minimap: boolean;
  lastTeamP1: string;
  lastTeamP2: string;
  formationP1: string;
  formationP2: string;
  classico: boolean;
  groupStage: boolean;
  padP1: number; padP2: number;
  teamSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  difficulty: 'Medium', halfMinutes: 3, volume: 0.7, quality: 1, showHints: true, minimap: true,
  lastTeamP1: 'rma', lastTeamP2: 'fcb', formationP1: '2-2-2', formationP2: '3-2-1', classico: false, groupStage: false, padP1: 0, padP2: 1, teamSize: 7,
};

export function loadSettings(): Settings { return loadJSON('settings', DEFAULT_SETTINGS); }
export function saveSettings(s: Settings) { saveJSON('settings', s); }
export const HALF_OPTIONS = [1, 2, 3, 5];
