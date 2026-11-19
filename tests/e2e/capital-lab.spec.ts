import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { watchErrors } from './helpers';

// The diorama variant needs the KayKit packs (npm run candidates:fetch); skip it when absent.
const kaykit = existsSync('dev-assets/candidates/kaykit-medieval-hexagon') && existsSync('dev-assets/candidates/kaykit-space-base');

async function open(page: Page, query: string) {
  await page.goto(`/capitallab.html?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180_000 });
}

test('variant A (production) and B (new pipeline) render the sample capital without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'variant=a');
  await expect(page.locator('.cap-tag')).toHaveCount(14);
  await open(page, 'variant=b&quality=mobile');
  await expect(page.locator('.cap-tag')).toHaveCount(14);
  expect(errors).toEqual([]);
});

test('the diorama keeps plot selection: labels and 3D picks select the right plot', async ({ page }) => {
  test.skip(!kaykit, 'KayKit packs not fetched');
  const errors = watchErrors(page);
  await open(page, 'variant=c&quality=mobile');
  await expect(page.locator('.cap-tag')).toHaveCount(14);
  // clicking a label selects its plot
  const tag = page.locator('.cap-tag').nth(3);
  const plot = Number(await tag.getAttribute('data-plot'));
  await tag.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __labPick?: number }).__labPick)).toBe(plot);
  // clicking the 3D scene at a plot's position picks that plot
  const target = await page.evaluate(() => {
    const lab = (window as unknown as { __lab: { view: { plotScreen(p: number, l?: number): { x: number; y: number } } } }).__lab;
    return { plot: 0, ...lab.view.plotScreen(0) };
  });
  await page.locator('[data-testid="lab-canvas"]').click({ position: { x: target.x, y: target.y } });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __labPick?: number }).__labPick)).toBe(0);
  expect(errors).toEqual([]);
});

test('switching variants repeatedly releases each view without errors', async ({ page }) => {
  test.skip(!kaykit, 'KayKit packs not fetched');
  const errors = watchErrors(page);
  for (const v of ['c', 'b', 'c', 'a', 'c']) await open(page, `variant=${v}&quality=mobile`);
  expect(errors).toEqual([]);
});

test('disposing a view releases every GPU geometry and texture it held', async ({ page }) => {
  test.skip(!kaykit, 'KayKit packs not fetched');
  await open(page, 'variant=a');
  for (const v of ['b', 'c'] as const) {
    const r = await page.evaluate((x) => (window as unknown as { __labDisposeCheck(v: string): Promise<{ before: { geometries: number; textures: number }; after: { geometries: number; textures: number } }> }).__labDisposeCheck(x), v);
    expect(r.before.geometries).toBeGreaterThan(20);
    expect(r.after).toEqual({ geometries: 0, textures: 0 });
  }
});

test('visual regression: the diorama still renders as approved for review', async ({ page }) => {
  test.skip(!kaykit, 'KayKit packs not fetched');
  await page.setViewportSize({ width: 960, height: 600 });
  await open(page, 'variant=c&quality=mobile&still=1');
  await expect(page).toHaveScreenshot('diorama-mobile-tier.png', { maxDiffPixelRatio: 0.03, timeout: 60_000 });
});
