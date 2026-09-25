const { test, expect } = require('playwright/test');
const selectFilterType = async (page, type) => {
  await page.locator(`[data-filter-type="${type}"]`).click();
};

test('FILTER power controls its layer across workspaces without changing FILTERBANK state', async ({ page }) => {
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
  await selectFilterType(page, 'bandpass');
  await page.locator('[data-filter-frequency]').fill('575');
  await page.locator('[data-filter-frequency]').dispatchEvent('input');
  await page.locator('[data-filter-slope]').fill('73');
  await page.locator('[data-filter-slope]').dispatchEvent('input');
  await page.locator('[data-filter-bandwidth]').fill('26');
  await page.locator('[data-filter-bandwidth]').dispatchEvent('input');
  await page.locator('[data-filter-resonance]').fill('64');
  await page.locator('[data-filter-depth]').fill('42');
  const filterState = await page.evaluate(() => ({
    ui: window.FilterMode.getState(),
    shape: window.FilterMode.getShape(),
    engineEnabled: window.FilterMode.getAudioEngine().filterEnabled,
    sameNode: window.__filterModeWorklet === window.FilterMode.getAudioEngine().filterbank
  }));
  expect(filterState.ui.filterType).toBe('bandpass');
  expect(filterState.ui.filterSlope).toBe(73);
  expect(filterState.ui.filterBandwidth).toBe(26);
  expect(filterState.ui.filterResonance).toBe(64);
  expect(filterState.ui.filterDepth).toBe(42);
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

test('FILTER bandwidth relevance, graph updates and P/CH spread priority persist across workspaces', async ({ page }) => {
  await page.goto('/');
  await page.locator('.per-channel-toggle').click();
  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-module-power="filter"]').click();
  await expect(page.locator('[data-control="spread"]')).toBeDisabled();
  await expect(page.locator('[data-filter-bandwidth]')).toBeDisabled();
  const pathBefore = await page.locator('[data-filter-response-path]').getAttribute('d');
  await selectFilterType(page, 'notch');
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

  await page.locator('[data-mode="clock-mod"]').click();
  await page.locator('[data-mode="filter"]').click();
  await expect(page.locator('[data-filter-type="notch"]')).toHaveClass(/active/);
  await expect(page.locator('[data-filter-frequency]')).toHaveValue('700');
  await page.locator('[data-mode="filterbank"]').click();
  await expect(page.locator('.per-channel-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(spread).toBeDisabled();
  await page.locator('[data-module-power="filter"]').click();
  await expect(spread).toBeDisabled();
});

test('workspace selection and module power remain independent pointer interactions', async ({ page }) => {
  await page.goto('/');
  const filterbankPower = page.locator('[data-module-power="filterbank"]');
  const power = page.locator('[data-module-power="filter"]');

  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filterbank', filterbankEnabled: true, filterEnabled: false });
  await page.locator('[data-mode="filter"]').click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filter', filterEnabled: false });

  await page.locator('[data-mode="filterbank"]').click();
  await power.click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filterbank', filterEnabled: true });
  await expect(power).toHaveAttribute('aria-pressed', 'true');
  await expect(power).toHaveAttribute('aria-label', 'FILTER ausschalten');

  await page.locator('[data-mode="filter"]').click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filter', filterEnabled: true });
  await filterbankPower.click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filter', filterbankEnabled: false, filterEnabled: true });
  await expect(filterbankPower).toHaveAttribute('aria-pressed', 'false');
  await filterbankPower.click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filter', filterbankEnabled: true, filterEnabled: true });
  await power.click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filter', filterEnabled: false });

  await page.locator('[data-mode="filterbank"]').click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filterbank', filterEnabled: false });
  await expect(page.locator('.mode-power:disabled')).toHaveCount(4);
  await expect(page.locator('[data-mode="filterbank"]').locator('xpath=..').locator('[data-module-power="filterbank"]')).toHaveCount(1);
  await expect(page.locator('[data-mode="presets"]').locator('xpath=..').locator('.mode-power-slot')).toHaveCount(1);
});

test('FILTER and FILTERBANK layers combine in dB and preserve both parameter systems', async ({ page }) => {
  await page.goto('/');
  const manualFader = page.locator('.center-fader .band-fader').first();
  await manualFader.fill('37');
  await manualFader.dispatchEvent('input');
  await page.locator('[data-mode="filter"]').click();
  await selectFilterType(page, 'bandpass');
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
    return {
      effectiveDb: engine.getEffectiveBandGains(0).leftDb,
      manualDb: window.ResonantState.controlToBandGainDb(engine.bandGainLeft[0], engine.maxBandBoostDb, engine.maxBandCutDb),
      filterDb: engine.filterModeBandGainsDb[0]
    };
  });
  expect(onBasis.effectiveDb).toBeCloseTo(Math.max(-12, Math.min(12, onBasis.manualDb + onBasis.filterDb)), 10);

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

test('FILTERBANK power gates gains, feedback and resonance effectively and restores stored state', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    const calls = { band: [], feedback: [], all: [], resonance: [] };
    const worklet = {
      setBandBaseGain: (channel, index, value) => calls.band.push({ channel, index, value }),
      setBandFeedback: (channel, index, enabled) => calls.feedback.push({ channel, index, enabled }),
      setFeedbackAll: (channel, enabled) => calls.all.push({ channel, enabled }),
      setResonance: value => calls.resonance.push(value)
    };
    engine.filterbank = worklet;
    const manualLeftControl = window.ResonantState.bandGainDbToControl(3, engine.maxBandBoostDb, engine.maxBandCutDb);
    const manualRightControl = window.ResonantState.bandGainDbToControl(1, engine.maxBandBoostDb, engine.maxBandCutDb);
    engine.setBandBaseGain('left', 5, manualLeftControl);
    engine.setBandBaseGain('right', 5, manualRightControl);
    engine.setPerChannelBands(true);
    engine.filterModeBandGainsDb[5] = -8;
    engine.setFilterEnabled(true);
    engine.setBandFeedback('left', 4, true);
    engine.setFeedbackAll('right', true);
    engine.setResonance(0.72);
    const bothOn = engine.getEffectiveBandGains(5);
    engine.setSpread(0.5);
    const spreadOnce = engine.getEffectiveBandGains(5);
    engine.setSpread(0);
    const nodeBefore = engine.filterbank;
    engine.setFilterbankEnabled(false);
    const off = {
      gainDb: engine.getEffectiveBandGains(5).leftDb,
      state: engine.getState(),
      effective: engine.getFilterbankState(),
      sameNode: nodeBefore === engine.filterbank,
      latestFeedback: calls.feedback.slice(-20),
      latestAll: calls.all.slice(-2),
      latestResonance: calls.resonance.at(-1)
    };
    engine.setFilterbankEnabled(true);
    const restored = {
      gainDb: engine.getEffectiveBandGains(5).leftDb,
      effective: engine.getFilterbankState(),
      sameNode: nodeBefore === engine.filterbank,
      latestFeedback: calls.feedback.slice(-20),
      latestAll: calls.all.slice(-2),
      latestResonance: calls.resonance.at(-1)
    };
    engine.setFilterEnabled(false);
    engine.setFilterbankEnabled(false);
    const bothOff = engine.getEffectiveBandGains(5).leftDb;
    return { bothOn, spreadOnce, off, restored, bothOff };
  });

  expect(report.bothOn.leftDb).toBeCloseTo(-5, 10);
  expect(report.bothOn.rightDb).toBeCloseTo(-7, 10);
  expect(report.spreadOnce.leftDb).toBeCloseTo(-5, 10);
  expect(report.spreadOnce.rightDb).toBeCloseTo(-7, 10);
  expect(report.off.gainDb).toBeCloseTo(-7, 10);
  expect(report.off.state).toMatchObject({ filterbankEnabled: false, filterEnabled: true, resonance: 0.72, feedbackAllRight: true });
  expect(report.off.state.feedbackBandLeft[4]).toBe(true);
  expect(report.off.effective).toMatchObject({ resonance: 0, feedbackAllLeft: false, feedbackAllRight: false });
  expect(report.off.effective.feedbackBandLeft.every(value => value === false)).toBeTruthy();
  expect(report.off.latestFeedback.every(call => call.enabled === false)).toBeTruthy();
  expect(report.off.latestAll.every(call => call.enabled === false)).toBeTruthy();
  expect(report.off.latestResonance).toBe(0);
  expect(report.off.sameNode).toBeTruthy();
  expect(report.restored.gainDb).toBeCloseTo(-5, 10);
  expect(report.restored.effective.feedbackBandLeft[4]).toBe(true);
  expect(report.restored.effective.feedbackAllRight).toBe(true);
  expect(report.restored.effective.resonance).toBeCloseTo(0.72, 10);
  expect(report.restored.latestFeedback.find(call => call.channel === 'left' && call.index === 4)?.enabled).toBe(true);
  expect(report.restored.latestAll.find(call => call.channel === 'right')?.enabled).toBe(true);
  expect(report.restored.latestResonance).toBeCloseTo(0.72, 10);
  expect(report.restored.sameNode).toBeTruthy();
  expect(report.bothOff).toBe(0);
});

