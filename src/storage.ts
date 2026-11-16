import { validState, type GameState } from './game';
export const SAVE_KEY = 'bus-bloom-v1';
export type Save = {
  version: 1; active: GameState; completed: number[]; best: Record<string, number>;
  sound: boolean; fast: boolean;
};
export function readSave(): Save | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as Save;
    if (!s || s.version !== 1 || !validState(s.active) || !Array.isArray(s.completed) ||
      !s.completed.every(n => Number.isInteger(n) && n > 0) || typeof s.sound !== 'boolean' ||
      typeof s.fast !== 'boolean' || !s.best || typeof s.best !== 'object') return null;
    return s;
  } catch { return null; }
}
export function writeSave(save: Save): boolean {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); return true; }
  catch { return false; }
}
