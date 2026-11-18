export type Vec2 = { x: number; y: number };
export type Polygon = { vertices: Vec2[]; axes: Vec2[]; left: number; right: number; top: number; bottom: number };
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export function polygon(vertices: Vec2[]): Polygon {
  const axes: Vec2[] = [];
  vertices.forEach((p, i) => {
    const next = vertices[(i + 1) % vertices.length], x = next.y - p.y, y = p.x - next.x, length = Math.hypot(x, y);
    if (!length) return;
    const axis = { x: x / length, y: y / length };
    if (!axes.some(other => Math.abs(dot(axis, other)) > 1 - 1e-10)) axes.push(axis);
  });
  return { vertices, axes, left: Math.min(...vertices.map(p => p.x)), right: Math.max(...vertices.map(p => p.x)), top: Math.min(...vertices.map(p => p.y)), bottom: Math.max(...vertices.map(p => p.y)) };
}
export function rectangle(center: Vec2, forward: Vec2, length: number, width: number) {
  const side = { x: -forward.y, y: forward.x };
  return polygon([[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([along, across]) => ({
    x: center.x + forward.x * along * length / 2 + side.x * across * width / 2,
    y: center.y + forward.y * along * length / 2 + side.y * across * width / 2,
  })));
}
function projection(shape: Polygon, axis: Vec2) {
  let min = Infinity, max = -Infinity;
  for (const vertex of shape.vertices) {
    const value = dot(vertex, axis); min = Math.min(min, value); max = Math.max(max, value);
  }
  return { min, max };
}
export function polygonsOverlap(a: Polygon, b: Polygon) {
  if (a.left >= b.right - 1e-7 || a.right <= b.left + 1e-7 || a.top >= b.bottom - 1e-7 || a.bottom <= b.top + 1e-7) return false;
  for (let i = 0; i < a.axes.length + b.axes.length; i++) {
    const axis = i < a.axes.length ? a.axes[i] : b.axes[i - a.axes.length];
    const aa = projection(a, axis), bb = projection(b, axis);
    if (aa.min >= bb.max - 1e-7 || aa.max <= bb.min + 1e-7) return false;
  }
  return true;
}
export function sweepDistance(a: Polygon, b: Polygon, velocity: Vec2): number | null {
  let enter = -Infinity, leave = Infinity;
  for (let i = 0; i < a.axes.length + b.axes.length; i++) {
    const axis = i < a.axes.length ? a.axes[i] : b.axes[i - a.axes.length];
    const aa = projection(a, axis), bb = projection(b, axis), speed = dot(velocity, axis);
    if (Math.abs(speed) < 1e-8) {
      if (aa.min >= bb.max - 1e-7 || aa.max <= bb.min + 1e-7) return null;
    } else {
      const first = (bb.min - aa.max) / speed, last = (bb.max - aa.min) / speed;
      enter = Math.max(enter, Math.min(first, last)); leave = Math.min(leave, Math.max(first, last));
      if (enter > leave + 1e-7) return null;
    }
  }
  return leave < 0 ? null : Math.max(0, enter);
}
export function convexHull(points: Vec2[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [], upper: Vec2[] = [];
  for (const p of sorted) { while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of sorted.reverse()) { while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p); }
  return polygon([...lower.slice(0, -1), ...upper.slice(0, -1)]);
}