test('stored L/R is mode-invariant and both powered-off layers remain neutral', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    const gains = () => Array.from({ length: 10 }, (_, index) => {
      const effective = engine.getEffectiveBandGains(index);
      return { leftDb: effective.leftDb, rightDb: effective.rightDb };
    });

    engine.setBandBaseGain('left', 0, -50);
    engine.setBandBaseGain('right', 0, 50);
    engine.setFilterbankEnabled(false);
    engine.setFilterEnabled(false);
    engine.setPerChannelBands(false);
    const bothOffClassic = gains();

    engine.setPerChannelBands(true);
    const bothOffPerChannel = gains();

    engine.setFilterEnabled(true);
    const filterOnlyPerChannel = gains();

    engine.setFilterEnabled(false);
    engine.setFilterbankEnabled(true);
    engine.setPerChannelBands(false);
    const filterbankOnlyClassic = gains();

    engine.setPerChannelBands(true);
    const filterbankOnlyPerChannel = gains();

    return { bothOffClassic, bothOffPerChannel, filterOnlyPerChannel, filterbankOnlyClassic, filterbankOnlyPerChannel };
  });

  for (const state of [report.bothOffClassic, report.bothOffPerChannel]) {
    expect(state.every(({ leftDb, rightDb }) => leftDb === 0 && rightDb === 0)).toBeTruthy();
  }
  expect(report.filterOnlyPerChannel.some(({ leftDb, rightDb }) => leftDb !== rightDb)).toBeTruthy();
  expect(report.filterbankOnlyClassic.some(({ leftDb, rightDb }) => leftDb !== rightDb)).toBeTruthy();
  expect(report.filterbankOnlyPerChannel).toEqual(report.filterbankOnlyClassic);
});

