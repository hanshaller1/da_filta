const { test, expect } = require('playwright/test');

test('feedback labels explain the two buses and MOD remains reserved', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const fb = page.locator('[data-feedback-band="0"]');
  const main = page.locator('.fb-all-toggle');
  const mod = page.locator('[data-mod-band="0"]');
  await expect(fb).toHaveAttribute('title', /alle zehn Bänder/);
  await expect(main).toHaveAttribute('title', /Separater MAIN-Feedback-Bus/);
  await expect(mod).toBeDisabled();
  await expect(mod).toHaveAttribute('title', /keine Audiofunktion/);
  await expect(page.locator('[data-feedback-topology] option[value="common-bus"]')).toHaveText(/DA_FILTA-ORIGINAL/);
  await expect(page.locator('[data-feedback-all-source] option[value="post-gain-sum"]')).toHaveText('STATIC POST-GAIN SUM');

  await fb.click();
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return { local: engine.feedbackBandLeft[0], main: engine.feedbackAllLeft };
  })).toEqual({ local: true, main: false });
  await main.click();
  await fb.click();
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return { local: engine.feedbackBandLeft[0], main: engine.feedbackAllLeft };
  })).toEqual({ local: false, main: true });
});

test('DEV controls follow their audio topology without clearing stored values', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-dev-lab-group="filterbank"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-dev-lab-group="resonator"] .dev-lab-collapse-toggle').click();
  const reference = page.locator('[data-reference-level]');
  const spreadCurve = page.locator('[data-spread-curve]');
  const tap = page.locator('[data-feedback-tap]');
  const mainSource = page.locator('[data-feedback-all-source]');
  const resonatorDrive = page.locator('[data-positive-resonance-drive]');
  await expect(reference).toBeDisabled();
  await expect(reference.locator('..')).toHaveClass(/is-irrelevant/);
  await expect(spreadCurve).toBeDisabled();
  await expect(spreadCurve.locator('..')).toContainText('INACTIVE');
  await expect(tap).toBeEnabled();
  await expect(mainSource).toBeEnabled();
  await expect(resonatorDrive).toBeDisabled();

  await page.locator('[data-wet-model]').selectOption('reference-delta');
  await expect(reference).toBeEnabled();
  await reference.selectOption('0.5');
  await page.locator('[data-wet-model]').selectOption('filterbank-sum');
  await expect(reference).toBeDisabled();
  await expect(reference).toHaveValue('0.5');
  await page.locator('[data-feedback-topology]').selectOption('isolated-tpt');
  await expect(tap).toBeDisabled();
  await expect(mainSource).toBeDisabled();
  await expect(resonatorDrive).toBeEnabled();
  await page.locator('[data-feedback-topology]').selectOption('common-bus');
  await expect(tap).toBeEnabled();
  await expect(resonatorDrive).toBeDisabled();
});

test('OUTPUT group exposes fixed-position soft protection and restores its snapshot', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const groups = await page.locator('.dev-lab-group').evaluateAll(elements => elements.slice(0, 3).map(element => element.dataset.devLabGroup));
  expect(groups).toEqual(['input', 'output', 'keyboard']);
  const group = page.locator('[data-dev-lab-group="output"]');
  await expect(group.locator('.dev-lab-collapse-toggle')).toHaveAttribute('aria-expanded', 'false');
  await group.locator('.dev-lab-collapse-toggle').click();
  const enabled = group.locator('[data-output-protection-enabled]');
  const threshold = group.locator('[data-output-protection-threshold]');
  const softness = group.locator('[data-output-protection-softness]');
  await expect(enabled).toHaveValue('on');
  await expect(threshold).toHaveValue('0.8');
  await expect(softness).toHaveValue('100');
  await expect(group.locator('select')).toHaveCount(1);
  await threshold.fill('0.7');
  await softness.fill('30');
  await enabled.selectOption('off');
  await expect(threshold).toBeDisabled();
  await expect(softness).toBeDisabled();
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return [engine.outputProtectionEnabled, engine.outputProtectionThreshold, engine.outputProtectionSoftness];
  })).toEqual([false, 0.7, 30]);

  await page.locator('[data-dev-lab-group="sweetspots"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-sweetspot-save="A"]').click();
  await enabled.selectOption('on');
  await threshold.fill('0.9');
  await softness.fill('80');
  await page.locator('[data-sweetspot-load="A"]').click();
  await expect(enabled).toHaveValue('off');
  await expect(threshold).toHaveValue('0.7');
  await expect(softness).toHaveValue('30');
  await expect(threshold).toBeDisabled();
});
