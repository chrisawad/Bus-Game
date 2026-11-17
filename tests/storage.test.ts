import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLevel } from '../src/game';
import { readSave, writeSave, SAVE_KEY, LEGACY_SAVE_KEY } from '../src/storage';
afterEach(() => vi.unstubAllGlobals());
describe('save migration', () => {
  it.each([1, 2, 3, 4, 5, 6])('keeps completed routes and preferences from save version %i', version => {
    const old = { version, active: { level: 4 }, completed: [1, 2, 3], best: { 1: 21 }, sound: true, fast: true };
    const oldKey = version < 4 ? LEGACY_SAVE_KEY : SAVE_KEY;
    const data = new Map([[oldKey, JSON.stringify(old)]]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
    const save = readSave()!;
    expect(save.version).toBe(7); expect(save.migrated).toBe(true);
    expect(save.completed).toEqual([1, 2, 3]);
    expect(save.active).toEqual(makeLevel(4, save.active.yard, save.active.crowdSeed));
    expect(save.sound).toBe(true); expect(save.fast).toBe(true);
    expect(writeSave(save)).toBe(true);
    expect(JSON.parse(data.get(SAVE_KEY)!).version).toBe(7);
    if (oldKey === LEGACY_SAVE_KEY) expect(data.get(LEGACY_SAVE_KEY)).toBe(JSON.stringify(old));
  });
  it('round-trips the new state and keeps play available when storage fails', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) });
    const save = { version: 7 as const, active: makeLevel(1, undefined, 12345), completed: [], best: {}, sound: false, fast: false };
    expect(writeSave(save)).toBe(true);
    expect(readSave()).toEqual(save);
    expect(data.has(SAVE_KEY)).toBe(true);
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('storage unavailable'); } });
    expect(writeSave(save)).toBe(false);
  });
});