test('Space, Enter and NumpadEnter keep PANIC semantics and never toggle module power', async ({ page }) => {
  await page.goto('/');
  const filterbankPower = page.locator('[data-module-power="filterbank"]');
  const power = page.locator('[data-module-power="filter"]');
  await power.click();
  await power.focus();

  for (const key of ['Space', 'Enter', 'NumpadEnter']) {
    const resonance = page.locator('[data-control="resonance"]');
    await resonance.fill('0.5');
    await resonance.dispatchEvent('input');
    await power.focus();
    await page.keyboard.press(key);
    expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filterbank', filterbankEnabled: true, filterEnabled: true });
    await expect(filterbankPower).toHaveAttribute('aria-pressed', 'true');
    await expect(power).toHaveAttribute('aria-pressed', 'true');
    await expect(resonance).toHaveValue('0');
  }
});

test('FILTERBANK response controls stay bound to manual FILTERBANK state while FILTER remains audible', async ({ page }) => {
  await page.goto('/');
  const barStyles = () => page.locator('[data-analyzer-band] i[data-channel]').evaluateAll(bars => bars.map(bar => bar.style.height));
  expect(await barStyles()).toEqual(Array(20).fill('0%'));

  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-module-power="filter"]').click();
  await selectFilterType(page, 'lowpass');
  await page.locator('[data-filter-frequency]').fill('180');
  await page.locator('[data-filter-frequency]').dispatchEvent('input');
  await page.locator('[data-filter-slope]').fill('100');
  await page.locator('[data-filter-slope]').dispatchEvent('input');
  const filterShape = await page.evaluate(() => ({
    shape: window.FilterMode.getShape(),
    effective: window.FilterMode.getAudioEngine().effectiveBandGainDbLeft
  }));
  expect(Math.min(...filterShape.shape)).toBeLessThan(-1);
  filterShape.effective.forEach((gain, index) => expect(gain).toBeCloseTo(filterShape.shape[index], 10));

  await page.locator('[data-mode="filterbank"]').click();
  expect(await page.evaluate(() => window.FilterMode.getState())).toMatchObject({ selectedWorkspaceMode: 'filterbank', filterEnabled: true });
  expect(await barStyles()).toEqual(Array(20).fill('0%'));
  const neutralDisplay = await page.evaluate(() => Array.from({ length: 10 }, (_, index) => window.FilterbankAnalyzer.getBandInfo(index).display));
  expect(neutralDisplay.every(gain => gain.leftDb === 0 && gain.rightDb === 0)).toBeTruthy();

  const bandTenControl = await page.evaluate(() => window.ResonantState.bandGainDbToControl(2.9, 12, 12));
  await page.locator('.center-fader .band-fader').nth(9).evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, bandTenControl);
  const bandTen = await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(9));
  expect(bandTen.display.leftDb).toBeCloseTo(2.9, 1);
  expect(bandTen.display.rightDb).toBeCloseTo(2.9, 1);
  await page.locator('[data-analyzer-band="9"]').hover();
  await expect(page.locator('.analyzer-band-detail')).toContainText('L +2.9 dB');
  await expect(page.locator('.analyzer-band-detail')).toContainText('R +2.9 dB');

  await page.locator('.per-channel-toggle').click();
  const channelControls = await page.evaluate(() => ({
    left: window.ResonantState.bandGainDbToControl(4, 12, 12),
    right: window.ResonantState.bandGainDbToControl(-2, 12, 12)
  }));
  await page.locator('.band-fader-channel[data-band="3"][data-channel="left"]').evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, channelControls.left);
  await page.locator('.band-fader-channel[data-band="3"][data-channel="right"]').evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, channelControls.right);
  const perChannelDisplay = await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(3).display);
  expect(perChannelDisplay.leftDb).toBeCloseTo(4, 1);
  expect(perChannelDisplay.rightDb).toBeCloseTo(-2, 1);

  await page.locator('.classic-channel-toggle').click();
  await page.locator('.center-fader .band-fader').first().fill('0');
  await page.locator('[data-control="spread"]').fill('3');
  await page.locator('[data-control="spread"]').dispatchEvent('input');
  const spreadDisplay = await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(0).display);
  expect(spreadDisplay.leftDb).toBeCloseTo(-3, 10);
  expect(spreadDisplay.rightDb).toBeCloseTo(3, 10);

  const filterbankDisplayBeforePowerOff = await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(3).display);
  await page.locator('[data-module-power="filterbank"]').click();
  const poweredOffDisplay = await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(3).display);
  expect(poweredOffDisplay).toEqual(filterbankDisplayBeforePowerOff);

  await page.locator('[data-mode="filter"]').click();
  const filterPathBefore = await page.locator('[data-filter-response-path]').getAttribute('d');
  await page.locator('[data-module-power="filterbank"]').click();
  await expect(page.locator('[data-filter-response-path]')).toHaveAttribute('d', filterPathBefore);
  await expect(page.locator('[data-filter-response-path]')).toHaveAttribute('d', /^M/);
  expect(await page.evaluate(() => window.FilterbankAnalyzer.getDisplayState().outputSpectrum)).toBe(true);
  expect(await page.evaluate(() => window.FilterMode.getState().filterEnabled)).toBe(true);
});

