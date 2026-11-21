import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Game, PALETTE, collisionFor, type Bus } from './game';
import { DepotScene } from './scene';
import { parkRoute, readParkedRoute, readSaveText, writeSave, type Save } from './storage';
import { createWinCelebration } from './celebration';
import { createWinAudio } from './win-audio';
import { fitYard } from './yard';
import { setupSettings } from './settings';
import { setupInstall, installInstructions } from './install';
import { prepareLevel } from './level-loader';
import { afterPaint } from './scheduling';

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
  cloud: '<path d="M7 18a5 5 0 1 1 0-10 7 7 0 0 1 13 2 4 4 0 0 1-1 8M9 16l2 2 4-4"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  speed: '<path d="m3 5 9 7-9 7V5Zm10 0 9 7-9 7V5Z"/>',
  settings: '<path d="m9 3 .6 2.2-2 .9L5.5 5 3 9.3l1.6 1.5v2.4L3 14.7 5.5 19l2.1-1.1 2 .9L10.2 21h4l.6-2.2 2-.9 2.1 1.1 2.5-4.3-1.6-1.5v-2.4l1.6-1.5L18.9 5l-2.1 1.1-2-.9L14.2 3H9Z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (name: string) => '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || '') + '</svg>';
const el = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const names = ['The morning shuffle', 'A colorful commute', 'Room for everyone', 'The scenic route', 'Rush-hour daydream', 'All aboard, again'];
function playArea() {
  const board = el('#scene').getBoundingClientRect();
  const overlaps = (box: DOMRect) => box.right > board.left && box.left < board.right && box.width > 0;
  const boxes = (selectors: string) => Array.from(document.querySelectorAll(selectors), node => node.getBoundingClientRect()).filter(overlaps);
  const top = Math.max(0, ...boxes('.brand, .level-header, #settings').map(box => box.bottom - board.top)) + 4;
  const bottom = Math.max(0, ...boxes('.control-bar, #install').map(box => board.bottom - box.top)) + 4;
  return { width: Math.max(1, board.width - 8), height: Math.max(1, board.height - top - bottom), centerOffset: (top - bottom) / 2 };
}
function currentYard() {
  const { width, height } = playArea();
  return fitYard(width, height);
}
const newCrowdSeed = () => Math.floor(Math.random() * 0x100000000);
let game: Game;
const progress: Omit<Save, 'active'> = { version: 7, completed: [], best: {}, sound: false, fast: false };
let scene: DepotScene;
let ready = false, transitioning = true;
let graphicsFailed = false;
let yardKey = '';
const clearExits = new Map<string, boolean>();
let boardingInProgress = false, boardingClock = 0, lastPhase = '';
let modal: 'help' | 'level' | 'retry' | 'won' | 'jammed' | 'install' | 'install-offer' | 'update' | null = null;
let messageTimer: ReturnType<typeof setTimeout>;
let audioContext: AudioContext | undefined;
let audioReady = false;
let updateAvailable: (() => void) | null = null;
let updatePrompted = false, installChecked = false, applyingUpdate = false;
let installPrompted = false;
try { installPrompted = sessionStorage.getItem('bus-jam-install-dismissed') === '1'; } catch { /* Session-only state is sufficient. */ }

