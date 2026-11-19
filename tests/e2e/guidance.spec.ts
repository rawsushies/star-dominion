import { test, expect, type Page } from '@playwright/test';
import { watchErrors, startReign, openScreen } from './helpers';

type G = { guidance?: { active: string | null; step: number; done: string[]; paused: boolean; seen: string[] } };
const guidance = (page: Page) => page.evaluate(() => (window as unknown as { __sd: { getState(): { game: G } } }).__sd.getState().game.guidance ?? null);
const lesson = (page: Page) => page.getByRole('complementary', { name: 'Lesson' });

test('a new player completes the first lesson by doing what it asks, and progress survives save and reload', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page); // "Guided first reign" is on by default
  await expect(lesson(page)).toContainText('You are the sovereign');
  await lesson(page).getByRole('button', { name: 'Continue' }).click();
  // the time step only completes once time has actually run and been paused
  await expect(lesson(page)).toContainText('Command the flow of time');
  await expect(page.getByTestId('lesson-goal')).not.toHaveClass(/met/);
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  await page.keyboard.press('Space');
  await expect(lesson(page)).toContainText('Read the treasury');
  await lesson(page).getByRole('button', { name: 'Continue' }).click();
  // open the Codex from the ministries column
  await page.locator('.neo-btn[aria-label="Imperial Codex"]').click();
  await expect(lesson(page)).toContainText('Your agenda');
  await lesson(page).getByRole('button', { name: 'Finish lesson' }).click();
  expect((await guidance(page))!.done).toContain('welcome');
  // the next lesson is offered, not forced
  const offer = page.getByRole('complementary', { name: 'Lesson available' });
  await expect(offer).toContainText('Understanding the Galaxy');
  await offer.getByRole('button', { name: 'Start lesson' }).click();
  await expect(lesson(page)).toContainText('Move around the map');
  await lesson(page).getByRole('button', { name: 'Continue' }).click();

  // save through the Chancery, reload the page, load the save from the title screen
  await page.getByRole('button', { name: /Chancery/ }).click();
  await page.getByLabel('Save name').fill('Guided test');
  await page.getByRole('button', { name: 'Save game' }).click();
  await expect(page.getByText('Saved “Guided test”.')).toBeVisible();
  await page.reload();
  await page.locator('.li', { hasText: 'Guided test' }).first().click();
  await page.waitForFunction(() => !!(window as unknown as { __sd: { getState(): { game: unknown } } }).__sd.getState().game);
  const g = await guidance(page);
  expect(g!.done).toContain('welcome');
  expect(g!.active).toBe('galaxy');
  expect(g!.step).toBe(1);
  await expect(lesson(page)).toContainText('Select a system');
  expect(errors).toEqual([]);
});

test('every lesson can be started, paused, resumed, left and replayed from the Codex', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  await lesson(page).getByRole('button', { name: 'Leave the lesson' }).click();
  await page.keyboard.press('F2');
  await page.getByRole('tab', { name: 'Lessons' }).click();
  const rows = page.getByTestId('lesson-list').locator('.lesson-li');
  await expect(rows).toHaveCount(10);
  const titles = await rows.locator('b').allTextContents();
  for (let i = 0; i < titles.length; i++) {
    await rows.nth(i).getByRole('button', { name: /Start|Restart|Replay/ }).click();
    await expect(lesson(page)).toContainText(`Lesson ${i + 1}: ${titles[i]}`);
    // walk to the end with Continue / Skip step
    for (let k = 0; k < 8; k++) {
      const fin = lesson(page).getByRole('button', { name: 'Finish lesson' });
      if (await fin.isVisible()) { await fin.click(); break; }
      await lesson(page).getByRole('button', { name: /Continue|Skip step/ }).click();
    }
    await expect(rows.nth(i)).toContainText('Completed');
  }
  // pause and resume, then replay a finished lesson
  await rows.nth(2).getByRole('button', { name: 'Replay' }).click();
  await lesson(page).getByRole('button', { name: 'Pause the lesson' }).click();
  await expect(page.getByRole('button', { name: /Resume lesson/ })).toBeVisible();
  await page.getByRole('button', { name: /Resume lesson/ }).click();
  await expect(lesson(page)).toContainText('The Imperial Capital');
  expect(errors).toEqual([]);
});

