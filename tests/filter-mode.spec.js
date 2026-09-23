const { test, expect } = require('playwright/test');

test('FILTER workspace controls the existing spectral core without changing manual filterbank state', async ({ page }) => {
  await page.goto('/');
  const firstManual = page.locator('.center-fader .band-fader').first();
  await firstManual.fill('37');
  await firstManual.dispatchEvent('input');
  await page.locator('.per-channel-toggle').click();
  await page.locator('[data-band-link="0"]').click();
  await page.locator('[data-feedback-band="2"]').click();
  await page.locator('.fb-all-toggle').click();
  await page.locator('[data-control="resonance"]').fill('0.37');
  await page.locator('[data-control="resonance"]').dispatchEvent('input');
  const before = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    engine.filterbank = { setBandBaseGain() {} };
    window.__filterModeWorklet = engine.filterbank;
    return {
      manual: window.FilterMode.getManualBandState(),
      feedbackLeft: [...engine.feedbackBandLeft],
      feedbackRight: [...engine.feedbackBandRight],
      feedbackAll: [engine.feedbackAllLeft, engine.feedbackAllRight],
      resonance: engine.resonance
    };
  });

  await page.locator('[data-mode="filter"]').click();
  await expect(page.locator('#mode-filter')).toBeVisible();
  await page.locator('[data-filter-type="bandpass"]').click();
  await page.locator('[data-filter-frequency]').fill('575');
  await page.locator('[data-filter-frequency]').dispatchEvent('input');
  await page.locator('[data-filter-slope]').fill('73');
  await page.locator('[data-filter-slope]').dispatchEvent('input');
  await page.locator('[data-filter-bandwidth]').fill('26');
  await page.locator('[data-filter-bandwidth]').dispatchEvent('input');
  const filterState = await page.evaluate(() => ({
    ui: window.FilterMode.getState(),
    shape: window.FilterMode.getShape(),
    engineMode: window.FilterMode.getAudioEngine().spectralMode,
    sameNode: window.__filterModeWorklet === window.FilterMode.getAudioEngine().filterbank
  }));
  expect(filterState.ui.filterType).toBe('bandpass');
  expect(filterState.ui.filterSlope).toBe(73);
  expect(filterState.ui.filterBandwidth).toBe(26);
  expect(filterState.engineMode).toBe('filter');
  expect(filterState.sameNode).toBeTruthy();
  expect(filterState.shape).toHaveLength(10);

  await page.locator('[data-mode="lfo"]').click();
  expect((await page.evaluate(() => window.FilterMode.getState())).spectralMode).toBe('filter');
  await page.locator('[data-mode="filterbank"]').click();
  const after = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return {
      manual: window.FilterMode.getManualBandState(),
      feedbackLeft: [...engine.feedbackBandLeft],
      feedbackRight: [...engine.feedbackBandRight],
      feedbackAll: [engine.feedbackAllLeft, engine.feedbackAllRight],
      resonance: engine.resonance,
      sameNode: window.__filterModeWorklet === engine.filterbank
    };
  });
  expect(after.manual).toEqual(before.manual);
  expect(after.feedbackLeft).toEqual(before.feedbackLeft);
  expect(after.feedbackRight).toEqual(before.feedbackRight);
  expect(after.feedbackAll).toEqual(before.feedbackAll);
  expect(after.resonance).toBe(before.resonance);
  expect(after.sameNode).toBeTruthy();
});

test('FILTER bandwidth relevance, graph updates, persistence and spread ignore stored P/CH', async ({ page }) => {
  await page.goto('/');
  await page.locator('.per-channel-toggle').click();
  await page.locator('[data-mode="filter"]').click();
  await expect(page.locator('[data-control="spread"]')).toBeEnabled();
  await expect(page.locator('[data-filter-bandwidth]')).toBeDisabled();
  const pathBefore = await page.locator('[data-filter-response-path]').getAttribute('d');
  await page.locator('[data-filter-type="notch"]').click();
  await expect(page.locator('[data-filter-bandwidth]')).toBeEnabled();
  await page.locator('[data-filter-frequency]').fill('700');
  await page.locator('[data-filter-frequency]').dispatchEvent('input');
  const pathAfter = await page.locator('[data-filter-response-path]').getAttribute('d');
  expect(pathAfter).not.toBe(pathBefore);
  await page.locator('[data-dev-lab-group="filterbank"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-band-cut-db]').selectOption('24');
  await expect(page.locator('[data-filter-response-floor]')).toHaveText('−24 dB');
  expect(Math.min(...await page.evaluate(() => window.FilterMode.getShape()))).toBeGreaterThanOrEqual(-24);

  const spread = page.locator('[data-control="spread"]');
  await spread.fill('0'); await spread.dispatchEvent('input');
  const neutral = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return [engine.getEffectiveBandGains(4).leftControl, engine.getEffectiveBandGains(4).rightControl];
  });
  expect(neutral[0]).toBe(neutral[1]);
  await spread.fill('0.5'); await spread.dispatchEvent('input');
  const spreadValues = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return [engine.getEffectiveBandGains(4).leftControl, engine.getEffectiveBandGains(4).rightControl];
  });
  expect(spreadValues[0]).not.toBe(spreadValues[1]);

  await page.locator('[data-mode="clock-mod"]').click();
  await page.locator('[data-mode="filter"]').click();
  await expect(page.locator('[data-filter-type="notch"]')).toHaveClass(/active/);
  await expect(page.locator('[data-filter-frequency]')).toHaveValue('700');
  await page.locator('[data-mode="filterbank"]').click();
  await expect(page.locator('.per-channel-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(spread).toBeDisabled();
});
