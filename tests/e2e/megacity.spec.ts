import { test, expect } from '@playwright/test';
import { watchErrors, startReign, openScreen } from './helpers';

// The megacity is heavy for SwiftShader (each frame takes about a second), so the browser's
// automatic choice here is the classic city; these tests choose the megacity explicitly.
test('automatic graphics fall back to the classic city in a software renderer', async ({ page }) => {
  await startReign(page);
  await openScreen(page, 'capital', 'Imperial capital');
  await expect(page.getByTestId('city')).toHaveAttribute('data-view', 'classic');
});

test('the megacity capital: labels pick plots, and switching back to the classic city releases it', async ({ page }) => {
  test.setTimeout(300_000);
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
