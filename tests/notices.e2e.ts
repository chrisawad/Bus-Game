import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const key = 'bus-jam-v1';

const publicUrl = 'https://buses.chrisawad.com/';
const description = 'Keep Bus Jam on your home screen and play offline after your first visit.';

function noNativeInstall() {
  Object.defineProperty(navigator, 'install', { configurable: true, value: undefined });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
}

test('offers the same dialog each visit, stays dismissed during play and can be reopened', async ({ page, context }) => {
  await context.addInitScript(noNativeInstall);
  await context.addInitScript(() => {
    localStorage.setItem('glow-trail-installed', '1');
    sessionStorage.setItem('bus-jam-install-dismissed', '1');
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: async (link: string) => { sessionStorage.setItem('copied', link); }}});
  });
  await page.goto('./');
  const dialog = page.getByRole('dialog', { name: 'Install Bus Jam' });
  await expect(dialog).toHaveAccessibleDescription(description);
  await expect(dialog.locator('#install-manual > p')).toHaveText('Open Bus Jam in Chrome or Edge and choose the install option in the address bar or browser menu.');
  await expect(dialog.getByText('Copy the game link', {exact:true})).toBeVisible();
  await expect(dialog.getByRole('textbox')).toBeHidden();
  await dialog.locator('summary').click();
  await expect(dialog.getByRole('textbox', {name:'Game link'})).toHaveValue(publicUrl);
  await dialog.getByRole('button', {name:'Copy link'}).click();
  await expect(dialog.getByText('Link copied.', {exact:true})).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('copied'))).toBe(publicUrl);
  await dialog.getByRole('button', {name:'Not now'}).click();
  await page.locator('#settings').click(); await page.locator('#settings-close').click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog).toBeHidden();
  const bus = await page.locator('[data-clear="true"][data-status="yard"]').last().evaluate(node => ({
    x: Number((node as HTMLElement).dataset.screenX), y: Number((node as HTMLElement).dataset.screenY),
  }));
  await page.locator('#scene canvas').click({ position: bus });
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).active.moves, key)).toBe(1);
  await page.locator('#install').click();
  await expect(dialog).toHaveAccessibleDescription(description);
  await dialog.getByRole('button', {name:'Not now'}).click();

  await page.reload();
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', {name:'Not now'}).click();
  await page.goto('about:blank'); await page.goBack();
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', {name:'Not now'}).click();
  // Also exercise page restoration when the browser preserves this document.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true})));
  await expect(dialog).toBeVisible();
  const fresh = await context.newPage();
  await fresh.goto('./#from=games-dashboard');
  await expect(fresh.getByRole('dialog', {name:'Install Bus Jam'})).toHaveAccessibleDescription(description);
});

test('dashboard entry shows exact platform steps despite stale signals and a denied or hung lookup', async ({ page }, info) => {
  const apple = info.project.name === 'mobile';
  await page.addInitScript(noNativeInstall);
  await page.addInitScript(apple => {
    Object.defineProperty(navigator, 'userAgent', { value: apple ? 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari/605' : 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0 Mobile Safari/537.36' });
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(navigator, 'getInstalledRelatedApps', { value: () => apple
      ? new Promise(resolve => Reflect.set(window, 'finishLookup', resolve))
      : Promise.reject(new DOMException('Denied', 'NotAllowedError')) });
    Object.defineProperty(navigator, 'clipboard', {value: undefined});
    Object.defineProperty(ServiceWorkerContainer.prototype, 'register', { value: () => new Promise(() => {}) });
    sessionStorage.setItem('bus-jam-install-dismissed', '1');
    localStorage.setItem('bus-jam-install-dismissed', '1');
  }, apple);
  const path = './?level=7#from=games-dashboard&route=test';
  await page.goto(path);
  const dialog = page.getByRole('dialog', {name:'Install Bus Jam'});
  await expect(dialog).toHaveAccessibleDescription(description);
  await expect(dialog.getByRole('listitem')).toHaveText(apple ? [
    'Use Open in Safari in this window’s menu, or copy the game link below and open it in Safari. Tap Share.',
    'Choose Add to Home Screen. Turn on Open as Web App if offered, then tap Add.',
  ] : [
    'Choose Open in Chrome in this window’s menu, or copy the game link below and open it in Chrome.',
    'Tap Chrome’s ⋮ menu, choose Install app or Add to Home screen, and follow the prompt.',
  ]);
  await expect(dialog.getByRole('textbox')).toHaveValue(publicUrl);
  await dialog.getByRole('button', {name:'Copy link'}).click();
  await expect(dialog.getByText('Use your device’s Copy command to copy the selected link.', {exact:true})).toBeVisible();
  await expect(dialog.getByRole('textbox')).toBeFocused();
  await dialog.getByRole('button', {name:'Not now'}).click();
  await page.locator('#install').click(); await expect(dialog).toBeVisible();
  expect(page.url()).toBe(new URL(path, info.project.use.baseURL!).href);
  if (apple) {
    await page.evaluate(() => Reflect.get(window, 'finishLookup')([{platform:'webapp', id:new URL('./', document.baseURI).href}]));
  } else {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'install', { value: async () => sessionStorage.setItem('native-install','yes') });
      window.dispatchEvent(new Event('focus'));
    });
    await expect(dialog.locator('#install-manual')).toBeHidden();
    await dialog.getByRole('button', {name:'Install app', exact:true}).click();
    expect(await page.evaluate(() => sessionStorage.getItem('native-install'))).toBe('yes');
  }
  await expect(dialog).toBeHidden(); await expect(page.locator('#install')).toBeHidden();
});