test('FILTER V1 controls remain editable while powered off and restore the identical shape when powered on', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();
  const power = page.locator('[data-module-power="filter"]');
  await expect(power).toHaveAttribute('aria-pressed', 'false');

  for (const type of ['lowpass', 'highpass']) {
    await selectFilterType(page, type);
    await expect(page.locator('[data-filter-bandwidth]')).toBeDisabled();
    await expect(page.locator('[data-filter-bandwidth-control]')).toHaveClass(/is-disabled/);
  }
  for (const type of ['bandpass', 'notch']) {
    await selectFilterType(page, type);
    await expect(page.locator('[data-filter-bandwidth]')).toBeEnabled();
    await expect(page.locator('[data-filter-bandwidth-control]')).not.toHaveClass(/is-disabled/);
  }

  await selectFilterType(page, 'notch');
  await page.locator('[data-filter-frequency]').fill('575');
  await page.locator('[data-filter-slope]').fill('72');
  await page.locator('[data-filter-bandwidth]').fill('38');
  await page.locator('[data-filter-resonance]').fill('80');
  await page.locator('[data-filter-depth]').fill('30');
  const poweredOff = await page.evaluate(() => ({
    state: window.FilterMode.getState(),
    shape: window.FilterMode.getShape(),
    effective: window.FilterMode.getAudioEngine().effectiveBandGainDbLeft
  }));
  expect(poweredOff.state).toMatchObject({ filterEnabled: false, filterType: 'notch', filterSlope: 72, filterBandwidth: 38, filterResonance: 80, filterDepth: 30 });
  expect(poweredOff.shape.some(value => value > 0)).toBeTruthy();
  expect(poweredOff.shape.some(value => value < 0)).toBeTruthy();
  expect(poweredOff.effective).toEqual(Array(10).fill(0));
  await expect(page.locator('[data-filter-response-path]')).toHaveAttribute('d', /^M/);

  await power.click();
  const poweredOn = await page.evaluate(() => ({ shape: window.FilterMode.getShape(), effective: window.FilterMode.getAudioEngine().effectiveBandGainDbLeft }));
  expect(poweredOn.shape).toEqual(poweredOff.shape);
  poweredOn.effective.forEach((value, index) => expect(value).toBeCloseTo(poweredOff.shape[index], 8));
  await power.click();
  await power.click();
  expect(await page.evaluate(() => window.FilterMode.getShape())).toEqual(poweredOff.shape);
});

