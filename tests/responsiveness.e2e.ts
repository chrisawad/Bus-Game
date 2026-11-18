import { test, expect, type Page } from '@playwright/test';
import { Game, collisionFor, validState, type Bus } from '../src/game';
const key = 'bus-jam-v1';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('bus-jam-install-dismissed', '1');
    const set = Map.prototype.set;
    Map.prototype.set = function(k, value) {
      if (value?.group && value?.halo && value?.tag) Reflect.set(window, '__visuals', this);
      if (value?.segments && value?.frames) Reflect.set(window, '__trafficRoutes', this);
      return set.call(this, k, value);
    };
    let draws = 0;
    for (const name of ['drawElements', 'drawArrays'] as const) {
      const original = WebGL2RenderingContext.prototype[name];
      Reflect.set(WebGL2RenderingContext.prototype, name, function(this: WebGL2RenderingContext, ...args: unknown[]) {
        draws++; return Reflect.apply(original, this, args);
      });
    }
    Reflect.set(window, '__drawCount', () => draws);
  });
});

async function open(page: Page) {
  await page.goto('./');
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#scene canvas')).toBeVisible();
}
const read = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).active, key);
async function position(page: Page, id?: string) {
  const button = id ? page.locator('[data-bus-id="' + id + '"]') : page.locator('[data-clear="true"][data-status="yard"]').last();
  const point = await button.evaluate(node => ({ id: (node as HTMLElement).dataset.busId!, x: +(node as HTMLElement).dataset.screenX!, y: +(node as HTMLElement).dataset.screenY! }));
  const canvas = (await page.locator('#scene canvas').boundingBox())!;
  return { ...point, x: point.x + canvas.x, y: point.y + canvas.y };
}

test('paints loading feedback while a cold route worker loads and prevents duplicate starts', async ({ page, context }, info) => {
  // Hold the real worker response until feedback has painted. A gate avoids
  // frame-rate assumptions on a busy CI host.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route('**/level.worker-*.js', async route => {
    await gate; await route.continue();
  });
  await page.goto('./');
  await expect(page.locator('#route-loading')).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  const frames = await page.evaluate(async () => {
    let count = 0;
    await new Promise<void>(resolve => { const frame = () => { count++; if (count < 3) requestAnimationFrame(frame); else resolve(); }; requestAnimationFrame(frame); });
    return count;
  });
  expect(frames).toBeGreaterThan(2);
  await page.screenshot({ path: 'test-results/' + info.project.name + '-loading.png' });
  release();
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#retry').click(); await page.locator('[data-action="restart"]').click();
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  expect((await read(page)).moves).toBe(0);
  await expect(page.locator('#route-loading')).toBeHidden();
});

test('keeps play available when Worker and Scheduler APIs are unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Worker', { value: class { constructor() { throw new Error('Workers blocked'); } } });
    Object.defineProperty(window, 'scheduler', { value: undefined });
  });
  await open(page);
  const point = await position(page);
  await page.locator('#scene canvas').click({ position: { x: point.x, y: point.y } });
  await expect.poll(async () => (await read(page)).moves).toBe(1);
  await page.locator('#undo').click(); await expect(page.locator('#move-count')).toHaveText('0 MOVES');
});

test('recovers when the worker asset cannot load', async ({ page, context }) => {
  await context.route('**/level.worker-*.js', route => route.abort());
  await open(page); expect((await read(page)).buses.length).toBeGreaterThan(40);
  await expect(page.locator('#route-loading')).toBeHidden();
});