test('only the dialog’s Install app button invokes native installation', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'install', {value: async () => {
    sessionStorage.setItem('calls', String(Number(sessionStorage.getItem('calls')) + 1));
    throw new DOMException('Canceled', 'AbortError');
  }}));
  await page.goto('./');
  const dialog = page.getByRole('dialog', {name:'Install Bus Jam'});
  await expect(dialog.getByRole('button', {name:'Install app'})).toBeFocused();
  await expect(dialog.locator('summary')).toBeHidden();
  await dialog.getByRole('button', {name:'Not now'}).click();
  await page.locator('#install').click();
  expect(await page.evaluate(() => sessionStorage.getItem('calls'))).toBeNull();
  await dialog.getByRole('button', {name:'Install app'}).click();
  await expect(dialog.getByText('Installation canceled. You can keep playing here.', {exact:true})).toBeVisible();
  await expect(dialog.getByRole('button', {name:'Install app'})).toBeEnabled();
  await expect(dialog.locator('summary')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('calls'))).toBe('1');
  await dialog.getByRole('button', {name:'Not now'}).click();
  await page.locator('#install').click();
  await expect(dialog.locator('#install-status')).toBeEmpty();
});

test('Dashboard install switches between compact native controls and the usable manual fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Android; wv Chrome/140' });
    Object.defineProperty(navigator, 'install', { value: () => new Promise((_resolve, reject) => {
      Reflect.set(window, 'denyInstall', () => reject(new DOMException('Blocked by host', 'SecurityError')));
    }) });
    // Control exactly when the browser makes a new single-use prompt available.
    window.addEventListener('beforeinstallprompt', event => {
      if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  });
  await page.goto('./#from=games-dashboard');
  const dialog = page.getByRole('dialog', { name: 'Install Bus Jam' });
  const install = dialog.getByRole('button', { name: 'Install app', exact: true });
  const dismiss = dialog.getByRole('button', { name: 'Not now' });
  const manual = dialog.locator('#install-manual');
  await expect(dialog).toHaveAccessibleDescription(description);
  await expect(install).toBeFocused();
  await expect(manual).toBeHidden();
  await dismiss.click(); await page.locator('#install').click();
  await expect(manual).toBeHidden();
  await install.click();
  await expect(dialog.getByRole('button', { name: 'Installing…' })).toBeDisabled();
  await expect(manual).toBeHidden();
  await page.evaluate(() => Reflect.get(window, 'denyInstall')());
  await expect(install).toBeHidden();
  await expect(dialog.getByRole('listitem').first()).toContainText('Open in Chrome');
  await expect(dialog.getByRole('textbox', { name: 'Game link' })).toHaveValue(publicUrl);
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await dismiss.click(); await page.locator('#install').click();
  await expect(manual).toBeVisible();
  await dialog.getByRole('textbox').focus();
  await page.evaluate(() => {
    const userChoice = new Promise(resolve => Reflect.set(window, 'finishPrompt', resolve));
    window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {}, userChoice,
    }));
  });
  await expect(install).toBeFocused(); await expect(manual).toBeHidden();
  await expect(dialog.locator('#install-status')).toBeEmpty();
  await install.click(); await expect(manual).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Installing…' })).toBeDisabled();
  await page.evaluate(() => Reflect.get(window, 'finishPrompt')({ outcome: 'dismissed' }));
  await expect(dialog.locator('#install-status')).toHaveText('Installation canceled. You can keep playing here.');
  await expect(manual).toBeVisible();
  await dismiss.click(); await expect(dialog).toBeHidden();
});

test('confirmed installations hide every install action on normal and dashboard visits', async ({page}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', {value:true});
    Object.defineProperty(navigator, 'getInstalledRelatedApps', {value:async () =>
      location.hash ? [{platform:'webapp', id:location.origin + '/', url:new URL('manifest.webmanifest', document.baseURI).href}] : []});
  });
  for (const path of ['./','./?next#from=games-dashboard']) {
    await page.goto(new URL(path,info.project.use.baseURL!).href);
    await expect(page.locator('#scene')).toHaveAttribute('aria-busy','false');
    await expect(page.locator('#dialog')).toBeHidden();
    await expect(page.locator('#install')).toBeHidden();
    await page.locator('#settings').click();
    await expect(page.getByRole('button',{name:/install/i})).toHaveCount(0);
    await page.locator('#settings-close').click();
  }
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
    await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
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
