const { test, expect } = require('playwright/test');
const { browserBundle } = require('./helpers/input-character-full-graph.cjs');

test('worklet modulation keeps base values and evaluates FILTER, resonance, filterbank, and Dynamic EQ targets', async ({ page }) => {
  await page.goto('/');
  const bundle = browserBundle('http://localhost:3000');
  const result = await page.evaluate(async code => {
    const engine = new window.AudioEngine({});
    engine.setFilterState({ filterType: 'lowpass', filterFrequencyHz: 777 });
    engine.setFilterEnabled(true);
    engine.setFilterbankEnabled(true);
    engine.setResonance(.2);
    engine.setDynamicEq({ dynamicEqEnabled: true, dynamicEqThresholdDb: -24, dynamicEqRangeDb: 6 });
    const options = engine.getFilterbankState();
    options.bandFrequencies = [...window.Filterbank.BAND_FREQUENCIES];
    options.bandQs = [...window.Filterbank.BAND_QS];
    options.bandGainLeft = Array(10).fill(0);
    options.bandGainRight = Array(10).fill(0);
    options.bandGainLeft[5] = 50;
    options.bandGainRight[5] = -100 / 6;
    options.maxBandBoostDb = 12;
    options.maxBandCutDb = 12;
    const bundleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { Graph } = await import(bundleUrl);
    URL.revokeObjectURL(bundleUrl);
    const graph = new Graph(48000, options, 'linear', false);
    const state = {
      ...engine.getModulationState(),
      lfoEnabled: true,
      lfoWaveform: 'saw-down',
      lfoRateHz: 1,
      lfoPolarity: 'bipolar',
      lfoPhase: 0,
      lfoTargetId: 'filter.frequencyHz',
      lfoAmount: 25,
      assignments: [
        { sourceId: 'lfo.1', targetId: 'filter.frequencyHz', amount: 25 },
        { sourceId: 'lfo.1', targetId: 'global.resonance', amount: 25 },
        { sourceId: 'lfo.1', targetId: 'filterbank.band.5.gainDb', amount: 25 },
        { sourceId: 'lfo.1', targetId: 'dynamicEq.thresholdDb', amount: 25 }
      ]
    };
    graph.bank.setModulationState(state);
    const active = {
      filterBase: graph.bank.filterShapeParams.frequencyHz,
      filterEffective: graph.bank.effectiveFilterShapeParams.frequencyHz,
      resonanceBase: graph.bank.baseResonance,
      resonanceEffective: graph.bank.resonanceTarget,
      dynamicEqBase: graph.bank.dynamicEqThresholdDb,
      dynamicEqEffective: graph.bank.dynamicEqEffectiveSettings.dynamicEqThresholdDb,
      bandOffset: graph.bank.modulationBandOffsetsDb[5],
      leftMultiplier: graph.bank.modulationBandGainTargets.left[5],
      rightMultiplier: graph.bank.modulationBandGainTargets.right[5],
      filterShapeOffset: graph.bank.effectiveFilterShapeGainsDb[5] - graph.bank.baseFilterShapeGainsDb[5],
      directBandOffset: graph.bank.modulationDirectBandOffsetsDb[5],
      leftBaseDb: graph.bank.controlToGainDb(graph.bank.bandControls.left[5]),
      rightBaseDb: graph.bank.controlToGainDb(graph.bank.bandControls.right[5]),
      maxBoostDb: graph.bank.maxBandBoostDb,
      maxCutDb: graph.bank.maxBandCutDb,
      leftControl: graph.bank.bandControls.left[5],
      rightControl: graph.bank.bandControls.right[5],
      sourceArrays: [options.bandGainLeft[5], options.bandGainRight[5]]
    };
    graph.bank.setModulationState({ ...state, filterbankEnabled: false });
    const feedbackOff = { base: graph.bank.baseResonance, effective: graph.bank.resonanceTarget };
    graph.bank.setModulationState({ ...state, lfoEnabled: false });
    const inactive = {
      filterEffective: graph.bank.effectiveFilterShapeParams.frequencyHz,
      resonanceEffective: graph.bank.resonanceTarget,
      dynamicEqEffective: graph.bank.dynamicEqEffectiveSettings.dynamicEqThresholdDb,
      bandOffset: graph.bank.modulationBandOffsetsDb[5],
      leftMultiplier: graph.bank.modulationBandGainTargets.left[5],
      rightMultiplier: graph.bank.modulationBandGainTargets.right[5],
      assignments: graph.bank.modulationCore.getAssignments()
    };
    return { active, feedbackOff, inactive };
  }, bundle);

  expect(result.active.filterBase).toBe(777);
  expect(result.active.filterEffective).toBeGreaterThan(777);
  expect(result.active.resonanceBase).toBeCloseTo(.2, 8);
  expect(result.active.resonanceEffective).toBeCloseTo(.45, 8);
  expect(result.active.dynamicEqBase).toBe(-24);
  expect(result.active.dynamicEqEffective).toBeCloseTo(-16.5, 8);
  expect(result.active.directBandOffset).toBeCloseTo(3, 8);
  expect(result.active.bandOffset).toBeCloseTo(result.active.filterShapeOffset + 3, 8);
  const leftEffectiveDb = Math.min(result.active.maxBoostDb, Math.max(-result.active.maxCutDb, result.active.leftBaseDb + result.active.bandOffset));
  const rightEffectiveDb = Math.min(result.active.maxBoostDb, Math.max(-result.active.maxCutDb, result.active.rightBaseDb + result.active.bandOffset));
  expect(result.active.leftMultiplier).toBeCloseTo(10 ** ((leftEffectiveDb - result.active.leftBaseDb) / 20), 8);
  expect(result.active.rightMultiplier).toBeCloseTo(10 ** ((rightEffectiveDb - result.active.rightBaseDb) / 20), 8);
  expect(result.active.leftControl).toBe(50);
  expect(result.active.rightControl).toBeCloseTo(-100 / 6, 8);
  expect(result.active.sourceArrays).toEqual([50, -100 / 6]);
  expect(result.feedbackOff.base).toBeCloseTo(.2, 8);
  expect(result.feedbackOff.effective).toBe(0);
  expect(result.inactive.filterEffective).toBeCloseTo(777, 8);
  expect(result.inactive.resonanceEffective).toBeCloseTo(.2, 8);
  expect(result.inactive.dynamicEqEffective).toBe(-24);
  expect(result.inactive.bandOffset).toBeCloseTo(0, 8);
  expect(result.inactive.leftMultiplier).toBeCloseTo(1, 8);
  expect(result.inactive.rightMultiplier).toBeCloseTo(1, 8);
  expect(result.inactive.assignments).toHaveLength(4);
});

