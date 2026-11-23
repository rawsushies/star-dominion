import { test, expect, type Page } from '@playwright/test';
import { watchErrors, openScreen } from './helpers';

// The living galaxy in the running game: after decades of autonomous play the map shows
// merchant convoys, settled systems by condition, fleets and couriers, all from simulation state.

const life = (page: Page) => page.evaluate(() => (window as unknown as { __sdLife: Record<string, number> }).__sdLife);
const sim = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as { __sd: { getState(): { game: any } } }).__sd.getState().game;
  return { routes: g.life.routes.length, history: g.life.history.length, migrations: g.life.migrations.length, year: Math.floor(g.tick / 360), conds: g.planets.filter((p: any) => p.colony).map((p: any) => p.colony.prosperity) };
});
/** frame the capital with the camera at `frac` of the galaxy's radius */
async function cam(page: Page, frac: number, pitch = 0.95) {
  await page.evaluate(([f, p]) => {
    const w = window as unknown as { __sdCam: { dist: number; pitch: number; tx: number; ty: number }; __sd: { getState(): { game: any } } };
    const g = w.__sd.getState().game;
    const c = g.galaxy.systems[g.empires[g.playerId].capitalSystemId];
    const R = g.galaxy.shape?.R ?? (g.galaxy.width - 160) / 2;
    Object.assign(w.__sdCam, { dist: R * f, pitch: p, tx: f > 1.5 ? g.galaxy.width / 2 : c.x, ty: f > 1.5 ? g.galaxy.height / 2 : c.y });
  }, [frac, pitch] as const);
  await page.mouse.move(700, 450);
  await page.waitForTimeout(900);
}

test('the living galaxy: decades of autonomous history are visible on the map and in the chronicle', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: '60 systems' }).click();
  await page.getByRole('button', { name: 'Begin the reign' }).click();
  await page.waitForFunction(() => !!(window as unknown as { __sd?: { getState(): { game: unknown } } }).__sd?.getState().game);
  await page.evaluate(() => (window as unknown as { __sdDev: { autopilot(d: number): Promise<void> } }).__sdDev.autopilot(360 * 25));
  // acknowledge the era reached during the decades skipped, so the map is not covered
  await page.evaluate(() => { const st = (window as any).__sd.getState(); st.set({ eraSeen: st.game.empires[st.game.playerId].era, windows: [], toasts: [] }); });
  const s = await sim(page);
  expect(s.year).toBeGreaterThanOrEqual(25);
  expect(s.routes).toBeGreaterThan(5);
  expect(s.history).toBeGreaterThan(3);
  // run the clock so convoys move between days
  await page.evaluate(() => (window as unknown as { __sd: { getState(): { setSpeed(n: number): void } } }).__sd.getState().setSpeed(1));
  await cam(page, 0.22);
  await expect.poll(async () => (await life(page)).convoys).toBeGreaterThan(0);
  await expect.poll(async () => (await life(page)).routes).toBeGreaterThan(0);
  console.log('drawn', JSON.stringify(await life(page)));
  await page.screenshot({ path: 'test-results/life-sector.png' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/life-sector-later.png' });
  await cam(page, 0.6, 1.0);
  await page.screenshot({ path: 'test-results/life-region.png' });
  await cam(page, 2.3, 1.1);
  await page.screenshot({ path: 'test-results/life-galaxy.png' });
  await page.evaluate(() => (window as unknown as { __sd: { getState(): { setSpeed(n: number): void } } }).__sd.getState().setSpeed(0));
  // the capital's system and world
  await page.evaluate(() => {
    const st = (window as unknown as { __sd: { getState(): any } }).__sd.getState();
    const g = st.game;
    st.set({ view: 'system', systemId: g.empires[g.playerId].capitalSystemId });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/life-system.png' });
  await page.evaluate(() => {
    const st = (window as unknown as { __sd: { getState(): any } }).__sd.getState();
    const g = st.game;
    st.set({ view: 'planet', planetId: g.empires[g.playerId].capitalPlanetId });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/life-planet.png' });
  await openScreen(page, 'chronicle', 'Chronicle of the reign');
  await expect(page.getByTestId('galactic-history')).toBeVisible();
  await expect(page.getByTestId('realm-arcs')).toBeVisible();
  await page.screenshot({ path: 'test-results/life-chronicle.png', fullPage: true });
  await openScreen(page, 'trade', 'Trade routes');
  await expect(page.getByTestId('merchant-routes')).toBeVisible();
  await page.screenshot({ path: 'test-results/life-trade.png' });
  expect(errors).toEqual([]);
});
