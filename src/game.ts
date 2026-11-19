import { rectangle, sweepDistance, type Polygon } from './geometry';
import { BUS_SCALE, DEFAULT_YARD, MAX_YARD_SIDE, MAX_YARD_AREA, type YardSize } from './yard';
import { yieldToBrowser } from './scheduling';
export { BUS_SCALE, DEFAULT_YARD, type YardSize } from './yard';

export const PALETTE = {
  mint: { name: 'Lime', hex: '#27d92d', light: '#5bf238', symbol: '●' },
  coral: { name: 'Red', hex: '#ff3024', light: '#ff4b36', symbol: '♥' },
  blue: { name: 'Blue', hex: '#009bf8', light: '#22b9ff', symbol: '◆' },
  yellow: { name: 'Yellow', hex: '#ffca08', light: '#ffe12d', symbol: '★' },
  violet: { name: 'Purple', hex: '#a62bf4', light: '#bd4cff', symbol: '✿' },
  pink: { name: 'Pink', hex: '#ff63d2', light: '#ff87df', symbol: '▲' },
} as const;
export type BusColor = keyof typeof PALETTE;
export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export type BusStatus = 'yard' | 'arriving' | 'docked' | 'leaving' | 'gone';
export type Bus = {
  id: string; x: number; y: number; length: number; direction: Direction;
  color: BusColor; capacity: number; filled: number; status: BusStatus; dock: number | null;
};
export type Person = { id: number; color: BusColor; lane: 0 | 1 };
export type GameState = {
  level: number; seed: number; crowdSeed: number; yard: YardSize; buses: Bus[]; lines: [Person[], Person[]];
  queue: Person[]; nextLine: 0 | 1; moves: number; bumps: number; boarded: number;
  totalPassengers: number; phase: 'playing' | 'jammed' | 'won';
};
export type Collision = { blocker: Bus; distance: number };
export const STOP_COUNT = 5;
export const QUEUE_SIZE = 24;
export const CROWD_BATCH_SIZE = STOP_COUNT - 1;
export const VISIBLE_PER_LINE = 36;
export type BoardingWave = {
  boardings: { person: Person; bus: Bus }[];
  fullBuses: Bus[];
  refilled: Person[];
};
export const VECTOR: Record<Direction, { x: number; y: number }> = {
  N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 },
  NE: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, SE: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  SW: { x: -Math.SQRT1_2, y: Math.SQRT1_2 }, NW: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
};
export const directionAngle = (direction: Direction) => Math.atan2(-VECTOR[direction].x, -VECTOR[direction].y);
export const clone = <T>(value: T): T => structuredClone(value);

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const shapes = new WeakMap<object, { key: string; shape: Polygon }>();
export function busShape(bus: Pick<Bus, 'x' | 'y' | 'direction' | 'length'>) {
  const key = [bus.x, bus.y, bus.direction, bus.length].join(',');
  let cached = shapes.get(bus);
  if (!cached || cached.key !== key) { cached = { key, shape: rectangle(bus, VECTOR[bus.direction], (bus.length - .1) * BUS_SCALE, .92 * BUS_SCALE) }; shapes.set(bus, cached); }
  return cached.shape;
}
export function bounds(bus: Pick<Bus, 'x' | 'y' | 'direction' | 'length'>) {
  const shape = busShape(bus);
  return { x: shape.left, y: shape.top, w: shape.right - shape.left, h: shape.bottom - shape.top };
}
export function collisionFor(bus: Bus, buses: Bus[]): Collision | null {
  const a = busShape(bus);
  let result: Collision | null = null;
  for (const other of buses) {
    if (other.id === bus.id || other.status !== 'yard') continue;
    const distance = sweepDistance(a, busShape(other), VECTOR[bus.direction]);
    if (distance !== null && (!result || distance < result.distance)) result = { blocker: other, distance };
  }
  return result;
}