test('global resonance base edits are sent through the modulation layer', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const engine = new window.AudioEngine({});
    const updates = [];
    const directResonanceWrites = [];
    engine.filterbankEnabled = true;
    engine.filterbank = {
      setModulationState: value => updates.push(value),
      setResonance: value => directResonanceWrites.push(value)
    };
    engine.setModulationState({ lfoEnabled: true, lfoTargetId: 'global.resonance', lfoAmount: 25 });
    engine.setResonance(.4);
    const activeResonance = { update: updates.at(-1), direct: [...directResonanceWrites] };
    engine.setModulationState({ lfoEnabled: true, lfoTargetId: 'filter.frequencyHz', lfoAmount: 25 });
    engine.setResonance(.6);
    return { activeResonance, otherTarget: updates.at(-1), directResonanceWrites, base: engine.resonance };
  });
  expect(result.base).toBe(.6);
  expect(result.activeResonance.update.baseResonance).toBe(.4);
  expect(result.activeResonance.update.assignments).toEqual([{ sourceId: 'lfo.1', targetId: 'global.resonance', amount: 25 }]);
  expect(result.activeResonance.direct).toEqual([]);
  expect(result.otherTarget.baseResonance).toBe(.6);
  expect(result.otherTarget.assignments).toEqual([{ sourceId: 'lfo.1', targetId: 'filter.frequencyHz', amount: 25 }]);
  expect(result.directResonanceWrites).toEqual([.6]);
});

test('formant assignments survive inactive FILTER types and become active again', async ({ page }) => {
  await page.goto('/');
  const bundle = browserBundle('http://localhost:3000');
  const result = await page.evaluate(async code => {
    const engine = new window.AudioEngine({});
    engine.setFilterEnabled(true);
    engine.setFilterState({ filterType: 'formant', filterFormantVowel: 2 });
    const options = engine.getFilterbankState();
    options.bandFrequencies = [...window.Filterbank.BAND_FREQUENCIES];
    options.bandQs = [...window.Filterbank.BAND_QS];
    const bundleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { Graph } = await import(bundleUrl);
    URL.revokeObjectURL(bundleUrl);
    const graph = new Graph(48000, options, 'linear', false);
    const assignment = { sourceId: 'lfo.1', targetId: 'filter.formantVowel', amount: 25 };
    const config = type => ({
      ...engine.getModulationState(),
      filterShapeParams: window.FilterShape.shapeParametersFromState({ filterType: type, filterFormantVowel: 2 }),
      lfoEnabled: true, lfoWaveform: 'saw-down', lfoTargetId: assignment.targetId, lfoAmount: assignment.amount,
      assignments: [assignment]
    });
    graph.bank.setModulationState(config('formant'));
    const activeValue = graph.bank.effectiveFilterShapeParams.formantVowel;
    graph.bank.setModulationState(config('lowpass'));
    const inactiveValue = graph.bank.effectiveFilterShapeParams.formantVowel;
    const preserved = graph.bank.modulationCore.getAssignments();
    graph.bank.setModulationState(config('formant'));
    return { activeValue, inactiveValue, reactivatedValue: graph.bank.effectiveFilterShapeParams.formantVowel, preserved };
  }, bundle);
  expect(result.activeValue).toBeCloseTo(2.5, 8);
  expect(result.inactiveValue).toBe(2);
  expect(result.reactivatedValue).toBeCloseTo(2.5, 8);
  expect(result.preserved).toEqual([{ sourceId: 'lfo.1', targetId: 'filter.formantVowel', amount: 25 }]);
});

