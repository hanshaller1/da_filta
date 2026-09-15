const { test, expect } = require('playwright/test');

test('all DEV/LAB properties expose complete hover and keyboard help', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/', { waitUntil: 'networkidle' });

  const controls = page.locator('.dev-lab-panel .dev-lab-control, .dev-lab-panel .dev-audition-control');
  const tooltip = page.locator('#dev-lab-tooltip');
  expect(await controls.count()).toBe(21);
  const consoleBefore = await page.locator('.console').boundingBox();
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    const optionCount = await control.locator('option').count();
    await control.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('li')).toHaveCount(optionCount || 3);
    const tooltipBox = await tooltip.boundingBox();
    expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(1914);
    expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
    expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(907);
  }

  await controls.first().locator('select, input').focus();
  await expect(tooltip).toBeVisible();
  await controls.last().locator('select, input').focus();
  await expect(tooltip).toBeVisible();
  const consoleAfter = await page.locator('.console').boundingBox();
  expect(consoleAfter).toEqual(consoleBefore);
  expect(await page.locator('[data-feedback-all-level] option').count()).toBe(6);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