test('FILTER graph uses an asymmetric dB axis and the desktop workspace keeps a 3:2 visual split', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-band-boost-db]').evaluate(select => { select.value = '24'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('[data-band-cut-db]').evaluate(select => { select.value = '36'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await selectFilterType(page, 'bandpass');
  await page.locator('[data-filter-resonance]').fill('100');
  await page.locator('[data-filter-depth]').fill('100');

  await expect(page.locator('[data-filter-response-ceiling]')).toHaveText('+24 dB');
  await expect(page.locator('[data-filter-response-floor]')).toHaveText('−36 dB');
  const report = await page.evaluate(() => {
    const rect = selector => { const value = document.querySelector(selector).getBoundingClientRect(); return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height }; };
    const markerYs = [...document.querySelectorAll('[data-filter-response-markers] circle')].map(marker => Number(marker.getAttribute('cy')));
    return {
      panel: rect('.filter-mode-panel'),
      graph: rect('.filter-response'),
      controls: rect('.filter-controls'),
      chart: rect('.filter-response-chart'),
      zeroY: Number(document.querySelector('[data-filter-response-zero-line]').getAttribute('y1')),
      markerYs,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    };
  });
  expect(report.zeroY).toBeCloseTo(95.2, 1);
  expect(Math.min(...report.markerYs)).toBeCloseTo(12, 5);
  expect(Math.max(...report.markerYs)).toBeCloseTo(220, 5);
  expect(report.graph.width / (report.graph.width + report.controls.width)).toBeCloseTo(0.6, 2);
  expect(report.graph.top).toBeCloseTo(report.controls.top, 5);
  expect(report.graph.bottom).toBeCloseTo(report.controls.bottom, 5);
  expect(report.graph.right).toBeLessThan(report.controls.left);
  expect(report.scrollWidth).toBe(report.innerWidth);
});

