import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { makeLevel } from '../src/game';
import fixtures from './fixtures/routes-v7.json';

it('preserves route and crowd data from the published version-7 generator', () => {
  // Captured by running the generator from f977d4b, before optimization.
  for (const fixture of fixtures) {
    const state = makeLevel(fixture.level, fixture.yard, fixture.crowdSeed);
    expect(createHash('sha256').update(JSON.stringify(state)).digest('hex')).toBe(fixture.hash);
  }
}, 30_000);
