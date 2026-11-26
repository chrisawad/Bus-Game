import { test, expect } from '@playwright/test';
import { Game } from '../src/game';
import { yardForLevel } from '../src/yard';

test('plays Arrow Cube’s celebration only on a newly finished route', async ({ page }, info) => {
  const game = new Game(1, undefined, yardForLevel(1, { width: 10.5, height: 22 }), 41);
  for (const bus of [...game.state.buses].reverse().slice(0, -1)) {
    expect(game.dispatch(bus.id).type).toBe('drive'); game.arrive(bus.id);
    for (let wave = game.boardAvailable(); wave; wave = game.boardAvailable()) {
      for (const full of wave.fullBuses) game.depart(full.id);
    }
  }
  const save = { version: 7, active: game.state, completed: [], best: {}, sound: true, fast: true, winVoice: true };
  await page.addInitScript(save => {
    if (!localStorage.getItem('bus-jam-v1')) localStorage.setItem('bus-jam-v1', JSON.stringify(save));
    Object.defineProperty(navigator, 'standalone', { value: true });
    const log: string[] = []; Reflect.set(window, '__winSounds', log);
    const horn = OscillatorNode.prototype.setPeriodicWave, voice = AudioBufferSourceNode.prototype.start;
    OscillatorNode.prototype.setPeriodicWave = function(wave) { log.push('horn'); horn.call(this, wave); };
    AudioBufferSourceNode.prototype.start = function(...args) { log.push('voice'); voice.apply(this, args); };
  }, save);
  await page.goto('./');
  await expect(page.locator('#scene')).toHaveAttribute('aria-busy', 'false');
  const bus = page.locator('[data-status="yard"]');
  const point = await bus.evaluate(el => ({ x: +(el as HTMLElement).dataset.screenX!, y: +(el as HTMLElement).dataset.screenY! }));
  await page.locator('#scene canvas').click({ position: point });
  await expect(page.getByRole('heading', { name: 'You win!' })).toBeVisible();
  const canvas = page.locator('#win-confetti');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box!.x).toBeCloseTo(0); expect(box!.y).toBeCloseTo(0);
  expect(box!.width).toBeCloseTo(page.viewportSize()!.width); expect(box!.height).toBeCloseTo(page.viewportSize()!.height);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__winSounds'))).toEqual(['voice', ...Array(8).fill('horn')]);
  await page.screenshot({ path: 'test-results/' + info.project.name + '-celebration.png' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'You win!' })).toBeVisible();
  await expect(canvas).toBeHidden();
  expect(await page.evaluate(() => Reflect.get(window, '__winSounds'))).toEqual([]);
  await page.locator('[data-action="next"]').click();
  await expect(page.locator('#level-badge')).toHaveText('02');
});
