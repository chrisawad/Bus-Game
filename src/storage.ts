import { makeLevel, validState, DEFAULT_YARD, type GameState, type YardSize } from './game';
import { yardForLevel } from './yard';
export const SAVE_KEY = 'bus-jam-v1';
export const LEGACY_SAVE_KEY = 'bus-bloom-v1';
export type Save = {
  version: 7; active: GameState; completed: number[]; best: Record<string, number>;
  sound: boolean; fast: boolean; winVoice?: boolean;
};
export function readSave(yard: YardSize = DEFAULT_YARD): (Save & { migrated?: boolean }) | null {
  return decodeSave(readSaveText(), yard);
}
export function readSaveText(): string | null {
  try { return localStorage.getItem(SAVE_KEY) || localStorage.getItem(LEGACY_SAVE_KEY); }
  catch { return null; }
}
export function decodeSave(raw: string | null, yard: YardSize = DEFAULT_YARD): (Save & { migrated?: boolean }) | null {
  try {
    const s = JSON.parse(raw || 'null');
    if (!s || ![1, 2, 3, 4, 5, 6, 7].includes(s.version) || !Array.isArray(s.completed) ||
      !s.completed.every((n: number) => Number.isInteger(n) && n > 0 && n <= 9999) || typeof s.sound !== 'boolean' ||
      typeof s.fast !== 'boolean' || !s.best || typeof s.best !== 'object' || Array.isArray(s.best) ||
      !Object.entries(s.best).every(([level, moves]) => /^[1-9]\d{0,3}$/.test(level) && Number.isInteger(moves) && (moves as number) >= 0)) return null;
    if (s.version < 7) {
      const level = s.active?.level;
      if (!Number.isInteger(level) || level < 1 || level > 9999) return null;
      return { version: 7, active: makeLevel(level, yardForLevel(level, yard), Math.floor(Math.random() * 0x100000000)), completed: s.completed, best: {}, sound: s.sound, fast: s.fast, migrated: true };
    }
    if (!validState(s.active)) return null;
    return s;
  } catch { return null; }
}
export function writeSave(save: Save): boolean {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); return true; }
  catch { return false; }
}

const sessionRoutes = new Map<number, string | null>();
export function readParkedRoute(level: number): string | null {
  if (sessionRoutes.has(level)) return sessionRoutes.get(level) ?? null;
  try { return localStorage.getItem(SAVE_KEY + '-route-' + level); }
  catch { return null; }
}

export function parkRoute(save: Save) {
  const level = save.active.level, key = SAVE_KEY + '-route-' + level;
  const raw = save.active.phase === 'won' ? null : JSON.stringify(save);
  try {
    if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw);
    sessionRoutes.delete(level);
  } catch { sessionRoutes.set(level, raw); }
}
