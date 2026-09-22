const { test, expect } = require('playwright/test');

test('P/CH swaps one center fader for an L/R pair without visual overlap', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const centers = page.locator('.center-fader');
  const channels = page.locator('.channel-faders');
  await expect(centers).toHaveCount(10);
  await expect(channels).toHaveCount(10);
  await expect(centers.first()).toBeVisible();
  await expect(channels.first()).toBeHidden();
  await expect(page.locator('.filterbank-panel-header')).toContainText('FILTERBANK');
  await expect(page.locator('.filterbank-panel-header .fb-all-toggle')).toBeVisible();
  await page.locator('.per-channel-toggle').click();
  await expect(centers.first()).toBeHidden();
  await expect(channels.first()).toBeVisible();
  await expect(page.locator('.band-fader-channel')).toHaveCount(20);
  await expect(page.locator('[data-band-link="0"]')).toHaveAttribute('aria-pressed', 'false');
  const values = await page.evaluate(() => {
    const left = document.querySelector('.band-fader-channel[data-band="0"][data-channel="left"]');
    const right = document.querySelector('.band-fader-channel[data-band="0"][data-channel="right"]');
    left.value = '25'; left.dispatchEvent(new Event('input', { bubbles: true }));
    return { left: left.value, right: right.value };
  });
  expect(values.left).toBe('25');
  expect(values.right).toBe('0');
  await page.locator('[data-band-link="0"]').click();
  await expect(page.locator('[data-band-link="0"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.per-channel-toggle').click();
  await expect(centers.first()).toBeVisible();
  await expect(channels.first()).toBeHidden();
});
