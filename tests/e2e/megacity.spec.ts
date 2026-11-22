import { test, expect } from '@playwright/test';
import { watchErrors, startReign, openScreen } from './helpers';

// The megacity runs for minutes on SwiftShader and can leave the shared GPU process wedged, which
// made the *next* spec time out creating its browser context (CI, 2026-11-22). Distinct launch
// options give this file its own worker and browser process; later specs start a fresh one.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-shader-disk-cache'] } });

// The megacity is heavy for SwiftShader (each frame takes about a second), so the browser's
// automatic choice here is the classic city; these tests choose the megacity explicitly.
test('automatic graphics fall back to the classic city in a software renderer', async ({ page }) => {
  await startReign(page);
  await openScreen(page, 'capital', 'Imperial capital');
  await expect(page.getByTestId('city')).toHaveAttribute('data-view', 'classic');
});

test('the megacity capital: labels pick plots, and switching back to the classic city releases it', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await page.addInitScript(() => { if (!sessionStorage.getItem('gfx-set')) { localStorage.setItem('sd.graphics.v1', JSON.stringify({ capital: 'megacity', quality: 'mobile' })); sessionStorage.setItem('gfx-set', '1'); } });
  await startReign(page);
  await openScreen(page, 'capital', 'Imperial capital');
  await expect(page.getByTestId('city')).toHaveAttribute('data-view', 'megacity');
  // the kit loads, the city is built and every building carries a label
  await page.waitForFunction(() => {
    const v = (window as unknown as { __sdCapital?: { stats?(): { kitModels: number } } }).__sdCapital;
    return !!v?.stats && v.stats().kitModels >= 30;
  }, null, { timeout: 120_000 });
  // street life, the metro and the outer world are built from their sourced models
  await page.waitForFunction(() => { const st = (window as unknown as { __sdCapital: { stats(): { cars: number; walkers: number; trains: number } } }).__sdCapital.stats(); return st.cars > 0 && st.walkers > 0 && st.trains === 2; }, null, { timeout: 240_000, polling: 2000 });
  // a train brought to a station stops, and its platform-side door leaves slide open
  await page.evaluate(() => { const l = (window as unknown as { __sdCapital: { metro: { line: { trains: { x: number; speed: number; served: number | null }[] } } } }).__sdCapital.metro.line; l.trains[0].x = -8.6; l.trains[0].speed = 0.6; l.trains[0].served = null; });
  await page.waitForFunction(() => (window as unknown as { __sdCapital: { metro: { line: { trains: { doors: number }[] } } } }).__sdCapital.metro.line.trains[0].doors > 0.6, null, { timeout: 200_000, polling: 1000 });
  const moved = await page.evaluate(() => {
    const m = (window as unknown as { __sdCapital: { metro: { line: { trains: { speed: number }[] }; trains: { doors: { node: { position: { z: number } }; rest: { z: number }; side: string }[] }[][] } } }).__sdCapital.metro;
    const doors = m.trains[0][0].doors;
    return { speed: m.line.trains[0].speed, open: doors.filter((d) => d.side === 'L' && Math.abs(d.node.position.z - d.rest.z) > 0.2).length, closedOtherSide: doors.filter((d) => d.side === 'R').every((d) => Math.abs(d.node.position.z - d.rest.z) < 1e-6) };
  });
  expect(moved.speed).toBe(0);
  expect(moved.open).toBe(8);
  expect(moved.closedOtherSide).toBe(true);
  const tags = page.locator('.cap-overlay .cap-tag');
  await expect(tags.first()).toBeVisible({ timeout: 120_000 });
  // clicking a building's label selects its plot in the side panel
  const name = (await tags.first().getAttribute('title'))!;
  await tags.first().click();
  await expect(page.locator('.cap-panel h2', { hasText: name })).toBeVisible();
  // switch to the classic city from the Chancery; the view is rebuilt on a fresh canvas
  await page.getByRole('button', { name: /Chancery/ }).click();
  await page.getByLabel('Capital city').selectOption('classic');
  await expect(page.getByTestId('graphics-now')).toContainText('classic city');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByTestId('city')).toHaveAttribute('data-view', 'classic');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sd.graphics.v1') ?? '{}'))).toMatchObject({ capital: 'classic' });
  expect(errors).toEqual([]);
});
