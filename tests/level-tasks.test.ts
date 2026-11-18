import { describe, expect, it, vi } from 'vitest';
import { makeLevel, makeLevelAsync, Game, validState } from '../src/game';
import { runLevelTask, runLevelTaskCooperatively } from '../src/level-tasks';
import { fitYard } from '../src/yard';

describe('responsive route preparation', () => {
  it('yields during cold generation and preserves the deterministic jam and shuffle', async () => {
    const yard = { width: 11, height: 13.5 };
    const interval = vi.fn();
    const timer = setInterval(interval, 0);
    try {
      const state = await makeLevelAsync(13, yard, 321);
      expect(interval).toHaveBeenCalled();
      expect(state).toEqual(makeLevel(13, yard, 321));
      expect(validState(state)).toBe(true);
    } finally { clearInterval(timer); }
  });
  it('restores in-flight moves and preferences through both preparation paths', async () => {
    const game = new Game(2, undefined, fitYard(390, 844), 47);
    game.dispatch(game.movable.at(-1)!.id);
    const raw = JSON.stringify({ version: 7, active: game.state, completed: [1], best: { 1: 63 }, sound: true, fast: true });
    const task = { type: 'load' as const, raw, yard: fitYard(1440, 1000), crowdSeed: 999 };
    const normal = runLevelTask(task), fallback = await runLevelTaskCooperatively(task);
    expect(fallback).toEqual(normal);
    expect(normal.state.yard).toEqual(game.state.yard);
    expect(normal.saved?.sound).toBe(true);
    expect(normal.state.moves).toBe(1);
  });
  it('starts a playable route for a corrupted save in the cooperative fallback', async () => {
    const result = await runLevelTaskCooperatively({ type: 'load', raw: '{bad json', yard: fitYard(390, 844), crowdSeed: 987 });
    expect(result.saved).toBeNull(); expect(result.state.crowdSeed).toBe(987);
    expect(validState(result.state)).toBe(true);
  });
});