test('FILTER response frequency marker and zero grid share the graph coordinate system', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();

  const frequencySlider = page.locator('[data-filter-frequency]');
  const marker = page.locator('[data-filter-frequency-marker]');
  const markerLabel = page.locator('[data-filter-frequency-marker-label]');
  const setFrequency = async frequencyHz => {
    await frequencySlider.evaluate((slider, frequency) => {
      slider.value = String(window.FilterShape.frequencyToSlider(frequency));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, frequencyHz);
    return page.evaluate(() => {
      const line = document.querySelector('[data-filter-frequency-marker]');
      const svg = line.ownerSVGElement;
      const lineRect = line.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      return {
        x: Number(line.getAttribute('x1')),
        pixelRatio: (lineRect.left - svgRect.left) / svgRect.width,
        label: document.querySelector('[data-filter-frequency-marker-label]').textContent,
        stateFrequency: window.FilterMode.getState().filterFrequencyHz
      };
    });
  };

  const middle = await page.evaluate(() => {
    const line = document.querySelector('[data-filter-frequency-marker]');
    const svg = line.ownerSVGElement;
    const lineRect = line.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    return {
      x: Number(line.getAttribute('x1')),
      pixelRatio: (lineRect.left - svgRect.left) / svgRect.width,
      label: document.querySelector('[data-filter-frequency-marker-label]').textContent
    };
  });
  const expectedMiddleX = 50 + Math.log(777 / 29) / Math.log(11000 / 29) * 900;
  expect(middle.x).toBeCloseTo(expectedMiddleX, 1);
  expect(middle.pixelRatio).toBeCloseTo(expectedMiddleX / 1000, 3);
  expect(middle.label).toBe('777 Hz');

  const left = await setFrequency(29);
  expect(left.x).toBeCloseTo(50, 1);
  expect(left.pixelRatio).toBeCloseTo(0.05, 3);
  expect(left.stateFrequency).toBeCloseTo(29, 0);

  const right = await setFrequency(11000);
  expect(right.x).toBeCloseTo(950, 1);
  expect(right.pixelRatio).toBeCloseTo(0.95, 3);
  expect(right.stateFrequency).toBeCloseTo(11000, 0);
  expect(await marker.evaluate(line => line.getBoundingClientRect().height)).toBeGreaterThan(0);
  expect(await marker.evaluate(line => getComputedStyle(line).stroke)).not.toBe('none');
  await expect(markerLabel).toBeVisible();

  const zeroAlignment = async () => page.evaluate(() => {
    const zero = document.querySelector('[data-filter-response-zero-line]');
    const grid = document.querySelector('[data-filter-response-zero-grid-line]');
    const zeroRect = zero.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    return {
      zeroY: Number(zero.getAttribute('y1')),
      gridY: Number(grid.getAttribute('y1')),
      pixelDelta: Math.abs(zeroRect.top - gridRect.top)
    };
  });

  let alignment = await zeroAlignment();
  expect(alignment.zeroY).toBeCloseTo(116, 2);
  expect(alignment.gridY).toBeCloseTo(alignment.zeroY, 5);
  expect(alignment.pixelDelta).toBeLessThan(1);

  await page.locator('[data-band-boost-db]').evaluate(select => { select.value = '24'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('[data-band-cut-db]').evaluate(select => { select.value = '36'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  alignment = await zeroAlignment();
  expect(alignment.zeroY).toBeCloseTo(95.2, 2);
  expect(alignment.gridY).toBeCloseTo(alignment.zeroY, 5);
  expect(alignment.pixelDelta).toBeLessThan(1);

  const controlStyles = await page.evaluate(() => {
    const frequency = getComputedStyle(document.querySelector('.filter-frequency-control'));
    const typeButton = document.querySelector('[data-filter-type]').getBoundingClientRect();
    return {
      borderRightWidth: frequency.borderRightWidth,
      borderBottomWidth: frequency.borderBottomWidth,
      typeButtonHeight: typeButton.height
    };
  });
  expect(controlStyles.borderRightWidth).toBe('0px');
  expect(Number.parseFloat(controlStyles.borderBottomWidth)).toBeGreaterThan(0);
  expect(controlStyles.typeButtonHeight).toBeCloseTo(22, 1);
});

test('legacy FILTER snapshots default missing resonance and depth safely', async ({ page }) => {
  await page.goto('/');
  const restored = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    engine.setFilterState({ filterResonance: 87, filterDepth: 13 });
    const legacy = engine.getState();
    delete legacy.filterResonance;
    delete legacy.filterDepth;
    engine.applyState(legacy);
    return engine.getState();
  });
  expect(restored.filterResonance).toBe(0);
  expect(restored.filterDepth).toBe(100);
});

test('FILTER type buttons group ten types and keep selection separate from PANIC', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();
  await expect(page.locator('.filter-type-groups')).toBeVisible();
  await expect(page.locator('[data-filter-type]')).toHaveCount(10);
  await expect(page.locator('.filter-type-group > strong')).toHaveText(['CLASSIC', 'EQ / TONE / FORMANT']);
  await page.locator('[data-filter-type="bell"]').click();
  await expect(page.locator('[data-filter-type="bell"]')).toHaveClass(/active/);
  await expect(page.locator('[data-filter-control="gain"]')).toBeEnabled();
  await expect(page.locator('[data-filter-control="bellWidth"]')).toBeEnabled();
  expect(await page.evaluate(() => window.FilterMode.getState().filterType)).toBe('bell');
  await page.locator('[data-filter-type="lowshelf"]').click();
  expect(await page.evaluate(() => window.FilterMode.getState().filterType)).toBe('lowshelf');
  await expect(page.locator('[data-control="resonance"]')).toHaveValue('0');
});

test('extended FILTER controls preserve per-type values, graph markers and power behavior', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-filter-frequency]').fill('720');
  const classicFrequency = await page.evaluate(() => window.FilterMode.getState().filterFrequencyHz);
  await selectFilterType(page, 'bell');
  await page.locator('[data-filter-control="gain"]').fill('6');
  await page.locator('[data-filter-control="bellFrequency"]').fill('540');
  const bellFrequency = await page.evaluate(() => window.FilterMode.getState().filterBellFrequencyHz);
  expect(bellFrequency).not.toBe(classicFrequency);
  const bellShape = await page.evaluate(() => window.FilterMode.getShape());
  expect(Math.max(...bellShape)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().effectiveBandGainDbLeft)).toEqual(Array(10).fill(0));
  await page.locator('[data-module-power="filter"]').click();
  (await page.evaluate(() => window.FilterMode.getAudioEngine().effectiveBandGainDbLeft))
    .forEach((value, index) => expect(value).toBeCloseTo(bellShape[index], 8));
  await selectFilterType(page, 'formant');
  await expect(page.locator('[data-filter-primary-control] > span')).toHaveText('VOWEL');
  await expect(page.locator('[data-filter-formant-markers] line')).toHaveCount(3);
  await expect(page.locator('[data-filter-frequency-marker]')).toBeHidden();
  await page.locator('[data-filter-control="vowel"]').fill('0.35');
  await expect(page.locator('[data-filter-frequency-output]')).toContainText('A → E 35 %');
  await selectFilterType(page, 'baxandall');
  await expect(page.locator('[data-filter-primary-control] > span')).toHaveText('TONE CENTER');
  await expect(page.locator('[data-filter-control="bass"]')).toBeEnabled();
  await expect(page.locator('[data-filter-control="treble"]')).toBeEnabled();
  await page.locator('[data-filter-control="bass"]').fill('5');
  const toneShape = await page.evaluate(() => window.FilterMode.getShape());
  expect(toneShape[0]).toBeGreaterThan(0);
  await selectFilterType(page, 'lowpass');
  expect(await page.evaluate(() => window.FilterMode.getState().filterFrequencyHz)).toBe(classicFrequency);
  await selectFilterType(page, 'bell');
  await expect(page.locator('[data-filter-control="gain"]')).toHaveValue('6');
  expect(await page.evaluate(() => window.FilterMode.getState().filterBellFrequencyHz)).toBe(bellFrequency);
  await page.locator('[data-module-power="filter"]').click();
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().effectiveBandGainDbLeft)).toEqual(Array(10).fill(0));
});

