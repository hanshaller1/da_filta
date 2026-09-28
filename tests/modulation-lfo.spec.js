const { test, expect } = require('playwright/test');
const { browserBundle } = require('./helpers/input-character-full-graph.cjs');

test('LFO graph keeps one bipolar zero line and removes its duplicate horizontal background guide', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="lfo"]').click();
  const middleLines = page.locator('[data-lfo-visualizer] line.lfo-grid-line[y1="60"]');
  await expect(middleLines).toHaveCount(1);
  const graph = await page.locator('[data-lfo-visualizer]').evaluate(element => ({
    linePositions: [...element.querySelectorAll('line.lfo-grid-line')].map(line => Number(line.getAttribute('y1'))),
    backgroundImage: getComputedStyle(element).backgroundImage
  }));
  expect(graph.linePositions).toEqual([6, 60, 114]);
  expect(graph.backgroundImage).not.toContain('to bottom');
});

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
    const lfoSources = engine.getModulationState().lfoSources.map(source => ({ ...source }));
    Object.assign(lfoSources[0], { enabled: true, waveform: 'saw-down', rateHz: 1, polarity: 'bipolar', phaseOffsetDeg: 0,
      targetId: 'filter.frequencyHz', amount: 25 });
    const state = {
      ...engine.getModulationState(),
      lfoEnabled: true,
      lfoModuleEnabled: true,
      lfoSources,
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
    graph.bank.setModulationState({ ...state, lfoEnabled: false, lfoModuleEnabled: false });
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
    const config = type => {
      const lfoSources = engine.getModulationState().lfoSources.map(source => ({ ...source }));
      Object.assign(lfoSources[0], { enabled: true, waveform: 'saw-down', targetId: assignment.targetId, amount: assignment.amount });
      return {
        ...engine.getModulationState(),
        filterShapeParams: window.FilterShape.shapeParametersFromState({ filterType: type, filterFormantVowel: 2 }),
        lfoEnabled: true, lfoModuleEnabled: true, lfoSources, assignments: [assignment]
      };
    };
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

test('four LFOs concurrently modulate FILTER, stereo band gains, and dry/wet without changing bases', async ({ page }) => {
  await page.goto('/');
  const bundle = browserBundle('http://localhost:3000');
  const result = await page.evaluate(async code => {
    const engine = new window.AudioEngine({});
    engine.setFilterEnabled(true);
    engine.setDryWet(50);
    const options = engine.getFilterbankState();
    options.bandFrequencies = [...window.Filterbank.BAND_FREQUENCIES];
    options.bandQs = [...window.Filterbank.BAND_QS];
    options.bandGainLeft = Array(10).fill(0); options.bandGainRight = Array(10).fill(0);
    options.bandGainLeft[2] = 50; options.bandGainRight[2] = -100 / 6;
    options.maxBandBoostDb = 12; options.maxBandCutDb = 12;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { Graph } = await import(url); URL.revokeObjectURL(url);
    const graph = new Graph(48000, options, 'linear', false);
    const sources = engine.getModulationState().lfoSources.map((source, index) => ({
      ...source, enabled: true, waveform: index === 3 ? 'square' : 'saw-down', rateHz: 1, rateMode: 'free', polarity: 'bipolar', phaseOffsetDeg: 0,
      amount: [25, 25, 25, 20][index], invert: index === 2,
      targetId: ['filter.frequencyHz', 'filterbank.band.2.gainDb', 'filterbank.band.2.gainDb', 'global.dryWet'][index],
      channel: ['both', 'left', 'right', 'both'][index]
    }));
    const assignments = sources.map(source => ({ sourceId: source.id, targetId: source.targetId, amount: source.amount, channel: source.channel }));
    graph.bank.setModulationState({ ...engine.getModulationState(), lfoModuleEnabled: true, lfoSources: sources, assignments,
      filterEnabled: true, filterbankEnabled: true, dryWet: 50 });
    const active = {
      filterBase: graph.bank.filterShapeParams.frequencyHz,
      filterEffective: graph.bank.effectiveFilterShapeParams.frequencyHz,
      leftOffset: graph.bank.modulationDirectBandOffsetsByChannel.left[2],
      rightOffset: graph.bank.modulationDirectBandOffsetsByChannel.right[2],
      dryWetBase: graph.bank.dryWet,
      dryWetEffective: graph.bank.effectiveDryWetTarget,
      sourceBases: [graph.bank.bandControls.left[2], graph.bank.bandControls.right[2]]
    };
    graph.bank.setModulationState({ ...engine.getModulationState(), lfoModuleEnabled: true, lfoSources: sources, assignments,
      filterEnabled: true, filterbankEnabled: true, dryWet: 50, perChannelBands: true, baseSpread: 0,
      assignments: [...assignments, { sourceId: 'lfo.4', targetId: 'global.spread', amount: 100 }] });
    const silence = [new Float32Array(128), new Float32Array(128)];
    for (let block = 0; block < 100; block += 1) graph.process(silence);
    return { active, spreadOffset: graph.bank.effectiveSpreadDeltaDb, spreadMode: graph.bank.spreadMode,
      dryWetControlDelta: graph.bankModOut[0][127] };
  }, bundle);
  expect(result.active.filterBase).toBe(777);
  expect(result.active.filterEffective).toBeGreaterThan(777);
  expect(result.active.leftOffset).toBeCloseTo(3, 8);
  expect(result.active.rightOffset).toBeCloseTo(-3, 8);
  expect(result.active.dryWetBase).toBe(50);
  expect(result.active.dryWetEffective).toBe(60);
  expect(result.active.sourceBases).toEqual([50, -100 / 6]);
  expect(result.spreadOffset).toBe(0);
  expect(result.dryWetControlDelta).toBeCloseTo(.1, 2);
});

test('MIDI transport START resets sync LFOs, CONTINUE preserves beat, and STOP freezes only sync', async ({ page }) => {
  await page.goto('/');
  const bundle = browserBundle('http://localhost:3000');
  const result = await page.evaluate(async code => {
    const engine = new window.AudioEngine({});
    const options = engine.getFilterbankState();
    options.bandFrequencies = [...window.Filterbank.BAND_FREQUENCIES];
    options.bandQs = [...window.Filterbank.BAND_QS];
    options.bandGainLeft = Array(10).fill(0); options.bandGainRight = Array(10).fill(0);
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { Graph } = await import(url); URL.revokeObjectURL(url);
    const graph = new Graph(48000, options, 'linear', false);
    const sources = engine.getModulationState().lfoSources.map((source, index) => ({
      ...source, enabled: index < 2, waveform: index === 0 ? 'sample-hold' : 'sine', seed: 9876,
      rateMode: index === 0 ? 'sync' : 'free', syncDivision: '1/4', rateHz: 1, targetId: '', amount: 0
    }));
    graph.bank.setModulationState({ ...engine.getModulationState(), lfoModuleEnabled: true, lfoSources: sources,
      assignments: [], clock: { source: 'midi', midiBpm: 120, running: true } });
    const silence = [new Float32Array(128), new Float32Array(128)];
    graph.bank.handleMessage({ type: 'midi-clock-start' });
    const initialStartSample = graph.bank.lfoSources[0].sampleValue;
    for (let block = 0; block < 188; block += 1) graph.process(silence);
    const beforeStop = { beat: graph.bank.clockCore.beatPosition, syncPhase: graph.bank.lfoSources[0].phase, freePhase: graph.bank.lfoSources[1].phase };
    graph.bank.handleMessage({ type: 'midi-clock-stop' });
    for (let block = 0; block < 94; block += 1) graph.process(silence);
    const stopped = { beat: graph.bank.clockCore.beatPosition, syncPhase: graph.bank.lfoSources[0].phase, freePhase: graph.bank.lfoSources[1].phase };
    graph.bank.handleMessage({ type: 'midi-clock-continue' });
    const continuedBeat = graph.bank.clockCore.beatPosition;
    for (let block = 0; block < 47; block += 1) graph.process(silence);
    const continued = { beat: graph.bank.clockCore.beatPosition, syncPhase: graph.bank.lfoSources[0].phase, freePhase: graph.bank.lfoSources[1].phase };
    graph.bank.handleMessage({ type: 'midi-clock-start' });
    const restarted = { beat: graph.bank.clockCore.beatPosition, pulseCount: graph.bank.clockCore.midiPulseCount,
      syncPhase: graph.bank.lfoSources[0].phase, syncSample: graph.bank.lfoSources[0].sampleValue,
      freePhase: graph.bank.lfoSources[1].phase };
    return { initialStartSample, beforeStop, stopped, continuedBeat, continued, restarted };
  }, bundle);
  expect(result.beforeStop.beat).toBeGreaterThan(.45);
  expect(result.stopped.beat).toBe(result.beforeStop.beat);
  expect(result.stopped.syncPhase).toBe(result.beforeStop.syncPhase);
  expect(result.stopped.freePhase).not.toBe(result.beforeStop.freePhase);
  expect(result.continuedBeat).toBe(result.stopped.beat);
  expect(result.continued.beat).toBeGreaterThan(result.continuedBeat);
  expect(result.continued.syncPhase).not.toBe(result.stopped.syncPhase);
  expect(result.restarted.beat).toBe(0);
  expect(result.restarted.pulseCount).toBe(0);
  expect(result.restarted.syncPhase).toBe(0);
  expect(result.restarted.syncSample).toBe(result.initialStartSample);
  expect(result.restarted.freePhase).toBe(result.continued.freePhase);
});

test('LFO V1.5 slot editor stays selection-only, compact, routable, and responsive', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  for (const viewport of [{ width: 1914, height: 907 }, { width: 1440, height: 900 }, { width: 1914, height: 768 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.locator('[data-mode="lfo"]').click();
    await expect(page.locator('[data-mode-panel="lfo"]')).toBeVisible();
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-waveform]')).toHaveCount(8);
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-target] option')).toHaveCount(28);
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-slot]')).toHaveCount(4);
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-rate]')).toBeVisible();
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-amount]')).toBeVisible();
    await expect(page.locator('[data-mode-panel="lfo"] [data-lfo-phase]')).toBeVisible();
    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      panel: document.querySelector('[data-mode-panel="lfo"]').scrollWidth,
      panelWidth: document.querySelector('[data-mode-panel="lfo"]').clientWidth,
      graphHeight: document.querySelector('[data-lfo-visualizer]').getBoundingClientRect().height,
      separator: getComputedStyle(document.querySelector('.lfo-editor'), '::before').display,
      assignmentControls: ['[data-lfo-target]', '[data-lfo-channel]', '[data-lfo-invert]', '[data-lfo-reset]'].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      }),
      maxScrollLeft: (() => { window.scrollTo(1000, 0); const value = window.scrollX; window.scrollTo(0, 0); return value; })(),
      overflowing: [...document.querySelectorAll('body *')].map(element => ({
        tag: element.tagName, id: element.id, className: typeof element.className === 'string' ? element.className : '',
        right: Math.round(element.getBoundingClientRect().right * 10) / 10,
        width: Math.round(element.getBoundingClientRect().width * 10) / 10
      })).filter(element => element.right > document.documentElement.clientWidth + .5).slice(0, 12)
    }));
    expect(overflow.page, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.panel).toBeLessThanOrEqual(overflow.panelWidth);
    expect(overflow.graphHeight, JSON.stringify(overflow)).toBeGreaterThanOrEqual(110);
    expect(overflow.separator).toBe(viewport.width > 1050 ? 'block' : 'none');
    for (const control of overflow.assignmentControls) {
      expect(Math.abs(control.height - 27), JSON.stringify({ viewport, overflow })).toBeLessThanOrEqual(0.5);
      expect(Math.abs(control.top - overflow.assignmentControls[0].top), JSON.stringify({ viewport, overflow })).toBeLessThanOrEqual(0.5);
    }
    if (viewport.width > 1050) expect(overflow.graphHeight, JSON.stringify(overflow)).toBeGreaterThan(150);
    expect(overflow.maxScrollLeft, JSON.stringify({ viewport, overflow })).toBe(0);
  }
  for (const theme of ['clean-modern', 'warm-studio']) {
    await page.locator('[data-theme-select]').selectOption(theme);
    const themedStroke = await page.locator('[data-lfo-wave-path]').evaluate(element => getComputedStyle(element).stroke);
    expect(themedStroke).not.toBe('none');
    expect(themedStroke).not.toBe('');
  }
  const before = await page.evaluate(() => window.LfoMode.getState());
  expect(before.lfoModuleEnabled).toBe(false);
  await page.locator('[data-lfo-slot="2"]').click();
  const selected = await page.evaluate(() => window.LfoMode.getState());
  expect(selected.selectedLfoIndex).toBe(2);
  expect(selected.lfoModuleEnabled).toBe(false);
  expect(selected.lfoSources).toEqual(before.lfoSources);
  await page.locator('[data-lfo-source-enable]').click();
  expect((await page.evaluate(() => window.LfoMode.getState())).selectedSourceEnabled).toBe(true);
  await page.locator('[data-module-power="lfo"]').click();
  await page.locator('[data-lfo-waveform="noise"]').click();
  await page.locator('[data-lfo-target]').selectOption('filterbank.band.5.gainDb');
  await page.locator('[data-lfo-channel]').selectOption('left');
  await page.locator('[data-lfo-invert]').click();
  await page.locator('[data-lfo-rate-mode="sync"]').click();
  await page.locator('[data-lfo-division]').selectOption('1/2');
  await page.locator('[data-lfo-clock-source]').selectOption('midi');
  await page.waitForTimeout(50);
  const unavailableSafe = await page.evaluate(() => window.LfoMode.getState());
  expect(unavailableSafe.lfoModuleEnabled).toBe(true);
  expect(unavailableSafe.lfoSources[2]).toMatchObject({ enabled: true, waveform: 'noise', targetId: 'filterbank.band.5.gainDb', channel: 'left', invert: true, rateMode: 'sync', syncDivision: '1/2' });
  await page.locator('[data-lfo-clock-source]').selectOption('internal');
  await page.locator('[data-lfo-rate-mode="free"]').click();
  await page.locator('[data-lfo-rate]').evaluate(element => { element.value = '1000'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-lfo-amount]').evaluate(element => { element.value = '60'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-lfo-phase]').evaluate(element => { element.value = '90'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-lfo-polarity="unipolar"]').click();
  await page.evaluate(() => window.LfoMode.getAudioEngine().onLfoTelemetry({ sourceId: 'lfo.3', enabled: true, waveform: 'noise', polarity: 'unipolar', rateHz: 20, phase: .5, value: .75 }));
  const ui = await page.evaluate(() => ({
    state: window.LfoMode.getState(),
    x: Number(document.querySelector('[data-lfo-phase-dot]').getAttribute('cx')),
    wave: document.querySelector('[data-lfo-wave-path]').getAttribute('d'),
    graphHeight: document.querySelector('[data-lfo-visualizer]').getBoundingClientRect().height,
    pageCountForTwenty: window.LfoMode.getSlotPages(20).length,
    pageSizesForTwenty: window.LfoMode.getSlotPages(20).map(page => page.length)
  }));
  expect(ui.state).toMatchObject({ lfoModuleEnabled: true, selectedLfoIndex: 2, lfoWaveform: 'noise', lfoTargetId: 'filterbank.band.5.gainDb', lfoAmount: 60, lfoPhase: 90, lfoPolarity: 'unipolar' });
  expect(ui.state.lfoRateHz).toBeCloseTo(20, 8);
  expect(ui.x).toBeGreaterThanOrEqual(500);
  expect(ui.x).toBeLessThan(560);
  expect(ui.wave.startsWith('M0.00 ')).toBe(true);
  expect(ui.graphHeight).toBeGreaterThan(100);
  expect(ui.pageCountForTwenty).toBe(5);
  expect(ui.pageSizesForTwenty).toEqual([4, 4, 4, 4, 4]);
  expect(pageErrors).toEqual([]);
});

