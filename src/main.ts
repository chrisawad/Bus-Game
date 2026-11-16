import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Game, PALETTE, collisionFor, type Bus } from './game';
import { DepotScene } from './scene';
import { readSave, writeSave, type Save } from './storage';

const icons: Record<string, string> = {
  bus: '<rect x="4" y="3" width="16" height="16" rx="4"/><path d="M4 11h16M8 19v2m8-2v2M8 15h.01M16 15h.01M8 7h8"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  undo: '<path d="M3 10h11a7 7 0 1 1-6.3 10M3 10l5-5M3 10l5 5"/>',
  hint: '<path d="M9 18h6m-5 3h4M8.5 14.5a6 6 0 1 1 7 0c-1 .7-1.5 1.5-1.5 3.5h-4c0-2-.5-2.8-1.5-3.5Z"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5V4Zm5 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 4-6 5H2v6h3l6 5V4Zm5 5 5 6m0-6-5 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1 .6-1.7 1.2-1.7 2.7M12 17h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  leaf: '<path d="M20 4C10 2 3 7 5 14s12 8 15-10ZM5 20 16 9"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m0-16a3 3 0 0 1 0 6m3 4a5 5 0 0 1 3 4v2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  trophy: '<path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm4 10v5m-4 3h8M8 5H4v2a5 5 0 0 0 5 5m7-7h4v2a5 5 0 0 1-5 5"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 0-10 7 7 0 0 1 13 2 4 4 0 0 1-1 8M9 16l2 2 4-4"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  speed: '<path d="m3 5 9 7-9 7V5Zm10 0 9 7-9 7V5Z"/>',
};
const icon = (name: string) => '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || '') + '</svg>';
const el = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const names = ['The morning shuffle', 'A colorful commute', 'Room for everyone', 'The scenic route', 'Rush-hour daydream', 'All aboard, again'];
const saved = readSave();
let game = new Game(saved?.active.level ?? 1, saved?.active);
const progress: Omit<Save, 'active'> = { version: 1, completed: saved?.completed ?? [], best: saved?.best ?? {}, sound: saved?.sound ?? false, fast: saved?.fast ?? false };
let scene: DepotScene;
let busy = false, boardingClock = 0, lastPhase = '';
let modal: 'help' | 'retry' | 'won' | 'jammed' | null = null;
let messageTimer: ReturnType<typeof setTimeout>;
let audioContext: AudioContext | undefined;
let audioReady = false;
let updateAvailable: (() => void) | null = null;

