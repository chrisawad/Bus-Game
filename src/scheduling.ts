// Safari and older browsers still get cooperative tasks without Scheduler API.
export async function yieldToBrowser() {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) await scheduler.yield();
  else await new Promise<void>(resolve => setTimeout(resolve, 0));
}

// Let loading feedback actually paint before starting graphics work.
export function afterPaint() {
  return new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
