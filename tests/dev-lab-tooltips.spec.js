const { test, expect } = require('playwright/test');

test('DEV/LAB group help is available for each current help group', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/', { waitUntil: 'networkidle' });

  const tooltip = page.locator('#dev-lab-tooltip');
  const groups = page.locator('.dev-lab-panel .dev-lab-group');
  const helpButtons = page.locator('.dev-lab-panel .dev-lab-group-header .dev-lab-info-button');
  expect(await groups.count()).toBeGreaterThan(0);
  const groupsWithHelp = await groups.evaluateAll(elements => elements.filter(element => element.querySelector('.dev-lab-info-button')).length);
  await expect(helpButtons).toHaveCount(groupsWithHelp);
  const consoleBefore = await page.locator('.console').boundingBox();
  for (let index = 0; index < await helpButtons.count(); index += 1) {
    const button = helpButtons.nth(index);
    await button.click();
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('h3, h4').first()).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const tooltipBox = await tooltip.boundingBox();
    expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(1914);
    expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
    expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(907);
    await expect(tooltip).toContainText(/./);
    await button.click();
    await expect(tooltip).toBeHidden();
  }

  const keyboardHelp = helpButtons.first();
  await keyboardHelp.focus();
  await expect(keyboardHelp).toBeFocused();
  await keyboardHelp.click();
  await expect(tooltip).toBeVisible();
  await expect(keyboardHelp).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  const consoleAfter = await page.locator('.console').boundingBox();
  expect(consoleAfter).toEqual(consoleBefore);
  await expect(page.locator('[data-feedback-all-level] option[value="raw"]')).toHaveCount(1);
  await expect(page.locator('[data-feedback-all-level] option[value="eightieth"]')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