test('LFO live marker and readout use the final worklet sample for every waveform', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  await page.goto('/');
  await page.locator('[data-mode="lfo"]').click();
  await page.locator('[data-lfo-source-enable]').click();
  await page.locator('[data-module-power="lfo"]').click();
  const emit = sample => page.evaluate(value => window.LfoMode.getAudioEngine().onLfoTelemetry({
    sourceId: 'lfo.1', enabled: true, phase: .25, rateHz: 1, value
  }), sample);
  const marker = () => page.evaluate(() => ({
    y: Number(document.querySelector('[data-lfo-phase-dot]').getAttribute('cy')),
    readout: document.querySelector('[data-lfo-phase-readout]').textContent,
    path: document.querySelector('[data-lfo-wave-path]').getAttribute('d')
  }));

  for (const waveform of ['sample-hold', 'noise']) {
    await page.locator(`[data-lfo-waveform="${waveform}"]`).click();
    await emit(.6);
    const positive = await marker();
    expect(positive.y).toBeCloseTo(31.2, 1);
    expect(positive.readout).toContain('+0.60');
    expect(positive.path).toMatch(/^M0\.00 /);
    await page.locator('[data-lfo-invert]').click();
    await emit(-.6);
    const negative = await marker();
    expect(negative.y).toBeCloseTo(88.8, 1);
    expect(negative.readout).toContain('-0.60');
    await emit(-.4);
    const changedLiveValue = await marker();
    expect(changedLiveValue.y).toBeCloseTo(79.2, 1);
    expect(changedLiveValue.readout).toContain('-0.40');
    expect(changedLiveValue.path).toBe(negative.path);
    await page.locator('[data-lfo-invert]').click();
  }

  for (const waveform of ['sine', 'triangle', 'saw-up', 'saw-down', 'square', 'pulse']) {
    await page.locator(`[data-lfo-waveform="${waveform}"]`).click();
    await emit(.25);
    expect((await marker()).y).toBeCloseTo(48, 1);
    await page.locator('[data-lfo-invert]').click();
    await emit(-.25);
    expect((await marker()).y).toBeCloseTo(72, 1);
    await page.locator('[data-lfo-invert]').click();
    await page.locator('[data-lfo-polarity="unipolar"]').click();
    await emit(.75);
    expect((await marker()).y).toBeCloseTo(37.5, 1);
    await page.locator('[data-lfo-invert]').click();
    await emit(-.75);
    expect((await marker()).y).toBeCloseTo(96, 1);
    await page.locator('[data-lfo-invert]').click();
    await page.locator('[data-lfo-polarity="bipolar"]').click();
  }
});

