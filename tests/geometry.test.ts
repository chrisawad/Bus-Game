import { describe, expect, it } from 'vitest';
import { Game, DEFAULT_YARD, BUS_SCALE, VECTOR, busShape, collisionFor, type Bus, type Direction } from '../src/game';
import { polygonsOverlap } from '../src/geometry';
import { createDepotLayout, fitYard, YARD_RIM } from '../src/yard';
import { yardExit, yardPosition, trafficOverlaps, BAY_WIDTH, BAY_LENGTH, DOCK_X, DOCK_Z, YARD_TOP, ROAD_X, ROAD_TOP, ROAD_BOTTOM } from '../src/traffic';

describe('angled bus geometry', () => {
  it('uses one bus lane on all four sides and puts the recovered space into parking', () => {
    for (const [width, height] of [[382, 708], [440, 800], [1432, 864]]) {
      const yard = fitYard(width, height), layout = createDepotLayout(yard);
      const widths = [(layout.ROAD_WIDTH - yard.width) / 2, YARD_TOP - layout.ROAD_NORTH_Z,
        layout.ROAD_SOUTH_Z - (YARD_TOP + yard.height)];
      for (const w of widths) {
        expect(w - YARD_RIM).toBeGreaterThan(BUS_SCALE);
        expect(w - YARD_RIM).toBeLessThan(2 * BUS_SCALE);
      }
      expect(yard.width * yard.height).toBeGreaterThan(220);
      const scale = Math.min(width / layout.frameWidth, height / layout.frameHeight);
      expect(layout.frameHeight * scale).toBeGreaterThan(height * .95);
    }
  });
  it('fits the longest bus into compact bays without obstructing perimeter turns', () => {
    expect(BAY_LENGTH).toBeGreaterThan(3 * BUS_SCALE);
    expect(BAY_WIDTH).toBeGreaterThan(BUS_SCALE);
    expect(BAY_WIDTH * BAY_LENGTH).toBeLessThan(3.4);
    expect(DOCK_X.at(-1)! - DOCK_X[0] + BAY_WIDTH).toBeLessThan(9);
    const turnRadius = Math.hypot((3 - .1) * BUS_SCALE / 2, .92 * BUS_SCALE / 2);
    for (const gap of [ROAD_X - DEFAULT_YARD.width / 2, YARD_TOP - ROAD_TOP, ROAD_BOTTOM - (YARD_TOP + DEFAULT_YARD.height)]) expect(gap).toBeGreaterThan(turnRadius + .02);
    for (const x of DOCK_X) {
      const parked = { length: 3, heading: 0, position: { x, z: DOCK_Z } };
      for (const heading of [0, Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
        expect(trafficOverlaps(parked, { length: 3, heading, position: { x, z: ROAD_TOP } })).toBe(false);
      }
    }
  });
  const bus = (id: string, x: number, y: number): Bus => ({ id, x, y, length: 2, direction: 'NE', color: 'blue', capacity: 12, filled: 0, status: 'yard', dock: null });
  it('finds a blocker ahead along the diagonal at the physical contact distance', () => {
    const a = bus('a', 3, 6), v = VECTOR.NE, b = bus('b', 3 + v.x * 3, 6 + v.y * 3);
    expect(collisionFor(a, [a, b])!.distance).toBeCloseTo(3 - 1.9 * BUS_SCALE);
    b.x = 3 - v.x * 3; b.y = 6 - v.y * 3;
    expect(collisionFor(a, [a, b])).toBeNull();
  });
  it('does not mistake overlapping bounding boxes for touching diagonal bodies', () => {
    const a = bus('a', 4, 4), b = bus('b', 4 + Math.SQRT1_2 * 1.1, 4 + Math.SQRT1_2 * 1.1);
    const aa = busShape(a), bb = busShape(b);
    expect(aa.left).toBeLessThan(bb.right); expect(aa.right).toBeGreaterThan(bb.left);
    expect(polygonsOverlap(aa, bb)).toBe(false);
    expect(collisionFor(a, [a, b])).toBeNull();
  });
  it('continues straight out of the jam before turning onto the perimeter in every direction', () => {
    const base = new Game().state.buses[0];
    for (const direction of Object.keys(VECTOR) as Direction[]) {
      const b = { ...base, x: 5, y: 5, direction }, start = yardPosition(b), exit = yardExit(b), vector = VECTOR[direction];
      const dx = exit.x - start.x, dz = exit.z - start.z;
      expect(dx * vector.y - dz * vector.x).toBeCloseTo(0);
      expect(dx * vector.x + dz * vector.y).toBeGreaterThan(0);
      expect(Math.abs(Math.abs(exit.x) - ROAD_X) < 1e-6 || Math.abs(exit.z - ROAD_TOP) < 1e-6 || Math.abs(exit.z - ROAD_BOTTOM) < 1e-6).toBe(true);
    }
  });
});
