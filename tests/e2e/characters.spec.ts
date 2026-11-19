import { test, expect } from '@playwright/test';
import { startReign, openScreen, watchErrors } from './helpers';

// The modular human kit renders in the Hall of Heroes, the throne room and the envoy panel.
test('heroes, the sovereign and rival rulers are shown with the human kit', async ({ page }, info) => {
  const errors = watchErrors(page);
  const kit: string[] = [];
  page.on('response', (r) => { if (/models\/chars2\/.+\.glb/.test(r.url()) && r.ok()) kit.push(r.url().split('/').pop()!); });
  await startReign(page);
  await openScreen(page, 'heroes', 'Hall of Heroes');
  await expect.poll(() => kit.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: info.outputPath('heroes.png') });
  await openScreen(page, 'throne', 'Throne room');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: info.outputPath('throne.png') });
  // meet every realm (explore the whole map) so the envoy panel can show a rival ruler
  await page.evaluate(() => {
    const sd = (window as unknown as { __sd: { getState(): { game: { playerId: number; empires: { explored: number[] }[]; galaxy: { systems: { id: number }[] } } } } }).__sd;
    const g = sd.getState().game;
    g.empires[g.playerId].explored = g.galaxy.systems.map((s) => s.id);
  });
  await openScreen(page, 'diplomacy', 'Diplomacy');
  await page.locator('.li').first().click();
  await expect(page.locator('canvas.rival-figure')).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: info.outputPath('diplomacy.png') });
  expect(kit).toContain('anims.glb');
  expect(kit.some((f) => f === 'male.glb' || f === 'female.glb')).toBe(true);
  expect(errors).toEqual([]);
});