test('extended filter state round-trips and legacy snapshots receive safe defaults', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    const values = { filterType: 'formant', filterGainDb: 5.5, filterTiltDb: -4.5, filterFormantVowel: 2.25, filterFormantShiftSemitones: 7, filterFormantWidth: 65, filterFormantAmount: 82, filterBaxandallBassDb: 3.5, filterBaxandallTrebleDb: -2, filterBaxandallCenterHz: 1200, filterBaxandallSlope: 68 };
    engine.setFilterState(values);
    const saved = engine.getState();
    engine.setFilterState({ filterFormantVowel: 4, filterGainDb: 0 });
    engine.applyState(saved);
    const restored = engine.getState();
    const legacy = { ...saved };
    window.ResonantState.FILTER_EXTRA_FIELDS.forEach(field => delete legacy[field]);
    engine.applyState(legacy);
    return { saved, restored, legacy: engine.getState(), defaults: window.ResonantState.normalizeFilterState({}) };
  });
  for (const field of await page.evaluate(() => window.ResonantState.FILTER_EXTRA_FIELDS)) {
    expect(report.restored[field]).toBe(report.saved[field]);
    expect(report.legacy[field]).toBe(report.defaults[field]);
  }
  await page.reload();
  const reloaded = await page.evaluate(saved => {
    const engine = window.FilterMode.getAudioEngine();
    engine.applyState(saved);
    return engine.getState();
  }, report.saved);
  for (const field of await page.evaluate(() => window.ResonantState.FILTER_EXTRA_FIELDS)) expect(reloaded[field]).toBe(report.saved[field]);
});

test('FORMANT SHIFT exposes the extended range and keeps UI, response and snapshots aligned', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();
  await selectFilterType(page, 'formant');
  const shift = page.locator('[data-filter-control="shift"]');
  const shiftOutput = page.locator('.filter-parameter-control:has([data-filter-control="shift"]) output');
  await expect(shift).toHaveAttribute('min', '-36');
  await expect(shift).toHaveAttribute('max', '24');
  await expect(shift).toHaveValue('0');
  await expect(shiftOutput).toHaveText('0 st');

  const samples = [];
  for (const value of ['-36', '0', '6', '12', '24']) {
    await shift.fill(value);
    await expect(shiftOutput).toHaveText(`${Number(value) > 0 ? '+' : ''}${value} st`);
    samples.push(await page.evaluate(() => ({
      shift: window.FilterMode.getState().filterFormantShiftSemitones,
      shape: window.FilterMode.getShape(),
      markers: [...document.querySelectorAll('[data-filter-formant-markers] line')]
        .map(line => ({ x: Number(line.getAttribute('x1')), title: line.querySelector('title')?.textContent }))
    })));
  }
  expect(samples.map(sample => sample.shift)).toEqual([-36, 0, 6, 12, 24]);
  for (const sample of samples) {
    expect(sample.shape.every(Number.isFinite)).toBe(true);
    expect(sample.markers).toHaveLength(3);
    expect(sample.markers.every(marker => Number.isFinite(marker.x) && marker.x >= 50 && marker.x <= 950)).toBe(true);
  }
  expect(samples[0].shape).not.toEqual(samples[1].shape);
  expect(samples[4].shape).not.toEqual(samples[1].shape);
  expect(samples[4].markers[2].title).toContain('11600 Hz');

  const snapshot = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    engine.setFilterState({ filterType: 'formant', filterFormantShiftSemitones: -36 });
    const low = engine.getState();
    engine.setFilterState({ filterFormantShiftSemitones: 6 });
    engine.applyState(low);
    const restoredLow = engine.getState().filterFormantShiftSemitones;
    engine.setFilterState({ filterFormantShiftSemitones: 24 });
    const high = engine.getState();
    engine.setFilterState({ filterFormantShiftSemitones: 0 });
    engine.applyState(high);
    return { low: low.filterFormantShiftSemitones, restoredLow,
      high: high.filterFormantShiftSemitones,
      clampedLow: window.ResonantState.normalizeFilterState({ filterFormantShiftSemitones: -90 }).filterFormantShiftSemitones,
      clampedHigh: window.ResonantState.normalizeFilterState({ filterFormantShiftSemitones: 90 }).filterFormantShiftSemitones };
  });
  expect(snapshot).toEqual({ low: -36, restoredLow: -36, high: 24, clampedLow: -36, clampedHigh: 24 });
});