test('Web MIDI UI reports availability and routes START, CLOCK, STOP, and CONTINUE', async ({ browser }) => {
  const unavailablePage = await browser.newPage();
  await unavailablePage.setViewportSize({ width: 1914, height: 907 });
  await unavailablePage.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined }));
  await unavailablePage.goto('http://localhost:3000');
  await unavailablePage.locator('[data-mode="lfo"]').click();
  await unavailablePage.locator('[data-lfo-rate-mode="sync"]').click();
  await unavailablePage.locator('[data-lfo-clock-source]').selectOption('midi');
  await expect(unavailablePage.locator('[data-lfo-midi-status]')).toHaveText('UNAVAILABLE');
  await unavailablePage.close();

  const noInputPage = await browser.newPage();
  await noInputPage.setViewportSize({ width: 1914, height: 907 });
  await noInputPage.addInitScript(() => {
    const access = { inputs: new Map(), onstatechange: null };
    window.__mockMidiAccess = access;
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
  });
  await noInputPage.goto('http://localhost:3000');
  await noInputPage.locator('[data-midi-setup].midi-setup-button').click();
  await noInputPage.locator('[data-midi-enable]').click();
  await expect(noInputPage.locator('[data-midi-access-status]')).toHaveText('CONNECTED');
  await expect(noInputPage.locator('[data-midi-clock-status]')).toHaveText('NO INPUT');
  await noInputPage.locator('.midi-dialog-close').click();
  await noInputPage.locator('[data-mode="lfo"]').click();
  await noInputPage.locator('[data-lfo-rate-mode="sync"]').click();
  await noInputPage.locator('[data-lfo-clock-source]').selectOption('midi');
  await expect(noInputPage.locator('[data-lfo-midi-status]')).toHaveText('NO INPUT');
  await noInputPage.close();

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1914, height: 907 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const input = { id: 'mock-input', name: 'Mock Clock', state: 'connected', onmidimessage: null };
    const access = { inputs: new Map([['mock-input', input]]), onstatechange: null };
    window.__mockMidiInput = input;
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
  });
  await page.goto('http://localhost:3000');
  await page.locator('[data-midi-setup].midi-setup-button').click();
  await expect(page.locator('[data-midi-access-status]')).toHaveText('NOT GRANTED');
  await expect(page.locator('[data-midi-input]')).toBeDisabled();
  await page.locator('[data-midi-enable]').click();
  await expect(page.locator('[data-midi-access-status]')).toHaveText('CONNECTED');
  await page.locator('[data-midi-input]').selectOption('mock-input');
  await page.locator('.midi-dialog-close').click();
  await page.locator('[data-mode="lfo"]').click();
  await page.locator('[data-lfo-rate-mode="sync"]').click();
  await page.evaluate(() => {
    const engine = window.LfoMode.getAudioEngine();
    window.__clockMessages = [];
    engine.sendLfoClockMessage = action => window.__clockMessages.push(action);
    engine.sendMidiClockPulse = bpm => window.__clockMessages.push({ pulse: true, bpm });
  });
  await page.locator('[data-lfo-clock-source]').selectOption('midi');
  await expect(page.locator('[data-lfo-midi-status]')).toHaveText('NO CLOCK');
  await page.evaluate(() => {
    let timestamp = performance.now();
    const send = status => window.__mockMidiInput.onmidimessage({ data: [status], timeStamp: timestamp });
    send(0xfa);
    for (let pulse = 0; pulse < 24; pulse += 1) {
      timestamp += [20.7, 21.1, 20.5, 21.0][pulse % 4];
      send(0xf8);
    }
  });
  await expect(page.locator('[data-lfo-midi-status]')).toContainText('LOCKED');
  const locked = await page.evaluate(() => window.LfoMode.getState().lfoClock);
  expect(locked.source).toBe('midi');
  expect(locked.running).toBe(true);
  expect(locked.midiBpm).toBeGreaterThan(110);
  expect(locked.midiBpm).toBeLessThan(130);
  await page.evaluate(() => window.__mockMidiInput.onmidimessage({ data: [0xfc], timeStamp: performance.now() }));
  expect((await page.evaluate(() => window.LfoMode.getState().lfoClock)).running).toBe(false);
  await expect(page.locator('[data-lfo-midi-status]')).toHaveText('STOPPED');
  await page.evaluate(() => window.__mockMidiInput.onmidimessage({ data: [0xfb], timeStamp: performance.now() }));
  expect((await page.evaluate(() => window.LfoMode.getState().lfoClock)).running).toBe(true);
  await expect(page.locator('[data-lfo-midi-status]')).toHaveText('NO CLOCK');
  const messages = await page.evaluate(() => window.__clockMessages);
  expect(messages[0]).toBe('start');
  expect(messages.filter(item => typeof item === 'object' && item.pulse)).toHaveLength(24);
  expect(messages).toContain('stop');
  expect(messages).toContain('continue');
  expect(pageErrors).toEqual([]);
  await page.close();
});
