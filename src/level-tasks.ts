import { makeLevel, makeLevelAsync, validLevelMetadata, type GameState, type YardSize } from './game';
import { decodeSave } from './storage';
import { yardForLevel } from './yard';

export type LevelTask = { type: 'level'; level: number; yard: YardSize; crowdSeed: number } |
  { type: 'load'; level?: number; raw: string | null; yard: YardSize; crowdSeed: number };
export type Session = { saved: ReturnType<typeof decodeSave>; state: GameState };

export function runLevelTask(task: LevelTask): Session {
  const saved = task.type === 'load' ? decodeSave(task.raw, task.yard) : null;
  if (saved && (!task.level || saved.active.level === task.level)) return { saved, state: saved.active };
  const level = task.level ?? 1;
  return { saved: null, state: makeLevel(level, yardForLevel(level, task.yard), task.crowdSeed) };
}

// Worker creation can fail under privacy extensions or restrictive policies.
// Keep the exact same deterministic generator, sliced into short tasks.
export async function runLevelTaskCooperatively(task: LevelTask): Promise<Session> {
  if (task.type === 'load') {
    try {
      const input = JSON.parse(task.raw || 'null');
      const oldLevel = input?.active?.level;
      const meta = input?.version === 7 ? input.active : { level: oldLevel, yard: yardForLevel(oldLevel, task.yard) };
      if (validLevelMetadata(meta)) await makeLevelAsync(meta.level, meta.yard);
    } catch { /* Invalid saves start a fresh route. */ }
    const saved = decodeSave(task.raw, task.yard);
    if (saved && (!task.level || saved.active.level === task.level)) return { saved, state: saved.active };
  }
  const level = task.level ?? 1;
  return { saved: null, state: await makeLevelAsync(level, yardForLevel(level, task.yard), task.crowdSeed) };
}
