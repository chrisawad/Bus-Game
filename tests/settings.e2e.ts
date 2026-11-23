import { test, expect } from '@playwright/test';
const key = 'bus-jam-v1';
const expectedShareUrl = 'https://buses.chrisawad.com/';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('bus-jam-install-dismissed', '1'));
});

test('Share stays at the lower left, keeps stats centered and sends the public game URL', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      sessionStorage.setItem('shared', JSON.stringify(data));
    } });
  });
  await page.goto('./?preview=local#level');
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  const share = page.getByRole('main').getByRole('button', { name: 'Share', exact: true });
  const viewport = page.viewportSize()!;
  for (const size of [viewport, { width: 320, height: 640 }, { width: 375, height: 812 }, { width: 568, height: 320 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => share.evaluate(button => button.getBoundingClientRect().bottom)).toBeCloseTo(size.height - 12, 0);
    await expect(share.locator('svg')).toBeVisible();
    await expect(share.locator('svg circle')).toHaveCount(3);
    await expect(share.locator('span')).toHaveText('Share');
    const icon = (await share.locator('svg').boundingBox())!, label = (await share.locator('span').boundingBox())!;
    expect(label.x).toBeGreaterThan(icon.x + icon.width);
    expect(label.y).toBeLessThan(icon.y + icon.height);
    const box = (await share.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeLessThan(20);
    const stats = (await page.locator('.level-header').boundingBox())!;
    expect(stats.x + stats.width / 2).toBeCloseTo(size.width / 2, 0);
    expect(stats.y).toBeLessThan(20);
    for (const selector of ['#install', '.control-bar']) {
      const other = (await page.locator(selector).boundingBox())!;
      expect(box.x >= other.x + other.width || other.x >= box.x + box.width ||
        box.y >= other.y + other.height || other.y >= box.y + box.height).toBe(true);
    }
    await page.evaluate(() => sessionStorage.removeItem('shared'));
    await share.click();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('shared')!))).toEqual({
      title: 'Bus Jam', url: expectedShareUrl,
    });
    if (size === viewport) await page.screenshot({ path: info.outputPath('share-controls.png') });
  }
});

test('Share respects cancellation and offers the public link when native sharing is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => sessionStorage.setItem('copied', text),
    } });
  });
  await page.goto('./?preview=local#level');
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  const share = page.getByRole('button', { name: 'Share', exact: true });
  await share.click();
  expect(await page.evaluate(() => sessionStorage.getItem('copied'))).toBeNull();
  await expect(page.locator('#dialog')).toBeHidden();
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
  await share.focus(); await share.press('Enter');
  await expect(page.locator('#status')).toHaveText('Bus Jam link copied.');
  expect(await page.evaluate(() => sessionStorage.getItem('copied'))).toBe(expectedShareUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
  });
  await share.click();
  const link = page.getByLabel('Copy this game link');
  await expect(link).toBeFocused();
  await expect(link).toHaveValue(expectedShareUrl);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(share).toBeFocused();
});

test('changes levels from the badge or Settings and restores a parked route', async ({ page }) => {
  const active = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).active, key);
  await page.goto('./');
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  await page.locator('[data-clear="true"][data-status="yard"]').last().evaluate(button => (button as HTMLButtonElement).click());
  const original = await active();
  await page.locator('#level-badge').click();
  const field = page.getByLabel('Level number'), play = page.getByRole('button', { name: 'Play level', exact: true });
  await expect(field).toBeFocused();
  await field.fill('10000'); await play.click();
  expect(await field.evaluate(node => (node as HTMLInputElement).validity.rangeOverflow)).toBe(true);
  await field.fill('5'); await field.press('Enter');
  await expect(page.locator('#level-badge')).toHaveText('05');
  expect((await active()).buses).toHaveLength(40);
  await page.reload();
  await expect(page.locator('#level-badge')).toHaveText('05');
  await page.locator('#settings').click(); await page.locator('#choose-level').click();
  await expect(field).toHaveValue('5');
  await field.fill('1'); await play.click();
  await expect(page.locator('#level-badge')).toHaveText('01');
  const restored = await active();
  expect(restored.moves).toBe(1); expect(restored.crowdSeed).toBe(original.crowdSeed);
  await page.locator('#level-badge').press('Enter'); await page.keyboard.press('Escape');
  await expect(page.locator('#level-badge')).toBeFocused();
});

