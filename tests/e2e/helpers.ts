import { expect, type Page } from '@playwright/test';

/** Collects page errors and console errors so a test can assert there were none. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // headless SwiftShader noise, not application errors
    if (/GPU stall due to ReadPixels|WebGL: INVALID_|Automatic fallback to software WebGL/.test(t)) return;
    errors.push(t);
  });
  return errors;
}

/** Start a new reign on the smallest galaxy and wait until the game state exists. */
export async function startReign(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '30 systems' }).click();
  await page.getByRole('button', { name: 'Begin the reign' }).click();
  await page.waitForFunction(() => !!(window as unknown as { __sd?: { getState(): { game: unknown } } }).__sd?.getState().game);
}

export async function openScreen(page: Page, id: string, title: string) {
  await page.evaluate((s) => (window as unknown as { __sd: { getState(): { openScreen(s: string): void } } }).__sd.getState().openScreen(s), id);
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
}