test('all extended types update the response and respect FILTER power independently', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();
  const power = page.locator('[data-module-power="filter"]');
  let previousPath = await page.locator('[data-filter-response-path]').getAttribute('d');
  for (const [type, control, value] of [
    ['bell', 'gain', '6'], ['lowshelf', 'lowShelfGain', '6'], ['highshelf', 'highShelfGain', '6'],
    ['tilt', 'tilt', '6'], ['formant', 'vowel', '1.5'], ['baxandall', 'bass', '6']
  ]) {
    await selectFilterType(page, type);
    await page.locator(`[data-filter-control="${control}"]`).fill(value);
    const path = await page.locator('[data-filter-response-path]').getAttribute('d');
    expect(path).not.toBe(previousPath);
    previousPath = path;
    const shape = await page.evaluate(() => window.FilterMode.getShape());
    expect(shape.some(value => value > 0)).toBeTruthy();
    expect(await page.evaluate(() => window.FilterMode.getAudioEngine().effectiveBandGainDbLeft)).toEqual(Array(10).fill(0));
    await power.click();
    (await page.evaluate(() => window.FilterMode.getAudioEngine().effectiveBandGainDbLeft))
      .forEach((gain, index) => expect(gain).toBeCloseTo(shape[index], 7));
    await power.click();
  }
  await expect(page.locator('[data-module-power="filterbank"]')).toHaveAttribute('aria-pressed', 'true');
});

test('gain controls follow DEV boost and cut limits without changing panel geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();
  const before = await page.locator('.filter-controls').boundingBox();
  await selectFilterType(page, 'bell');
  await page.locator('[data-band-boost-db]').evaluate(select => { select.value = '24'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('[data-band-cut-db]').evaluate(select => { select.value = '36'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('[data-filter-control="gain"]')).toHaveAttribute('min', '-36');
  await expect(page.locator('[data-filter-control="gain"]')).toHaveAttribute('max', '24');
  await expect(page.locator('[data-filter-control="gain"]')).toHaveAttribute('step', '0.1');
  await selectFilterType(page, 'formant');
  await selectFilterType(page, 'baxandall');
  const after = await page.locator('.filter-controls').boundingBox();
  expect(after).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

test('response graph places positive and negative BELL and TILT samples around zero', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();
  const graph = () => page.evaluate(() => ({
    zero: Number(document.querySelector('[data-filter-response-zero-line]').getAttribute('y1')),
    points: [...document.querySelectorAll('[data-filter-response-markers] circle')].map(circle => Number(circle.getAttribute('cy')))
  }));
  await selectFilterType(page, 'bell');
  await page.locator('[data-filter-control="gain"]').fill('6');
  let response = await graph();
  expect(response.points[5]).toBeLessThan(response.zero);
  await page.locator('[data-filter-control="gain"]').fill('-6');
  response = await graph();
  expect(response.points[5]).toBeGreaterThan(response.zero);
  await selectFilterType(page, 'tilt');
  await page.locator('[data-filter-control="tilt"]').fill('6');
  response = await graph();
  expect(response.points[0]).toBeGreaterThan(response.zero);
  expect(response.points[9]).toBeLessThan(response.zero);
});
