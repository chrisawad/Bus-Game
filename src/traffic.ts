import { VECTOR, type Bus } from './game';
import { BAY_WIDTH, BUS_SCALE, DEFAULT_YARD, YARD_TOP, createDepotLayout } from './yard';
import { rectangle, convexHull, polygonsOverlap, type Polygon } from './geometry';

export type Point = { x: number; z: number };
export { createDepotLayout, YARD_TOP, ROAD_CLEARANCE, BAY_WIDTH, BAY_LENGTH } from './yard';
export const DOCK_X = [-2, -1, 0, 1, 2].map(index => index * (BAY_WIDTH + .54));
export type DepotLayout = ReturnType<typeof createDepotLayout>;
export const DEFAULT_LAYOUT = createDepotLayout(DEFAULT_YARD);
export const { ROAD_X, ROAD_TOP, ROAD_BOTTOM, DOCK_Z, PLAZA_FRONT_Z } = DEFAULT_LAYOUT;
const point = (x: number, z: number): Point => ({ x, z });
export const routeLength = (points: Point[]) => points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);
export function yardPosition(bus: Bus, layout = DEFAULT_LAYOUT): Point {
  return point(bus.x - layout.yard.width / 2, bus.y + YARD_TOP);
}
export function yardExit(bus: Bus, layout = DEFAULT_LAYOUT): Point {
  const { ROAD_X, ROAD_TOP, ROAD_BOTTOM } = layout;
  const start = yardPosition(bus, layout), vector = VECTOR[bus.direction];
  const tx = Math.abs(vector.x) < 1e-8 ? Infinity : ((vector.x > 0 ? ROAD_X : -ROAD_X) - start.x) / vector.x;
  const tz = Math.abs(vector.y) < 1e-8 ? Infinity : ((vector.y > 0 ? ROAD_BOTTOM : ROAD_TOP) - start.z) / vector.y;
  const distance = Math.min(tx, tz);
  return point(start.x + vector.x * distance, start.z + vector.y * distance);
}
export function arrivalRoutes(bus: Bus, layout = DEFAULT_LAYOUT): Point[][] {
  const { ROAD_X, ROAD_TOP, ROAD_BOTTOM, DOCK_Z } = layout;
  const start = yardPosition(bus, layout), dock = DOCK_X[bus.dock!];
  const width = ROAD_X * 2, height = ROAD_BOTTOM - ROAD_TOP, perimeter = 2 * (width + height);
  const corners = [point(-ROAD_X, ROAD_TOP), point(ROAD_X, ROAD_TOP), point(ROAD_X, ROAD_BOTTOM), point(-ROAD_X, ROAD_BOTTOM)];
  const offsets = [0, width, width + height, 2 * width + height];
  const entry = yardExit(bus, layout);
  const from = Math.abs(entry.z - ROAD_TOP) < 1e-6 ? entry.x + ROAD_X : Math.abs(entry.x - ROAD_X) < 1e-6 ? width + entry.z - ROAD_TOP : Math.abs(entry.z - ROAD_BOTTOM) < 1e-6 ? width + height + ROAD_X - entry.x : 2 * width + height + ROAD_BOTTOM - entry.z;
  const to = dock + ROAD_X;
  return [1, -1].map(direction => {
    const ahead = (offset: number) => ((offset - from) * direction + perimeter) % perimeter;
    const distance = ahead(to);
    const via = corners.map((p, i) => ({ p, distance: ahead(offsets[i]) })).filter(c => c.distance > .001 && c.distance < distance - .001).sort((a, b) => a.distance - b.distance);
    return [start, entry, ...via.map(c => c.p), point(dock, ROAD_TOP), point(dock, DOCK_Z)];
  });
}
export function arrivalRoute(bus: Bus, layout = DEFAULT_LAYOUT): Point[] {
  return arrivalRoutes(bus, layout).sort((a, b) => routeLength(a) - routeLength(b))[0];
}
export function departureRoutes(bus: Bus, layout = DEFAULT_LAYOUT): Point[][] {
  const { ROAD_X, ROAD_TOP, DOCK_Z } = layout;
  const x = DOCK_X[bus.dock!];
  return [-1, 1].map(side => [point(x, DOCK_Z), point(x, ROAD_TOP), point(side * (ROAD_X + 3), ROAD_TOP)]);
}
export function departureRoute(bus: Bus, layout = DEFAULT_LAYOUT): Point[] {
  return departureRoutes(bus, layout).sort((a, b) => routeLength(a) - routeLength(b))[0];
}

