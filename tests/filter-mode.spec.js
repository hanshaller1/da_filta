const { test, expect } = require('playwright/test');

test('FILTER power controls the existing spectral core across workspaces without changing manual filterbank state', async ({ page }) => {
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
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filter', filterEnabled: false });
  await page.locator('[data-module-power="filter"]').click();
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
    engineEnabled: window.FilterMode.getAudioEngine().filterEnabled,
    sameNode: window.__filterModeWorklet === window.FilterMode.getAudioEngine().filterbank
  }));
  expect(filterState.ui.filterType).toBe('bandpass');
  expect(filterState.ui.filterSlope).toBe(73);
  expect(filterState.ui.filterBandwidth).toBe(26);
  expect(filterState.ui.filterEnabled).toBe(true);
  expect(filterState.engineEnabled).toBe(true);
  expect(filterState.sameNode).toBeTruthy();
  expect(filterState.shape).toHaveLength(10);

  await page.locator('[data-mode="lfo"]').click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'lfo', filterEnabled: true });
  await page.locator('[data-mode="filterbank"]').click();
  const after = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return {
      manual: window.FilterMode.getManualBandState(),
      feedbackLeft: [...engine.feedbackBandLeft],
      feedbackRight: [...engine.feedbackBandRight],
      feedbackAll: [engine.feedbackAllLeft, engine.feedbackAllRight],
      resonance: engine.resonance,
      filterEnabled: engine.filterEnabled,
      sameNode: window.__filterModeWorklet === engine.filterbank
    };
  });
  expect(after.manual).toEqual(before.manual);
  expect(after.feedbackLeft).toEqual(before.feedbackLeft);
  expect(after.feedbackRight).toEqual(before.feedbackRight);
  expect(after.feedbackAll).toEqual(before.feedbackAll);
  expect(after.resonance).toBe(before.resonance);
  expect(after.filterEnabled).toBe(true);
  expect(after.sameNode).toBeTruthy();
});

test('FILTER bandwidth relevance, graph updates, persistence and spread ignore stored P/CH', async ({ page }) => {
  await page.goto('/');
  await page.locator('.per-channel-toggle').click();
  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-module-power="filter"]').click();
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
  await expect(spread).toBeEnabled();
  await page.locator('[data-module-power="filter"]').click();
  await expect(spread).toBeDisabled();
});

test('workspace selection and FILTER power remain independent pointer interactions', async ({ page }) => {
  await page.goto('/');
  const power = page.locator('[data-module-power="filter"]');

  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filterbank', filterEnabled: false });
  await page.locator('[data-mode="filter"]').click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filter', filterEnabled: false });

  await page.locator('[data-mode="filterbank"]').click();
  await power.click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filterbank', filterEnabled: true });
  await expect(power).toHaveAttribute('aria-pressed', 'true');
  await expect(power).toHaveAttribute('aria-label', 'FILTER ausschalten');

  await page.locator('[data-mode="filter"]').click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filter', filterEnabled: true });
  await power.click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filter', filterEnabled: false });

  await page.locator('[data-mode="filterbank"]').click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filterbank', filterEnabled: false });
  await expect(page.locator('.mode-power:disabled')).toHaveCount(5);
  await expect(page.locator('[data-mode="filterbank"]').locator('xpath=..').locator('.mode-power-slot')).toHaveCount(1);
  await expect(page.locator('[data-mode="presets"]').locator('xpath=..').locator('.mode-power-slot')).toHaveCount(1);
});

test('FILTER power swaps only the effective band basis and preserves both parameter systems', async ({ page }) => {
  await page.goto('/');
  const manualFader = page.locator('.center-fader .band-fader').first();
  await manualFader.fill('37');
  await manualFader.dispatchEvent('input');
  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-filter-type="bandpass"]').click();
  await page.locator('[data-filter-frequency]').evaluate((slider, frequency) => {
    slider.value = String(window.FilterShape.frequencyToSlider(frequency));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, 1200);
  await page.locator('[data-filter-slope]').fill('73');
  await page.locator('[data-filter-slope]').dispatchEvent('input');
  await page.locator('[data-filter-bandwidth]').fill('28');
  await page.locator('[data-filter-bandwidth]').dispatchEvent('input');
  const configuredFilter = await page.evaluate(() => window.FilterMode.getState());

  const offBasis = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return { effective: engine.getEffectiveBandGains(0).leftControl, manual: engine.bandGainLeft[0] };
  });
  expect(offBasis.effective).toBe(offBasis.manual);

  const power = page.locator('[data-module-power="filter"]');
  await power.click();
  const onBasis = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return { effective: engine.getEffectiveBandGains(0).leftControl, filter: engine.filterModeBandControls[0] };
  });
  expect(onBasis.effective).toBe(onBasis.filter);

  await page.locator('[data-mode="lfo"]').click();
  await page.locator('[data-mode="filter"]').click();
  await power.click();
  const restored = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return {
      ui: window.FilterMode.getState(),
      effective: engine.getEffectiveBandGains(0).leftControl,
      manual: engine.bandGainLeft[0],
      manualState: window.FilterMode.getManualBandState()
    };
  });
  expect(restored.ui).toMatchObject({
    filterEnabled: false,
    filterType: configuredFilter.filterType,
    filterFrequencyHz: configuredFilter.filterFrequencyHz,
    filterSlope: configuredFilter.filterSlope,
    filterBandwidth: configuredFilter.filterBandwidth
  });
  expect(restored.effective).toBe(restored.manual);
  expect(restored.manualState.left[0]).toBeCloseTo(37, 10);
});

test('Space, Enter and NumpadEnter keep PANIC semantics and never toggle FILTER power', async ({ page }) => {
  await page.goto('/');
  const power = page.locator('[data-module-power="filter"]');
  await power.click();
  await power.focus();

  for (const key of ['Space', 'Enter', 'NumpadEnter']) {
    const resonance = page.locator('[data-control="resonance"]');
    await resonance.fill('0.5');
    await resonance.dispatchEvent('input');
    await power.focus();
    await page.keyboard.press(key);
    expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filterbank', filterEnabled: true });
    await expect(resonance).toHaveValue('0');
  }
});