const levelCache = new Map<string, GameState>();
function* generateLevel(level: number, yard: YardSize, crowdSeed: number): Generator<void, GameState> {
  const key = [level, yard.width, yard.height].join(':');
  if (levelCache.has(key)) return fillCrowd(clone(levelCache.get(key)!), crowdSeed);
  const seed = 9217 + level * 7919;
  const rng = random(seed);
  const colors = Object.keys(PALETTE) as BusColor[];
  const buses: Bus[] = [], parked: Polygon[] = [];
  let exposed: { shape: Polygon; forward: { x: number; y: number } }[] = [];
  const directions = Object.keys(VECTOR) as Direction[];
  // Grow a tightly packed, irregular jam from its center. Every new bus has
  // a clear forward exit at insertion, so reverse insertion is a solution.
  // Version-7 yards up to 200 square units retain their original seed layout.
  const busLimit = 84 + Math.ceil(Math.max(0, yard.width * yard.height - 200) / 2);
  for (let index = 0; index < busLimit; index++) {
    let best: { bus: Bus; shape: Polygon; score: number } | undefined;
    for (let attempt = 0; attempt < 1400; attempt++) {
      if (attempt % 32 === 0) yield;
      const roll = rng(), length = index < 38 ? (roll < .08 ? 3 : 2) : (roll < .7 ? 1.5 : 2);
      const bus: Bus = { id: 'bus-' + index, x: .55 + rng() * (yard.width - 1.1), y: .55 + rng() * (yard.height - 1.1), length,
        direction: directions[Math.floor(rng() * directions.length)], color: colors[Math.floor(rng() * colors.length)],
        capacity: length === 3 ? 24 : length === 2 ? 12 : 8, filled: 0, status: 'yard', dock: null };
      const shape = rectangle(bus, VECTOR[bus.direction], (length + .02) * BUS_SCALE, 1.02 * BUS_SCALE);
      if (shape.left < .04 || shape.right > yard.width - .04 || shape.top < .04 || shape.bottom > yard.height - .04) continue;
      if (parked.some(other => sweepDistance(shape, other, VECTOR[bus.direction]) !== null)) continue;
      const wantsDiagonal = index % 3 !== 1;
      const body = busShape(bus);
      const blocks = exposed.filter(other => sweepDistance(other.shape, body, other.forward) !== null).length;
      const score = Math.hypot((bus.x / yard.width - .5) * 10, (bus.y / yard.height - .5) * 10) + ((bus.direction.length === 2) !== wantsDiagonal ? 1.75 : 0) - blocks * .2;
      if (!best || score < best.score) best = { bus, shape, score };
    }
    if (!best) break;
    buses.push(best.bus); parked.push(best.shape);
    const body = busShape(best.bus);
    exposed = exposed.filter(other => sweepDistance(other.shape, body, other.forward) === null);
    exposed.push({ shape: body, forward: VECTOR[best.bus.direction] });
  }
  const state: GameState = {
    level, seed, crowdSeed, yard: { ...yard }, buses, lines: [[], []], queue: [], nextLine: 0, moves: 0, bumps: 0,
    boarded: 0, totalPassengers: 0, phase: 'playing',
  };
  if (levelCache.size >= 12) levelCache.delete(levelCache.keys().next().value!);
  levelCache.set(key, clone(state));
  return fillCrowd(state, crowdSeed);
}

export function makeLevel(level: number, yard: YardSize = DEFAULT_YARD, crowdSeed = 9217 + level * 7919): GameState {
  const work = generateLevel(level, yard, crowdSeed);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

export async function makeLevelAsync(level: number, yard: YardSize = DEFAULT_YARD, crowdSeed = 9217 + level * 7919): Promise<GameState> {
  const work = generateLevel(level, yard, crowdSeed);
  let deadline = performance.now() + 8, step = work.next();
  while (!step.done) {
    if (performance.now() >= deadline) { await yieldToBrowser(); deadline = performance.now() + 8; }
    step = work.next();
  }
  return step.value;
}

function fillCrowd(state: GameState, crowdSeed: number): GameState {
  const rng = random(crowdSeed), solution = [...state.buses].reverse();
  state.crowdSeed = crowdSeed;
  let personId = 0;
  // Independently shuffled feeders mix nearby solution batches. Limiting a
  // batch to four buses leaves room at the five stops: dispatching one batch,
  // then letting it board and depart, is always a winning strategy.
  for (let start = 0; start < solution.length; start += CROWD_BATCH_SIZE) {
    const batch: [BusColor[], BusColor[]] = [[], []];
    for (const bus of solution.slice(start, start + CROWD_BATCH_SIZE)) {
      for (let seat = 0; seat < bus.capacity; seat++) batch[seat % 2].push(bus.color);
    }
    for (const line of batch) for (let i = line.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)); [line[i], line[j]] = [line[j], line[i]];
    }
    for (let i = 0; i < batch[0].length; i++) for (const lane of [0, 1] as const)
      state.lines[lane].push({ id: personId++, color: batch[lane][i], lane });
  }
  state.totalPassengers = personId;
  refillQueue(state);
  return state;
}

