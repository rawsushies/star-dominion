import { test, expect } from '@playwright/test';
import { watchErrors, startReign, openScreen } from './helpers';

const SCREENS: [string, string][] = [
  ['throne', 'Throne room'], ['council', 'Royal council'], ['capital', 'Imperial capital'], ['heroes', 'Hall of Heroes'],
  ['warroom', 'War room'], ['operations', 'Resource operations'], ['chronicle', 'Chronicle of the reign'], ['kingdom', 'Kingdom overview'],
];

test('a new reign starts and every sovereign screen opens without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  for (const [id, title] of SCREENS) await openScreen(page, id, title);
  await expect(page.getByTestId('asset-notice')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the throne room lists matters that open their ministry', async ({ page }) => {
  await startReign(page);
  await openScreen(page, 'throne', 'Throne room');
  const first = page.getByTestId('matters').locator('.li').first();
  await expect(first).toBeVisible();
  await first.click();
  // the matter opens its ministry as the focused screen
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sd: { getState(): { screen: string } } }).__sd.getState().screen)).not.toBe('throne');
});

test('3D views can be opened and closed repeatedly', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  for (let i = 0; i < 4; i++) {
    await openScreen(page, 'capital', 'Imperial capital');
    await openScreen(page, 'heroes', 'Hall of Heroes');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  expect(errors.filter((e) => /context|WebGL/i.test(e))).toEqual([]);
});
