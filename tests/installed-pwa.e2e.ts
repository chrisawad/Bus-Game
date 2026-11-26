import { expect, test } from '@playwright/test';

test('a real installation suppresses Dashboard install help until Bus Jam is uninstalled', async ({ playwright, baseURL }, info) => {
  const context = await playwright.chromium.launchPersistentContext('', {
    channel: 'chromium',
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    const cdp = await context.newCDPSession(page);
    const { appId } = await cdp.send('Page.getAppId');
    const manifestUrl = await page.locator('link[rel=manifest]').evaluate(link => (link as HTMLLinkElement).href);
    expect(appId).toBe(new URL('/', manifestUrl).href);
    const manifest = await (await context.request.get(manifestUrl)).json();
    expect(manifest.related_applications).toContainEqual({ platform: 'webapp', url: './manifest.webmanifest', id: appId });
    await cdp.send('PWA.install', { manifestId: appId, installUrlOrBundleUrl: page.url() });

    const dashboardVisit = await context.newPage();
    await dashboardVisit.addInitScript(() => {
      const showModal = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        if (this.querySelector('#install-description')) document.documentElement.dataset.installOffered = 'yes';
        showModal.call(this);
      };
    });
    await dashboardVisit.goto(new URL('#from=games-dashboard', baseURL).href);
    await expect(dashboardVisit.locator('#scene')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => dashboardVisit.evaluate(async () => {
      const nav = navigator as Navigator & { getInstalledRelatedApps(): Promise<{ url?: string }[]> };
      return (await nav.getInstalledRelatedApps()).map(app => app.url);
    })).toContain(manifestUrl);
    await expect(dashboardVisit.locator('#install')).toBeHidden();
    await expect(dashboardVisit.locator('html')).not.toHaveAttribute('data-install-offered', 'yes');

    await cdp.send('PWA.uninstall', { manifestId: appId });
    await dashboardVisit.reload();
    await expect(dashboardVisit.getByRole('dialog', { name: 'Install Bus Jam' })).toBeVisible();
  } finally {
    await context.close();
  }
});
