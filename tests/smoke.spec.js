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
