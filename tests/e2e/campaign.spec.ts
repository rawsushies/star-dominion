import { test, expect, type Page } from '@playwright/test';
import { watchErrors, openScreen } from './helpers';

type W = { __sd: { getState(): { game: any; setSpeed?(n: number): void } }; __sdDev: { runDays(n: number): Promise<void>; raiseChain(d: string, p?: number | null): Promise<void> } };
const game = (page: Page) => page.evaluate(() => (window as unknown as W).__sd.getState().game);

test('a hard campaign: difficulty explained, ambitions and victory tracked, a chain answered and remembered across save and load', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: '30 systems' }).click();
  await page.getByRole('button', { name: 'Hard', exact: true }).click();
  await expect(page.getByTestId('difficulty-text')).toContainText('no hidden bonuses');
  await page.getByRole('button', { name: 'Begin the reign' }).click();
  await page.waitForFunction(() => !!(window as unknown as W).__sd?.getState().game);
  expect((await game(page)).settings.difficulty).toBe('hard');

  // three years of play: rivals form plans; ambitions and victory progress show in the throne room
  await page.evaluate(() => (window as unknown as W).__sdDev.runDays(360 * 3));
  const g = await game(page);
  const goals = g.empires.filter((e: any) => e.kind === 'major' && !e.isPlayer && e.alive).map((e: any) => e.aiPlan?.goal);
  expect(goals.every((x: string) => ['expand', 'develop', 'arm', 'war', 'recover', 'ascend'].includes(x))).toBe(true);
  await openScreen(page, 'throne', 'Throne room');
  await expect(page.getByTestId('ambitions').locator('.li').first()).toBeVisible();
  await expect(page.getByTestId('victory')).toContainText('Domination');
  await expect(page.getByTestId('victory')).toContainText('Supremacy');
  await expect(page.getByTestId('victory')).toContainText('Ascension');

  // an event chain comes before the council; the answer schedules its next stage
  await page.evaluate(() => (window as unknown as W).__sdDev.raiseChain('guild_charter'));
  await openScreen(page, 'council', 'Royal council');
  const matter = page.getByTestId('petition').filter({ hasText: 'The guilds offer a loan' });
  await expect(matter).toContainText('this will return to the council');
  await matter.getByRole('button', { name: 'Accept the loan' }).click();
  await expect.poll(async () => (await game(page)).empires[0].pendingChains?.[0]?.def).toBe('guild_due');

  // save, reload and load: the plan, the pending chain and the ambitions survive
  await page.getByRole('button', { name: /Chancery/ }).click();
  await page.getByLabel('Save name').fill('Campaign test');
  await page.getByRole('button', { name: 'Save game' }).click();
  await expect(page.getByText('Saved “Campaign test”.')).toBeVisible();
  const before = await game(page);
  await page.reload();
  await page.locator('.li', { hasText: 'Campaign test' }).first().click();
  await page.waitForFunction(() => !!(window as unknown as W).__sd.getState().game);
  const after = await game(page);
  expect(after.empires[0].pendingChains).toEqual(before.empires[0].pendingChains);
  expect(after.empires.map((e: any) => e.aiPlan?.goal)).toEqual(before.empires.map((e: any) => e.aiPlan?.goal));
  expect(after.empires[0].ambitions ?? []).toEqual(before.empires[0].ambitions ?? []);
  expect(errors).toEqual([]);
});
