export const publicGameUrl = 'https://buses.chrisawad.com/';

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
  const link = '<a class="install-link" href="' + publicGameUrl + '">buses.chrisawad.com</a>';
  const secureHelp = isSecureContext ? '' : '<p>For installation and offline play, open the HTTPS game link at ' + link + '.</p>';
  if (/Android/i.test(navigator.userAgent)) return secureHelp +
    '<ol class="help-rules install-steps"><li>If Bus Jam opened inside another app, tap its menu (⋮) and choose <strong>Open in Chrome</strong>. If that option is missing, press and hold ' + link + ', copy the link, and paste it into Chrome’s address bar.</li>' +
    '<li>In Chrome, tap the menu (⋮) and choose <strong>Install and create shortcut</strong>, then <strong>Install</strong>. Some versions show <strong>Install app</strong> or <strong>Add to Home screen</strong> instead.</li></ol>' +
    '<p class="help-note"><strong>Already installed?</strong> From your Android home screen, swipe up to open the app drawer. Search for <strong>Bus Jam</strong> and tap its icon to play.</p>';
  const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (appleMobile) return secureHelp + '<p>Open ' + link + ' in Safari. Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Turn on <strong>Open as Web App</strong> if offered, then tap <strong>Add</strong>.</p><p>To play again, tap <strong>Bus Jam</strong> on your Home Screen.</p>';
  if (/Mac/.test(navigator.platform)) return secureHelp + '<p>In Safari, choose <strong>File → Add to Dock</strong>. In Chrome or Edge, look for <strong>Install Bus Jam</strong> in the address bar or browser’s menu.</p><p>To launch it again, search for <strong>Bus Jam</strong> in Spotlight.</p>';
  return secureHelp + '<p>Open ' + link + ' in Chrome or Edge. Look for the install icon in the address bar or choose <strong>Install Bus Jam</strong> from the browser’s menu.</p><p>To launch it again, search your apps for <strong>Bus Jam</strong>.</p>';
}
