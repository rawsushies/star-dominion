import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';

// The comparison gallery renders third-party candidate packs that are fetched on demand
// (npm run candidates:fetch); skip when they are not present.
const fetched = existsSync('dev-assets/candidates');

for (const cat of ['capital', 'ships', 'heroes', 'villains']) {
  test(`comparison gallery renders every ${cat} candidate set`, async ({ page }) => {
    test.skip(!fetched, 'candidate packs not fetched');
    await page.goto(`/compare.html?cat=${cat}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120_000 });
    expect(await page.evaluate(() => document.body.dataset.errors)).toBe('0');
    await expect(page.locator('#sets .set').first()).toBeVisible();
    await expect(page.locator('#sets .badge.external').first()).toBeVisible();
  });
}