test('Codex search and navigation reach entries, related entries and game screens', async ({ page }) => {
  await startReign(page);
  await page.keyboard.press('F2');
  await page.getByRole('tab', { name: 'Encyclopedia' }).click();
  await page.getByLabel('Search the Codex').fill('kardashev');
  await page.getByTestId('codex-results').locator('.codex-li').first().click();
  const entry = page.getByTestId('codex-entry');
  await expect(entry.locator('h2')).toHaveText('The Kardashev scale');
  await expect(entry).toContainText('log₁₀');
  await entry.getByRole('button', { name: 'Political eras' }).click();
  await expect(entry.locator('h2')).toHaveText('Political eras');
  await entry.getByRole('button', { name: 'Open Kingdom' }).click();
  await expect(page.locator('section.win[aria-label="Kingdom"]')).toBeVisible();
  // generated catalogue entries carry the game's own numbers
  await page.keyboard.press('F2');
  await page.getByLabel('Search the Codex').fill('residential district');
  await page.getByTestId('codex-results').locator('.codex-li', { hasText: 'Residential District' }).click();
  await expect(entry).toContainText('80 minerals, 30 credits');
});

test('windows explain themselves: first-visit card and information drawer', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  await lesson(page).getByRole('button', { name: 'Leave the lesson' }).click();
  for (const [id, label, title] of [['economy', 'Economy', 'Economy'], ['council', 'Council', 'Royal council'], ['fleets', 'Fleets', 'Fleet management'], ['heroes', 'Hall of Heroes', 'Hall of Heroes']]) {
    await openScreen(page, id, title);
    const win = page.locator(`section.win[aria-label="${label}"]`);
    await expect(win.locator('.first-visit')).toBeVisible();
    await win.locator('.first-visit').getByRole('button', { name: 'Got it' }).click();
    await expect(win.locator('.first-visit')).toHaveCount(0);
    await win.getByRole('button', { name: 'About this window' }).click();
    await expect(win.getByRole('region', { name: /About/ })).toContainText(title);
    await win.getByRole('button', { name: 'Close the explanation' }).click();
  }
  // a card seen once is not shown again
  await page.keyboard.press('Escape');
  await openScreen(page, 'economy', 'Economy');
  await expect(page.locator('section.win[aria-label="Economy"] .first-visit')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('advisor hints reflect real conditions and lead to the fix; guidance can be turned off', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '30 systems' }).click();
  await page.locator('label.guided input').uncheck();
  await page.getByRole('button', { name: 'Begin the reign' }).click();
  await page.waitForFunction(() => !!(window as unknown as { __sd: { getState(): { game: unknown } } }).__sd.getState().game);
  await expect(lesson(page)).toHaveCount(0);
  // let a few days pass so the advisor looks at the realm
  await page.keyboard.press('3');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  const hint = page.getByTestId('hint').filter({ hasText: 'The scholars are idle' });
  await expect(hint).toBeVisible();
  await hint.getByRole('button', { name: 'Open Research' }).click();
  await expect(page.locator('section.win[aria-label="Research"]')).toBeVisible();
  await page.locator('section.win[aria-label="Research"]').getByRole('button', { name: 'Research', exact: true }).first().click();
  await page.waitForTimeout(1800);
  await expect(page.getByTestId('hint').filter({ hasText: 'The scholars are idle' })).toHaveCount(0);
  // turn everything off
  await page.keyboard.press('F2');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'I know the game: turn all off' }).click();
  await expect(page.getByTestId('hint')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Lesson available' })).toHaveCount(0);
  await openScreen(page, 'council', 'Royal council');
  await expect(page.locator('section.win[aria-label="Council"] .first-visit')).toHaveCount(0);
  // preferences persist in this browser
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sd.guidance.v1') ?? '{}'))).toMatchObject({ lessons: false, hints: false, tooltips: false });
});
