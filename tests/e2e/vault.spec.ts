import { test, expect } from '@playwright/test';
import { watchErrors, startReign, openScreen } from './helpers';

test('the Relic Vault: a draw spends a relic and reveals what was won', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  await openScreen(page, 'vault', 'Relic Vault');
  const win = page.locator('section.win[aria-label="Relic Vault"]');
  await expect(win.getByTestId('relic-count')).toHaveText('3');
  await win.getByRole('button', { name: 'Draw 1', exact: true }).click();
  await expect(win.getByTestId('relic-card')).toHaveCount(1);
  await expect(win.getByTestId('relic-count')).toHaveText('2');
  await page.evaluate(() => { const s = (window as any).__sd.getState(); s.game.empires[0].relics = 12; s.bump(); });
  await win.getByRole('button', { name: 'Draw 10', exact: true }).click();
  await expect(win.getByTestId('relic-card')).toHaveCount(10);
  // ten draws always include at least one epic or legendary
  await expect(win.locator('.relic-card.epic, .relic-card.legendary').first()).toBeVisible();
  await page.waitForTimeout(1800);
  if (process.env.SHOT) await page.screenshot({ path: '/tmp/claude-0/-home-user/36099148-197d-5dc2-ba5e-5fff2cbfd865/scratchpad/vault.png' });
  expect(errors).toEqual([]);
});