test('floating settings support keyboard dismissal, saved preferences, and help', async ({ page }, info) => {
  await page.goto('./'); await expect(page.locator('#scene canvas')).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
  const panel = page.locator('#settings-panel');
  await expect(panel).toBeHidden(); await expect(page.locator('#install')).toBeVisible();
  await expect(page.locator('.header-actions #install,.play-column #keyboard-panel')).toHaveCount(0);
  const installBox = await page.locator('#install').boundingBox(), controls = await page.locator('.control-bar').boundingBox();
  expect(installBox!.y).toBeGreaterThan(page.viewportSize()!.height * .75);
  expect(installBox!.x + installBox!.width).toBeLessThan(controls!.x);
  await expect(page.locator('.control-bar #sound,.control-bar #speed')).toHaveCount(0);
  await trigger.focus(); await trigger.press('Enter');
  await expect(panel).toBeVisible(); await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#sound')).toBeFocused();
  const box = await panel.boundingBox(), viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  await page.locator('#sound').click(); await page.locator('#speed').click();
  await expect(page.locator('#sound')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#speed-value')).toHaveText('2×');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.sound).toBe(true); expect(saved.fast).toBe(true);
  await page.keyboard.press('h'); await expect(page.locator('#dialog')).not.toBeVisible();
  await page.screenshot({ path: 'test-results/' + info.project.name + '-settings.png' });
  await page.keyboard.press('Escape'); await expect(panel).toBeHidden(); await expect(trigger).toBeFocused();
  await trigger.click(); await page.mouse.click(5, 100); await expect(panel).toBeHidden();
  await trigger.click(); await panel.locator('#keyboard-panel summary').click();
  await expect(panel.locator('#bus-controls')).toBeVisible();
  await expect(panel.locator('[data-bus-id]')).toHaveCount(saved.active.buses.length);
  await panel.locator('#keyboard-panel summary').click(); await page.locator('#settings-close').click();
  await trigger.click(); await page.locator('#help').click();
  await expect(page.locator('#dialog')).toBeVisible(); await expect(panel).toBeHidden();
  await page.locator('#dialog-close').click(); await expect(trigger).toBeFocused();
  await page.reload(); await trigger.click();
  await expect(page.locator('#sound-value')).toHaveText('On'); await expect(page.locator('#speed-value')).toHaveText('2×');
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).active.crowdSeed).toBe(saved.active.crowdSeed);
});

test('settings remain usable when the native Popover API is unavailable', async ({ page }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(HTMLElement.prototype, 'popover'); });
  await page.goto('./'); await expect(page.locator('#scene canvas')).toBeVisible();
  await page.locator('#settings').click(); await expect(page.locator('#settings-panel')).toBeVisible();
  await page.locator('#sound').click(); await expect(page.locator('#sound-value')).toHaveText('On');
  await page.keyboard.press('Escape'); await expect(page.locator('#settings-panel')).toBeHidden();
  await expect(page.locator('#settings')).toBeFocused();
  await page.locator('#settings').click(); await page.locator('#settings-close').click();
  await expect(page.locator('#settings-panel')).toBeHidden();
});

test('bottom controls fit the visible viewport and clear the system navigation bar', async ({ page }) => {
  // Model a standalone window whose layout height still includes an obscured
  // strip. Chrome can also expose the system bar separately as a safe inset.
  await page.addInitScript(() => {
    Object.defineProperty(window.visualViewport!, 'height', {
      configurable: true, get: () => window.innerHeight - 56,
    });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
  await page.setViewportSize({ width: 448, height: 936 });
  await page.goto('./');
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  for (const [width, height, bottom, right] of [[320, 640, 0, 0], [448, 936, 0, 0], [448, 936, 48, 0], [936, 448, 0, 48]]) {
    await page.setViewportSize({ width, height });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom, right } });
    await expect(page.locator('#boarded')).toBeVisible();
    const left = (await page.locator('#buses-left').boundingBox())!, boarded = (await page.locator('#boarded').boundingBox())!;
    expect(Math.max(boarded.x - (left.x + left.width), boarded.y - (left.y + left.height))).toBeGreaterThanOrEqual(8);
    const brand = (await page.locator('.brand').boundingBox())!, stats = (await page.locator('.level-header').boundingBox())!;
    const settings = (await page.locator('#settings').boundingBox())!;
    expect(stats.x >= brand.x + brand.width || stats.y >= brand.y + brand.height).toBe(true);
    expect(stats.x + stats.width).toBeLessThanOrEqual(settings.x);
    expect(stats.x + stats.width / 2).toBeCloseTo((width - right) / 2, 0);
    for (const selector of ['#share', '#undo', '#retry', '#hint']) {
      const button = page.locator(selector);
      await expect.poll(() => button.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(height - 56 - bottom - 12);
      const box = (await button.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width - right - 12);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: 'Restart route' }).click();
    await expect(page.locator('[data-action="restart"]')).toBeVisible();
    await page.locator('#dialog-close').click();
  }
});

test('the game-screen Install action offers help before prompting and hides after install', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'install', { configurable: true, value: undefined });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
  });
  await page.goto('./'); await expect(page.locator('#scene canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Install Bus Jam', exact: true }).click();
  await expect(page.locator('#dialog-title')).toHaveText('Install Bus Jam');
  await expect(page.locator('#dialog-content')).toContainText('browser’s menu');
  await page.screenshot({ path: 'test-results/' + info.project.name + '-install-help.png' });
  await page.locator('[data-action="close"]').click(); await expect(page.locator('#install')).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('#install')).toBeHidden();
});
