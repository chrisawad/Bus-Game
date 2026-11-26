import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const key = 'bus-jam-v1';

test('offers installation once per session and resumes the puzzle after dismissal', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'install', { value: undefined });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
  });
  await page.goto('./'); await expect(page.locator('#dialog-title')).toHaveText('Take Bus Jam with you');
  await expect(page.locator('[data-action="install"]')).toBeFocused();
  await page.screenshot({ path: 'test-results/' + info.project.name + '-install-offer.png' });
  await page.locator('[data-action="install"]').click();
  await expect(page.locator('#dialog-title')).toHaveText('Install Bus Jam');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.reload(); await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('#dialog')).not.toBeVisible(); await expect(page.locator('#install')).toBeVisible();
  const bus = await page.locator('[data-clear="true"][data-status="yard"]').last().evaluate(node => ({
    x: Number((node as HTMLElement).dataset.screenX), y: Number((node as HTMLElement).dataset.screenY),
  }));
  await page.locator('#scene canvas').click({ position: bus });
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).active.moves, key)).toBe(1);
});

test('Android install help works in an in-app browser before and after installed-app detection', async ({ browser }, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel; wv) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
  });
  await context.addInitScript(() => {
    sessionStorage.setItem('bus-jam-install-dismissed', '1');
    Object.defineProperty(navigator, 'install', { value: undefined });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    Object.defineProperty(navigator, 'getInstalledRelatedApps', { value: async () =>
      sessionStorage.getItem('installed') ? [{ platform: 'webapp', id: new URL('./', document.baseURI).href }] : [] });
  });
  try {
    const page = await context.newPage();
    await page.goto(info.project.use.baseURL!);
    const dialog = page.getByRole('dialog', { name: 'Install Bus Jam' });
    for (const installed of [false, true]) {
      if (installed) {
        await page.evaluate(() => sessionStorage.setItem('installed', '1'));
        await page.goto(new URL('#from=games-dashboard', info.project.use.baseURL!).href);
        await page.reload();
      }
      await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('#install')).toBeVisible({ visible: !installed });
      if (!installed) {
        await expect(dialog).toContainText('Open in Chrome');
        await dialog.getByRole('button', { name: 'Got it' }).click();
      }
      await expect(dialog).toBeHidden();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'How to install' }).click();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(dialog).toContainText('Open in Chrome');
      await expect(dialog.getByRole('link', { name: 'buses.chrisawad.com' })).toHaveAttribute('href', 'https://buses.chrisawad.com/');
      await expect(dialog).toContainText('paste it into Chrome');
      await expect(dialog).toContainText('Add to Home screen');
      await expect(dialog).toContainText('app drawer');
      await dialog.getByRole('button', { name: 'Got it' }).click();
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    }
  } finally { await context.close(); }
});

test('dashboard entry shows platform instructions with stale dismissal and an inconclusive lookup', async ({ page }, info) => {
  const apple = info.project.name === 'mobile';
  await page.addInitScript(apple => {
    Object.defineProperty(navigator, 'userAgent', { value: apple ? 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148' : 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0 Mobile Safari/537.36' });
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(navigator, 'install', { configurable: true, value: undefined });
    window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); ev.stopImmediatePropagation(); }, true);
    Object.defineProperty(navigator, 'getInstalledRelatedApps', { value: () => apple
      ? new Promise(resolve => Reflect.set(window, 'finishLookup', resolve))
      : Promise.reject(new DOMException('Denied', 'NotAllowedError')) });
    Object.defineProperty(ServiceWorkerContainer.prototype, 'register', { value: () => apple
      ? new Promise(() => {})
      : Promise.reject(new DOMException('Updates unavailable', 'SecurityError')) });
    sessionStorage.setItem('bus-jam-install-dismissed', '1');
    localStorage.setItem('bus-jam-install-dismissed', '1');
  }, apple);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
  const path = './?level=7#from=games-dashboard&route=test';
  await page.goto(path);
  const guide = page.getByRole('dialog', { name: 'Install Bus Jam' });
  await expect(guide).toContainText(apple ? 'Open in Safari' : 'Open in Chrome');
  await expect(guide).toContainText(apple ? 'Add to Home Screen' : 'Install and create shortcut');
  await expect(guide.getByRole('link')).toHaveAttribute('href', 'https://buses.chrisawad.com/');
  await expect(guide.getByRole('button', { name: 'Install Bus Jam' })).toBeHidden();
  await guide.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#install')).toBeVisible();
  await page.locator('#settings').click();
  await page.getByRole('button', { name: 'How to install' }).click();
  await guide.getByRole('button', { name: 'Got it' }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(guide).toBeHidden();
  expect(page.url()).toBe(new URL(path, info.project.use.baseURL!).href);
  await page.reload();
  await expect(guide).toBeVisible();
  if (apple) {
    await page.evaluate(() => Reflect.get(window, 'finishLookup')([{ platform: 'webapp', id: new URL('./', document.baseURI).href }]));
    await expect(guide).toBeHidden();
    await expect(page.locator('#install')).toBeHidden();
  } else {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'install', { value: async () => sessionStorage.setItem('native-install', 'yes') });
      window.dispatchEvent(new Event('focus'));
    });
    await guide.getByRole('button', { name: 'Install Bus Jam' }).click();
    expect(await page.evaluate(() => sessionStorage.getItem('native-install'))).toBe('yes');
    await expect(guide).toBeHidden();
  }
});

