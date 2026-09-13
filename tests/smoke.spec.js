const { test, expect } = require('playwright/test');

test('local webapp loads in Chromium without browser errors', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  const response = await page.goto('/', { waitUntil: 'networkidle' });

  expect(response).not.toBeNull();
  expect(response.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/Resonant Filterbank/);
  await expect(page.locator('main.console')).toBeVisible();
  await page.screenshot({ path: 'tests/artifacts/smoke-full-page.png', fullPage: true });

  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('FB, MOD and band keyboard controls share state with the analyzer', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const fb = page.locator('[data-feedback-band]');
  const mod = page.locator('[data-mod-band]');
  const faders = page.locator('.band-fader');
  const analyzerBar = index => page.locator(`[data-analyzer-band="${index}"] i`).first();

  await page.keyboard.press('Digit1');
  await expect(fb.nth(0)).toHaveClass(/active/);
  await page.keyboard.press('Digit1');
  await expect(fb.nth(0)).not.toHaveClass(/active/);
  await page.keyboard.press('Digit0');
  await expect(fb.nth(9)).toHaveClass(/active/);
  await page.keyboard.press('Shift+Digit1');
  await expect(mod.nth(0)).toHaveClass(/active/);
  await expect(fb.nth(0)).not.toHaveClass(/active/);
  await page.keyboard.press('Shift+Digit0');
  await expect(mod.nth(9)).toHaveClass(/active/);

  const initialBar = await analyzerBar(0).getAttribute('style');
  await page.keyboard.press('KeyQ');
  await expect(faders.nth(0)).toHaveValue('10');
  await expect(analyzerBar(0)).not.toHaveAttribute('style', initialBar);
  await expect(faders.nth(9)).toHaveValue('0');
  await page.keyboard.press('KeyP');
  await expect(faders.nth(9)).toHaveValue('10');
  await page.keyboard.press('KeyA');
  await expect(faders.nth(0)).toHaveValue('0');
  await page.keyboard.press('Semicolon');
  await expect(faders.nth(9)).toHaveValue('0');

  for (let i = 0; i < 25; i++) await page.keyboard.press('KeyQ');
  await expect(faders.nth(0)).toHaveValue('100');
  for (let i = 0; i < 25; i++) await page.keyboard.press('KeyA');
  await expect(faders.nth(0)).toHaveValue('-100');
  await faders.nth(0).fill('100');
  await expect(analyzerBar(0)).toHaveAttribute('style', /80%/);

  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
