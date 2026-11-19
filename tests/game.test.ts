import { describe, expect, it } from 'vitest';
import { Game, BUS_SCALE, DEFAULT_YARD, QUEUE_SIZE, STOP_COUNT, CROWD_BATCH_SIZE, makeLevel, collisionFor, bounds, busShape, validState, clone } from '../src/game';
import { fitYard } from '../src/yard';
import { polygonsOverlap } from '../src/geometry';

describe('dense depot and group boarding', () => {
  it('fills the smaller 24-person middle from alternating shuffled lines', () => {
    const state = makeLevel(1);
    expect(state.queue).toHaveLength(QUEUE_SIZE);
    expect(state.queue.map(p => p.lane)).toEqual(Array.from({ length: QUEUE_SIZE }, (_, i) => i % 2));
    expect(state.lines[0][0].id).toBe(QUEUE_SIZE);
    expect(state.lines[1][0].id).toBe(QUEUE_SIZE + 1);
    expect(state.totalPassengers).toBeGreaterThan(300);
    expect(state.buses.length).toBeGreaterThanOrEqual(45);
    expect(state.buses.filter(bus => collisionFor(bus, state.buses)).length).toBeGreaterThanOrEqual(30);
  });
  it('packs rectangular phone and desktop yards without overlap and preserves a solution', () => {
    for (const yard of [DEFAULT_YARD, fitYard(390, 844), fitYard(1440, 1000)]) for (let level = 1; level <= 4; level++) {
      const state = makeLevel(level, yard);
      expect(state).toEqual(makeLevel(level, yard));
      expect(state.buses.length, JSON.stringify({ level, count: state.buses.length })).toBeGreaterThanOrEqual(40);
      expect(state.buses.reduce((area, bus) => area + (bus.length - .1) * .92 * BUS_SCALE ** 2, 0)).toBeGreaterThan(35);
      expect(state.buses.filter(b => b.direction.length === 2).length).toBeGreaterThanOrEqual(5);
      for (const bus of state.buses) {
        const b = bounds(bus);
        expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(yard.width); expect(b.y + b.h).toBeLessThanOrEqual(yard.height);
        for (const other of state.buses) if (bus !== other) expect(polygonsOverlap(busShape(bus), busShape(other))).toBe(false);
      }
      for (const bus of [...state.buses].reverse()) {
        expect(collisionFor(bus, state.buses)).toBeNull(); bus.status = 'gone';
      }
    }
  }, 120_000);
  it('keeps blocked buses in the yard without taking a stop', () => {
    const game = new Game();
    const blocked = game.state.buses.find(b => collisionFor(b, game.state.buses))!;
    expect(game.dispatch(blocked.id).type).toBe('bump');
    expect(blocked.status).toBe('yard');
    expect(game.availableStops).toHaveLength(STOP_COUNT);
    expect(game.state.moves).toBe(0);
    expect(game.state.bumps).toBe(1);
    game.dispatch(game.movable.at(-1)!.id);
    game.dispatch(game.state.buses.find(b => collisionFor(b, game.state.buses))!.id);
    expect(game.undo()).toBe(true);
    expect(game.state.moves).toBe(0);
    expect(game.state.bumps).toBe(2);
  });
  it('boards matching people anywhere in the middle, even behind another color', () => {
    const game = new Game();
    const first = game.state.queue[0];
    const bus = game.movable.find(b => b.color !== first.color && game.state.queue.filter(p => p.color === b.color).length >= 4)!;
    expect(bus).toBeDefined();
    const before = clone(game.state);
    const middleIds = new Set(before.queue.map(p => p.id));
    game.dispatch(bus.id); game.arrive(bus.id);
    const wave = game.boardAvailable()!;
    expect(wave.boardings.length).toBeGreaterThan(1);
    expect(wave.boardings.every(event => event.person.color === bus.color && middleIds.has(event.person.id))).toBe(true);
    expect(game.state.queue[0].id).toBe(first.id);
    expect(bus.filled).toBeLessThanOrEqual(bus.capacity);
    expect(wave.refilled).toHaveLength(wave.boardings.length);
    expect(game.state.lines[0].length).toBeLessThan(before.lines[0].length - 1);
    expect(game.state.lines[1].length).toBeLessThan(before.lines[1].length - 1);
    expect(wave.refilled.map(p => p.lane)).toEqual(Array.from({ length: wave.refilled.length }, (_, i) => i % 2));
    expect(game.state.queue).toHaveLength(QUEUE_SIZE);
    expect(validState(game.state)).toBe(true);
  });
  it('does not draw directly from the overflow while a boarding group is leaving', () => {
    const game = new Game();
    const bus = game.movable.at(-1)!;
    const middle = new Set(game.state.queue.map(p => p.id));
    game.dispatch(bus.id); game.arrive(bus.id);
    const wave = game.boardAvailable()!;
    expect(wave.boardings.every(event => middle.has(event.person.id))).toBe(true);
    expect(wave.refilled.every(p => !wave.boardings.some(event => event.person.id === p.id))).toBe(true);
  });
  it('can send five buses immediately and reserves a different stop for each', () => {
    const game = new Game();
    const ids = [...game.state.buses].reverse().slice(0, STOP_COUNT).map(b => b.id);
    for (const id of ids) expect(game.dispatch(id).type).toBe('drive');
    const buses = game.state.buses.filter(b => b.status === 'arriving');
    expect(buses).toHaveLength(STOP_COUNT);
    expect(new Set(buses.map(b => b.dock)).size).toBe(STOP_COUNT);
    expect(game.availableStops).toHaveLength(0);
    expect(game.boardAvailable()).toBeNull();
    expect(game.dispatch(game.movable.at(-1)!.id).type).toBe('full');
  });
  it('fills more than one docked bus per wave without overfilling', () => {
    const game = new Game();
    const buses = [...game.state.buses].reverse().slice(0, STOP_COUNT);
    for (const bus of buses) { game.dispatch(bus.id); game.arrive(bus.id); }
    const wave = game.boardAvailable()!;
    expect(new Set(wave.boardings.map(b => b.bus.id)).size).toBeGreaterThan(1);
    expect(wave.boardings.length).toBeGreaterThan(12);
    expect(buses.every(b => b.filled <= b.capacity)).toBe(true);
    expect(new Set(wave.fullBuses.map(b => b.id)).size).toBe(wave.fullBuses.length);
    expect(validState(game.state)).toBe(true);
  });
  it('wins only after every full bus has finished leaving', () => {
    const game = new Game();
    const solution = [...game.state.buses].reverse();
    for (let i = 0; i < solution.length; i += CROWD_BATCH_SIZE) {
      const batch = solution.slice(i, i + CROWD_BATCH_SIZE);
      for (const bus of batch) { expect(game.dispatch(bus.id).type).toBe('drive'); game.arrive(bus.id); }
      while (batch.some(b => b.status !== 'gone')) {
        const wave = game.boardAvailable()!;
        expect(wave).not.toBeNull();
        expect(game.state.phase).toBe('playing');
        for (const bus of wave.fullBuses) {
          expect(bus.filled).toBe(bus.capacity); expect(bus.status).toBe('leaving'); game.depart(bus.id);
        }
      }
    }
    expect(game.state.phase).toBe('won');
    expect(game.remaining).toBe(0);
    expect(game.state.queue).toHaveLength(0);
    expect(game.state.lines.flat()).toHaveLength(0);
    expect(game.state.boarded).toBe(game.state.totalPassengers);
  });
  it('shuffles both feeders independently and keeps different crowd seeds solvable', () => {
    for (const yard of [DEFAULT_YARD, fitYard(390, 844), fitYard(1440, 1000)]) for (let seed = 1; seed <= 12; seed++) {
      const initial = makeLevel(1, yard, seed), again = makeLevel(1, yard, seed);
      expect(initial).toEqual(again);
      const other = makeLevel(1, yard, seed + 100);
      expect(initial.buses).toEqual(other.buses);
      for (const lane of [0, 1] as const) {
        expect(initial.lines[lane].map(p => p.color)).not.toEqual(other.lines[lane].map(p => p.color));
        expect(initial.lines[lane].filter((p, i, line) => i && p.color !== line[i - 1].color).length).toBeGreaterThan(initial.lines[lane].length / 4);
      }
      expect(initial.lines[0].map(p => p.color)).not.toEqual(initial.lines[1].map(p => p.color));
      const game = new Game(1, initial), solution = [...game.state.buses].reverse();
      for (let i = 0; i < solution.length; i += CROWD_BATCH_SIZE) {
        const batch = solution.slice(i, i + CROWD_BATCH_SIZE);
        for (const bus of batch) { expect(game.dispatch(bus.id).type).toBe('drive'); game.arrive(bus.id); }
        while (batch.some(bus => bus.status !== 'gone')) {
          const wave = game.boardAvailable(); expect(wave, 'unfinished shuffled batch must still be boardable').not.toBeNull();
          for (const bus of wave!.fullBuses) game.depart(bus.id);
        }
      }
      expect(game.state.phase).toBe('won');
      expect(validState(game.state)).toBe(true);
    }
  }, 60_000);
  it('checks every middle passenger before declaring a full-stop deadlock', () => {
    const game = new Game();
    for (const bus of [...game.state.buses].reverse().slice(0, STOP_COUNT)) { game.dispatch(bus.id); game.arrive(bus.id); }
    const ready = game.state.buses.filter(b => b.status === 'docked');
    for (const bus of ready) bus.color = 'coral';
    game.state.queue.forEach(p => { p.color = 'mint'; });
    game.state.queue[20].color = 'coral';
    game.checkEnd(); expect(game.state.phase).toBe('playing');
    game.state.queue[20].color = 'mint';
    game.checkEnd(); expect(game.state.phase).toBe('jammed');
    expect(game.undo()).toBe(true);
    expect(game.state.phase).toBe('playing');
  });
  it('undoes a dispatch and validates saves during overlapping movements', () => {
    const game = new Game();
    const before = clone(game.state);
    game.dispatch(game.movable.at(-1)!.id);
    expect(validState(game.state)).toBe(true);
    expect(new Game(1, game.state).state.buses.some(b => b.status === 'docked')).toBe(true);
    expect(game.undo()).toBe(true);
    expect(game.state).toEqual(before);
    const corrupted = clone(game.state); corrupted.queue.push(corrupted.queue[0]);
    expect(validState(corrupted)).toBe(false);
    expect(validState({ ...game.state, phase: 'won' })).toBe(false);
    expect(validState(null)).toBe(false);
  });
  it('settles interrupted trips when undo restores an overlapping dispatch', () => {
    const game = new Game();
    const [first, second] = [...game.state.buses].reverse();
    game.dispatch(first.id); game.dispatch(second.id);
    expect(game.undo()).toBe(true);
    expect(game.state.buses.find(bus => bus.id === first.id)?.status).toBe('docked');
    expect(game.state.buses.find(bus => bus.id === second.id)?.status).toBe('yard');
    expect(validState(game.state)).toBe(true);
    expect(game.undo()).toBe(true); expect(game.state.moves).toBe(0);
  });
});
