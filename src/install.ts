export const publicGameUrl = 'https://buses.chrisawad.com/';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
type RelatedApp = { platform: string; id?: string; url?: string };
type InstallNavigator = Navigator & {
  standalone?: boolean;
  install?: () => Promise<void>;
  getInstalledRelatedApps?: () => Promise<RelatedApp[]>;
};

function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function setupInstall(button: HTMLButtonElement, openDialog: () => void, focusAfterInstall: () => void, onChange: (installed: boolean) => void) {
  const nav = navigator as InstallNavigator;
  const appMode = matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)');
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const appleMobile = isAppleMobile();
  const android = /Android/i.test(nav.userAgent);
  const externalLaunch = fragment.getAll('from').includes('games-dashboard') || window.self !== window.top ||
    /^https:\/\/(?:games\.chrisawad\.com(?:\/|$)|chrisawad\.github\.io\/Games-Dashboard(?:\/|$))/i.test(document.referrer) ||
    (android && (/^android-app:\/\/(?!org\.chromium\.webapk\.)/i.test(document.referrer) || /Version\/4\.0.*Chrome\//i.test(nav.userAgent))) ||
    (appleMobile && !nav.standalone && !/Safari\//i.test(nav.userAgent)) ||
    /;\s*wv\b|\bWebView\b|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|\bLine\/|LinkedInApp|GSA\/|Snapchat|TikTok|BytedanceWebview|Pinterest|Twitter for/i.test(nav.userAgent);
  let prompt: InstallPrompt | undefined, installedHere = false, relatedInstalled = false;
  let busy = false, message = '';
  const isInstalled = () => installedHere || relatedInstalled || (!externalLaunch && (appMode.matches || nav.standalone === true));
  const canPrompt = () => isSecureContext && !isInstalled() && (typeof nav.install === 'function' || !!prompt);
  const reflect = () => {
    const installed = isInstalled();
    if (installed && document.activeElement === button) focusAfterInstall();
    button.hidden = installed;
    onChange(installed);
  };
  let lookup = 0;
  const checkRelated = async () => {
    const current = ++lookup;
    try {
      if (!isSecureContext || !nav.getInstalledRelatedApps) return;
      const id = new URL('./', document.baseURI).href;
      const manifest = new URL('manifest.webmanifest', id).href;
      const apps = await nav.getInstalledRelatedApps();
      if (current !== lookup) return;
      relatedInstalled = apps.some(app => app.platform === 'webapp' && (app.id ? app.id === id : app.url === manifest));
      reflect();
    } catch { /* Unavailable detection leaves a useful install/help action. */ }
  };
  appMode.addEventListener('change', reflect);
  window.addEventListener('focus', () => { reflect(); void checkRelated(); });
  window.addEventListener('appinstalled', () => { installedHere = true; prompt = undefined; reflect(); });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event as InstallPrompt;
    // Fresh browser eligibility also covers uninstalling during this session.
    ++lookup; installedHere = false; relatedInstalled = false; reflect();
  });
  const request = async () => {
    if (busy || !canPrompt()) return;
    busy = true; message = ''; reflect();
    try {
      if (nav.install) { await nav.install(); installedHere = true; }
      else if (prompt) {
        const pending = prompt; prompt = undefined;
        await pending.prompt();
        installedHere = (await pending.userChoice).outcome === 'accepted' || installedHere;
      }
      if (!installedHere) message = 'Installation canceled. You can keep playing here.';
    } catch (error) {
      message = error instanceof DOMException && error.name === 'AbortError'
        ? 'Installation canceled. You can keep playing here.'
        : 'The installer could not open. Try again or use your browser’s install menu.';
    } finally { busy = false; reflect(); }
  };
  button.addEventListener('click', () => { if (!isInstalled()) openDialog(); });
  reflect();
  // Give fast local confirmations priority without depending on a host WebView
  // ever answering. A later positive result still updates the open UI.
  const checkVisit = () => new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 750);
    void checkRelated().then(() => { clearTimeout(timeout); resolve(); });
  });
  return { checkVisit, externalLaunch, isInstalled, canPrompt, request, get busy() { return busy; }, get message() { return message; } };
}

export function installInstructions(embedded: boolean) {
  const app = isSecureContext ? 'Bus Jam' : '<a class="install-link" href="' + publicGameUrl + '">Bus Jam</a>';
  if (isAppleMobile()) {
    const first = embedded ? 'Use <strong>Open in Safari</strong> in this window’s menu, or copy the game link below and open it in Safari. Tap <strong>Share</strong>.'
      : 'Open ' + app + ' in Safari and tap <strong>Share</strong>.';
    return '<ol class="help-rules install-steps"><li>' + first + '</li><li>Choose <strong>Add to Home Screen</strong>. Turn on <strong>Open as Web App</strong> if offered, then tap <strong>Add</strong>.</li></ol>';
  }
  if (/Android/i.test(navigator.userAgent)) {
    const first = embedded ? 'Choose <strong>Open in Chrome</strong> in this window’s menu, or copy the game link below and open it in Chrome.'
      : 'Open ' + app + ' in Chrome.';
    return '<ol class="help-rules install-steps"><li>' + first + '</li><li>Tap Chrome’s <strong>⋮ menu</strong>, choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, and follow the prompt.</li></ol>';
  }
  if (!isSecureContext) return '<p>To install from this preview, open <a class="install-link" href="' + publicGameUrl + '">Bus Jam over HTTPS</a>.</p>';
  if (/Macintosh/.test(navigator.userAgent) && /Version\/.*Safari\//.test(navigator.userAgent)) return '<p>In Safari, choose <strong>File → Add to Dock</strong>, then select <strong>Add</strong>.</p>';
  return '<p>Open Bus Jam in Chrome or Edge and choose the <strong>install option</strong> in the address bar or browser menu.</p>';
}
