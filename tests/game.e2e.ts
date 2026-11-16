import { test, expect, type Page } from '@playwright/test';
const key = 'bus-bloom-v1';
const read = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
async function openDepot(page: Page) {
  await page.goto('./');
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('[data-bus-id]')).toHaveCount(21);
}
async function canvasClick(page: Page, id: string) {
  const button = page.locator('[data-bus-id="' + id + '"]');
  const position = await button.evaluate(node => ({ x: Number((node as HTMLElement).dataset.screenX), y: Number((node as HTMLElement).dataset.screenY) }));
  await page.locator('#scene canvas').click({ position });
}
test('pointer collisions, hints, dispatch, undo, and responsive layout', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openDepot(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/' + info.project.name + '-depot.png', fullPage: true });
  const blocked = await page.locator('[data-clear="false"][data-status="yard"]').first().getAttribute('data-bus-id');
  await canvasClick(page, blocked!);
  await expect(page.locator('#status')).toContainText('bump');
  await expect.poll(async () => (await read(page)).active.bumps).toBe(1);
  expect((await read(page)).active.moves).toBe(0);
  await expect(page.locator('#scene')).toHaveAttribute('data-busy', 'false');
  await page.locator('#hint').click();
  await expect(page.locator('#status')).toContainText('glowing');
  await canvasClick(page, 'bus-20');
  await expect.poll(async () => (await read(page)).active.moves).toBe(1);
  await expect(page.locator('[data-bus-id="bus-20"]')).toHaveAttribute('data-status', /docked|leaving|gone/);
  await page.locator('#undo').click();
  await expect(page.locator('#move-count')).toHaveText('0 MOVES');
  expect((await read(page)).active.boarded).toBe(0);
  expect((await read(page)).active.buses.every((b: { status: string }) => b.status === 'yard')).toBe(true);
  expect(errors).toEqual([]);
});
test('plays a full level, wins only after every departure, advances, and restores progress', async ({ page }, info) => {
  await openDepot(page);
  await page.locator('#speed').click();
  await page.locator('#keyboard-panel summary').click();
  const ids = await page.locator('[data-bus-id]').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).dataset.busId!).reverse());
  for (const id of ids) {
    const button = page.locator('[data-bus-id="' + id + '"]');
    await expect(button).toHaveAttribute('data-clear', 'true');
    await button.click();
    await expect(button).toHaveAttribute('data-status', 'gone');
  }
  await expect(page.locator('#dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toContainText('good route');
  expect((await read(page)).active.buses.every((b: { status: string }) => b.status === 'gone')).toBe(true);
  expect((await read(page)).active.boarded).toBe((await read(page)).active.totalPassengers);
  await expect(page.locator('#buses-left')).toHaveText('0');
  await page.screenshot({ path: 'test-results/' + info.project.name + '-won.png', fullPage: true });
  await page.locator('[data-action="next"]').click();
  await expect(page.locator('#level-badge')).toHaveText('02');
  await page.reload();
  await expect(page.locator('#level-badge')).toHaveText('02');
  expect((await read(page)).completed).toContain(1);
});
test('recovers from invalid saves and reloads the installed shell offline', async ({ page, context }) => {
  await openDepot(page);
  await page.evaluate(key => localStorage.setItem(key, '{"version":1,"active":{"level":-9}}'), key);
  await page.reload();
  await expect(page.locator('#level-badge')).toHaveText('01');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('#level-badge')).toHaveText('01');
  await page.locator('#hint').click();
  await expect(page.locator('#status')).toContainText('glowing');
  await context.setOffline(false);
});
