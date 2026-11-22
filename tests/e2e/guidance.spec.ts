import { test, expect, type Page } from '@playwright/test';
import { watchErrors, startReign, openScreen } from './helpers';

type G = { guidance?: { active: string | null; step: number; done: string[]; paused: boolean; seen: string[] } };
const guidance = (page: Page) => page.evaluate(() => (window as unknown as { __sd: { getState(): { game: G } } }).__sd.getState().game.guidance ?? null);
const lesson = (page: Page) => page.getByRole('complementary', { name: 'Lesson', exact: true });

test('a new player completes the first lesson by doing what it asks, and progress survives save and reload', async ({ page }) => {
  const errors = watchErrors(page);
  const voice = page.waitForResponse((r) => /\/assets\/audio\/voice\/welcome\.(ogg|m4a)$/.test(r.url()));
  await startReign(page); // "Guided first reign" is on by default
  // the Lord Admiral introduces herself aloud, once, and her words are on screen
  expect((await voice).status()).toBe(200);
  await expect(page.getByTestId('advisor-quote').first()).toContainText("I'm Fiona MacLeod");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sd: { getState(): { game: { guidance: { seen: string[] } } } } }).__sd.getState().game.guidance.seen.includes('said:welcome'))).toBe(true);
  // a beginner starts with a few screens; the rest join the bar as they matter
  await expect(page.locator('.neo-btn[aria-label="Research"]')).toBeVisible();
  await expect(page.locator('.neo-btn[aria-label="Hall of Heroes"]')).toHaveCount(0);
  await expect(page.locator('.neo-btn[aria-label="Show all screens"]')).toBeVisible();
  await expect(lesson(page)).toContainText('Welcome, ruler');
  await lesson(page).getByRole('button', { name: 'Continue' }).click();
  // the clock step only completes once time has actually run and been stopped
  await expect(lesson(page)).toContainText('Start and stop the clock');
  await expect(page.getByTestId('lesson-goal')).not.toHaveClass(/met/);
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  await page.keyboard.press('Space');
  // research, through the Research window that "Show me" opens
  await expect(lesson(page)).toContainText('Pick something to invent');
  await lesson(page).getByRole('button', { name: 'Show me' }).click();
  await page.locator('section.win[aria-label="Research"]').getByRole('button', { name: 'Research', exact: true }).first().click();
  // building: "Do it for me" gives the order and the step completes from the real queue
  await expect(lesson(page)).toContainText('Build on your planet');
  await lesson(page).getByRole('button', { name: 'Do it for me' }).click();
  await expect(lesson(page)).toContainText('Let time run');
  await page.evaluate(() => (window as unknown as { __sd: { getState(): any } }).__sd.getState().setSpeed(3));
  await expect(lesson(page)).toContainText('What to do next', { timeout: 30000 });
  await page.evaluate(() => (window as unknown as { __sd: { getState(): any } }).__sd.getState().setSpeed(0));
  await lesson(page).getByRole('button', { name: 'Finish lesson' }).click();
  expect((await guidance(page))!.done).toContain('welcome');
  // the next lesson is offered, not forced
  const offer = page.getByRole('complementary', { name: 'Lesson available' });
  await expect(offer).toContainText('Getting Bigger');
  await offer.getByRole('button', { name: 'Start lesson' }).click();
  await expect(lesson(page)).toContainText('Stars are places');
  await lesson(page).getByRole('button', { name: 'Continue' }).click();
  await expect(lesson(page)).toContainText('Explore with your scout');
  await lesson(page).getByRole('button', { name: 'Do it for me' }).click();
  await expect.poll(() => page.evaluate(() => Object.values((window as unknown as { __sd: { getState(): any } }).__sd.getState().game.fleets as Record<string, { ownerId: number; path: number[]; ships: { cls: string }[] }>).some((f) => f.ownerId === 0 && f.ships.every((x) => x.cls === 'scout') && f.path.length > 0))).toBe(true);

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
  expect(g!.active).toBe('grow');
  expect(g!.step).toBe(1);
  await expect(lesson(page)).toContainText('Explore with your scout');
  expect(errors).toEqual([]);
});

test('every lesson can be started, paused, resumed, left and replayed from the Codex', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  await lesson(page).getByRole('button', { name: 'Leave the lesson' }).click();
  await page.keyboard.press('F2');
  await page.getByRole('tab', { name: 'Lessons' }).click();
  const rows = page.getByTestId('lesson-list').locator('.lesson-li');
  await expect(rows).toHaveCount(12);
  const titles = await rows.locator('b').allTextContents();
  for (let i = 0; i < titles.length; i++) {
    await rows.nth(i).getByRole('button', { name: /Start|Restart|Replay/ }).click();
    await expect(lesson(page)).toContainText(`Lesson ${i + 1}: ${titles[i]}`);
    // walk to the end with Continue / Skip step
    // walk to the end; a step can also complete itself (its window is already open), and the
    // lesson closes once finished, so stop as soon as the panel is gone
    for (let k = 0; k < 14 && (await lesson(page).count()); k++) {
      const btn = lesson(page).getByRole('button', { name: /Finish lesson|Continue|Skip step/ });
      await btn.first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(350);
    }
    await expect(rows.nth(i)).toContainText('Completed');
  }
  // pause and resume, then replay a finished lesson
  await rows.nth(5).getByRole('button', { name: 'Replay' }).click();
  await lesson(page).getByRole('button', { name: 'Pause the lesson' }).click();
  await expect(page.getByRole('button', { name: /Resume lesson/ })).toBeVisible();
  await page.getByRole('button', { name: /Resume lesson/ }).click();
  await expect(lesson(page)).toContainText('Your Capital City');
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
  // advice comes with a "Do it for me" that gives the order
  await expect(hint.getByRole('button', { name: 'Do it for me' })).toBeVisible();
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

test('the Next steps panel states the goal and the useful next actions, and a panel button over the map works', async ({ page }) => {
  const errors = watchErrors(page);
  await startReign(page);
  await lesson(page).getByRole('button', { name: 'Leave the lesson' }).click();
  const next = page.getByRole('complementary', { name: 'Next steps' });
  await expect(page.getByTestId('reign-goal')).toContainText('Quest: Put the realm in order');
  await expect(page.getByTestId('quest')).toContainText('quest 1 of 5');
  await expect(next.getByTestId('hint').first()).toBeVisible();
  // regression: releasing the mouse over a side-panel button must not also click the star behind it
  await page.evaluate(() => {
    const s = (window as unknown as { __sd: { getState(): any } }).__sd.getState();
    const g = s.game;
    const own = new Set(g.galaxy.systems.filter((x: { owner: number | null }) => x.owner === 0).map((x: { id: number }) => x.id));
    const free = g.galaxy.lanes.flatMap(([a, b]: [number, number]) => own.has(a) ? [b] : own.has(b) ? [a] : []).find((id: number) => g.galaxy.systems[id].owner == null);
    s.selectSystem(free);
  });
  await page.getByRole('button', { name: 'Send construction ship' }).click();
  await expect.poll(() => page.evaluate(() => Object.values((window as unknown as { __sd: { getState(): any } }).__sd.getState().game.fleets as Record<string, { ownerId: number; order: { type: string } }>).some((f) => f.ownerId === 0 && f.order.type === 'outpost'))).toBe(true);
  expect(errors).toEqual([]);
});