test('LFO workspace controls stay separate from selection and fit desktop and tablet viewports', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  for (const viewport of [{ width: 1914, height: 907 }, { width: 1440, height: 900 }, { width: 1914, height: 768 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.locator('[data-mode="lfo"]').click();
    await expect(page.locator('[data-mode-panel="lfo"]')).toBeVisible();
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-waveform]')).toHaveCount(6);
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-target] option')).toHaveCount(21);
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-rate]')).toBeVisible();
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-amount]')).toBeVisible();
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-phase]')).toBeVisible();
    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      panel: document.querySelector('[data-mode-panel="lfo"]').scrollWidth,
      panelWidth: document.querySelector('[data-mode-panel="lfo"]').clientWidth,
      maxScrollLeft: (() => { window.scrollTo(1000, 0); const value = window.scrollX; window.scrollTo(0, 0); return value; })(),
      overflowing: [...document.querySelectorAll('body *')].map(element => ({
        tag: element.tagName, id: element.id, className: typeof element.className === 'string' ? element.className : '',
        right: Math.round(element.getBoundingClientRect().right * 10) / 10,
        width: Math.round(element.getBoundingClientRect().width * 10) / 10
      })).filter(element => element.right > document.documentElement.clientWidth + .5).slice(0, 12)
    }));
    expect(overflow.page, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.panel).toBeLessThanOrEqual(overflow.panelWidth);
    expect(overflow.maxScrollLeft, JSON.stringify({ viewport, overflow })).toBe(0);
  }
  for (const theme of ['clean-modern', 'warm-studio']) {
    await page.locator('[data-theme-select]').selectOption(theme);
    const themedStroke = await page.locator('[data-lfo-wave-path]').evaluate(element => getComputedStyle(element).stroke);
    expect(themedStroke).not.toBe('none');
    expect(themedStroke).not.toBe('');
  }
  const before = await page.evaluate(() => window.LfoMode.getState().lfoEnabled);
  expect(before).toBe(false);
  await page.locator('[data-module-power="lfo"]').click();
  await page.locator('[data-lfo-waveform="triangle"]').click();
  await page.locator('[data-lfo-target]').selectOption('filter.frequencyHz');
  await page.locator('[data-lfo-rate]').evaluate(element => { element.value = '1000'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-lfo-amount]').evaluate(element => { element.value = '60'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-lfo-phase]').evaluate(element => { element.value = '90'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-lfo-polarity="unipolar"]').click();
  await page.evaluate(() => window.LfoMode.getAudioEngine().onLfoTelemetry({ enabled: true, waveform: 'triangle', polarity: 'bipolar', rateHz: 1, phase: .5, value: .75 }));
  await page.locator('[data-lfo-waveform="sample-hold"]').click();
  await page.evaluate(() => {
    window.__lfoResetCalled = false;
    window.LfoMode.getAudioEngine().filterbank = { resetLfoPhase() { window.__lfoResetCalled = true; return true; } };
  });
  await page.locator('[data-lfo-reset]').click();
  const ui = await page.evaluate(() => ({
    state: window.LfoMode.getState(),
    x: Number(document.querySelector('[data-lfo-phase-dot]').getAttribute('cx')),
    y: Number(document.querySelector('[data-lfo-phase-dot]').getAttribute('cy')),
    wave: document.querySelector('[data-lfo-wave-path]').getAttribute('d'),
    resetCalled: window.__lfoResetCalled
  }));
  expect(ui.state).toMatchObject({ lfoEnabled: true, lfoWaveform: 'sample-hold', lfoTargetId: 'filter.frequencyHz', lfoAmount: 60, lfoPhase: 90, lfoPolarity: 'unipolar' });
  expect(ui.state.lfoRateHz).toBeCloseTo(20, 8);
  expect(ui.x).toBeGreaterThanOrEqual(500);
  expect(ui.x).toBeLessThan(540);
  expect(ui.y).toBeCloseTo(66, 0);
  expect(ui.wave.startsWith('M0.00 66.00')).toBe(true);
  expect(ui.resetCalled).toBe(true);
  expect(pageErrors).toEqual([]);
});
