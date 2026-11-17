import { describe, expect, it } from 'vitest';
import { Game, STOP_COUNT } from '../src/game';
import { fitYard } from '../src/yard';
import { Traffic, createDepotLayout, arrivalRoute, arrivalRoutes, departureRoute, routeLength, trafficOverlaps, ROAD_TOP, ROAD_BOTTOM, DOCK_X } from '../src/traffic';

describe('concurrent border traffic', () => {
  it('uses the direct top road or the nearest side instead of a forced lap', () => {
    const game = new Game();
    for (const bus of game.state.buses) for (let dock = 0; dock < DOCK_X.length; dock++) {
      const assigned = { ...bus, dock }, options = arrivalRoutes(assigned), shortest = arrivalRoute(assigned);
      expect(routeLength(shortest)).toBe(Math.min(...options.map(routeLength)));
      if (bus.direction === 'N' || bus.direction === 'E' || bus.direction === 'W') expect(shortest.some(p => p.z === ROAD_BOTTOM)).toBe(false);
      expect(shortest.at(-2)).toEqual({ x: DOCK_X[dock], z: ROAD_TOP });
    }
  }, 30_000);
  it('chooses the closest available stop when the road is empty', () => {
    const game = new Game(), traffic = new Traffic();
    const bus = { ...game.state.buses[0], direction: 'N' as const, x: 9, y: 0, length: 1 };
    expect(traffic.planArrival(bus, [0, 1, 2, 3, 4])!.dock).toBe(4);
    expect(traffic.planArrival(bus, [0, 1])!.dock).toBe(1);
  });
  it('moves independent buses simultaneously', () => {
    const traffic = new Traffic();
    traffic.start('a', 2, [{ x: -3, z: 0 }, { x: -3, z: -5 }]);
    traffic.start('b', 2, [{ x: 3, z: 0 }, { x: 3, z: -5 }]);
    traffic.update(.2);
    expect(traffic.routes.get('a')!.distance).toBeGreaterThan(0);
    expect(traffic.routes.get('b')!.distance).toBeGreaterThan(0);
  });
  it('keeps a following bus behind the vehicle in front on slow frames', () => {
    const traffic = new Traffic();
    traffic.start('front', 3, [{ x: 0, z: -4 }, { x: 0, z: -30 }]);
    traffic.start('rear', 2, [{ x: 0, z: 0 }, { x: 0, z: -30 }]);
    for (let i = 0; i < 10; i++) {
      traffic.update(.15);
      const front = traffic.routes.get('front'), rear = traffic.routes.get('rear');
      if (front && rear) expect(trafficOverlaps(front, rear)).toBe(false);
    }
  });
  it.each([[390, 844], [1440, 1000]])('finishes the full %ix%i rectangle with five buses in flight', (width, height) => {
    const game = new Game(1, undefined, fitYard(width, height)), layout = createDepotLayout(game.state.yard), traffic = new Traffic(layout);
    const solution = [...game.state.buses].reverse();
    const departures: { id: string; at: number }[] = [];
    let next = 0, maxConcurrent = 0;
    for (let time = 0; time < 180 && game.state.phase !== 'won'; time += .05) {
      for (const id of traffic.update(.05)) {
        const bus = game.state.buses.find(b => b.id === id)!;
        if (bus.status === 'arriving') game.arrive(id); else game.depart(id);
      }
      for (let i = departures.length - 1; i >= 0; i--) if (departures[i].at <= time) {
        const bus = game.state.buses.find(b => b.id === departures[i].id)!;
        traffic.start(bus.id, bus.length, departureRoute(bus, layout), true); departures.splice(i, 1);
      }
      const wave = game.boardAvailable();
      if (wave) for (const bus of wave.fullBuses) departures.push({ id: bus.id, at: time + 1.05 });
      while (next < solution.length && game.availableStops.length) {
        const bus = solution[next++];
        const plan = traffic.planArrival(bus, game.availableStops)!;
        expect(game.dispatch(bus.id, plan.dock).type).toBe('drive');
        traffic.start(bus.id, bus.length, plan.points);
      }
      maxConcurrent = Math.max(maxConcurrent, traffic.routes.size);
      const active = [...traffic.routes.values()];
      for (let i = 0; i < active.length; i++) for (const other of active.slice(i + 1)) expect(trafficOverlaps(active[i], other)).toBe(false);
    }
    expect(maxConcurrent).toBe(STOP_COUNT);
    expect(game.state.phase, JSON.stringify({ next, pending: departures, active: [...traffic.routes.values()], buses: game.state.buses.filter(b => b.status !== 'gone' && b.status !== 'yard') })).toBe('won');
    expect(game.state.boarded).toBe(game.state.totalPassengers);
  }, 30_000);
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))('clears staggered clicks and varying frames (timing seed %i)', seed => {
      let randomState = seed;
      const random = () => ((randomState = (randomState * 1664525 + 1013904223) >>> 0) / 4294967296);
      const game = new Game(), traffic = new Traffic(), solution = [...game.state.buses].reverse();
      let next = 0, clickAt = 0, boardingUntil = 0, boardAt = .15;
      let departing: string[] = [];
      const clickDelay = seed <= 10 ? .05 : seed <= 20 ? 1.2 : seed <= 30 ? 6 : 12;
      for (let time = 0; time < 900 && game.state.phase !== 'won';) {
        const dt = .016 + random() * (seed % 2 ? .18 : .984);
        time += dt;
        for (const id of traffic.update(dt)) {
          const bus = game.state.buses.find(b => b.id === id)!;
          if (bus.status === 'arriving') game.arrive(id); else game.depart(id);
        }
        const active = [...traffic.routes.values()];
        for (let i = 0; i < active.length; i++) for (const other of active.slice(i + 1)) {
          if (trafficOverlaps(active[i], other)) throw new Error(JSON.stringify({ seed, collision: [active[i], other].map(r => ({ id: r.id, position: r.position, distance: r.distance, startTick: r.startTick })) }));
        }
        if (boardingUntil && time >= boardingUntil) {
          for (const id of departing) {
            const bus = game.state.buses.find(b => b.id === id)!;
            traffic.start(id, bus.length, departureRoute(bus), true);
          }
          boardingUntil = 0; departing = []; boardAt = time + .8;
        }
        if (!boardingUntil && time >= boardAt) {
          boardAt = time + .15;
          const wave = game.boardAvailable();
          if (wave) { boardingUntil = time + 1.05; departing = wave.fullBuses.map(b => b.id); }
        }
        if (next < solution.length && game.availableStops.length && time >= clickAt) {
          const bus = solution[next++];
          const plan = traffic.planArrival(bus, game.availableStops)!;
          expect(game.dispatch(bus.id, plan.dock).type).toBe('drive');
          traffic.start(bus.id, bus.length, plan.points);
          clickAt = time + random() * clickDelay;
        }
      }
      expect(game.state.phase, JSON.stringify({ seed, next, active: [...traffic.routes.values()] })).toBe('won');
  });
});
