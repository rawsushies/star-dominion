import { test, expect, devices } from '@playwright/test';
import { watchErrors } from './helpers';

// Chromium with a phone's viewport and touch (WebKit is not installed on the test machines).
const { defaultBrowserType: _b, ...phone } = devices['iPhone 13']; void _b;
test.use({ ...phone });

const inside = async (page: import('@playwright/test').Page, sel: string) => {
  const box = await page.locator(sel).first().boundingBox();
  const vw = page.viewportSize()!.width, vh = page.viewportSize()!.height;
  expect(box, sel).not.toBeNull();
  expect(box!.x, `${sel} left`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${sel} right`).toBeLessThanOrEqual(vw + 1);
  expect(box!.y + box!.height, `${sel} bottom`).toBeLessThanOrEqual(vh + 1);
};

test('on a phone the map, the lesson, the clock and a window all fit on screen', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: '30 systems' }).click();
  await page.getByRole('button', { name: 'Begin the reign' }).click();
  await page.waitForFunction(() => !!(window as unknown as { __sd?: { getState(): { game: unknown } } }).__sd?.getState().game);
  await inside(page, 'aside.lesson');
  await inside(page, '.dial-center');
  await inside(page, '[data-testid="quest"]');
  await page.locator('.dial-center').tap();
  await page.evaluate(() => (window as unknown as { __sd: { getState(): { openScreen(s: string): void } } }).__sd.getState().openScreen('planets'));
  await inside(page, 'section.win[aria-label="Planets"]');
  expect(errors).toEqual([]);
});
