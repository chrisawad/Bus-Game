type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
type RelatedApp = { platform: string; id?: string; url?: string };
type InstallNavigator = Navigator & {
  standalone?: boolean;
  install?: () => Promise<void>;
  getInstalledRelatedApps?: () => Promise<RelatedApp[]>;
};

export function setupInstall(button: HTMLButtonElement, help: () => void, status: (message: string) => void, focusAfterInstall: () => void, onInstalled?: () => void) {
  const nav = navigator as InstallNavigator;
  const appMode = matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)');
  let prompt: InstallPrompt | undefined, installedHere = false, relatedInstalled = false;
  const isInstalled = () => appMode.matches || nav.standalone === true || installedHere || relatedInstalled;
  const reflect = () => {
    const installed = isInstalled();
    if (installed && document.activeElement === button) focusAfterInstall();
    button.hidden = installed;
    if (installed) onInstalled?.();
  };
  const checkRelated = async () => {
    if (!isSecureContext || !nav.getInstalledRelatedApps) return;
    try {
      const id = new URL('./', document.baseURI).href;
      const manifest = new URL('manifest.webmanifest', id).href;
      const apps = await nav.getInstalledRelatedApps();
      relatedInstalled = apps.some(app => app.platform === 'webapp' && (app.id === id || app.url === manifest));
      reflect();
    } catch { /* Unavailable detection leaves a useful install/help action. */ }
  };
  appMode.addEventListener('change', reflect);
  window.addEventListener('focus', () => { reflect(); void checkRelated(); });
  window.addEventListener('appinstalled', () => { installedHere = true; prompt = undefined; reflect(); });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event as InstallPrompt;
    // Fresh browser eligibility also covers uninstalling during this session.
    installedHere = false; relatedInstalled = false; reflect();
  });
  const request = async () => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    // The always-visible game action has a real help flow when prompting is
    // unavailable. Call supported install APIs directly in this user gesture.
    if (!isSecureContext || (!nav.install && !prompt)) { help(); return; }
    button.setAttribute('aria-disabled', 'true');
    try {
      if (nav.install) { await nav.install(); installedHere = true; }
      else if (prompt) {
        const pending = prompt; prompt = undefined;
        await pending.prompt();
        installedHere = (await pending.userChoice).outcome === 'accepted' || installedHere;
      }
      if (!installedHere) status('Installation canceled. You can install later.');
    } catch {
      status('Installation did not complete. Try again or use your browser’s install menu.');
    } finally { button.removeAttribute('aria-disabled'); reflect(); }
  };
  button.addEventListener('click', request);
  reflect();
  const ready = checkRelated();
  return { ready, isInstalled, request };
}

export function installInstructions() {
  if (!isSecureContext) return '<p>Installation and offline play need a secure connection. Open the HTTPS version of Bus Jam, then tap Install.</p><p>You can keep playing at this address.</p>';
  const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (appleMobile) return '<p>In Safari, open the Share menu and choose <strong>Add to Home Screen</strong>. Turn on <strong>Open as Web App</strong> if offered, then tap <strong>Add</strong>.</p>';
  return '<p>Open your browser’s menu and choose <strong>Install Bus Jam</strong>, <strong>Install app</strong>, <strong>Add to Home Screen</strong>, or <strong>Add to Dock</strong> if offered.</p><p>If no install option appears, open this page in Chrome, Edge, or Safari. You can keep playing in your browser.</p>';
}
