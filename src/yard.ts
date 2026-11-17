export type YardSize = { width: number; height: number };
export const BUS_SCALE = .78;
export const DEFAULT_YARD: YardSize = { width: 10, height: 15 };

// Choose the board proportions before generating a level. Preserve them for
// the life of the level so rotating a phone never moves a parked bus.
export function fitYard(width: number, height: number): YardSize {
  const area = 150, projection = 30 / Math.hypot(30, 24.2);
  const aspect = Math.max(240, width - 16) / Math.max(240, height - 128);
  const horizontalMargin = 3 * BUS_SCALE + .1 + 1.6;
  const verticalMargin = projection * (9 * BUS_SCALE + 5.3) + .4;
  const a = aspect * projection, b = aspect * verticalMargin - horizontalMargin;
  const depth = (-b + Math.sqrt(b * b + 4 * a * area)) / (2 * a);
  const round = (n: number) => Math.round(n * 2) / 2;
  const yardWidth = round(Math.max(8.5, Math.min(23, area / depth)));
  return { width: yardWidth, height: round(Math.max(6.5, Math.min(20, area / yardWidth))) };
}