test('reuses bus resources on repeated undo and leaves a settled board idle', async ({ page }, info) => {
  await open(page);
  // No GPU draws are needed while the board is settled and has no highlight.
  await expect.poll(async () => page.evaluate(async () => {
    const count = Reflect.get(window, '__drawCount'), before = count();
    await new Promise(resolve => setTimeout(resolve, 150)); return count() - before;
  })).toBe(0);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const durations = await page.evaluate(async key => {
    const visuals = Reflect.get(window, '__visuals') as Map<string, { group: { uuid: string } }>;
    const original = new Map([...visuals].map(([id, v]) => [id, v.group.uuid]));
    const results: number[] = [];
    for (let i = 0; i < 8; i++) {
      document.querySelector<HTMLButtonElement>('[data-clear="true"][data-status="yard"]')!.click();
      const start = performance.now();
      const committed = new Promise<number>(resolve => {
        const counter = document.querySelector('#move-count')!;
        const observer = new MutationObserver(() => {
          if (counter.textContent !== '0 MOVES') return;
          observer.disconnect(); resolve(performance.now() - start);
        });
        observer.observe(counter, { childList: true, subtree: true, characterData: true });
      });
      document.querySelector<HTMLButtonElement>('#undo')!.click();
      // Observe the actual UI commit in a microtask, rather than measuring
      // when a later polling timer gets CPU after a software-rendered frame.
      results.push(await committed);
      for (const [id, visual] of visuals) if (visual.group.uuid !== original.get(id)) throw new Error('Undo rebuilt bus ' + id);
      if (JSON.parse(localStorage.getItem(key)!).active.moves !== 0) throw new Error('Undo did not persist');
    }
    return results;
  }, key);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await info.attach('undo-duration-ms-at-4x-cpu', { body: JSON.stringify(durations), contentType: 'application/json' });
  console.log(info.project.name + ' undo UI commits at 4x CPU (ms): ' + durations.map(value => value.toFixed(1)).join(', '));
  expect(Math.max(...durations)).toBeLessThan(250);
  await expect(page.locator('#undo')).toBeDisabled();
});

test('shows press feedback, tolerates finger jitter, and ignores drags or cancelled touches', async ({ page }, info) => {
  await open(page);
  const point = await position(page);
  const cdp = await page.context().newCDPSession(page);
  if (info.project.name === 'mobile') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
  } else { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
  await expect.poll(async () => page.evaluate(id => Reflect.get(window, '__visuals').get(id).halo.visible, point.id)).toBe(true);
  if (info.project.name === 'mobile') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 4, y: point.y + 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else { await page.mouse.move(point.x + 4, point.y + 3); await page.mouse.up(); }
  await expect.poll(async () => (await read(page)).moves).toBe(1);
  expect((await read(page)).buses.find((bus: Bus) => bus.id === point.id).status).not.toBe('yard');
  await page.locator('#undo').click(); await expect(page.locator('#move-count')).toHaveText('0 MOVES');
  const next = await position(page), before = await read(page);
  if (info.project.name === 'mobile') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: next.x, y: next.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: next.x + 40, y: next.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: next.x, y: next.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  } else { await page.mouse.move(next.x, next.y); await page.mouse.down(); await page.mouse.move(next.x + 40, next.y); await page.mouse.up(); }
  expect((await read(page)).moves).toBe(before.moves); expect((await read(page)).bumps).toBe(before.bumps);
});

test('accepts a bumped bus immediately after its blocker starts leaving', async ({ page }) => {
  await open(page);
  const state = await read(page), buses: Bus[] = state.buses;
  const bus = buses.find(bus => {
    const collision = collisionFor(bus, buses);
    return collision && !collisionFor(collision.blocker, buses) && !collisionFor(bus, buses.filter(other => other.id !== collision.blocker.id));
  })!;
  expect(bus).toBeDefined();
  const blocker = collisionFor(bus, buses)!.blocker;
  const after = await page.evaluate(({ bus, blocker, key }) => {
    for (const id of [bus, blocker, bus]) document.querySelector<HTMLButtonElement>('[data-bus-id="' + id + '"]')!.click();
    return JSON.parse(localStorage.getItem(key)!).active;
  }, { bus: bus.id, blocker: blocker.id, key });
  expect(after.bumps).toBe(1); expect(after.moves).toBe(2);
  expect(after.buses.find((other: Bus) => other.id === bus.id).status).toBe('arriving');
});