type Footprint = Polygon;
export type Drive = {
  id: string; length: number; points: Point[]; segments: number[];
  total: number; distance: number; position: Point; heading: number; reverseFirst: boolean;
  startTick: number; frames: Footprint[]; rest: Footprint;
};
const TICK = .025, SPEED = 12;
function sample(route: Drive, distance: number): { position: Point; heading: number } {
  let travelled = 0;
  for (let i = 0; i < route.segments.length; i++) {
    if (distance <= travelled + route.segments[i] || i === route.segments.length - 1) {
      const a = route.points[i], b = route.points[i + 1];
      const t = Math.min(1, Math.max(0, (distance - travelled) / route.segments[i]));
      return { position: point(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t), heading: route.reverseFirst && i === 0 ? 0 : Math.atan2(a.x - b.x, a.z - b.z) };
    }
    travelled += route.segments[i];
  }
  return { position: route.position, heading: route.heading };
}
function footprint(r: Pick<Drive, 'position' | 'heading' | 'length'>): Footprint {
  return rectangle({ x: r.position.x, y: r.position.z }, { x: -Math.sin(r.heading), y: -Math.cos(r.heading) }, (r.length - .02) * BUS_SCALE, BUS_SCALE);
}
export function trafficOverlaps(a: Pick<Drive, 'position' | 'heading' | 'length'>, b: Pick<Drive, 'position' | 'heading' | 'length'>) {
  return polygonsOverlap(footprint(a), footprint(b));
}
function makeDrive(id: string, length: number, input: Point[], reverseFirst: boolean): Drive {
  const points = input.filter((p, i) => i === 0 || Math.hypot(p.x - input[i - 1].x, p.z - input[i - 1].z) > .01);
  const segments = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.z - points[i].z));
  const drive: Drive = { id, length, points, segments, total: routeLength(points), distance: 0, position: { ...points[0] }, heading: 0, reverseFirst, startTick: 0, frames: [], rest: footprint({ position: points[0], heading: 0, length }) };
  drive.heading = sample(drive, 0).heading; drive.rest = footprint(drive);
  for (let distance = 0; distance < drive.total; distance += TICK * SPEED) {
    const a = footprint({ length, ...sample(drive, distance) }), b = footprint({ length, ...sample(drive, Math.min(drive.total, distance + TICK * SPEED)) });
    // Preserve orientation when reserving angled buses; overlapping bounding
    // boxes alone do not mean two diagonal buses touch.
    drive.frames.push(convexHull([...a.vertices, ...b.vertices]));
  }
  return drive;
}
const atTick = (r: Drive, tick: number) => tick < r.startTick ? r.rest : r.frames[tick - r.startTick];

export class Traffic {
  constructor(readonly layout = DEFAULT_LAYOUT) {}
  routes = new Map<string, Drive>();
  private clock = 0;
  clear() { this.routes.clear(); this.clock = 0; }
  private schedule(route: Drive, delay = 0) {
    const first = Math.ceil((this.clock + delay) / TICK), now = Math.floor(this.clock / TICK);
    const last = Math.max(first, ...[...this.routes.values()].map(r => r.startTick + r.frames.length)) + 1;
    // Book complete trajectories: independent and following trips overlap,
    // while opposing traffic waits at its origin instead of gridlocking.
    for (let start = first; start <= last; start++) {
      route.startTick = start;
      let clear = true;
      for (const other of this.routes.values()) {
        if (other.id === route.id) continue;
        const end = Math.min(start + route.frames.length, other.startTick + other.frames.length);
        for (let tick = now; tick < end; tick++) {
          if (polygonsOverlap(atTick(route, tick), atTick(other, tick))) { clear = false; break; }
        }
        if (!clear) break;
      }
      if (clear) return start;
    }
    return last;
  }
  estimate(id: string, length: number, points: Point[], reverseFirst = false, delay = 0, instant = false) {
    const route = makeDrive(id, length, points, reverseFirst);
    return this.schedule(route, delay * (instant ? 70 / SPEED : 1)) * TICK + route.total / SPEED;
  }
  planArrival(bus: Bus, stops: number[], delay = 0, instant = false) {
    const options = stops.flatMap(dock => arrivalRoutes({ ...bus, dock }, this.layout).map(points => ({ dock, points, distance: routeLength(points) })))
      .sort((a, b) => a.distance - b.distance);
    let best: (typeof options[number] & { arrival: number }) | undefined;
    for (const option of options) {
      // A longer route cannot beat the current choice even without traffic.
      if (best && this.clock + delay * (instant ? 70 / SPEED : 1) + option.distance / SPEED >= best.arrival) break;
      const arrival = this.estimate(bus.id, bus.length, option.points, false, delay, instant);
      if (!best || arrival < best.arrival) best = { ...option, arrival };
    }
    return best;
  }
  start(id: string, length: number, input: Point[], reverseFirst = false, delay = 0, instant = false) {
    const route = makeDrive(id, length, input, reverseFirst);
    route.startTick = this.schedule(route, delay * (instant ? 70 / SPEED : 1)); this.routes.set(id, route);
  }
  update(dt: number, instant = false) {
    this.clock += dt * (instant ? 70 / SPEED : 1);
    const finished: string[] = [];
    for (const route of this.routes.values()) {
      route.distance = Math.min(route.total, Math.max(0, (this.clock - route.startTick * TICK) * SPEED));
      Object.assign(route, sample(route, route.distance));
      if (route.distance >= route.total) { this.routes.delete(route.id); finished.push(route.id); }
    }
    return finished;
  }
}