el('#app').innerHTML = `
<div class="app-shell">
  <header class="site-header flex items-center justify-between">
    <a class="brand flex items-center gap-3" href="./" aria-label="Bus Bloom home">
      <span class="brand-mark">${icon('bus')}<span class="brand-flower">✳</span></span>
      <span>bus<span class="brand-light">bloom</span><span class="brand-period">.</span></span>
    </a>
    <div class="header-tagline">A colorful little traffic puzzle</div>
    <div class="header-actions flex items-center gap-2">
      <span class="saved-pill" id="save-state">${icon('check')} Progress saved</span>
      <button class="icon-button" id="sound" type="button" aria-label="Turn sound on" aria-pressed="false" title="Sound">${icon('mute')}</button>
      <button class="icon-button" id="help" type="button" aria-label="How to play" title="How to play">${icon('help')}</button>
      <button class="install-button" id="install" type="button" hidden>${icon('download')} Install</button>
    </div>
  </header>
  <main class="game-layout">
    <aside class="sidebar">
      <div><div class="eyebrow"><span class="tiny-sun">✳</span> A GOOD DAY TO UNWIND</div>
        <h1>A little traffic.<br><span>A lot of color.</span></h1>
        <p class="intro">Untangle the buses.<br>Get your little people home.</p>
      </div>
      <section class="how-section" aria-label="How to play">
        <div class="section-label">THE SHORT VERSION</div>
        <ol class="rule-list">
          <li><span class="rule-number">01</span><div><strong>Find a way out</strong><p>Tap a bus. It follows its arrow.<br>Watch out for a little bump.</p></div></li>
          <li><span class="rule-number">02</span><div><strong>Meet your match</strong><p>First in line boards a bus<br>of the same color.</p></div></li>
          <li><span class="rule-number">03</span><div><strong>Make some room</strong><p>Full buses roll out. Clear them<br>all to finish your route.</p></div></li>
        </ol>
      </section>
      <section class="next-up" aria-label="Passenger queue">
        <div class="section-label flex items-center justify-between">NEXT IN LINE <span id="queue-left"></span></div>
        <div id="queue-preview" class="queue-preview"></div>
        <div class="queue-caption"><span class="color-dot" id="next-dot"></span><span id="next-name"></span><span class="queue-arrow">↗</span></div>
        <p class="feeder-note">Two lines. Taking turns. One happy queue.</p>
      </section>
      <div class="sidebar-bottom">
        <div class="section-label">YOUR LITTLE JOURNEY <span id="journey-count"></span></div>
        <div class="journey" id="journey"></div>
        <p>No rush. No timer.<br>Just one bus at a time.</p>
        <span class="made-for-you">${icon('leaf')} A small moment of play.</span>
      </div>
    </aside>
    <section class="play-column" aria-label="Bus puzzle">
      <div class="level-header flex items-center justify-between">
        <div class="flex items-center gap-3"><span class="level-badge" id="level-badge">01</span>
          <div><div class="eyebrow level-eyebrow">YOUR CURRENT ROUTE</div><h2 id="level-name"></h2></div>
        </div>
        <div class="level-stats flex items-center">
          <div><span class="stat-label">BUSES LEFT</span><strong id="buses-left"></strong></div>
          <span class="stat-divider"></span>
          <div><span class="stat-label">HAPPY PASSENGERS</span><strong><span id="boarded">0</span><span class="stat-total" id="total"></span></strong></div>
        </div>
      </div>
      <div class="board-card">
        <div class="board-top flex items-center justify-between">
          <div class="depot-label"><span class="live-dot"></span> LITTLE BLOOM DEPOT</div>
          <span class="stops-label">${icon('check')} All 5 stops unlocked</span>
        </div>
        <div id="scene" class="scene"><div class="loading"><span class="loading-bus">${icon('bus')}</span>Opening the depot…</div></div>
        <div class="board-footnote"><span>← TWO LINES, ONE QUEUE →</span><span id="move-count">0 MOVES</span></div>
        <div class="board-progress" role="progressbar" aria-label="Passengers boarded" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="progress-bar"></span></div>
      </div>
      <div class="status-strip" id="status-strip">
        <span class="status-symbol">${icon('bus')}</span><p id="status" role="status" aria-live="polite">Pick a bus with a clear road ahead.</p>
        <span class="status-detail" id="stops-status">5 stops open</span>
      </div>
      <div class="control-bar flex items-center justify-between">
        <div class="flex items-center gap-2">
          <button class="tool-button" id="undo" type="button" disabled>${icon('undo')}<span>Undo</span><kbd>Z</kbd></button>
          <button class="tool-button" id="retry" type="button">${icon('reset')}<span>Restart</span><kbd>R</kbd></button>
        </div>
        <div class="flex items-center gap-2">
          <button class="speed-button" id="speed" type="button" aria-label="Switch to double speed" aria-pressed="false">${icon('speed')}<span>1×</span></button>
          <button class="hint-button" id="hint" type="button">${icon('hint')} A little hint <kbd>H</kbd></button>
        </div>
      </div>
      <details class="keyboard-panel" id="keyboard-panel">
        <summary>Keyboard depot controls <span>Tab to a bus, then press Enter</span></summary><div class="bus-controls" id="bus-controls"></div>
      </details>
      <div class="play-footer"><span>${icon('cloud')} <span id="offline-state">Your journey saves in this browser</span></span>
        <button type="button" id="update" hidden>Update ready · Restart app ↗</button><span>TAKE THE COLORFUL WAY HOME</span>
      </div>
    </section>
  </main>
  <dialog id="dialog" aria-labelledby="dialog-title"><button class="dialog-close icon-button" id="dialog-close" type="button" aria-label="Close dialog">${icon('close')}</button><div id="dialog-content"></div></dialog>
</div>`;

