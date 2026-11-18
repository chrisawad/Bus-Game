export type ScreenPoint = { x: number; y: number };

// Distance to the actual projected roof outline, never its oversized AABB.
export function distanceToOutline(point: ScreenPoint, outline: ScreenPoint[]) {
  let inside = false, nearest = Infinity;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j], b = outline[i], dx = b.x - a.x, dy = b.y - a.y;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return inside ? 0 : nearest;
}