export function refillQueue(state: GameState): Person[] {
  const added: Person[] = [];
  while (state.queue.length < QUEUE_SIZE && (state.lines[0].length || state.lines[1].length)) {
    const lane = state.lines[state.nextLine].length ? state.nextLine : (1 - state.nextLine) as 0 | 1;
    const person = state.lines[lane].shift()!;
    state.queue.push(person);
    added.push(person);
    state.nextLine = (1 - lane) as 0 | 1;
  }
  return added;
}

export class Game {
  state: GameState;
  history: GameState[] = [];
  constructor(level = 1, restored?: GameState, yard: YardSize = DEFAULT_YARD, crowdSeed?: number) {
    this.state = restored ? normalizeRestored(clone(restored)) : makeLevel(level, yard, crowdSeed);
  }
  get availableStops() {
    return Array.from({ length: STOP_COUNT }, (_, i) => i).filter(i =>
      !this.state.buses.some(bus => bus.status !== 'gone' && bus.dock === i));
  }
  get remaining() { return this.state.buses.filter(bus => bus.status !== 'gone').length; }
  get activeAnimations() { return this.state.buses.some(bus => bus.status === 'arriving' || bus.status === 'leaving'); }
  get movable() { return this.state.buses.filter(bus => bus.status === 'yard' && !collisionFor(bus, this.state.buses)); }
  dispatch(id: string, preferredDock?: number): { type: 'drive'; bus: Bus } | { type: 'bump'; bus: Bus; collision: Collision } | { type: 'full' } | { type: 'busy' } {
    const bus = this.state.buses.find(bus => bus.id === id);
    if (!bus || bus.status !== 'yard' || this.state.phase !== 'playing') return { type: 'busy' };
    if (!this.availableStops.length) return { type: 'full' };
    const collision = collisionFor(bus, this.state.buses);
    if (collision) {
      this.state.bumps++;
      return { type: 'bump', bus, collision };
    }
    this.history.push(clone(this.state));
    if (this.history.length > 40) this.history.shift();
    const dock = preferredDock !== undefined && this.availableStops.includes(preferredDock) ? preferredDock : this.availableStops[0];
    bus.status = 'arriving';
    bus.dock = dock;
    this.state.moves++;
    return { type: 'drive', bus };
  }
  arrive(id: string) {
    const bus = this.state.buses.find(bus => bus.id === id);
    if (bus?.status === 'arriving') bus.status = 'docked';
  }
  boardAvailable(): BoardingWave | null {
    if (this.state.phase !== 'playing') return null;
    const boardings: BoardingWave['boardings'] = [];
    const fullBuses: Bus[] = [];
    const selected = new Set<number>();
    const ready = this.state.buses.filter(bus => bus.status === 'docked').sort((a, b) => a.dock! - b.dock!);
    for (const bus of ready) {
      for (const person of this.state.queue) {
        if (person.color !== bus.color || selected.has(person.id) || bus.filled >= bus.capacity) continue;
        selected.add(person.id); boardings.push({ person, bus });
        bus.filled++; this.state.boarded++;
      }
      if (bus.filled === bus.capacity) { bus.status = 'leaving'; fullBuses.push(bus); }
    }
    if (!boardings.length) { this.checkEnd(); return null; }
    this.state.queue = this.state.queue.filter(person => !selected.has(person.id));
    return { boardings, fullBuses, refilled: refillQueue(this.state) };
  }
  depart(id: string) {
    const bus = this.state.buses.find(bus => bus.id === id);
    if (bus?.status === 'leaving') { bus.status = 'gone'; bus.dock = null; }
    this.checkEnd();
  }
  checkEnd() {
    if (this.state.buses.every(bus => bus.status === 'gone')) this.state.phase = 'won';
    else if (!this.activeAnimations && !this.availableStops.length &&
      !this.state.buses.some(bus => bus.status === 'docked' && this.state.queue.some(person => person.color === bus.color) && bus.filled < bus.capacity)) {
      this.state.phase = 'jammed';
    }
  }
  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    previous.bumps = this.state.bumps;
    this.state = normalizeRestored(previous);
    return true;
  }
  hint() {
    if (!this.availableStops.length) return null;
    const colors = new Set(this.state.queue.map(person => person.color));
    return this.movable.find(bus => colors.has(bus.color)) ?? this.movable.at(-1) ?? null;
  }
}
export function normalizeRestored(state: GameState) {
  for (const bus of state.buses) {
    if (bus.status === 'arriving') bus.status = 'docked';
    if (bus.status === 'leaving') { bus.status = 'gone'; bus.dock = null; }
  }
  if (state.buses.every(bus => bus.status === 'gone')) state.phase = 'won';
  return state;
}
export function validState(input: unknown): input is GameState {
  try {
    const s = input as GameState;
    if (!validLevelMetadata(s)) return false;
    if (!Number.isInteger(s.crowdSeed) || s.crowdSeed < 0 || s.crowdSeed > 0xffffffff) return false;
    const initial = makeLevel(s.level, s.yard, s.crowdSeed);
    if (s.seed !== initial.seed || s.buses.length !== initial.buses.length || !Array.isArray(s.queue) ||
      s.queue.length > QUEUE_SIZE || !Array.isArray(s.lines) || s.lines.length !== 2 ||
      ![0, 1].includes(s.nextLine) || !['playing', 'jammed', 'won'].includes(s.phase)) return false;
    if (![s.moves, s.bumps, s.boarded].every(n => Number.isInteger(n) && n >= 0) || s.totalPassengers !== initial.totalPassengers) return false;
    const occupied = new Set<number>();
    for (let i = 0; i < s.buses.length; i++) {
      const b = s.buses[i], ref = initial.buses[i];
      if (!['yard', 'arriving', 'docked', 'leaving', 'gone'].includes(b.status) ||
        !Number.isInteger(b.filled) || b.filled < 0 || b.filled > b.capacity) return false;
      for (const key of ['id', 'x', 'y', 'length', 'direction', 'color', 'capacity'] as const) if (b[key] !== ref[key]) return false;
      if (b.status === 'yard' && b.filled !== 0) return false;
      if ((b.status === 'gone' || b.status === 'leaving') && b.filled !== b.capacity) return false;
      if (b.status === 'yard' || b.status === 'gone') { if (b.dock !== null) return false; }
      else {
        if (b.dock === null || !Number.isInteger(b.dock) || b.dock < 0 || b.dock >= STOP_COUNT || occupied.has(b.dock)) return false;
        occupied.add(b.dock);
      }
    }
    if ((s.phase === 'won') !== s.buses.every(bus => bus.status === 'gone')) return false;
    if (s.moves !== s.buses.filter(bus => bus.status !== 'yard').length) return false;
    const originalPeople = new Map([...initial.queue, ...initial.lines.flat()].map(p => [p.id, p]));
    const people = [...s.queue, ...s.lines.flat()];
    const seen = new Set<number>();
    for (const p of people) {
      const ref = originalPeople.get(p.id);
      if (!ref || ref.color !== p.color || ref.lane !== p.lane || seen.has(p.id)) return false;
      seen.add(p.id);
    }
    if (s.lines.some((line, lane) => line.some(p => p.lane !== lane))) return false;
    if (s.boarded !== s.buses.reduce((n, b) => n + b.filled, 0)) return false;
    return Object.keys(PALETTE).every(color =>
      people.filter(p => p.color === color).length + s.buses.filter(b => b.color === color).reduce((n, b) => n + b.filled, 0)
      === initial.buses.filter(b => b.color === color).reduce((n, b) => n + b.capacity, 0));
  } catch { return false; }
}

export function validLevelMetadata(s: Pick<GameState, 'level' | 'yard'> | null | undefined): s is Pick<GameState, 'level' | 'yard'> {
  return !!s && Number.isInteger(s.level) && s.level >= 1 && s.level <= 9999 && !!s.yard &&
    [s.yard.width, s.yard.height].every(n => Number.isFinite(n) && n >= 6.5 && n <= MAX_YARD_SIDE && n * 2 === Math.round(n * 2)) &&
    s.yard.width * s.yard.height <= MAX_YARD_AREA;
}