el('#app').innerHTML = `
<div class="app-shell">
  <header class="site-header flex items-center justify-between">
    <a class="brand flex items-center gap-3" href="./" aria-label="Bus Jam home" title="Bus Jam">
      <span class="brand-mark">${icon('bus')}</span>
      <span>Bus <span class="brand-light">Jam</span><span class="brand-period">.</span></span>
    </a>
    <div class="header-actions flex items-center gap-2">
      <button class="icon-button settings-trigger" id="settings" type="button" popovertarget="settings-panel" aria-controls="settings-panel" aria-expanded="false" aria-label="Settings">${icon('settings')}</button>
    </div>
  </header>
  <main class="game-layout">
    <section class="play-column" aria-label="Bus puzzle">
      <div class="level-header flex items-center justify-between">
        <div class="flex items-center gap-3"><button class="level-badge" id="level-badge" type="button" aria-label="Change level" aria-haspopup="dialog" title="Change level">01</button>
          <div><div class="eyebrow level-eyebrow">LEVEL</div><h1 id="level-name"></h1></div>
        </div>
        <div class="level-stats flex items-center">
          <div><span class="stat-label">BUSES LEFT</span><strong id="buses-left"></strong></div>
          <span class="stat-divider"></span>
          <div><span class="stat-label">BOARDED</span><strong><span id="boarded">0</span><span class="stat-total" id="total"></span></strong></div>
        </div>
      </div>
      <div class="board-card">
        <span class="sr-only" id="stops-status"></span>
        <div id="scene" class="scene" aria-busy="true"></div>
        <div class="board-progress" role="progressbar" aria-label="Passengers boarded" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="progress-bar"></span></div>
      </div>
      <div class="status-strip" id="status-strip" hidden>
        <p id="status" role="status" aria-live="polite"></p>
      </div>
      <div class="control-bar flex items-center justify-between">
        <div class="flex items-center gap-2">
          <button class="tool-button" id="undo" type="button" disabled>${icon('undo')}<span>Undo</span><kbd>Z</kbd></button>
          <button class="tool-button restart-button" id="retry" type="button" aria-label="Restart route" title="Restart route (R)">${icon('reset')}<span>Restart</span></button>
        </div>
        <div class="flex items-center gap-2">
          <button class="hint-button" id="hint" type="button">${icon('hint')} Hint</button>
        </div>
      </div>
      <button class="install-button" id="install" type="button" aria-label="Install Bus Jam">${icon('download')} Install</button>
      <div class="play-footer"><span>${icon('check')} <span id="offline-state">Saved on this device</span></span>
      </div>
    </section>
  </main>
  <section class="settings-panel" id="settings-panel" popover="auto" aria-labelledby="settings-title">
    <div class="settings-heading"><h2 id="settings-title">Settings</h2><button class="icon-button" id="settings-close" type="button" aria-label="Close settings">${icon('close')}</button></div>
    <div class="settings-options">
      <button class="setting-row" id="sound" type="button" aria-label="Sound" aria-pressed="false" autofocus><span class="setting-icon">${icon('mute')}</span><span>Sound</span><span class="setting-value" id="sound-value">Off</span></button>
      <button class="setting-row" id="speed" type="button" aria-label="Double speed" aria-pressed="false"><span class="setting-icon">${icon('speed')}</span><span>Double speed</span><span class="setting-value" id="speed-value">1×</span></button>
      <button class="setting-row" id="win-voice" type="button" aria-label="You win voice" aria-pressed="false"><span class="setting-icon">${icon('sound')}</span><span>“You win!” voice</span><span class="setting-value" id="voice-value">Off</span></button>
      <button class="setting-row" id="choose-level" type="button" aria-haspopup="dialog"><span class="setting-icon">${icon('bus')}</span><span>Change level</span>${icon('arrow')}</button>
      <button class="setting-row" id="help" type="button"><span class="setting-icon">${icon('help')}</span><span>How to play</span>${icon('arrow')}</button>
      <button class="setting-row" id="update" type="button" hidden><span class="setting-icon">${icon('reset')}</span><span>Update available</span>${icon('arrow')}</button>
      <details class="keyboard-panel" id="keyboard-panel">
        <summary class="setting-row" aria-label="Bus list and keyboard controls"><span class="setting-icon">${icon('bus')}</span><span>Bus list</span>${icon('arrow')}</summary>
        <div class="bus-controls" id="bus-controls"></div>
      </details>
    </div>
    <p class="settings-saved" id="save-state">${icon('check')} Progress saved</p>
  </section>
  <dialog id="dialog" aria-labelledby="dialog-title"><canvas id="win-confetti" aria-hidden="true" hidden></canvas><button class="dialog-close icon-button" id="dialog-close" type="button" aria-label="Close dialog">${icon('close')}</button><div id="dialog-content"></div></dialog>
  <div class="route-loading" id="route-loading" role="status" aria-live="polite"><div class="route-loading-card"><span class="loading-bus">${icon('bus')}</span><strong id="loading-title">Opening the depot…</strong><span id="loading-detail">Getting your buses and passengers ready.</span><span class="loading-track" aria-hidden="true"></span><button class="dialog-primary" id="loading-reload" type="button" hidden>Reload game ${icon('reset')}</button></div></div>
</div>`;
// Some installed Android browsers report a layout viewport taller than the
// visible game window. Ignore pinch zoom so it can magnify the existing board.
function fitVisibleViewport() {
  const viewport = window.visualViewport;
  if (viewport && viewport.scale !== 1) return;
  const height = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
  if (height > 0) el('#app').style.setProperty('--visible-height', height + 'px');
}
fitVisibleViewport();
window.visualViewport?.addEventListener('resize', fitVisibleViewport);
window.addEventListener('resize', fitVisibleViewport);
window.addEventListener('pageshow', fitVisibleViewport);

