const { test, expect } = require('playwright/test');

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
  await page.locator('[data-filter-type="bandpass"]').click();
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
  await expect(page.locator('.mode-power:disabled')).toHaveCount(5);
  await expect(page.locator('[data-mode="filterbank"]').locator('xpath=..').locator('[data-module-power="filterbank"]')).toHaveCount(1);
  await expect(page.locator('[data-mode="presets"]').locator('xpath=..').locator('.mode-power-slot')).toHaveCount(1);
});

test('FILTER and FILTERBANK layers combine in dB and preserve both parameter systems', async ({ page }) => {
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
  await page.locator('[data-filter-type="lowpass"]').click();
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
    await page.locator(`[data-filter-type="${type}"]`).click();
    await expect(page.locator('[data-filter-bandwidth]')).toBeDisabled();
    await expect(page.locator('[data-filter-bandwidth-control]')).toHaveClass(/is-disabled/);
  }
  for (const type of ['bandpass', 'notch']) {
    await page.locator(`[data-filter-type="${type}"]`).click();
    await expect(page.locator('[data-filter-bandwidth]')).toBeEnabled();
    await expect(page.locator('[data-filter-bandwidth-control]')).not.toHaveClass(/is-disabled/);
  }

  await page.locator('[data-filter-type="notch"]').click();
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
  await page.locator('[data-filter-type="bandpass"]').click();
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
