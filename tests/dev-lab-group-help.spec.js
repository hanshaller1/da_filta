const { test, expect } = require('playwright/test');

const expectedGroups = {
  input: ['DEV INPUT STAGE', 'DEV CHARACTER'],
  filterbank: ['DEV REFERENCE', 'DEV BAND BOOST', 'DEV BAND CUT', 'SPREAD CURVE', 'DEV SPREAD MAX OFFSET', 'DEV WET MODEL'],
  'local-feedback': ['DEV FB TOPOLOGY', 'FEEDBACK CORE', 'DEV LOCAL LOOP TUNING', 'DEV FB TAP', 'DEV FB SAT', 'DEV FB DRIVE', 'DEV FB CEILING'],
  main: ['DEV FB ALL ENGINE', 'DEV FB ALL SOURCE', 'DEV POST GAIN FB WEIGHT', 'DEV FB ALL LEVEL', 'DEV RESONANCE CURVE', 'DEV MAIN SAT/RETURN'],
  resonator: ['CAL DEV RES AUD', 'CAL DEV RES DRIVE', 'CAL DEV RES FLOOR', 'DEV RES OUTPUT', 'DEV RES LATENCY', 'DEV RES CURVE', 'DEV RES ENGINE']
};

test('DEV-LAB replaces per-control hover help with five complete click-open group popups', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const tooltip = page.locator('#dev-lab-tooltip');
  await expect(tooltip).toBeHidden();
  await expect(page.locator('.dev-lab-group-header .dev-lab-info-button')).toHaveCount(5);

  await page.locator('[data-input-preamp-stage]').hover();
  await expect(tooltip).toBeHidden();

  let previousButton = null;
  for (const [group, names] of Object.entries(expectedGroups)) {
    const button = page.locator(`[data-dev-lab-help="${group}"]`);
    await button.click();
    await expect(tooltip).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    if (previousButton) await expect(previousButton).toHaveAttribute('aria-expanded', 'false');
    previousButton = button;
    for (const name of names) await expect(tooltip.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(tooltip).not.toContainText('Signalweg / Scope');
    await expect(tooltip).not.toContainText('Werte:');
    await expect(tooltip).not.toContainText('Default:');
    await expect(tooltip).not.toContainText('Hinweis:');
    await expect(tooltip).not.toContainText('Erklärung:');
    expect(await tooltip.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
  }

  await page.locator('[data-dev-lab-help="resonator"]').click();
  await expect(tooltip).toBeHidden();

  const inputButton = page.locator('[data-dev-lab-help="input"]');
  await inputButton.click();
  await expect(tooltip).toBeVisible();
  await inputButton.click();
  await expect(tooltip).toBeHidden();
  await inputButton.click();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();

  await inputButton.click();
  await page.mouse.click(8, 8);
  await expect(tooltip).toBeHidden();
});

test('FILTERBANK RESPONSE DEV LAB exposes one consolidated info popup beside SNAPSHOT', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto('/', { waitUntil: 'networkidle' });

  await page.locator('[data-response-mode="dev-lab"]').click();
  const responseHelp = page.locator('.response-dev-toolbar [data-dev-lab-help="response"]');
  const snapshot = page.locator('[data-debug-snapshot]');
  await expect(responseHelp).toBeVisible();
  expect((await responseHelp.boundingBox()).x).toBeGreaterThan((await snapshot.boundingBox()).x);
  await snapshot.hover();
  await expect(page.locator('#dev-lab-tooltip')).toBeHidden();

  await responseHelp.click();
  const tooltip = page.locator('#dev-lab-tooltip');
  await expect(tooltip).toBeVisible();
  for (const name of ['FREEZE / LIVE', 'RESET METRICS', 'DEBUG CONSOLE', 'MARK', 'SNAPSHOT']) await expect(tooltip.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(tooltip).not.toContainText('Signalweg / Scope');
  await expect(tooltip).not.toContainText('Werte:');
  await expect(tooltip).not.toContainText('Default:');
  await expect(tooltip).not.toContainText('Hinweis:');
  await expect(tooltip).not.toContainText('Erklärung:');

  const geometry = await responseHelp.evaluate(button => {
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height, touchAction: style.touchAction };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(28);
  expect(geometry.height).toBeGreaterThanOrEqual(28);
  expect(geometry.touchAction).toBe('manipulation');
});