const settings = setupSettings(el<HTMLButtonElement>('#settings'), el('#settings-panel'), el<HTMLButtonElement>('#settings-close'));
const confettiCanvas = el<HTMLCanvasElement>('#win-confetti');
const celebration = createWinCelebration(confettiCanvas);
const winAudio = createWinAudio();
function stopCelebration() {
  celebration.stop(); winAudio.stop(); confettiCanvas.hidden = true;
}
function setLoading(active: boolean, title = 'Opening the depot…', detail = 'Getting your buses and passengers ready.') {
  if (graphicsFailed && !active) return;
  transitioning = active;
  el('#loading-title').textContent = title; el('#loading-detail').textContent = detail;
  el('#route-loading').hidden = !active;
  el('#route-loading').setAttribute('role', 'status'); el('#route-loading').dataset.failed = 'false';
  el('#loading-reload').hidden = true; el('.loading-track').hidden = false;
  el('#scene').setAttribute('aria-busy', String(active));
  el('main').inert = active; el('header').inert = active;
}
function showFailure(title: string, detail: string) {
  settings.close(); closeDialog();
  setLoading(true, title, detail);
  graphicsFailed = true;
  el('#route-loading').setAttribute('role', 'alert'); el('#route-loading').dataset.failed = 'true';
  el('.loading-track').hidden = true; el('#loading-reload').hidden = false; el('#loading-reload').focus();
}
el('#loading-reload').addEventListener('click', () => location.reload());
setLoading(true);

