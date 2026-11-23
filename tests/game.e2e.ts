import { test, expect, type Page } from '@playwright/test';
const key = 'bus-jam-v1';
const read = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
test.beforeEach(async ({ page }) => {
  // Repeatable crowds in browser checks; production gets a fresh seed on
  // each new game. Model tests exercise many other shuffle seeds.
  await page.addInitScript(() => {
    sessionStorage.setItem('bus-jam-install-dismissed', '1');
    let seed = 12345;
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  });
});
async function openDepot(page: Page) {
  await page.goto('./');
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  const save = await read(page);
  await expect(page.locator('[data-bus-id]')).toHaveCount(save.active.buses.length);
  await expect(page.locator('#scene')).toHaveAttribute('data-people', '96');
}
async function canvasClick(page: Page, id: string) {
  const position = await page.locator('[data-bus-id="' + id + '"]').evaluate(node => ({
    x: Number((node as HTMLElement).dataset.screenX), y: Number((node as HTMLElement).dataset.screenY),
  }));
  await page.locator('#scene canvas').click({ position });
}
test('shows the warm depot, short feeder queues, and real diagonal buses', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openDepot(page);
  await expect(page).toHaveTitle('Bus Jam — Colorful Traffic Puzzles');
  await expect(page.getByRole('link', { name: 'Bus Jam home' })).toBeVisible();
  const manifest = await (await page.request.get(new URL('manifest.webmanifest', page.url()).href)).json();
  expect(manifest.short_name).toBe('Bus Jam');
  const sceneBox = await page.locator('#scene').boundingBox();
  const viewport = page.viewportSize()!;
  expect(sceneBox!.width).toBeCloseTo(viewport.width, 0);
  expect(sceneBox!.height).toBeCloseTo(viewport.height, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('aside')).toHaveCount(0);
  const save = await read(page);
  const yard = save.active.yard;
  if (viewport.height > viewport.width) expect(yard.height).toBeGreaterThan(yard.width);
  else expect(yard.width).toBeGreaterThan(yard.height);
  await expect(page.locator('.stops-label')).toHaveCount(0);
  await expect(page.locator('#status-strip')).toBeHidden();
  const counter = (await page.locator('.level-header').boundingBox())!;
  await expect(page.getByText('BOARDED', { exact: true })).toBeVisible();
  await expect(page.locator('#boarded')).toHaveText('0');
  const actions = (await page.locator('.header-actions').boundingBox())!;
  expect(counter.x + counter.width < actions.x || counter.y + counter.height < actions.y ||
    actions.y + actions.height < counter.y).toBe(true);
  expect(save.active.queue).toHaveLength(24);
  expect(save.active.buses).toHaveLength(20);
  expect(save.active.totalPassengers).toBe(save.active.buses.reduce((sum: number, b: { capacity: number }) => sum + b.capacity, 0));
  const buses = save.active.buses as { id: string; x: number; y: number; length: number; direction: string }[];
  expect(buses.filter(b => b.direction.length === 2).length).toBeGreaterThanOrEqual(5);
  await page.screenshot({ path: 'test-results/' + info.project.name + '-depot.png', fullPage: true });
  const blocked = await page.locator('[data-clear="false"][data-status="yard"]').first().getAttribute('data-bus-id');
  await canvasClick(page, blocked!);
  await expect(page.locator('#status')).toContainText('bump');
  // Another bus can leave even while the blocked bus is bumping.
  const clearDiagonal = await page.locator('[data-clear="true"][data-status="yard"]').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).dataset.busId!));
  const diagonal = buses.find(b => b.direction.length === 2 && clearDiagonal.includes(b.id))!;
  expect(diagonal).toBeDefined();
  await canvasClick(page, diagonal.id);
  await expect.poll(async () => (await read(page)).active.moves).toBe(1);
  await expect(page.locator('#status-strip')).toBeHidden();
  await page.locator('#undo').click();
  await expect(page.locator('#undo')).toBeDisabled();
  expect((await read(page)).active.boarded).toBe(0);
  expect(errors).toEqual([]);
});
test('preserves parked positions on resize and fits a new rectangle on restart', async ({ page }) => {
  await openDepot(page);
  const original = await read(page);
  await page.setViewportSize({ width: 844, height: 390 });
  expect((await read(page)).active).toEqual(original.active);
  await page.locator('#retry').click();
  await page.locator('[data-action="restart"]').click();
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  const restarted = await read(page);
  expect(restarted.active.crowdSeed).not.toBe(original.active.crowdSeed);
  for (const lane of [0, 1]) expect(restarted.active.lines[lane]).not.toEqual(original.active.lines[lane]);
  expect(restarted.active.yard.width).toBeGreaterThan(restarted.active.yard.height);
  await expect(page.locator('#scene')).toHaveAttribute('data-people', '96');
  const bus = await page.locator('[data-status="yard"][data-clear="true"]').first().getAttribute('data-bus-id');
  await canvasClick(page, bus!);
  await expect.poll(async () => (await read(page)).active.moves).toBe(1);
  await page.reload();
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  expect((await read(page)).active.yard).toEqual(restarted.active.yard);
  expect((await read(page)).active.crowdSeed).toEqual(restarted.active.crowdSeed);
});
test('turns the same depot, keeps taps aligned, and finishes a trip across rotation', async ({ page }, info) => {
  const portrait = { width: 390, height: 844 }, landscape = { width: 844, height: 390 };
  const startsTall = info.project.name === 'mobile';
  const start = startsTall ? portrait : landscape, rotated = startsTall ? landscape : portrait;
  if (!startsTall) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(start);
  await openDepot(page);
  const original = (await read(page)).active;
  const idle = page.locator('[data-status="yard"][data-clear="false"]').first();
  const id = (await idle.getAttribute('data-bus-id'))!;
  const fixed = page.locator('[data-bus-id="' + id + '"]');
  const initialLabel = (await fixed.getAttribute('aria-label'))!;
  const headingIn = (label: string) => new RegExp('facing ' + label.split(', facing ')[1].split(',')[0] + ',');
  const points = () => page.locator('[data-bus-id]').evaluateAll(nodes => nodes.map(n => {
    const { screenX, screenY } = (n as HTMLElement).dataset;
    return { x: Number(screenX), y: Number(screenY) };
  }));
  const before = await points();
  await page.setViewportSize(rotated);
  await expect(fixed).not.toHaveAttribute('aria-label', initialLabel);
  const rotatedLabel = (await fixed.getAttribute('aria-label'))!;
  const after = await points();
  // A long baseline between two parked roofs turns through 90 degrees in
  // world space. The oblique camera foreshortens its vertical component.
  const first = before.findIndex(p => p.x === Math.min(...before.map(q => q.x)));
  const last = before.findIndex(p => p.x === Math.max(...before.map(q => q.x)));
  const a = { x: before[last].x - before[first].x, y: before[last].y - before[first].y };
  const b = { x: after[last].x - after[first].x, y: after[last].y - after[first].y };
  expect(Math.abs(a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))).toBeLessThan(.26);
  expect((await read(page)).active).toEqual(original);
  await page.screenshot({ path: info.outputPath('rotated-depot.png') });
  await canvasClick(page, id);
  await expect.poll(async () => (await read(page)).active.bumps).toBe(1);
  const clear = page.locator('[data-status="yard"][data-clear="true"][data-matches="true"]').first();
  const sent = (await clear.getAttribute('data-bus-id'))!;
  await canvasClick(page, sent);
  await page.setViewportSize(start);
  await expect(fixed).toHaveAttribute('aria-label', headingIn(initialLabel));
  await expect.poll(async () => (await read(page)).active.boarded).toBeGreaterThan(0);
  // A refill can supply another boarding wave after the first animation ends.
  await expect(page.locator('[data-bus-id]:is([data-status="arriving"], [data-status="leaving"], [data-status="docked"][data-matches="true"])')).toHaveCount(0);
  await expect(page.locator('#scene')).toHaveAttribute('data-in-transit', '0');
  await expect(page.locator('#scene')).toHaveAttribute('data-boarding', 'false');
  expect((await read(page)).active.moves).toBe(1);
  await expect(page.locator('[data-bus-id="' + sent + '"]')).not.toHaveAttribute('data-status', 'yard');

  await page.setViewportSize(rotated);
  // Clearing a neighboring bus can change this bus's exit status.
  await expect(fixed).toHaveAttribute('aria-label', headingIn(rotatedLabel));
  const saved = (await read(page)).active;
  await expect(page.locator('#undo')).toBeEnabled();
  await page.reload();
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  await expect(fixed).toHaveAttribute('aria-label', headingIn(rotatedLabel));
  expect((await read(page)).active).toEqual(saved);

  const almostSquare = startsTall ? { width: 620, height: 640 } : { width: 640, height: 620 };
  await page.setViewportSize(almostSquare);
  await expect(fixed).toHaveAttribute('aria-label', headingIn(initialLabel));
  await page.setViewportSize({ width: almostSquare.height, height: almostSquare.width });
  await expect(fixed).toHaveAttribute('aria-label', headingIn(rotatedLabel));
  expect((await read(page)).active).toEqual(saved);
});
test('boards people behind another color and refills both sides in a group', async ({ page }, info) => {
  await openDepot(page);
  const before = await read(page), front = before.active.queue[0];
  const eligible = await page.locator('[data-clear="true"][data-matches="true"]').evaluateAll(nodes => nodes.map(n => ({
    id: (n as HTMLElement).dataset.busId!, color: (n as HTMLElement).dataset.color!,
  })));
  const bus = eligible.find(b => b.color !== front.color && before.active.queue.filter((p: { color: string }) => p.color === b.color).length >= 4)!;
  expect(bus).toBeDefined();
  await canvasClick(page, bus.id);
  await expect.poll(async () => (await read(page)).active.boarded).toBeGreaterThan(1);
  await expect(page.locator('#boarded')).toBeVisible();
  await expect(page.locator('#boarded')).not.toHaveText('0');
  const after = await read(page);
  expect(after.active.queue[0].id).toBe(front.id);
  expect(after.active.lines[0].length).toBeLessThan(before.active.lines[0].length - 1);
  expect(after.active.lines[1].length).toBeLessThan(before.active.lines[1].length - 1);
  expect(after.active.queue).toHaveLength(24);
  await expect(page.locator('#scene')).toHaveAttribute('data-boarding', 'false');
  await page.screenshot({ path: 'test-results/' + info.project.name + '-refill.png', fullPage: true });
});
test('accepts quick successive dispatches and keeps all stop reservations unique', async ({ page }, info) => {
  await openDepot(page);
  await page.locator('#settings').click();
  await page.locator('#keyboard-panel summary').click();
  const ids = (await read(page)).active.buses.slice(-3).reverse().map((b: { id: string }) => b.id);
  // Send a burst through the real button handlers in one browser task. Waiting
  // for Playwright action stability between clicks can let short trips finish.
  const burst = await page.evaluate(({ ids, key }) => {
    for (const id of ids) {
      const button = document.querySelector<HTMLButtonElement>('[data-bus-id="' + id + '"]')!;
      if (button.disabled) throw new Error('Bus is unexpectedly disabled: ' + id);
      button.click();
    }
    return JSON.parse(localStorage.getItem(key)!).active;
  }, { ids, key });
  expect(burst.moves).toBe(3);
  expect(burst.buses.filter((b: { status: string }) => b.status === 'arriving')).toHaveLength(3);
  const reserved = burst.buses.filter((b: { dock: number | null; status: string }) => b.dock !== null && b.status !== 'gone');
  expect(new Set(reserved.map((b: { dock: number }) => b.dock)).size).toBe(reserved.length);
  await page.locator('#settings-close').click();
  await page.screenshot({ path: 'test-results/' + info.project.name + '-traffic.png', fullPage: true });
});
test('vibrates on impact and sounds the full-stop cue only with sound enabled', async ({ page }) => {
  await page.addInitScript(() => {
    const pulses: number[] = [], frequencies: number[] = [];
    Reflect.set(window, '__pulses', pulses); Reflect.set(window, '__notes', frequencies);
    Object.defineProperty(navigator, 'vibrate', { value: (duration: number) => { pulses.push(duration); return true; } });
    const setValue = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function(value, time) {
      if (value > 1) frequencies.push(value);
      return setValue.call(this, value, time);
    };
  });
  await openDepot(page);
  const blocked = await page.locator('[data-clear="false"][data-status="yard"]').first().getAttribute('data-bus-id');
  await canvasClick(page, blocked!);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__pulses'))).toEqual([45]);
  const feedback = await page.evaluate(key => {
    const yard = [...document.querySelectorAll<HTMLButtonElement>('[data-status="yard"]')];
    const [first, ...remaining] = yard.slice(-5).reverse();
    const sound = document.querySelector<HTMLButtonElement>('#sound')!;
    const notes = Reflect.get(window, '__notes') as number[];
    sound.click(); notes.length = 0;
    first.click();
    const successful = notes.slice(), toastHidden = document.querySelector<HTMLElement>('#status-strip')!.hidden;
    sound.click(); notes.length = 0;
    for (const bus of remaining) bus.click();
    const next = document.querySelector<HTMLButtonElement>('[data-status="yard"]')!;
    next.click();
    const muted = notes.slice();
    sound.click();
    notes.length = 0;
    next.click();
    return { successful, toastHidden, muted, enabled: notes.slice(), status: document.querySelector('#status')!.textContent,
      state: JSON.parse(localStorage.getItem(key)!).active };
  }, key);
  expect(feedback.muted).toEqual([]);
  expect(feedback.successful).toEqual([390]);
  expect(feedback.toastHidden).toBe(true);
  expect(feedback.enabled).toEqual([392, 294]);
  expect(feedback.status).toContain('All five stops are full');
  expect(feedback.state.moves).toBe(5); expect(feedback.state.bumps).toBe(1);
});
test('clears the full dense level with concurrent traffic, then advances and restores', async ({ page }, info) => {
  // Normal-motion inputs and boarding are checked above. The long complete
  // playthrough also covers the reduced-motion path and finishes faster in CI.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Capture the pure route objects for a useful failure report without adding
  // diagnostic globals to the production game.
  await page.addInitScript(() => {
    const set = Map.prototype.set;
    Map.prototype.set = function(key, value) {
      if (value && typeof value === 'object' && 'segments' in value && 'reverseFirst' in value) {
        Object.defineProperty(window, '__busTraffic', { value: this, configurable: true });
      }
      return set.call(this, key, value);
    };
    const trackFrame = (now: number) => { Reflect.set(window, '__busLastFrame', now); requestAnimationFrame(trackFrame); };
    requestAnimationFrame(trackFrame);
  });
  await openDepot(page); await page.locator('#settings').click(); await page.locator('#speed').click();
  await page.locator('#keyboard-panel summary').click();
  await page.locator('[data-clear="false"][data-status="yard"]').first().press('Enter');
  const ids = await page.locator('[data-bus-id]').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).dataset.busId!).reverse());
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    await expect.poll(async () => {
      const state = (await read(page)).active;
      return 5 - state.buses.filter((b: { dock: number | null; status: string }) => b.dock !== null && b.status !== 'gone').length;
    }).toBeGreaterThan(0).catch(async error => {
      const diagnostic = await page.evaluate(() => ({
        hidden: document.hidden,
        frameAgo: performance.now() - Reflect.get(window, '__busLastFrame'),
        routes: [...(Reflect.get(window, '__busTraffic')?.values() || [])],
      }));
      await info.attach('traffic-state', { body: JSON.stringify(diagnostic, null, 2), contentType: 'application/json' });
      throw error;
    });
    const button = page.locator('[data-bus-id="' + id + '"]');
    await expect(button).toHaveAttribute('data-clear', 'true');
    // Exercise the keyboard control without chasing a button as earlier buses
    // disappear from the list. Canvas picking is covered by the input tests.
    await button.press('Enter');
    // A four-bus batch is a constructive solution for any shuffled crowd.
    // Other orders can deliberately jam the smaller holding area.
    if (i % 4 === 3 || i === ids.length - 1) {
      const batch = ids.slice(i - i % 4, i + 1);
      await expect.poll(async () => (await read(page)).active.buses
        .filter((b: { id: string }) => batch.includes(b.id))
        .every((b: { status: string }) => b.status === 'gone'), { timeout: 60_000 }).toBe(true);
    }
  }
  await expect(page.locator('#dialog-title')).toHaveText('You win!', { timeout: 60_000 });
  const finished = await read(page);
  await expect(page.locator('.win-stats > span').last()).toHaveText('1bump');
  expect(finished.active.buses.every((b: { status: string }) => b.status === 'gone')).toBe(true);
  expect(finished.active.boarded).toBe(finished.active.totalPassengers);
  await page.screenshot({ path: 'test-results/' + info.project.name + '-won.png', fullPage: true });
  await page.locator('[data-action="next"]').click();
  await expect(page.locator('#level-badge')).toHaveText('02');
  expect((await read(page)).active.buses).toHaveLength(25);
  await page.reload(); await expect(page.locator('#level-badge')).toHaveText('02');
  expect((await read(page)).completed).toContain(1);
});
test('keeps earlier achievements, recovers invalid saves, and reloads offline', async ({ page, context }) => {
  // Seed before application startup: injecting before reload would be replaced
  // by the current page's intentional pagehide autosave.
  await page.addInitScript(key => {
    const mode = sessionStorage.getItem('save-fixture-mode') || 'legacy';
    if (mode === 'legacy') localStorage.setItem(key, JSON.stringify({
      version: 6, active: { level: 3 }, completed: [1, 2], best: {}, sound: false, fast: true,
    }));
    if (mode === 'invalid') localStorage.setItem(key, '{"version":7,"active":{"level":-9}}');
    sessionStorage.setItem('save-fixture-mode', 'normal');
  }, key);
  await page.goto('./'); await expect(page.locator('#level-badge')).toHaveText('03');
  expect((await read(page)).completed).toEqual([1, 2]);
  await page.evaluate(() => sessionStorage.setItem('save-fixture-mode', 'invalid'));
  await page.reload(); await expect(page.locator('#level-badge')).toHaveText('01');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('#scene canvas')).toBeVisible();
  await page.locator('#hint').click(); await expect(page.locator('#status')).toContainText('glowing');
  await context.setOffline(false);
});