test('suppresses the install offer when already installed and defers it behind other dialogs', async ({ browser }) => {
  const installed = await browser.newContext();
  await installed.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  const app = await installed.newPage(); await app.goto(test.info().project.use.baseURL!);
  await expect(app.locator('#scene canvas')).toBeVisible(); await expect(app.locator('#install')).toBeHidden();
  await expect(app.locator('#dialog')).not.toBeVisible();
  await app.getByRole('button', { name: 'Settings', exact: true }).click();
  await app.getByRole('button', { name: 'How to install' }).click();
  await expect(app.getByRole('dialog', { name: 'Install Bus Jam' })).toBeVisible();
  await installed.close();
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const pending = new Promise(resolve => Reflect.set(window, 'finishInstallCheck', resolve));
    Object.defineProperty(navigator, 'getInstalledRelatedApps', { value: () => pending });
  });
  const page = await context.newPage(); await page.goto(test.info().project.use.baseURL!);
  await expect(page.locator('#scene canvas')).toBeVisible();
  await page.locator('#settings').click(); await page.locator('#help').click();
  await page.evaluate(() => Reflect.get(window, 'finishInstallCheck')([]));
  await expect(page.locator('#dialog-title')).toHaveText('A busload of possibility.');
  await page.locator('#dialog-close').click();
  await expect(page.locator('#dialog-title')).toHaveText('Take Bus Jam with you');
  await page.getByRole('button', { name: 'Not now' }).click(); await expect(page.locator('#dialog')).not.toBeVisible();
  await context.close();
});

test('shows a real service-worker update popup, supports Later, and saves before reloading', async ({ browser }, info) => {
  const root = path.resolve('dist'), base = process.env.BASE_PATH || '/';
  let version = 1;
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url!, 'http://localhost').pathname;
      if (!pathname.startsWith(base)) { res.writeHead(404); res.end(); return; }
      const relative = decodeURIComponent(pathname.slice(base.length)) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      let data = await readFile(file);
      if (relative === 'sw.js') data = Buffer.from(data.toString() + '\n// release ' + version);
      const type: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
      res.writeHead(200, { 'Content-Type': type[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext({ viewport: info.project.use.viewport });
  try {
    await context.addInitScript(() => sessionStorage.setItem('bus-jam-install-dismissed', '1'));
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:' + (server.address() as { port: number }).port + base);
    await page.evaluate(() => navigator.serviceWorker.ready); await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.locator('#settings').click(); await page.locator('#sound').click(); await page.locator('#settings-close').click();
    const bus = await page.locator('[data-clear="true"][data-status="yard"]').last().getAttribute('data-bus-id');
    await page.evaluate(id => document.querySelector<HTMLButtonElement>('[data-bus-id="' + id + '"]')!.click(), bus);
    version = 2;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.locator('#dialog-title')).toHaveText('A new version is ready');
    const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
    expect(before.active.moves).toBe(1);
    await page.screenshot({ path: 'test-results/' + info.project.name + '-update-popup.png' });
    await page.getByRole('button', { name: 'Later', exact: true }).click();
    await expect(page.locator('#dialog')).not.toBeVisible();
    await expect(page.locator('.play-footer #update')).toHaveCount(0);
    await page.locator('#settings').click(); await page.locator('#update').click();
    await page.evaluate(() => {
      const write = Storage.prototype.setItem; let failOnce = true;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'bus-jam-v1' && failOnce) { failOnce = false; throw new Error('Storage unavailable'); }
        return write.call(this, key, value);
      };
    });
    await page.getByRole('button', { name: 'Update now' }).click();
    await expect(page.locator('#dialog-content')).toContainText('Your progress could not be saved');
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Try saving again' }).click()]);
    await expect(page.locator('#scene canvas')).toBeVisible();
    const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
    expect(after.active.crowdSeed).toBe(before.active.crowdSeed); expect(after.completed).toEqual(before.completed);
    expect(after.sound).toBe(true); expect(after.active.moves).toBe(before.active.moves);
    await expect(page.locator('#dialog')).not.toBeVisible();
  } finally { await context.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
