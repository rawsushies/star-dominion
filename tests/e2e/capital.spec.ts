import { test, expect, type Page } from '@playwright/test';
import { watchErrors, startReign, openScreen } from './helpers';

type Cap = { buildings: Record<string, { level: number; plot: number }>; queue: { building: string; plot: number }[] };
const capital = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as { __sd: { getState(): { game: { playerId: number; empires: { capital: Cap }[] } } } }).__sd.getState().game;
  return g.empires[g.playerId].capital;
});
const ui = (page: Page) => page.evaluate(() => { const s = (window as unknown as { __sd: { getState(): { view: string; capitalPlot: number | null } } }).__sd.getState(); return { view: s.view, plot: s.capitalPlot }; });

test('the capital fills the screen; its panels build, queue and cancel through the simulation', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  await openScreen(page, 'capital', 'Imperial capital');
  expect((await ui(page)).view).toBe('capital');
  // edge to edge: the city canvas covers the viewport beside the ministries column
  const box = await page.getByTestId('city').boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.width).toBeGreaterThan(vp.width - 80);
  expect(box!.height).toBeGreaterThan(vp.height - 10);
  await expect(page.locator('section.win[aria-label="Capital"]')).toHaveCount(0); // not a window
  // Build: the next free plot is selected and its build list offered
  await page.getByRole('toolbar', { name: 'Capital actions' }).getByRole('button', { name: 'Build' }).click();
  const panel = page.getByRole('complementary', { name: 'Capital panel' });
  await expect(panel.locator('h2')).toHaveText('An open plot');
  const plot = (await ui(page)).plot;
  expect(plot).not.toBeNull();
  await panel.getByTestId('cap-throne_hall').getByRole('button', { name: 'Build' }).click();
  let cap = await capital(page);
  expect(cap.queue.map((j) => [j.building, j.plot])).toContainEqual(['throne_hall', plot]);
  await expect(page.getByTestId('capital-job')).toHaveCount(1);
  // the queued building now owns the plot: the panel shows it, with its work in progress
  await expect(panel.locator('h2')).toContainText('Throne hall');
  await expect(panel).toContainText('Raising to level 1');
  await panel.getByRole('button', { name: 'Cancel' }).click();
  cap = await capital(page);
  expect(cap.queue).toHaveLength(0);
  // the Citadel's panel upgrades it
  await page.getByRole('toolbar', { name: 'Capital actions' }).getByRole('button', { name: 'Citadel' }).click();
  await expect(panel.locator('h2')).toHaveText('Citadel');
  await panel.getByTestId('capital-upgrade').click();
  cap = await capital(page);
  expect(cap.queue.map((j) => j.building)).toEqual(['citadel']);
  // other windows open over the city; Esc closes them first, then clears the selection, then leaves
  await openScreen(page, 'economy', 'Economy');
  await page.keyboard.press('Escape');
  expect((await ui(page)).view).toBe('capital');
  await page.keyboard.press('Escape');
  expect(await ui(page)).toEqual({ view: 'capital', plot: null });
  await page.keyboard.press('Escape');
  expect((await ui(page)).view).toBe('galaxy');
  expect(errors).toEqual([]);
});

test('on a phone the city has the screen and the panel opens as a bottom sheet on selection', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = watchErrors(page);
  await startReign(page);
  await openScreen(page, 'capital', 'Imperial capital');
  const panel = page.getByRole('complementary', { name: 'Capital panel' });
  await expect(panel).toHaveCount(0);
  await page.getByRole('toolbar', { name: 'Capital actions' }).getByRole('button', { name: 'Citadel' }).click();
  await expect(panel).toBeVisible();
  const b = (await panel.boundingBox())!;
  expect(b.y + b.height).toBeGreaterThan(844 - 20); // anchored to the bottom
  expect(b.height).toBeLessThan(844 * 0.5);
  expect(errors).toEqual([]);
  await page.close();
});
