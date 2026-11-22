// Browser bug audit ("monkey" test): starts a reign in the real UI, opens every screen, presses
// random buttons on each, fast-forwards the game, saves and loads, and reports every page error,
// console error and screen that failed to render. Needs a running dev server.
//   node scripts/browser-audit.cjs [baseURL=http://localhost:5181] [clicksPerScreen=25] [phases=3]
const { chromium } = require('playwright');

// a stuck page must not hang the audit: give up after AUDIT_TIMEOUT_MIN minutes
const LIMIT_MIN = Number(process.env.AUDIT_TIMEOUT_MIN || 30);
setTimeout(() => { console.log(`\n✗ audit stopped after ${LIMIT_MIN} minutes (last step logged above)`); process.exit(2); }, LIMIT_MIN * 60_000).unref();

const BASE = process.argv[2] || 'http://localhost:5181';
const CLICKS = Number(process.argv[3] || 25);
const PHASES = Number(process.argv[4] || 3);
const SCREENS = ['map', 'kingdom', 'planets', 'system', 'fleets', 'military', 'economy', 'industry', 'research', 'diplomacy', 'intel', 'construction', 'trade', 'journal', 'techtree', 'heroes', 'council', 'capital', 'operations', 'throne', 'warroom', 'chronicle', 'codex', 'vault'];
const NOISE = /GPU stall due to ReadPixels|WebGL: INVALID_|Automatic fallback to software WebGL|THREE\.WebGLRenderer: Context Lost|Download the React DevTools/;
// buttons the monkey must not press: they leave the reign or open the OS file picker
const AVOID = /Abdicate|Main menu|Leave|Quit|Import|Export|Delete|New reign|Sign|Log ?out|Reset/i;

async function startReign(page) {
  await page.getByRole('button', { name: /30 systems|Small/ }).first().click();
  await page.getByRole('button', { name: 'Begin the reign' }).click();
  await page.waitForFunction(() => !!window.__sd?.getState().game);
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = [];
  for (const vp of [{ name: 'desktop', viewport: { width: 1440, height: 900 } }, { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
    const page = await ctx.newPage();
    const errors = [];
    let where = 'start';
    page.on('pageerror', (e) => errors.push(`[${vp.name} ${where}] pageerror: ${e.message} ${(e.stack || '').split('\n').slice(1, 3).join(' ')}`));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(`[${vp.name} ${where}] console: ${m.text().slice(0, 300)}`); });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(BASE);
    await startReign(page);
    const blank = [];
    for (let phase = 0; phase < PHASES; phase++) {
      for (const s of SCREENS) {
        where = `phase${phase}/${s}`;
        await page.evaluate((id) => { if (!window.__sd?.getState().game) throw new Error('not in a reign'); const ui = window.__sd.getState(); ui.set?.({ windows: [] }); ui.openScreen(id); }, s).catch((e) => errors.push(`[${vp.name} ${where}] openScreen threw ${e.message}`));
        await page.waitForTimeout(250);
        if (process.env.AUDIT_VERBOSE) console.log(`  ${vp.name} ${where}`);
        const txt = await page.evaluate(() => document.body.innerText.length);
        if (txt < 50) blank.push(where);
        // a crashed React tree leaves the error boundary's text behind
        const boom = await page.evaluate(() => /Something went wrong|crashed|Error:/i.test(document.querySelector('.window, .sheet, main')?.textContent || ''));
        if (boom) errors.push(`[${vp.name} ${where}] error text rendered`);
        for (let i = 0; i < CLICKS; i++) {
          const btns = await page.$$('button:visible, [role=button]:visible, .li:visible, .tab:visible, select:visible');
          if (!btns.length) break;
          const b = btns[Math.floor(Math.random() * btns.length)];
          const label = ((await b.textContent().catch(() => '')) || '').trim().slice(0, 40);
          if (AVOID.test(label)) continue;
          const tag = await b.evaluate((n) => n.tagName).catch(() => '');
          try {
            if (tag === 'SELECT') { const n = await b.evaluate((x) => x.options.length); if (n) await b.selectOption({ index: Math.floor(Math.random() * n) }, { timeout: 1000 }); }
            else await b.click({ timeout: 1000, trial: false });
          } catch { /* covered or detached: fine */ }
          await page.waitForTimeout(40);
          // the monkey must stay in the reign
          const inGame = await page.evaluate(() => !!window.__sd?.getState().game).catch(() => false);
          if (!inGame) {
            const url = page.url();
            errors.push(`[${vp.name} ${where}] left the reign after pressing "${label}" (${url})`);
            await page.goto(BASE); await startReign(page); break;
          }
        }
        await page.keyboard.press('Escape').catch(() => {});
      }
      where = `phase${phase}/advance`;
      await page.evaluate(async () => { const ui = window.__sd.getState(); if (window.__sdDev) await window.__sdDev.runDays(720); ui.set?.({ speed: 0 }); }).catch((e) => errors.push(`[${vp.name} ${where}] advance failed ${e.message}`));
      await page.waitForTimeout(800);
      // save, then load the save back
      where = `phase${phase}/save-load`;
      const ok = await page.evaluate(async () => {
        const mod = await import('/src/ui/store.ts');
        const before = window.__sd.getState().game.tick;
        await mod.saveGame('audit', 'Audit');
        await mod.loadGame('audit');
        return window.__sd.getState().game.tick === before;
      }).catch((e) => `threw ${e.message}`);
      if (ok !== true) errors.push(`[${vp.name} ${where}] save/load mismatch: ${ok}`);
    }
    results.push({ vp: vp.name, errors, blank });
    await ctx.close();
  }
  await browser.close();
  for (const r of results) {
    console.log(`\n== ${r.vp}: ${r.errors.length} errors, ${r.blank.length} blank screens`);
    const seen = new Map();
    for (const e of r.errors) { const k = e.replace(/^\[[^\]]*\] /, '').slice(0, 160); seen.set(k, [(seen.get(k)?.[0] ?? 0) + 1, seen.get(k)?.[1] ?? e]); }
    for (const [, [n, e]] of seen) console.log(`  [${n}] ${e.slice(0, 500)}`);
    if (r.blank.length) console.log('  blank:', r.blank.join(', '));
  }
})();
