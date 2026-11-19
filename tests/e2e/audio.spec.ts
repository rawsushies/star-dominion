import { test, expect, type Page } from '@playwright/test';
import { watchErrors, startReign, openScreen } from './helpers';

type Dbg = { music: string | null; sections: number; scene: string | null; state: string; ctx: string | null; failed: string[] };
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __sdAudio: { debug(): Dbg } }).__sdAudio.debug());
const settings = (page: Page) => page.evaluate(() => (window as unknown as { __sdAudio: { audio: { settings: Record<string, number | boolean> } } }).__sdAudio.audio.settings);

test('audio starts only after a user gesture, follows the game and never duplicates', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  expect((await dbg(page)).ctx).toBeNull(); // autoplay rules: nothing before interaction
  await page.getByRole('button', { name: '30 systems' }).click();
  await expect.poll(async () => (await dbg(page)).ctx).toBe('running');
  expect((await dbg(page)).music).toBe('menu');
  await page.getByRole('button', { name: 'Begin the reign' }).click();
  await page.waitForFunction(() => !!(window as unknown as { __sd: { getState(): { game: unknown } } }).__sd.getState().game);
  await expect.poll(async () => (await dbg(page)).music).toBe('galaxy');
  expect((await dbg(page)).scene).toBe('space');
  // the capital: the city's ambience at once, its music after a short dwell
  await openScreen(page, 'capital', 'Imperial capital');
  await expect.poll(async () => (await dbg(page)).scene).toBe('city');
  await expect.poll(async () => (await dbg(page)).music, { timeout: 15_000 }).toBe('capital');
  // flick between windows many times: still one live music section and one ambience bed
  for (let i = 0; i < 6; i++) {
    await openScreen(page, 'diplomacy', 'Diplomacy');
    await openScreen(page, 'fleets', 'Fleet management');
    await page.keyboard.press('Escape');
  }
  const d = await dbg(page);
  expect(d.sections).toBeLessThanOrEqual(1);
  expect(d.failed).toEqual([]);
  expect(errors).toEqual([]);
});

test('volume controls, mute and persistence', async ({ page }) => {
  await startReign(page);
  await page.keyboard.press('F2');
  await page.getByRole('tab', { name: 'Settings' }).click();
  const panel = page.getByTestId('audio-settings');
  for (const [id, v] of [['vol-master', '60'], ['vol-music', '20'], ['vol-sfx', '90'], ['vol-ambient', '10']]) await panel.locator(`#${id}`).fill(v);
  expect(await settings(page)).toMatchObject({ master: 0.6, music: 0.2, sfx: 0.9, ambient: 0.1, muted: false });
  // global mute from the keyboard, and from the ministries column
  await page.locator('body').click({ position: { x: 700, y: 400 } });
  await page.keyboard.press('m');
  expect((await settings(page)).muted).toBe(true);
  await expect.poll(async () => (await dbg(page)).ctx).toBe('suspended'); // a muted mix stops processing
  await page.getByRole('button', { name: /Unmute sound/ }).first().click();
  expect((await settings(page)).muted).toBe(false);
  await expect.poll(async () => (await dbg(page)).ctx).toBe('running');
  // settings persist across a reload
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sd.audio.v1') ?? '{}'))).toMatchObject({ master: 0.6, music: 0.2, sfx: 0.9, ambient: 0.1 });
  expect(await settings(page)).toMatchObject({ master: 0.6, music: 0.2 });
});

test('missing audio files do not break the game', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route('**/assets/audio/**', (r) => r.fulfill({ status: 404, body: '' }));
  await startReign(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await openScreen(page, 'capital', 'Imperial capital');
  await openScreen(page, 'economy', 'Economy');
  await expect.poll(async () => (await dbg(page)).failed.length).toBeGreaterThan(0);
  expect((await dbg(page)).ctx).toBe('running'); // generative music and ambience continue
  // the game itself is unaffected
  expect(await page.evaluate(() => (window as unknown as { __sd: { getState(): { game: { tick: number } } } }).__sd.getState().game.tick)).toBeGreaterThan(0);
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
