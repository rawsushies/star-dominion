import { test, expect } from '@playwright/test';
import { watchErrors, startReign } from './helpers';

test('a victory ends the reign with a screen that says how it was won and lets the reign continue', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  await page.evaluate(async () => {
    const w = window as unknown as { __sd: { getState(): any }; __sdDev: { runDays(n: number): Promise<void> } };
    const g = w.__sd.getState().game;
    // hand the player most of the galaxy, as if conquered, and let the domination hold run out
    for (const s of g.galaxy.systems) if (s.owner == null || g.empires[s.owner].kind === 'major' && s.owner !== 0) s.owner = 0;
    for (const p of g.planets) if (p.colony && p.colony.ownerId === 0) p.colony.pops = 400;
    await w.__sdDev.runDays(31);
    g.empires[0].dominationSince = g.tick - 24 * 30;
    await w.__sdDev.runDays(31);
  });
  const modal = page.locator('.modal');
  await expect(modal).toContainText('Domination victory');
  await expect(page.getByTestId('gameover-why')).toContainText('How you won');
  await expect(page.getByTestId('gameover-why')).toContainText('of claimed systems');
  await modal.getByRole('button', { name: 'Continue ruling' }).click();
  await expect(modal).toHaveCount(0);
  expect(errors).toEqual([]);
});
