import { test, expect, type Page } from '@playwright/test';
import { watchErrors, startReign, openScreen } from './helpers';

const scenario = (page: Page, what: string) => page.evaluate((w) => (window as unknown as { __sdDev: { expansion(w: string): Promise<void> } }).__sdDev.expansion(w), what);
const game = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as { __sd: { getState(): { game: any } } }).__sd.getState().game;
  return { session: g.expansion.conclave.session, history: g.expansion.conclave.history.length, founded: g.expansion.conclave.founded, stage: g.expansion.omega.stage, pressure: g.expansion.precursors.map((p: any) => p.pressure) };
});

test('the High Conclave window: table a motion and vote on it', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  await openScreen(page, 'conclave', 'High Conclave');
  await expect(page.getByTestId('conclave-unfounded')).toBeVisible();
  await scenario(page, 'conclave');
  await expect(page.getByTestId('conclave-members')).toBeVisible();
  const members = page.getByTestId('conclave-members').locator('tbody tr');
  expect(await members.count()).toBeGreaterThan(2);
  if (await page.getByTestId('motion-form').count()) {
    await page.getByTestId('motion-kind').selectOption('naval_accords');
    await page.getByTestId('table-motion').click();
    await expect(page.getByTestId('session')).toBeVisible();
    await page.getByTestId('vote-yea').click();
    await expect(page.getByTestId('conclave-note')).toContainText('Vote cast');
    expect((await game(page)).session).not.toBeNull();
  }
  await page.screenshot({ path: 'test-results/expansion-conclave.png' });
  expect(errors).toEqual([]);
});

test('the Ancients and threats window: powers, tribute, the Devourer and the Omega rift', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  await scenario(page, 'ancients');
  await openScreen(page, 'cosmos', 'Ancients and threats');
  await expect(page.getByTestId('power-veil')).toBeVisible();
  await expect(page.getByTestId('power-automata')).toContainText('Awakened');
  const before = (await game(page)).pressure[0];
  await page.getByTestId('tribute-veil').click();
  await expect(page.getByTestId('cosmos-note')).toBeVisible();
  const note = await page.getByTestId('cosmos-note').textContent();
  if (note?.startsWith('Tribute accepted')) expect((await game(page)).pressure[0]).toBeLessThan(before);
  await scenario(page, 'devourer');
  await expect(page.getByTestId('devourer')).toContainText('Next destination');
  await scenario(page, 'omega');
  await expect(page.getByTestId('omega')).toContainText('Integrity');
  expect(['rift', 'incursion']).toContain((await game(page)).stage);
  await page.screenshot({ path: 'test-results/expansion-cosmos.png' });
  // the map draws the rift and the Devourer
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/expansion-map.png' });
  expect(errors).toEqual([]);
});

test('emergent politics: an overture, a compact, motives, and the ancients\' regard', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  await scenario(page, 'politics');
  await openScreen(page, 'diplomacy', 'Diplomacy');
  await expect(page.getByTestId('overtures')).toBeVisible();
  const offer = page.getByTestId('offer-compact').first();
  await expect(offer).toContainText('Why they offer');
  await page.screenshot({ path: 'test-results/politics-overture.png' });
  await page.getByTestId('accept-compact').first().click();
  await expect(page.getByTestId('pacts')).toContainText('Compact');
  await expect(page.getByTestId('pacts')).toContainText('Automata Prime');
  const pacts = await page.evaluate(() => (window as unknown as { __sd: { getState(): { game: any } } }).__sd.getState().game.expansion.politics.pacts.map((p: any) => p.kind));
  expect(pacts).toContain('compact');
  await expect(page.getByTestId('motives')).toBeVisible();
  await page.screenshot({ path: 'test-results/politics-diplomacy.png' });
  await openScreen(page, 'cosmos', 'Ancients and threats');
  await expect(page.getByTestId('regard-automata')).toContainText('Respect');
  await expect(page.getByTestId('accord')).toBeVisible();
  await page.getByTestId('mediate').click();
  await page.screenshot({ path: 'test-results/politics-cosmos.png' });
  expect(errors).toEqual([]);
});
