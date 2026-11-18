import { makeLevel, makeLevelAsync, validLevelMetadata, type GameState, type YardSize } from './game';
import { decodeSave } from './storage';

export type LevelTask = { type: 'level'; level: number; yard: YardSize; crowdSeed: number } |
  { type: 'load'; raw: string | null; yard: YardSize; crowdSeed: number };
export type Session = { saved: ReturnType<typeof decodeSave>; state: GameState };

export function runLevelTask(task: LevelTask): Session {
  const saved = task.type === 'load' ? decodeSave(task.raw, task.yard) : null;
  return { saved, state: saved?.active ?? makeLevel(task.type === 'level' ? task.level : 1, task.yard, task.crowdSeed) };
}

// Worker creation can fail under privacy extensions or restrictive policies.
// Keep the exact same deterministic generator, sliced into short tasks.
export async function runLevelTaskCooperatively(task: LevelTask): Promise<Session> {
  if (task.type === 'load') {
    try {
      const input = JSON.parse(task.raw || 'null');
      const meta = input?.version === 7 ? input.active : { level: input?.active?.level, yard: task.yard };
      if (validLevelMetadata(meta)) await makeLevelAsync(meta.level, meta.yard);
    } catch { /* Invalid saves start a fresh route. */ }
    const saved = decodeSave(task.raw, task.yard);
    if (saved) return { saved, state: saved.active };
  }
  return { saved: null, state: await makeLevelAsync(task.type === 'level' ? task.level : 1, task.yard, task.crowdSeed) };
}
