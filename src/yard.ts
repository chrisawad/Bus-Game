// Routes saved before progression have no target and keep their original layout.
export type YardSize = { width: number; height: number; busTarget?: number };
export const BUS_SCALE = .78;
// A short bus fits in this square at any of the eight headings, including its parking gap.
export const PARKING_CELL = 1.44;
export const DEFAULT_YARD: YardSize = { width: 10, height: 15 };
export const MAX_YARD_SIDE = 32, MAX_YARD_AREA = 320;

export const YARD_TOP = -.8;
const MAX_BUS_LENGTH = 3 * BUS_SCALE;
// The inside of the lane needs room for the diagonal swept by a turning coach.
// On the outside a straight-running bus only needs half its width and a shoulder.
export const ROAD_CLEARANCE = Math.hypot(MAX_BUS_LENGTH, BUS_SCALE) / 2 + .025;
export const ROAD_SHOULDER = BUS_SCALE / 2 + .09;
export const YARD_RIM = .22;
export const BAY_WIDTH = 1.4 * BUS_SCALE + .18;
export const BAY_LENGTH = MAX_BUS_LENGTH + .2;
const PLAZA_DEPTH = 4.4, PLINTH_EDGE = .3;
const EXTRA_WIDTH = 2 * (ROAD_CLEARANCE + ROAD_SHOULDER + PLINTH_EDGE);
const PLAZA_WIDTH = 14.2; // Includes the lamps at either end of the stops.
const COMPACT_PLAZA_WIDTH = 9.4; // Fits the five stops when the side planters are absent.

export const CAMERA_RISE = 30, CAMERA_RUN = 24.2;
const GROUND_PROJECTION = CAMERA_RISE / Math.hypot(CAMERA_RISE, CAMERA_RUN);
// Project the shelter roof at the north end and the plinth at the south end.
const NORTH_OVERHANG = .73, SOUTH_OVERHANG = .29;
export const FRAME_CENTER_Y = (NORTH_OVERHANG - SOUTH_OVERHANG) / 2;

export function createDepotLayout(yard: YardSize) {
  const ROAD_X = yard.width / 2 + ROAD_CLEARANCE;
  const ROAD_TOP = YARD_TOP - ROAD_CLEARANCE;
  const ROAD_BOTTOM = YARD_TOP + yard.height + ROAD_CLEARANCE;
  const ROAD_NORTH_Z = ROAD_TOP - ROAD_SHOULDER;
  // A bus can emerge opposite an occupied stop before it turns onto the lane.
  const DOCK_Z = ROAD_TOP - ROAD_CLEARANCE - BAY_LENGTH / 2;
  const PLAZA_FRONT_Z = DOCK_Z - BAY_LENGTH / 2 - .05;
  const ROAD_WIDTH = (ROAD_X + ROAD_SHOULDER) * 2;
  const ROAD_SOUTH_Z = ROAD_BOTTOM + ROAD_SHOULDER;
  const WORLD_NORTH_Z = PLAZA_FRONT_Z - PLAZA_DEPTH;
  const WORLD_SOUTH_Z = ROAD_SOUTH_Z + .1;
  const WORLD_CENTER_Z = (WORLD_NORTH_Z + WORLD_SOUTH_Z) / 2;
  const frameWidth = Math.max(yard.busTarget ? COMPACT_PLAZA_WIDTH : PLAZA_WIDTH, ROAD_WIDTH + 2 * PLINTH_EDGE);
  const plazaWidthRatio = Math.min(1, frameWidth / PLAZA_WIDTH);
  const frameHeight = (WORLD_SOUTH_Z - WORLD_NORTH_Z) * GROUND_PROJECTION + NORTH_OVERHANG + SOUTH_OVERHANG;
  return { yard, ROAD_X, ROAD_TOP, ROAD_BOTTOM, DOCK_Z, PLAZA_FRONT_Z, ROAD_WIDTH,
    ROAD_NORTH_Z, ROAD_SOUTH_Z, WORLD_NORTH_Z, WORLD_SOUTH_Z, WORLD_CENTER_Z, frameWidth, frameHeight, plazaWidthRatio };
}

// The camera fits the whole depot. Fit a smaller depot for small fleets so the
// same world units enlarge buses, people, hit targets and collision geometry together.
export function yardForLevel(level: number, available: YardSize): YardSize {
  const parkingCells = Math.floor(available.width / PARKING_CELL) * Math.floor(available.height / PARKING_CELL);
  const fullArea = available.width * available.height;
  const capacity = Math.min(100, parkingCells, 5 * Math.round(fullArea * .43 / 5));
  const busTarget = Math.min(capacity, 20 + (level - 1) * 5);
  if (busTarget === capacity) return { ...available, busTarget };
  const frame = createDepotLayout(available);
  const fixedHeight = frame.frameHeight - available.height * GROUND_PROJECTION;
  const smallestFrame = Math.max(COMPACT_PLAZA_WIDTH / frame.frameWidth,
    (fixedHeight + 4.5 * GROUND_PROJECTION) / frame.frameHeight);
  const progress = (busTarget - 20) / (capacity - 20);
  let low = smallestFrame + (1 - smallestFrame) * progress, high = 1;
  const area = fullArea * (busTarget / capacity) ** .72;
  // Find the smallest frame with enough parking area after the fixed-width
  // road, stops and terminal have taken their share in both directions.
  for (let i = 0; i < 16; i++) {
    const f = (low + high) / 2;
    const w = frame.frameWidth * f - EXTRA_WIDTH;
    const h = (frame.frameHeight * f - fixedHeight) / GROUND_PROJECTION;
    const cells = Math.floor(w / PARKING_CELL) * Math.floor(h / PARKING_CELL);
    if (w * h < area || cells < busTarget) low = f; else high = f;
  }
  const hundredth = (value: number) => Math.round(value * 100) / 100;
  return {
    width: Math.min(available.width, Math.max(5.5, hundredth(frame.frameWidth * high - EXTRA_WIDTH))),
    height: Math.min(available.height, Math.max(4.5, hundredth((frame.frameHeight * high - fixedHeight) / GROUND_PROJECTION))),
    busTarget,
  };
}

// Fit new routes to the space between the controls. Existing routes keep their
// world coordinates on rotation and reload, and only the camera refits.
export function fitYard(width: number, height: number): YardSize {
  width = Math.max(1, width); height = Math.max(1, height);
  const area = 240;
  const extraHeight = createDepotLayout({ width: 0, height: 0 }).frameHeight;
  const aspect = width / height;
  // Solve w*h = area with (w + margins)/(h*projection + margins) = aspect.
  const a = aspect * GROUND_PROJECTION, b = aspect * extraHeight - EXTRA_WIDTH;
  const depth = 2 * area / (Math.sqrt(b * b + 4 * a * area) + b);
  const scale = Math.min(width / PLAZA_WIDTH, height / (depth * GROUND_PROJECTION + extraHeight));
  const halfUnit = (n: number) => Math.floor(n * 2) / 2;
  const yardWidth = halfUnit(Math.max(8.5, Math.min(MAX_YARD_SIDE, width / scale - EXTRA_WIDTH)));
  const yardHeight = halfUnit(Math.max(6.5, Math.min(MAX_YARD_SIDE, MAX_YARD_AREA / yardWidth,
    (height / scale - extraHeight) / GROUND_PROJECTION)));
  return { width: yardWidth, height: yardHeight };
}
