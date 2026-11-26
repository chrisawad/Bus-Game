import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupInstall, installInstructions } from '../src/install';

class Button extends EventTarget {
  hidden = false;
  attributes = new Map<string, string>();
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  click() { this.dispatchEvent(new Event('click')); }
}
function fixture(nav: Record<string, unknown> = {}, installedMode = false, readyState = 'complete') {
  const button = new Button(), win = Object.assign(new EventTarget(), { location: new URL('https://example.test/Bus-Game/') });
  const mode = Object.assign(new EventTarget(), { matches: installedMode });
  const help = vi.fn(), focus = vi.fn();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { baseURI: 'https://example.test/Bus-Game/', activeElement: button, readyState });
  vi.stubGlobal('navigator', { userAgent: 'Chrome', platform: 'Linux', maxTouchPoints: 0, ...nav });
  vi.stubGlobal('matchMedia', () => mode);
  vi.stubGlobal('isSecureContext', true);
  const flow = setupInstall(button as unknown as HTMLButtonElement, help, focus, () => {});
  void flow.checkVisit();
  return { button, win, mode, help, focus, flow };
}
function promptEvent(outcome: 'accepted' | 'dismissed') {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome }),
  });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('persistent install action', () => {
  it('opens useful help while waiting for browser install eligibility', () => {
    const f = fixture(); expect(f.button.hidden).toBe(false);
    f.button.click(); expect(f.help).toHaveBeenCalledOnce();
  });
  it('consumes each browser prompt once, keeps cancellation retryable, and hides on acceptance', async () => {
    const f = fixture(), dismissed = promptEvent('dismissed'); f.win.dispatchEvent(dismissed);
    expect(dismissed.defaultPrevented).toBe(true);
    f.button.click(); expect(dismissed.prompt).not.toHaveBeenCalled();
    await Promise.all([f.flow.request(), f.flow.request()]);
    expect(dismissed.prompt).toHaveBeenCalledOnce(); expect(f.button.hidden).toBe(false);
    f.button.click(); expect(f.help).toHaveBeenCalledTimes(2);
    expect(f.flow.message).toBe('Installation canceled. You can keep playing here.');
    const accepted = promptEvent('accepted'); f.win.dispatchEvent(accepted); await f.flow.request();
    await vi.waitFor(() => expect(f.button.hidden).toBe(true)); expect(f.focus).toHaveBeenCalledOnce();
  });
  it('prefers the modern install API and recovers from cancellation', async () => {
    const install = vi.fn().mockRejectedValueOnce(new DOMException('Canceled', 'AbortError')).mockResolvedValue(undefined);
    const f = fixture({ install }), event = promptEvent('accepted'); f.win.dispatchEvent(event);
    f.button.click(); expect(install).not.toHaveBeenCalled();
    await f.flow.request(); expect(f.flow.message).toBe('Installation canceled. You can keep playing here.');
    expect(f.button.hidden).toBe(false); expect(f.button.getAttribute('aria-disabled')).toBeNull();
    await f.flow.request(); expect(f.button.hidden).toBe(true);
    expect(install).toHaveBeenCalledTimes(2); expect(event.prompt).not.toHaveBeenCalled();
  });
  it.each(['NotSupportedError', 'NotAllowedError', 'SecurityError', 'AbortError'])('falls back after an explicit host restriction (%s) and can use a fresh browser prompt', async name => {
    const install = vi.fn().mockRejectedValue(new DOMException('Installation is not supported in this environment', name));
    const f = fixture({ install }), stale = promptEvent('accepted');
    f.win.dispatchEvent(stale);
    await f.flow.request();
    expect(f.flow.canPrompt()).toBe(false);
    f.win.dispatchEvent(new Event('focus'));
    await f.flow.request();
    expect(install).toHaveBeenCalledOnce();
    expect(stale.prompt).not.toHaveBeenCalled();
    const fresh = promptEvent('accepted');
    f.win.dispatchEvent(fresh);
    expect(f.flow.canPrompt()).toBe(true);
    await f.flow.request();
    expect(fresh.prompt).toHaveBeenCalledOnce(); expect(f.button.hidden).toBe(true);
  });
  it('hides for installed display mode, iOS standalone, and installation events', () => {
    expect(fixture({}, true).button.hidden).toBe(true);
    expect(fixture({ standalone: true }).button.hidden).toBe(true);
    const f = fixture(); f.win.dispatchEvent(new Event('appinstalled'));
    expect(f.button.hidden).toBe(true);
    f.win.dispatchEvent(promptEvent('dismissed')); expect(f.button.hidden).toBe(true);
    const g = fixture(); g.mode.matches = true; g.mode.dispatchEvent(new Event('change'));
    expect(g.button.hidden).toBe(true);
  });
  it('detects only this installed PWA and notices its later removal', async () => {
    const apps = vi.fn().mockResolvedValue([{ platform: 'webapp', id: 'https://example.test/Bus-Game/' }]);
    const f = fixture({ getInstalledRelatedApps: apps });
    await vi.waitFor(() => expect(f.button.hidden).toBe(true));
    apps.mockResolvedValue([{ platform: 'webapp', id: 'https://example.test/another-app/' }]);
    f.win.dispatchEvent(new Event('focus')); await vi.waitFor(() => expect(f.button.hidden).toBe(false));
    apps.mockRejectedValue(new Error('not supported')); f.win.dispatchEvent(new Event('focus'));
    await Promise.resolve(); expect(f.button.hidden).toBe(false);
  });
  it('waits for load and recognizes Android and desktop records by their game manifest', async () => {
    const url = 'https://example.test/Bus-Game/manifest.webmanifest';
    const apps = vi.fn().mockResolvedValue([{ platform: 'webapp', id: './', url }]);
    const f = fixture({ getInstalledRelatedApps: apps }, false, 'interactive');
    await Promise.resolve(); expect(apps).not.toHaveBeenCalled();
    f.win.dispatchEvent(promptEvent('dismissed'));
    f.win.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(f.button.hidden).toBe(true));
    apps.mockResolvedValue([{ platform: 'webapp', id: 'https://example.test/', url }]);
    f.win.dispatchEvent(promptEvent('dismissed'));
    await vi.waitFor(() => expect(apps).toHaveBeenCalledTimes(2));
    expect(f.button.hidden).toBe(true);
    apps.mockResolvedValue([{ platform: 'webapp', id: 'https://example.test/', url: 'https://example.test/Other/manifest.webmanifest' }]);
    f.win.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(f.button.hidden).toBe(false));
  });
  it('distinguishes an unmarked iPad web view from the home-screen app', () => {
    const ipad = { platform: 'MacIntel', maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15' };
    expect(fixture({ ...ipad, standalone: false }, true).button.hidden).toBe(false);
    expect(fixture({ ...ipad, standalone: true }, true).button.hidden).toBe(true);
  });
  it('keeps installation help available on insecure local network addresses', () => {
    const install = vi.fn(), f = fixture({ install }); vi.stubGlobal('isSecureContext', false);
    f.button.click(); expect(install).not.toHaveBeenCalled(); expect(f.help).toHaveBeenCalledOnce();
    expect(installInstructions(false)).toContain('HTTPS');
  });
  it('provides maintained Safari instructions for iPhone and touch-enabled iPad', () => {
    fixture({ userAgent: 'iPhone' }); expect(installInstructions(false)).toContain('Add to Home Screen');
    fixture({ platform: 'MacIntel', maxTouchPoints: 5 }); expect(installInstructions(false)).toContain('Open as Web App');
    fixture(); expect(installInstructions(false)).toContain('address bar or browser menu.');
    fixture({userAgent: 'Macintosh Version/19 Safari/605'}); expect(installInstructions(false)).toContain('File → Add to Dock');
    fixture({userAgent: 'Android'}); expect(installInstructions(false)).toContain('Open Bus Jam in Chrome.');
    expect(installInstructions(true)).toContain('Open in Chrome');
  });
});