function tone(kind: 'tap' | 'bump' | 'board' | 'depart' | 'win') {
  if (!progress.sound || !audioReady) return;
  try {
    audioContext ??= new AudioContext(); void audioContext.resume();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), now = audioContext.currentTime;
    oscillator.type = kind === 'bump' ? 'triangle' : 'sine';
    const freq = { tap: 390, bump: 110, board: 640, depart: 440, win: 780 }[kind];
    oscillator.frequency.setValueAtTime(freq, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'bump' ? 55 : freq * 1.4, now + .12);
    gain.gain.setValueAtTime(kind === 'board' ? .025 : .065, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + .18);
    oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(now); oscillator.stop(now + .2);
  } catch { /* Play remains available without audio. */ }
}
function persist() {
  const ok = writeSave({ ...progress, active: game.state });
  el('#save-state').innerHTML = icon(ok ? 'check' : 'help') + (ok ? 'Progress saved' : 'Save unavailable');
  el('#save-state').title = ok ? 'Saved locally on this device' : 'Browser storage is unavailable. You can still play this session.';
}
function say(text: string, warning = false, duration = 4000) {
  clearTimeout(messageTimer); el('#status').textContent = text;
  el('#status-strip').classList.toggle('warning', warning);
  if (duration) messageTimer = setTimeout(() => {
    el('#status-strip').classList.remove('warning');
    if (game.state.phase === 'playing') el('#status').textContent = 'Follow the arrows. Match the first person in line.';
  }, duration);
}
function updateControls() {
  el<HTMLButtonElement>('#undo').disabled = !game.history.length;
  el('#sound').innerHTML = icon(progress.sound ? 'sound' : 'mute');
  el('#sound').setAttribute('aria-label', progress.sound ? 'Turn sound off' : 'Turn sound on');
  el('#sound').setAttribute('aria-pressed', String(progress.sound));
  el('#speed span').textContent = progress.fast ? '2×' : '1×';
  el('#speed').setAttribute('aria-pressed', String(progress.fast));
  el('#speed').setAttribute('aria-label', progress.fast ? 'Switch to normal speed' : 'Switch to double speed');
}
function sync() {
  scene.state = game.state; el('#scene').dataset.busy = String(busy);
  const s = game.state, color = s.queue[0]?.color;
  el('#level-badge').textContent = String(s.level).padStart(2, '0'); el('#level-name').textContent = names[(s.level - 1) % names.length];
  el('#buses-left').textContent = String(game.remaining); el('#boarded').textContent = String(s.boarded); el('#total').textContent = ' / ' + s.totalPassengers;
  el('#move-count').textContent = s.moves + (s.moves === 1 ? ' MOVE' : ' MOVES');
  el('#queue-left').textContent = (s.totalPassengers - s.boarded) + ' waiting';
  el('#next-name').textContent = color ? PALETTE[color].name + ' is up next' : 'Everyone is on board!';
  el('#next-dot').style.background = color ? PALETTE[color].hex : '#aecbb5';
  el('#queue-preview').innerHTML = s.queue.slice(0, 8).map((p, i) => '<span class="person-chip ' + (i === 0 ? 'first' : '') +
    '" style="--person-color:' + PALETTE[p.color].hex + '" title="' + PALETTE[p.color].name + ' passenger"><span class="chip-head"></span><span class="chip-body">' +
    PALETTE[p.color].symbol + '</span></span>').join('') + (s.queue.length > 8 ? '<span class="more-people">+' + (s.totalPassengers - s.boarded - 8) + '</span>' : '');
  const percent = s.boarded / s.totalPassengers * 100;
  el('#progress-bar').style.width = percent + '%'; el('.board-progress').setAttribute('aria-valuenow', String(Math.round(percent)));
  el('#stops-status').textContent = game.availableStops.length + (game.availableStops.length === 1 ? ' stop open' : ' stops open');
  el('#journey-count').textContent = progress.completed.length + ' finished';
  const first = Math.floor((s.level - 1) / 5) * 5 + 1;
  el('#journey').innerHTML = Array.from({ length: 5 }, (_, i) => first + i).map(level => '<span class="' + (level === s.level ? 'current' : '') + ' ' +
    (progress.completed.includes(level) ? 'done' : '') + '" title="Route ' + level + '">' + (progress.completed.includes(level) ? icon('check') : String(level).padStart(2, '0')) + '</span>').join('');
  const controlBox = el('#bus-controls');
  // Real HTML controls provide a keyboard/screen-reader alternative to WebGL.
  for (const bus of s.buses) {
    let button = controlBox.querySelector<HTMLButtonElement>('[data-bus-id="' + bus.id + '"]');
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.dataset.busId = bus.id;
      button.addEventListener('click', () => selectBus(bus.id)); controlBox.appendChild(button);
    }
    const clear = !collisionFor(bus, s.buses);
    button.dataset.clear = String(clear); button.dataset.matches = String(bus.color === color);
    button.dataset.status = bus.status; button.dataset.color = bus.color;
    button.style.setProperty('--bus-color', PALETTE[bus.color].hex);
    button.disabled = bus.status !== 'yard'; button.hidden = bus.status === 'gone';
    const dir = { N: '↑', E: '→', S: '↓', W: '←' }[bus.direction];
    button.textContent = PALETTE[bus.color].symbol + ' ' + PALETTE[bus.color].name + ' ' + dir + ' · ' +
      (bus.status === 'yard' ? bus.capacity + ' seats' : bus.filled + '/' + bus.capacity);
    button.setAttribute('aria-label', PALETTE[bus.color].name + ' bus ' + (Number(bus.id.slice(4)) + 1) + ', facing ' +
      { N: 'north', E: 'east', S: 'south', W: 'west' }[bus.direction] + ', ' + bus.capacity + ' seats, ' +
      (bus.status === 'yard' ? (clear ? 'clear exit' : 'blocked exit') : bus.status));
    const screen = scene.busScreenPosition(bus.id);
    if (screen) { button.dataset.screenX = String(screen.x); button.dataset.screenY = String(screen.y); }
  }
  scene.syncPeople(); updateControls(); persist();
  if (s.phase !== lastPhase) {
    lastPhase = s.phase;
    if (s.phase === 'won') {
      if (!progress.completed.includes(s.level)) progress.completed.push(s.level);
      progress.best[s.level] = Math.min(progress.best[s.level] ?? Infinity, s.moves);
      persist(); tone('win'); scene.celebrate(); showDialog('won');
    } else if (s.phase === 'jammed') showDialog('jammed');
  }
}
function selectBus(id: string) {
  audioReady = true;
  if (modal || game.state.phase !== 'playing') return;
  if (busy) { say('One moment—let this bus finish its move.'); return; }
  const result = game.dispatch(id);
  if (result.type === 'full') { say('The stops are full. Let a matching bus fill up, or undo a move.', true); return; }
  if (result.type === 'busy') return;
  busy = true; el('#scene').dataset.busy = 'true';
  if (result.type === 'bump') {
    tone('bump'); say('A little bump! Clear the ' + PALETTE[result.collision.blocker.color].name.toLowerCase() + ' bus ahead first.', true);
    scene.bump(result.bus, result.collision.distance, result.collision.blocker, () => { busy = false; sync(); }); persist(); return;
  }
  tone('tap'); say(PALETTE[result.bus.color].name + ' is heading to stop ' + (result.bus.dock! + 1) + '.');
  scene.drive(result.bus, () => { game.arrive(id); busy = false; say(PALETTE[result.bus.color].name + ' is ready. Matching passengers, hop aboard!'); sync(); });
  sync();
}
function doUndo() {
  if (!game.undo()) { say('Your first move is still ahead of you.'); return; }
  const history = game.history;
  closeDialog(); busy = false; boardingClock = 0; lastPhase = '';
  game = new Game(game.state.level, game.state); game.history = history;
  scene.reset(game.state); sync(); say('A little rewind. Try a different bus.');
}
function restart(level = game.state.level) {
  closeDialog(); busy = false; boardingClock = 0; lastPhase = '';
  game = new Game(level); scene.reset(game.state); el('#bus-controls').innerHTML = '';
  sync(); say('A fresh start. Find a bus with a clear exit.');
}
function showDialog(kind: NonNullable<typeof modal>) {
  const dialog = el<HTMLDialogElement>('#dialog');
  if (dialog.open) dialog.close();
  modal = kind;
  const content = el('#dialog-content'); el('#dialog-close').hidden = kind === 'jammed' || kind === 'won';
  if (kind === 'help') {
    content.innerHTML = '<div class="dialog-emblem">' + icon('bus') + '</div><div class="eyebrow">WELCOME TO THE DEPOT</div><h2 id="dialog-title">A busload of possibility.</h2>' +
      '<p>Clear every bus to finish your route. Here’s how:</p><ol class="help-rules">' +
      '<li><strong>Follow the arrow.</strong> Tap a bus to drive forward. If another bus blocks it, it bumps and returns to its spot.</li>' +
      '<li><strong>Pick your colors.</strong> A clear bus circles the border into a free stop. All five stops are always unlocked.</li>' +
      '<li><strong>First in, first aboard.</strong> Two passenger lines alternate into one queue. Only the first person can board, and only a bus of their color.</li>' +
      '<li><strong>Fill it and free it.</strong> A full bus drives off and opens its stop. You win when every bus is gone.</li></ol>' +
      '<p class="help-note">Full stops with no matching bus? Undo or restart. Hints are always free. Color symbols and keyboard controls are available, too.</p>' +
      '<button class="dialog-primary" data-action="close">Let’s roll ' + icon('arrow') + '</button>';
  } else if (kind === 'retry') {
    content.innerHTML = '<div class="dialog-emblem">' + icon('reset') + '</div><div class="eyebrow">A FRESH PERSPECTIVE</div><h2 id="dialog-title">Take it from the top?</h2>' +
      '<p>Restart this route with all buses and passengers back in place. Your completed routes stay saved.</p>' +
      '<button class="dialog-primary" data-action="restart">Restart route ' + icon('reset') + '</button><button class="dialog-secondary" data-action="close">Keep playing</button>';
  } else if (kind === 'jammed') {
    content.innerHTML = '<div class="dialog-emblem warm">' + icon('people') + '</div><div class="eyebrow">A LITTLE TRAFFIC JAM</div><h2 id="dialog-title">Time for a little rewind.</h2>' +
      '<p>All five stops are occupied, and the first passenger has no matching bus. Undo a dispatch to make room for their color.</p>' +
      '<button class="dialog-primary" data-action="undo">Undo last dispatch ' + icon('undo') + '</button><button class="dialog-secondary" data-action="restart">Try this route again</button>';
  } else {
    content.innerHTML = '<div class="dialog-emblem trophy">' + icon('trophy') + '</div><div class="eyebrow">EVERYONE MADE IT HOME</div><h2 id="dialog-title">Now that’s a good route.</h2>' +
      '<p>Every bus is gone. Every little person is on their way. Take a moment—you’ve earned it.</p>' +
      '<div class="win-stats"><span><strong>' + game.state.buses.length + '</strong>buses cleared</span><span><strong>' + game.state.boarded +
      '</strong>happy passengers</span><span><strong>' + game.state.moves + '</strong>moves</span></div>' +
      '<button class="dialog-primary" data-action="next">On to route ' + (game.state.level + 1) + ' ' + icon('arrow') + '</button><button class="dialog-secondary" data-action="restart">Play this one again</button>';
  }
  content.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'close') closeDialog(); if (action === 'restart') restart(); if (action === 'next') restart(game.state.level + 1); if (action === 'undo') doUndo();
  }));
  dialog.showModal();
}
function closeDialog() { el<HTMLDialogElement>('#dialog').close(); modal = null; }
el('#dialog-close').addEventListener('click', closeDialog);
el<HTMLDialogElement>('#dialog').addEventListener('cancel', event => {
  if (modal === 'jammed' || modal === 'won') event.preventDefault(); else modal = null;
});
el('#help').addEventListener('click', () => showDialog('help')); el('#retry').addEventListener('click', () => showDialog('retry'));
el('#undo').addEventListener('click', doUndo);
el('#hint').addEventListener('click', () => {
  const bus = game.hint();
  if (bus) {
    scene.hint(bus.id); el<HTMLButtonElement>('[data-bus-id="' + bus.id + '"]')?.classList.add('hinted');
    say('Look for the glowing ' + PALETTE[bus.color].name.toLowerCase() + ' bus. Its road is clear.');
  } else say('Let the stops empty, or undo a dispatch to make room.', true);
});
el('#sound').addEventListener('click', () => { audioReady = true; progress.sound = !progress.sound; tone('tap'); updateControls(); persist(); });
el('#speed').addEventListener('click', () => { progress.fast = !progress.fast; updateControls(); persist(); });
window.addEventListener('keydown', event => {
  if (modal || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)) return;
  const key = event.key.toLowerCase();
  if (key === 'z') { event.preventDefault(); doUndo(); } if (key === 'h') el<HTMLButtonElement>('#hint').click(); if (key === 'r') showDialog('retry');
});
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferredInstall: InstallPrompt | undefined;
const installNavigator = navigator as Navigator & { install?: () => Promise<void> };
const installButton = el<HTMLButtonElement>('#install');
if (typeof installNavigator.install === 'function') installButton.hidden = false;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event as InstallPrompt; installButton.hidden = false; });
installButton.addEventListener('click', async () => {
  if (installButton.getAttribute('aria-disabled') === 'true') return;
  installButton.setAttribute('aria-disabled', 'true');
  try {
    if (typeof installNavigator.install === 'function') { await installNavigator.install(); installButton.hidden = true; }
    else if (deferredInstall) {
      const prompt = deferredInstall; deferredInstall = undefined; await prompt.prompt(); await prompt.userChoice; installButton.hidden = !deferredInstall;
    }
  } catch { say('Installation was canceled or could not complete. You can keep playing here.'); }
  finally { installButton.removeAttribute('aria-disabled'); }
});
window.addEventListener('appinstalled', () => { installButton.hidden = true; deferredInstall = undefined; });
const updateSW = registerSW({
  onNeedRefresh() { updateAvailable = () => void updateSW(true); el('#update').hidden = false; },
  onOfflineReady() { el('#offline-state').textContent = 'Ready to play offline · Saved on this device'; },
  onRegisterError(error) { console.warn('Offline support could not start.', error); },
});
el('#update').addEventListener('click', () => { persist(); updateAvailable?.(); });
window.addEventListener('offline', () => { el('#offline-state').textContent = 'Playing offline · Your journey still saves'; });
window.addEventListener('online', () => { el('#offline-state').textContent = 'Your journey saves in this browser'; });
window.addEventListener('pagehide', persist);
el('#scene').addEventListener('graphicslost', () => { persist(); say('The graphics paused. Reload to continue your saved route.', true, 0); });
try {
  scene = new DepotScene(el('#scene'), game.state, selectBus); el('.loading').remove();
  scene.onHover = (bus: Bus | null) => {
    if (!busy && !modal) el('#scene').setAttribute('title', bus ? PALETTE[bus.color].name + ' bus · ' + bus.capacity + ' seats · Click to drive' : '');
  };
  sync(); let previous = performance.now();
  function frame(now: number) {
    const realDt = Math.min((now - previous) / 1000, .5); previous = now;
    if (!document.hidden) {
      const dt = realDt * (progress.fast ? 2 : 1); scene.update(dt);
      if (!modal) {
        boardingClock += dt;
        while (boardingClock >= .3 && !modal) {
          boardingClock -= .3; const result = game.boardNext();
          if (result) {
            scene.board(result.person, result.bus); tone('board');
            if (result.full) {
              tone('depart'); say(PALETTE[result.bus.color].name + ' is full. Next stop: home!');
              scene.departure(result.bus, () => { game.depart(result.bus.id); sync(); });
            }
            sync();
          } else if (game.state.phase !== lastPhase) sync();
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
} catch (error) {
  console.error('3D renderer could not start', error);
  el('#scene').innerHTML = '<div class="graphics-error">' + icon('bus') + '<h2>Your depot needs WebGL 2</h2><p>Enable hardware acceleration or try a browser with WebGL support, then reload. Your progress is saved.</p></div>';
}