function tone(kind: 'tap' | 'bump' | 'board' | 'depart' | 'win' | 'full') {
  if (!progress.sound || !audioReady) return;
  try {
    const context = audioContext ??= new AudioContext();
    void context.resume().catch(() => {});
    if (kind === 'win') {
      void winAudio.play(context, progress.winVoice === true).catch(() => {});
      return;
    }
    const now = context.currentTime;
    if (kind === 'full') {
      const notes = [
        { delay: 0, from: 392, to: 349, duration: .08 },
        { delay: .105, from: 294, to: 220, duration: .14 },
      ];
      for (const note of notes) {
        const oscillator = context.createOscillator(), gain = context.createGain();
        const start = now + note.delay, end = start + note.duration;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(note.from, start);
        oscillator.frequency.exponentialRampToValueAtTime(note.to, end);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.06, start + .006);
        gain.gain.exponentialRampToValueAtTime(.001, end - .008);
        gain.gain.linearRampToValueAtTime(0, end);
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(end);
      }
      return;
    }
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = kind === 'bump' ? 'triangle' : 'sine';
    const freq = { tap: 390, bump: 110, board: 640, depart: 440 }[kind];
    oscillator.frequency.setValueAtTime(freq, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'bump' ? 55 : freq * 1.4, now + .12);
    gain.gain.setValueAtTime(kind === 'board' ? .025 : .065, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + .18);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + .2);
  } catch { /* Play remains available without audio. */ }
}
function persist() {
  if (!game) return false;
  const ok = writeSave({ ...progress, active: game.state });
  el('#save-state').innerHTML = icon(ok ? 'check' : 'help') + (ok ? 'Progress saved' : 'Save unavailable');
  el('#save-state').title = ok ? 'Saved locally on this device' : 'Browser storage is unavailable. You can still play this session.';
  return ok;
}
function say(text: string, warning = false, duration = 4000) {
  clearTimeout(messageTimer); el('#status').textContent = text;
  el('#status-strip').hidden = false;
  el('#status-strip').classList.toggle('warning', warning);
  if (duration) messageTimer = setTimeout(() => {
    el('#status-strip').classList.remove('warning');
    el('#status').textContent = ''; el('#status-strip').hidden = true;
  }, duration);
}
function updateControls() {
  el<HTMLButtonElement>('#undo').disabled = !game.history.length;
  el('#sound .setting-icon').innerHTML = icon(progress.sound ? 'sound' : 'mute');
  el('#sound-value').textContent = progress.sound ? 'On' : 'Off';
  el('#sound').setAttribute('aria-pressed', String(progress.sound));
  el('#win-voice').setAttribute('aria-pressed', String(progress.winVoice === true));
  el('#voice-value').textContent = progress.winVoice ? 'On' : 'Off';
  el('#speed-value').textContent = progress.fast ? '2×' : '1×';
  el('#speed').setAttribute('aria-pressed', String(progress.fast));
}
function syncBusView(button: HTMLButtonElement, bus: Bus) {
  const direction = scene.screenDirection(bus.direction);
  const arrow = { N: '↑', NE: '↗', E: '→', SE: '↘', S: '↓', SW: '↙', W: '←', NW: '↖' }[direction];
  const heading = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' }[direction];
  const label = PALETTE[bus.color].symbol + ' ' + PALETTE[bus.color].name + ' ' + arrow + ' · ' +
    (bus.status === 'yard' ? bus.capacity + ' seats' : bus.filled + '/' + bus.capacity);
  if (button.textContent !== label) button.textContent = label;
  button.setAttribute('aria-label', PALETTE[bus.color].name + ' bus ' + (Number(bus.id.slice(4)) + 1) + ', facing ' +
    heading + ', ' + bus.capacity + ' seats, ' +
    (bus.status === 'yard' ? (clearExits.get(bus.id) ? 'clear exit' : 'blocked exit') : bus.status));
  const screen = scene.busScreenPosition(bus.id);
  if (screen) { button.dataset.screenX = String(screen.x); button.dataset.screenY = String(screen.y); }
}
function sync(celebrateWin = false) {
  scene.state = game.state; scene.dirty = true;
  const s = game.state;
  el('#scene').dataset.boarding = String(boardingInProgress);
  el('#scene').dataset.inTransit = String(s.buses.filter(bus => bus.status === 'arriving' || bus.status === 'leaving').length);
  el('#level-badge').textContent = String(s.level).padStart(2, '0'); el('#level-name').textContent = names[(s.level - 1) % names.length];
  el('#buses-left').textContent = String(game.remaining); el('#boarded').textContent = String(s.boarded); el('#total').textContent = ' / ' + s.totalPassengers;
  const percent = s.boarded / s.totalPassengers * 100;
  el('#progress-bar').style.width = percent + '%'; el('.board-progress').setAttribute('aria-valuenow', String(Math.round(percent)));
  el('#stops-status').textContent = game.availableStops.length + (game.availableStops.length === 1 ? ' stop open' : ' stops open');
  const controlBox = el('#bus-controls');
  const nextYardKey = [s.seed, s.yard.width, s.yard.height, ...s.buses.filter(bus => bus.status === 'yard').map(bus => bus.id)].join(':');
  if (nextYardKey !== yardKey) {
    yardKey = nextYardKey; clearExits.clear();
    for (const bus of s.buses) if (bus.status === 'yard') clearExits.set(bus.id, !collisionFor(bus, s.buses));
  }
  const waitingColors = new Set(s.queue.map(person => person.color));
  // Real HTML controls provide a keyboard/screen-reader alternative to WebGL.
  for (const bus of s.buses) {
    let button = controlBox.querySelector<HTMLButtonElement>('[data-bus-id="' + bus.id + '"]');
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.dataset.busId = bus.id;
      button.addEventListener('click', () => selectBus(bus.id)); controlBox.appendChild(button);
    }
    const clear = clearExits.get(bus.id) ?? false;
    button.dataset.clear = String(clear); button.dataset.matches = String(waitingColors.has(bus.color));
    button.dataset.status = bus.status; button.dataset.color = bus.color;
    button.style.setProperty('--bus-color', PALETTE[bus.color].hex);
    button.disabled = bus.status !== 'yard'; button.hidden = bus.status === 'gone';
    syncBusView(button, bus);
  }
  if (!boardingInProgress) scene.syncPeople();
  updateControls(); persist();
  if (s.phase !== lastPhase) {
    lastPhase = s.phase;
    if (s.phase === 'won') {
      if (!progress.completed.includes(s.level)) progress.completed.push(s.level);
      progress.best[s.level] = Math.min(progress.best[s.level] ?? Infinity, s.moves);
      persist(); showDialog('won');
      if (celebrateWin) {
        confettiCanvas.hidden = false; celebration.play(); tone('win');
      }
    } else if (s.phase === 'jammed') showDialog('jammed');
  }
}
function selectBus(id: string) {
  audioReady = true;
  if (!ready || transitioning || modal || game.state.phase !== 'playing') return;
  const bus = game.state.buses.find(bus => bus.id === id);
  const stops = game.availableStops;
  if (bus && stops.length && scene.bumping.has(id)) {
    if (collisionFor(bus, game.state.buses)) { say('That bus is still blocked. Clear the bus ahead first.', true); return; }
    scene.cancelBump(bus);
  }
  const plan = stops.length && bus?.status === 'yard' && !collisionFor(bus, game.state.buses) ? scene.planArrival(bus, stops) : undefined;
  const result = game.dispatch(id, plan?.dock);
  if (result.type === 'full') { tone('full'); say('All five stops are full. Wait for a bus to leave or use Undo.', true); return; }
  if (result.type === 'busy') { say('That bus is already on its way. Choose a bus in the jam.'); return; }
  if (result.type === 'bump') {
    tone('bump'); say('A little bump! Clear the ' + PALETTE[result.collision.blocker.color].name.toLowerCase() + ' bus ahead first.', true);
    scene.bump(result.bus, result.collision.distance, () => {
      try { navigator.vibrate?.(45); } catch { /* Haptics are optional on this device. */ }
    }, () => sync());
    persist(); return;
  }
  tone('tap'); el('#status-strip').hidden = true;
  scene.drive(result.bus, () => { game.arrive(id); sync(); }, plan?.points);
  sync();
}
async function doUndo() {
  if (!ready || transitioning) return;
  if (!game.undo()) { say('Your first move is still ahead of you.'); return; }
  transitioning = true;
  const notice = setTimeout(() => setLoading(true, 'Rewinding your last move…', 'Putting your buses and passengers back.'), 120);
  closeDialog(); boardingInProgress = false; boardingClock = 0; lastPhase = '';
  try {
    await scene.reset(game.state); sync(); say('A little rewind. Try a different bus.');
  } finally { clearTimeout(notice); setLoading(false); }
}
async function restart(level = game.state.level, switchLevel = false, yardBeforeKeyboard?: ReturnType<typeof currentYard>) {
  if (!ready || transitioning) return;
  if (switchLevel && level === game.state.level) { closeDialog(); return; }
  if (level !== game.state.level) parkRoute({ ...progress, active: game.state });
  closeDialog(); boardingInProgress = false; boardingClock = 0; lastPhase = '';
  settings.close(); setLoading(true, 'Making room for a fresh start…', 'Arranging the jam and shuffling both queues.');
  try {
    await afterPaint();
    const options = { level, yard: yardBeforeKeyboard ?? currentYard(), crowdSeed: newCrowdSeed() };
    const { state } = await prepareLevel(switchLevel || level !== game.state.level
      ? { ...options, type: 'load', raw: readParkedRoute(level) } : { ...options, type: 'level' });
    game = new Game(level, state); await scene.reset(game.state); el('#bus-controls').innerHTML = '';
    sync(); scene.update(0); await afterPaint(); say('A fresh start. Find a bus with a clear exit.');
  } catch (error) {
    console.error('Could not restart the route', error);
    say('This route could not be prepared. Please try Restart again.', true, 0);
  } finally { setLoading(false); }
}
function showDialog(kind: NonNullable<typeof modal>) {
  settings.close();
  const dialog = el<HTMLDialogElement>('#dialog');
  if (dialog.open) closeDialog();
  modal = kind;
  const content = el('#dialog-content'); el('#dialog-close').hidden = kind === 'jammed' || kind === 'won';
  if (kind === 'level') {
    // Measure the play area before focusing the number field opens a phone keyboard.
    const yard = currentYard(), shellWidth = el('.app-shell').clientWidth;
    content.innerHTML = '<h2 id="dialog-title">Change level</h2><form id="level-form">' +
      '<label for="level-number">Level number</label><input id="level-number" name="level" type="number" inputmode="numeric" min="1" max="9999" step="1" required autofocus>' +
      '<button type="submit" class="dialog-primary">Play level</button>' +
      '<button type="button" class="dialog-secondary" data-action="close">Cancel</button></form>';
    const input = el<HTMLInputElement>('#level-number'); input.valueAsNumber = game.state.level;
    el('#level-form').addEventListener('submit', event => {
      event.preventDefault(); void restart(input.valueAsNumber, true, shellWidth === el('.app-shell').clientWidth ? yard : undefined);
    });
  } else if (kind === 'help') {
    content.innerHTML = '<div class="dialog-emblem">' + icon('bus') + '</div><div class="eyebrow">WELCOME TO THE DEPOT</div><h2 id="dialog-title">A busload of possibility.</h2>' +
      '<p>Clear every bus to finish your route. Here’s how:</p><ol class="help-rules">' +
      '<li><strong>Follow the arrow.</strong> Tap a bus to drive forward. If another bus blocks it, it bumps and returns to its spot.</li>' +
      '<li><strong>Pick your colors.</strong> A clear bus circles the border into a free stop. All five stops are always unlocked.</li>' +
      '<li><strong>Match the whole middle.</strong> Anyone in the middle group can board a bus of their color. Matching passengers move together, then both side lines alternate to fill all the empty spaces.</li>' +
      '<li><strong>Fill it and free it.</strong> A full bus drives off and opens its stop. You win when every bus is gone.</li></ol>' +
      '<p class="help-note">Send several clear buses in quick succession. Stops are reserved immediately, and buses share the border road. Undo and hints are always available.</p>' +
      '<button class="dialog-primary" data-action="close">Let’s roll ' + icon('arrow') + '</button>';
  } else if (kind === 'retry') {
    content.innerHTML = '<div class="dialog-emblem">' + icon('reset') + '</div><div class="eyebrow">A FRESH PERSPECTIVE</div><h2 id="dialog-title">Take it from the top?</h2>' +
      '<p>Restart this route with all buses and passengers back in place. Your completed routes stay saved.</p>' +
      '<button class="dialog-primary" data-action="restart">Restart route ' + icon('reset') + '</button><button class="dialog-secondary" data-action="close">Keep playing</button>';
  } else if (kind === 'jammed') {
    content.innerHTML = '<div class="dialog-emblem warm">' + icon('people') + '</div><div class="eyebrow">A LITTLE TRAFFIC JAM</div><h2 id="dialog-title">Time for a little rewind.</h2>' +
      '<p>All five stops are occupied, and nobody in the middle matches those buses. Undo a dispatch to make room for another color.</p>' +
      '<button class="dialog-primary" data-action="undo">Undo last dispatch ' + icon('undo') + '</button><button class="dialog-secondary" data-action="restart">Try this route again</button>';
  } else if (kind === 'install') {
    content.innerHTML = '<div class="dialog-emblem">' + icon('download') + '</div><h2 id="dialog-title">Install Bus Jam</h2>' +
      installInstructions() + '<button class="dialog-primary" data-action="close">Got it ' + icon('check') + '</button>';
  } else if (kind === 'install-offer') {
    content.innerHTML = '<div class="dialog-emblem">' + icon('download') + '</div><h2 id="dialog-title">Take Bus Jam with you</h2>' +
      '<p>Add Bus Jam to your home screen for full-screen puzzles and offline play.</p>' +
      '<button class="dialog-primary" data-action="install" autofocus>Install Bus Jam ' + icon('download') + '</button>' +
      '<button class="dialog-secondary" data-action="close">Not now</button>';
  } else if (kind === 'update') {
    content.innerHTML = '<div class="dialog-emblem">' + icon('reset') + '</div><h2 id="dialog-title">A new version is ready</h2>' +
      '<p>Update Bus Jam to get the latest changes. Your progress will be saved before reloading.</p>' +
      '<button class="dialog-primary" data-action="update" autofocus>Update now ' + icon('reset') + '</button>' +
      '<button class="dialog-secondary" data-action="close">Later</button>';
  } else {
    content.innerHTML = '<div class="win-mark" aria-hidden="true"><svg viewBox="0 0 80 80" width="80" height="80"><path d="M23 15H12v10c0 11 8 17 18 17m27-27h11v10c0 11-8 17-18 17" fill="none" stroke="#d99b24" stroke-width="6" stroke-linecap="round"/><path d="M23 10h34v23c0 12-8 21-17 21s-17-9-17-21Z" fill="#ffcf48" stroke="#dda227" stroke-width="3"/><path d="M40 54v12m-13 4h26" fill="none" stroke="#d99b24" stroke-width="7" stroke-linecap="round"/><path d="m40 19 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="#fff6c2"/></svg></div>' +
      '<div class="eyebrow">Level ' + game.state.level + ' complete</div><h2 id="dialog-title">You win!</h2>' +
      '<div class="win-stats"><span><strong>' + game.state.buses.length + '</strong>buses cleared</span><span><strong>' + game.state.boarded +
      '</strong>happy passengers</span><span><strong>' + game.state.bumps + '</strong>' + (game.state.bumps === 1 ? 'bump' : 'bumps') + '</span></div>' +
      (game.state.level < 9999 ? '<button class="dialog-primary" data-action="next" autofocus>On to route ' + (game.state.level + 1) + ' ' + icon('arrow') + '</button>' : '') +
      '<button class="dialog-secondary" data-action="restart">Play this one again</button>';
  }
  content.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'close') closeDialog(); if (action === 'restart') restart(); if (action === 'next') restart(game.state.level + 1); if (action === 'undo') doUndo();
    if (action === 'install') { closeDialog(); void installFlow.request(); }
    if (action === 'update' && !applyingUpdate) {
      if (!persist()) {
        content.querySelector('p')!.textContent = 'Your progress could not be saved. Keep playing, or try saving again before updating.';
        button.textContent = 'Try saving again'; return;
      }
      applyingUpdate = true; button.textContent = 'Updating…'; button.setAttribute('aria-disabled', 'true'); updateAvailable?.();
    }
  }));
  dialog.showModal();
}
function closeDialog() { stopCelebration(); el<HTMLDialogElement>('#dialog').close(); modal = null; }
el('#dialog').addEventListener('close', () => { if (!el<HTMLDialogElement>('#dialog').open) { stopCelebration(); modal = null; } });
el('#dialog-close').addEventListener('click', closeDialog);
el<HTMLDialogElement>('#dialog').addEventListener('cancel', event => {
  if (modal === 'jammed' || modal === 'won') event.preventDefault(); else modal = null;
});
el('#help').addEventListener('click', () => showDialog('help')); el('#retry').addEventListener('click', () => showDialog('retry'));
for (const id of ['#level-badge', '#choose-level']) el(id).addEventListener('click', () => showDialog('level'));
el('#undo').addEventListener('click', doUndo);
el('#hint').addEventListener('click', () => {
  const bus = game.hint();
  if (bus) {
    scene.hint(bus.id);
    el('#bus-controls').querySelectorAll('.hinted').forEach(button => button.classList.remove('hinted'));
    el<HTMLButtonElement>('[data-bus-id="' + bus.id + '"]')?.classList.add('hinted');
    say('Look for the glowing ' + PALETTE[bus.color].name.toLowerCase() + ' bus. Its road is clear.');
  } else say('Let the stops empty, or undo a dispatch to make room.', true);
});
el('#sound').addEventListener('click', () => { audioReady = true; progress.sound = !progress.sound; tone('tap'); updateControls(); persist(); });
el('#win-voice').addEventListener('click', () => { progress.winVoice = !progress.winVoice; updateControls(); persist(); });
el('#speed').addEventListener('click', () => { progress.fast = !progress.fast; updateControls(); persist(); });
window.addEventListener('keydown', event => {
  if (!ready || transitioning || modal || settings.isOpen() || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)) return;
  const key = event.key.toLowerCase();
  if (key === 'z') { event.preventDefault(); doUndo(); } if (key === 'h') el<HTMLButtonElement>('#hint').click(); if (key === 'r') showDialog('retry');
});
const installFlow = setupInstall(el<HTMLButtonElement>('#install'), () => showDialog('install'), message => say(message), () => el('#settings').focus(), () => {
  if (modal === 'install-offer' || modal === 'install') closeDialog();
});
void installFlow.ready.then(() => { installChecked = true; });
function showPendingNotice() {
  if (!ready || transitioning || modal || applyingUpdate || settings.isOpen() || game.state.phase !== 'playing') return;
  if (updateAvailable && !updatePrompted) { updatePrompted = true; showDialog('update'); return; }
  if (installChecked && !installPrompted && !installFlow.isInstalled()) {
    installPrompted = true;
    try { sessionStorage.setItem('bus-jam-install-dismissed', '1'); } catch { /* Keep the offer once per page if storage is unavailable. */ }
    showDialog('install-offer');
  }
}
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { updatePrompted = false; updateAvailable = () => void updateSW(true); el('#update').hidden = false; },
  onRegisteredSW(_url, registration) {
    const check = () => { if (registration && navigator.onLine && !document.hidden) void registration.update().catch(() => {}); };
    window.addEventListener('focus', check); window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    setInterval(check, 5 * 60 * 1000);
  },
  onOfflineReady() { el('#offline-state').textContent = 'Offline ready · Saved on this device'; },
  onRegisterError(error) { console.warn('Offline support could not start.', error); },
});
el('#update').addEventListener('click', () => showDialog('update'));
window.addEventListener('offline', () => { el('#offline-state').textContent = 'Playing offline · Progress saved'; });
window.addEventListener('online', () => { el('#offline-state').textContent = 'Saved on this device'; });
window.addEventListener('pagehide', () => { stopCelebration(); persist(); });
el('#scene').addEventListener('graphicslost', () => {
  const saved = persist();
  showFailure('The graphics paused', saved ? 'Your route is saved. Reload to continue where you left off.' : 'Reload to restore the graphics. Browser storage is unavailable, so unsaved moves will be lost.');
});
async function boot() {
try {
  await afterPaint();
  const { saved, state } = await prepareLevel({ type: 'load', raw: readSaveText(), yard: currentYard(), crowdSeed: newCrowdSeed() });
  if (saved) Object.assign(progress, { completed: saved.completed, best: saved.best, sound: saved.sound, fast: saved.fast, winVoice: saved.winVoice === true });
  game = new Game(state.level, state);
  scene = new DepotScene(el('#scene'), game.state, selectBus, playArea);
  for (const selector of ['.site-header', '.level-header', '.control-bar', '#install']) scene.resizeObserver.observe(el(selector));
  await scene.reset(game.state);
  scene.onViewSettled = () => {
    if (transitioning) return;
    for (const bus of game.state.buses) {
      const button = el<HTMLButtonElement>('[data-bus-id="' + bus.id + '"]');
      if (button) syncBusView(button, bus);
    }
  };
  scene.onHover = (bus: Bus | null) => {
    if (!modal) el('#scene').setAttribute('title', bus ? PALETTE[bus.color].name + ' bus · ' + bus.capacity + ' seats · Click to drive' : '');
  };
  sync();
  scene.renderer.domElement.hidden = false;
  scene.update(0); await afterPaint(); ready = true; setLoading(false);
  if (saved?.migrated) say('Your completed routes are saved. This route now has shuffled lines and a smaller middle group.', false, 6000);
  let previous = performance.now();
  function frame(now: number) {
    const realDt = Math.min((now - previous) / 1000, .5); previous = now;
    if (!document.hidden) {
      const dt = realDt * (progress.fast ? 2 : 1);
      if (!transitioning) {
        scene.advanceView(now);
        if (!modal || modal === 'won') scene.update(dt);
        else if (scene.dirty) scene.render();
      }
      showPendingNotice();
      if (!transitioning && !modal && !boardingInProgress) {
        boardingClock += dt;
        if (boardingClock >= .15) {
          boardingClock = 0;
          const wave = game.boardAvailable();
          if (wave) {
            boardingInProgress = true;
            el('#scene').dataset.boarders = String(wave.boardings.length);
            wave.boardings.forEach(({ person, bus }, i) => scene.board(person, bus, i));
            tone('board');
            scene.animate(1.05, () => {}, () => {
              boardingInProgress = false; boardingClock = -.65;
              // Reveal the whole refill after the previous group has boarded.
              for (const bus of wave.fullBuses) scene.departure(bus, () => { game.depart(bus.id); sync(true); });
              if (wave.fullBuses.length) tone('depart');
              sync();
            });
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
  showFailure('The depot could not open', 'Try reloading. If this keeps happening, check that hardware acceleration and WebGL 2 are enabled in your browser.');
}
}
void boot();
