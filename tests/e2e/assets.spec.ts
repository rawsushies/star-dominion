import { test, expect } from '@playwright/test';
import { startReign, openScreen } from './helpers';

test('a model that fails to load is named to the player, not silently replaced', async ({ page }) => {
  await page.route('**/assets/models/chars/**', (r) => r.fulfill({ status: 404, body: 'missing' }));
  await startReign(page);
  await openScreen(page, 'heroes', 'Hall of Heroes');
  const notice = page.getByTestId('asset-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('could not be loaded');
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
});