test('continues an interrupted bump from its visible position without snapping back', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-01-01T10:00:00Z') });
  await open(page);
  await page.clock.pauseAt(new Date('2030-01-01T10:01:00Z'));
  const buses: Bus[] = (await read(page)).buses;
  const bus = buses.find(bus => {
    const collision = collisionFor(bus, buses);
    return collision && collision.distance > .3 && !collisionFor(collision.blocker, buses) && !collisionFor(bus, buses.filter(other => other.id !== collision.blocker.id));
  })!;
  expect(bus).toBeDefined();
  const blocker = collisionFor(bus, buses)!.blocker;
  await page.evaluate(id => {
    const group = Reflect.get(window, '__visuals').get(id).group;
    Reflect.set(window, '__bumpOrigin', { x: group.position.x, z: group.position.z });
    document.querySelector<HTMLButtonElement>('[data-bus-id="' + id + '"]')!.click();
  }, bus.id);
  await page.clock.runFor(150);
  const movement = await page.evaluate(({ bus, blocker }) => {
    const group = Reflect.get(window, '__visuals').get(bus).group, origin = Reflect.get(window, '__bumpOrigin');
    const before = { x: group.position.x, z: group.position.z };
    document.querySelector<HTMLButtonElement>('[data-bus-id="' + blocker + '"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-bus-id="' + bus + '"]')!.click();
    return { before, after: { x: group.position.x, z: group.position.z }, origin,
      reservedOrigin: Reflect.get(window, '__trafficRoutes').get(bus)?.points[0] };
  }, { bus: bus.id, blocker: blocker.id });
  expect(Math.hypot(movement.before.x - movement.origin.x, movement.before.z - movement.origin.z)).toBeGreaterThan(.08);
  expect(movement.after).toEqual(movement.before);
  expect(movement.reservedOrigin).toEqual(movement.origin);
  expect((await read(page)).moves).toBe(2);
  await page.clock.runFor(16);
  const firstFrame = await page.evaluate(id => {
    const position = Reflect.get(window, '__visuals').get(id).group.position;
    return { x: position.x, z: position.z };
  }, bus.id);
  const initialGap = Math.hypot(movement.before.x - movement.origin.x, movement.before.z - movement.origin.z);
  expect(Math.hypot(firstFrame.x - movement.origin.x, firstFrame.z - movement.origin.z)).toBeGreaterThan(initialGap * .5);
  await page.clock.runFor(130);
  const routeOrigin = await page.evaluate(id => Reflect.get(window, '__trafficRoutes').get(id)?.points[0], bus.id);
  expect(routeOrigin).toEqual(movement.origin);
});

test('handles two overlapping finger taps independently', async ({ page }) => {
  await open(page);
  const ids = await page.locator('[data-clear="true"][data-status="yard"]').evaluateAll(nodes => nodes.slice(-2).map(node => (node as HTMLElement).dataset.busId!));
  const a = await position(page, ids[0]), b = await position(page, ids[1]);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: a.x, y: a.y }, { id: 1, x: b.x, y: b.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await read(page)).moves).toBe(2);
  for (const id of ids) expect((await read(page)).buses.find((bus: Bus) => bus.id === id).status).not.toBe('yard');
});

test('offers a saved-progress reload when the graphics context is lost', async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-clear="true"][data-status="yard"]')!.click());
  await page.evaluate(() => document.querySelector<HTMLCanvasElement>('#scene canvas')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
  await expect(page.locator('#loading-title')).toHaveText('The graphics paused');
  await expect(page.locator('#loading-detail')).toContainText('Your route is saved');
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Reload game' }).click();
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  expect((await read(page)).moves).toBe(1);
});

test('undo during group boarding preserves passengers and cancels stale animations', async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-clear="true"][data-matches="true"][data-status="yard"]')!.click());
  await page.waitForFunction(() => document.querySelector<HTMLElement>('#scene')!.dataset.boarding === 'true');
  const { before, after } = await page.evaluate(async key => {
    const before = JSON.parse(localStorage.getItem(key)!).active;
    document.querySelector<HTMLButtonElement>('[data-clear="true"][data-status="yard"]')!.click();
    document.querySelector<HTMLButtonElement>('#undo')!.click();
    while (document.querySelector('#move-count')!.textContent !== before.moves + ' MOVE') await new Promise(resolve => setTimeout(resolve, 0));
    return { before, after: JSON.parse(localStorage.getItem(key)!).active };
  }, key);
  expect(before.boarded).toBeGreaterThan(0);
  expect(validState(after)).toBe(true);
  expect(after).toEqual(new Game(after.level, before).state);
  await expect(page.locator('#scene')).toHaveAttribute('data-boarding', 'false');
  await page.locator('#undo').click(); await expect(page.locator('#move-count')).toHaveText('0 MOVES');
  expect((await read(page)).boarded).toBe(0);
});
