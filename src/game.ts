export const PALETTE = {
  mint: { name: 'Mint', hex: '#41bd92', light: '#a1e7c8', symbol: '●' },
  coral: { name: 'Coral', hex: '#f57869', light: '#ffc1b5', symbol: '♥' },
  blue: { name: 'Blue', hex: '#52a5e8', light: '#acd9fc', symbol: '◆' },
  yellow: { name: 'Sunshine', hex: '#f5c44c', light: '#ffe6a0', symbol: '★' },
  violet: { name: 'Lilac', hex: '#a88ade', light: '#dfccff', symbol: '✿' },
  pink: { name: 'Rose', hex: '#e980af', light: '#ffc6e2', symbol: '▲' },
} as const;
export type BusColor = keyof typeof PALETTE;
export type Direction = 'N' | 'E' | 'S' | 'W';
export type BusStatus = 'yard' | 'arriving' | 'docked' | 'leaving' | 'gone';
export type Bus = {
  id: string; x: number; y: number; length: number; direction: Direction;
  color: BusColor; capacity: number; filled: number; status: BusStatus; dock: number | null;
};
export type Person = { id: number; color: BusColor; lane: 0 | 1 };
export type GameState = {
  level: number; seed: number; buses: Bus[]; lines: [Person[], Person[]];
  queue: Person[]; nextLine: 0 | 1; moves: number; bumps: number; boarded: number;
  totalPassengers: number; phase: 'playing' | 'jammed' | 'won';
};
export type Collision = { blocker: Bus; distance: number };
export const GRID = 8;
export const STOP_COUNT = 5;
export const QUEUE_SIZE = 14;
export const VECTOR: Record<Direction, { x: number; y: number }> = {
  N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 },
};
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
export function bounds(bus: Pick<Bus, 'x' | 'y' | 'direction' | 'length'>) {
  const horizontal = bus.direction === 'E' || bus.direction === 'W';
  return { x: bus.x, y: bus.y, w: horizontal ? bus.length : 1, h: horizontal ? 1 : bus.length };
}
function overlap(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
export function collisionFor(bus: Bus, buses: Bus[]): Collision | null {
  const a = bounds(bus);
  let result: Collision | null = null;
  for (const other of buses) {
    if (other.id === bus.id || other.status !== 'yard') continue;
    const b = bounds(other);
    const acrossX = a.x < b.x + b.w && a.x + a.w > b.x;
    const acrossY = a.y < b.y + b.h && a.y + a.h > b.y;
    let distance = Infinity;
    if (bus.direction === 'N' && acrossX && b.y + b.h <= a.y) distance = a.y - b.y - b.h;
    if (bus.direction === 'S' && acrossX && b.y >= a.y + a.h) distance = b.y - a.y - a.h;
    if (bus.direction === 'W' && acrossY && b.x + b.w <= a.x) distance = a.x - b.x - b.w;
    if (bus.direction === 'E' && acrossY && b.x >= a.x + a.w) distance = b.x - a.x - a.w;
    if (Number.isFinite(distance) && (!result || distance < result.distance)) result = { blocker: other, distance };
  }
  return result;
}

export function makeLevel(level: number): GameState {
  const seed = 1927 + level * 7919;
  const rng = random(seed);
  const colors = (Object.keys(PALETTE) as BusColor[]).slice(0, Math.min(4 + Math.floor((level - 1) / 3), 6));
  const buses: Bus[] = [];
  // Build in reverse solution order. Every new bus has a clear exit past all older
  // buses, so removing them in reverse insertion order always solves the layout.
  for (let attempt = 0; attempt < 5000 && buses.length < Math.min(20 + level, 27); attempt++) {
    const direction = (['N', 'E', 'S', 'W'] as const)[Math.floor(rng() * 4)];
    const length = rng() > .76 ? 3 : 2;
    const horizontal = direction === 'E' || direction === 'W';
    const x = Math.floor(rng() * (GRID - (horizontal ? length : 1) + 1));
    const y = Math.floor(rng() * (GRID - (horizontal ? 1 : length) + 1));
    const bus: Bus = {
      id: 'bus-' + buses.length, x, y, length, direction,
      color: colors[Math.floor(rng() * colors.length)], capacity: length * 3,
      filled: 0, status: 'yard', dock: null,
    };
    if (buses.some(other => overlap(bounds(bus), bounds(other))) || collisionFor(bus, buses)) continue;
    buses.push(bus);
  }
  let personId = 0;
  const lines: [Person[], Person[]] = [[], []];
  // Interleave the two feeders into a FIFO that can be served in the known
  // solution order. Players can still create a stop-color deadlock by rushing.
  for (const bus of [...buses].reverse()) {
    for (let seat = 0; seat < bus.capacity; seat++) {
      const lane = personId % 2 as 0 | 1;
      lines[lane].push({ id: personId++, color: bus.color, lane });
    }
  }
  const state: GameState = {
    level, seed, buses, lines, queue: [], nextLine: 0, moves: 0, bumps: 0,
    boarded: 0, totalPassengers: personId, phase: 'playing',
  };
  refillQueue(state);
  return state;
}

export function refillQueue(state: GameState) {
  while (state.queue.length < QUEUE_SIZE && (state.lines[0].length || state.lines[1].length)) {
    const lane = state.lines[state.nextLine].length ? state.nextLine : (1 - state.nextLine) as 0 | 1;
    state.queue.push(state.lines[lane].shift()!);
    state.nextLine = (1 - lane) as 0 | 1;
  }
}

export class Game {
  state: GameState;
  history: GameState[] = [];
  constructor(level = 1, restored?: GameState) {
    this.state = restored ? normalizeRestored(clone(restored)) : makeLevel(level);
  }
  get availableStops() {
    return Array.from({ length: STOP_COUNT }, (_, i) => i).filter(i =>
      !this.state.buses.some(bus => bus.status !== 'gone' && bus.dock === i));
  }
  get remaining() { return this.state.buses.filter(bus => bus.status !== 'gone').length; }
  get activeAnimations() { return this.state.buses.some(bus => bus.status === 'arriving' || bus.status === 'leaving'); }
  get movable() { return this.state.buses.filter(bus => bus.status === 'yard' && !collisionFor(bus, this.state.buses)); }
  dispatch(id: string): { type: 'drive'; bus: Bus } | { type: 'bump'; bus: Bus; collision: Collision } | { type: 'full' } | { type: 'busy' } {
    const bus = this.state.buses.find(bus => bus.id === id);
    if (!bus || bus.status !== 'yard' || this.state.phase !== 'playing') return { type: 'busy' };
    const collision = collisionFor(bus, this.state.buses);
    if (collision) {
      this.state.bumps++;
      return { type: 'bump', bus, collision };
    }
    if (!this.availableStops.length) return { type: 'full' };
    this.history.push(clone(this.state));
    if (this.history.length > 40) this.history.shift();
    bus.status = 'arriving';
    bus.dock = this.availableStops[0];
    this.state.moves++;
    return { type: 'drive', bus };
  }
  arrive(id: string) {
    const bus = this.state.buses.find(bus => bus.id === id);
    if (bus?.status === 'arriving') bus.status = 'docked';
  }
  boardNext(): { person: Person; bus: Bus; full: boolean } | null {
    if (this.state.phase !== 'playing') return null;
    const person = this.state.queue[0];
    const bus = this.state.buses.find(bus =>
      bus.status === 'docked' && bus.color === person?.color && bus.filled < bus.capacity);
    if (!person || !bus) { this.checkEnd(); return null; }
    this.state.queue.shift();
    bus.filled++;
    this.state.boarded++;
    const full = bus.filled === bus.capacity;
    if (full) bus.status = 'leaving';
    refillQueue(this.state);
    return { person, bus, full };
  }
  depart(id: string) {
    const bus = this.state.buses.find(bus => bus.id === id);
    if (bus?.status === 'leaving') { bus.status = 'gone'; bus.dock = null; }
    this.checkEnd();
  }
  checkEnd() {
    if (this.state.buses.every(bus => bus.status === 'gone')) this.state.phase = 'won';
    else if (!this.activeAnimations && !this.availableStops.length &&
      !this.state.buses.some(bus => bus.status === 'docked' && bus.color === this.state.queue[0]?.color && bus.filled < bus.capacity)) {
      this.state.phase = 'jammed';
    }
  }
  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    this.state = previous;
    return true;
  }
  hint() {
    if (!this.availableStops.length) return null;
    const color = this.state.queue[0]?.color;
    return this.movable.find(bus => bus.color === color) ?? this.movable.at(-1) ?? null;
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
    if (!s || !Number.isInteger(s.level) || s.level < 1 || s.level > 9999) return false;
    const initial = makeLevel(s.level);
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
