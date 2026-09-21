const { test, expect } = require('playwright/test');

test('collapsed preview remains available when DEV LAB is the active response mode', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const collapse = page.locator('.response-collapse-toggle');
  const preview = page.locator('.collapsed-analyzer-preview');
  await collapse.click(); await expect(preview).toBeVisible(); await collapse.click();
  await page.locator('[data-response-mode="dev-lab"]').click();
  await expect(page.locator('.response-dev-lab')).toBeVisible();
  await collapse.click(); await expect(preview).toBeVisible();
  await expect(page.locator('.response-dev-lab')).toBeHidden();
  await collapse.click();
  await expect(page.locator('.response-dev-lab')).toBeVisible();
  await expect(page.locator('[data-response-mode="dev-lab"]')).toHaveAttribute('aria-pressed', 'true');
});
