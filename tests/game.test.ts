import { describe, expect, it } from 'vitest';
import { Game, makeLevel, collisionFor, bounds, validState, clone, STOP_COUNT } from '../src/game';

describe('puzzle mechanics', () => {
  it('feeds the shared queue from alternating lines and preserves FIFO', () => {
    const state = makeLevel(1);
    expect(state.queue.map(p => p.lane)).toEqual(Array.from({ length: 14 }, (_, i) => i % 2));
    expect(state.queue.map(p => p.id)).toEqual(Array.from({ length: 14 }, (_, i) => i));
    expect(state.lines[0][0].id).toBe(14);
    expect(state.lines[1][0].id).toBe(15);
  });
  it('generates deterministic, non-overlapping, solvable levels', () => {
    for (let level = 1; level <= 100; level++) {
      const state = makeLevel(level);
      expect(state).toEqual(makeLevel(level));
      expect(state.buses.length).toBeGreaterThanOrEqual(16);
      for (const a of state.buses) for (const b of state.buses) {
        if (a === b) continue;
        const ab = bounds(a), bb = bounds(b);
        expect(ab.x < bb.x + bb.w && ab.x + ab.w > bb.x && ab.y < bb.y + bb.h && ab.y + ab.h > bb.y).toBe(false);
      }
      for (const bus of [...state.buses].reverse()) {
        expect(collisionFor(bus, state.buses)).toBeNull();
        bus.status = 'gone';
      }
    }
  });
  it('blocked buses stay in the yard and do not reserve a stop', () => {
    const game = new Game();
    const blocked = game.state.buses.find(b => collisionFor(b, game.state.buses))!;
    expect(blocked).toBeDefined();
    expect(game.dispatch(blocked.id).type).toBe('bump');
    expect(blocked.status).toBe('yard');
    expect(game.availableStops).toHaveLength(STOP_COUNT);
    expect(game.state.moves).toBe(0);
    expect(game.state.bumps).toBe(1);
  });
  it('matches only the front passenger color, holds the stop until departure, and wins only when all buses are gone', () => {
    const game = new Game();
    const solution = [...game.state.buses].reverse();
    for (const bus of solution) {
      expect(game.dispatch(bus.id).type).toBe('drive');
      expect(game.boardNext()).toBeNull();
      game.arrive(bus.id);
      for (let seat = 0; seat < bus.capacity; seat++) {
        const boarded = game.boardNext()!;
        expect(boarded.person.color).toBe(bus.color);
        expect(boarded.full).toBe(seat === bus.capacity - 1);
      }
      expect(bus.status).toBe('leaving');
      expect(game.availableStops).toHaveLength(STOP_COUNT - 1);
      expect(game.state.phase).toBe('playing');
      game.depart(bus.id);
    }
    expect(game.state.phase).toBe('won');
    expect(game.remaining).toBe(0);
    expect(game.state.queue).toHaveLength(0);
    expect(game.state.lines.flat()).toHaveLength(0);
    expect(game.state.boarded).toBe(game.state.totalPassengers);
  });
  it('will not skip a passenger to serve a different color', () => {
    const game = new Game();
    const front = game.state.queue[0].color;
    const other = game.movable.find(b => b.color !== front)!;
    expect(other).toBeDefined();
    game.dispatch(other.id); game.arrive(other.id);
    const before = clone(game.state.queue);
    expect(game.boardNext()).toBeNull();
    expect(game.state.queue).toEqual(before);
    expect(other.filled).toBe(0);
  });
  it('reserves distinct stops and undoes the entire preceding dispatch', () => {
    const game = new Game();
    const before = clone(game.state);
    const bus = game.movable.at(-1)!;
    game.dispatch(bus.id); game.arrive(bus.id); game.boardNext();
    expect(game.undo()).toBe(true);
    expect(game.state).toEqual(before);
    while (game.availableStops.length) {
      const next = game.movable.at(-1)!;
      game.dispatch(next.id);
    }
    const docks = game.state.buses.filter(b => b.status === 'arriving').map(b => b.dock);
    expect(new Set(docks).size).toBe(STOP_COUNT);
    expect(game.dispatch(game.movable.at(-1)!.id).type).toBe('full');
  });
  it('detects a full-stop color deadlock and undo recovers it', () => {
    const game = new Game();
    for (let i = 0; i < STOP_COUNT; i++) {
      const bus = game.movable.at(-1)!;
      game.dispatch(bus.id); game.arrive(bus.id);
    }
    // Arrange a valid stalled queue head without depending on the generated palette order.
    const docked = game.state.buses.filter(b => b.status === 'docked');
    for (const bus of docked) bus.color = 'coral';
    game.state.queue[0].color = 'mint';
    game.checkEnd();
    expect(game.state.phase).toBe('jammed');
    expect(game.undo()).toBe(true);
    expect(game.state.phase).toBe('playing');
  });
  it('validates saves, rejects corrupted data, and settles animations on restore', () => {
    const game = new Game();
    expect(validState(game.state)).toBe(true);
    const bus = game.movable.at(-1)!;
    game.dispatch(bus.id);
    expect(validState(game.state)).toBe(true);
    const restored = new Game(1, game.state);
    expect(restored.state.buses.find(b => b.id === bus.id)!.status).toBe('docked');
    const corrupted = clone(game.state);
    corrupted.queue.push(corrupted.queue[0]);
    expect(validState(corrupted)).toBe(false);
    expect(validState({ ...game.state, phase: 'won' })).toBe(false);
    expect(validState(null)).toBe(false);
    expect(validState({ ...game.state, level: 1e9 })).toBe(false);
    expect(validState({ ...game.state, totalPassengers: 0 })).toBe(false);
  });
});
