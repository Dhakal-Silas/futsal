import data from '../data/difficulty.json';

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Legend';
export const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Legend'];

export interface DifficultyParams {
  reactionTime: number; decisionInterval: number; passNoise: number; shotNoise: number; sprintUsage: number;
  pressAggression: number; tackleSkill: number; tackleTiming: number; positionDiscipline: number; keeperSkill: number;
  shootEagerness: number; throughPassSkill: number; speedMult: number; markingTightness: number; staminaMult: number;
}

export function difficultyParams(d: Difficulty): DifficultyParams {
  return (data.levels as Record<string, DifficultyParams>)[d] ?? data.levels.Medium;
}
