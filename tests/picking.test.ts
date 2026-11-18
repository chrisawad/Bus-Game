import { describe, expect, it } from 'vitest';
import { distanceToOutline } from '../src/picking';

describe('forgiving bus roof targets', () => {
  const diagonal = [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 30, y: 20 }, { x: 20, y: 30 }];
  it('accepts the interior and edges of a diagonal roof', () => {
    expect(distanceToOutline({ x: 15, y: 15 }, diagonal)).toBe(0);
    expect(distanceToOutline({ x: 5, y: 5 }, diagonal)).toBe(0);
  });
  it('measures the outline instead of accepting empty bounding-box corners', () => {
    expect(distanceToOutline({ x: 0, y: 0 }, diagonal)).toBeCloseTo(Math.sqrt(50));
    expect(distanceToOutline({ x: 35, y: 35 }, diagonal)).toBeGreaterThan(9);
  });
});
