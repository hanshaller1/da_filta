const { test, expect } = require('playwright/test');
const { browserBundle } = require('./helpers/input-character-full-graph.cjs');

const rows = page => page.locator('[data-lfo-assignments] > [data-assignment-id]');
const amount = (row, value) => row.locator('[data-lfo-amount]').evaluate((element, next) => {
  element.value = String(next); element.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

test('assignment editor adds independent routes, derives channel capabilities and removes only one row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('[data-mode="lfo"]').click();
  const initial = await page.evaluate(() => window.LfoMode.getState());
  const baseBefore = await page.evaluate(() => {
    const engine = window.LfoMode.getAudioEngine();
    return [engine.bandGainLeft, engine.bandGainRight, engine.dryWet, engine.filterFrequencyHz, engine.resonance];
  });
  await rows(page).first().locator('[data-lfo-target]').selectOption('filterbank.band.4.gainDb');
  await rows(page).first().locator('[data-lfo-channel]').selectOption('spread');
  await amount(rows(page).first(), 40);
  await rows(page).first().locator('[data-lfo-assignment-invert]').check();
  await page.locator('[data-lfo-add-assignment]').click();
  await expect(rows(page)).toHaveCount(2);
  expect((await page.evaluate(() => window.LfoMode.getState())).lfoSources[0].assignments[1].amount).toBe(0);
  await rows(page).nth(1).locator('[data-lfo-target]').selectOption('filter.frequencyHz');
  await expect(rows(page).nth(1).locator('[data-lfo-channel] option')).toHaveCount(1);
  await expect(rows(page).nth(1).locator('[data-lfo-channel]')).toBeDisabled();
  await amount(rows(page).nth(1), 15);
  for (let index = 0; index < 6; index += 1) await page.locator('[data-lfo-add-assignment]').click();
  await expect(rows(page)).toHaveCount(8);
  for (const width of [1914, 1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      parameterBottom: document.querySelector('#mode-lfo .lfo-parameter-grid').getBoundingClientRect().bottom,
      assignmentTop: document.querySelector('[data-lfo-assignments]').getBoundingClientRect().top,
      panelWidth: document.querySelector('#mode-lfo').clientWidth,
      panelScroll: document.querySelector('#mode-lfo').scrollWidth
    }));
    expect(layout.parameterBottom, JSON.stringify({ width, layout })).toBeLessThanOrEqual(layout.assignmentTop);
    expect(layout.panelScroll, JSON.stringify({ width, layout })).toBeLessThanOrEqual(layout.panelWidth);
    await expect(page.locator('[data-lfo-add-assignment]')).toBeVisible();
  }
  const beforeRemoval = await page.evaluate(() => window.LfoMode.getState());
  expect(beforeRemoval.lfoSources[0].invert).toBe(false);
  expect(beforeRemoval.lfoSources[0].assignments[0]).toMatchObject({ amount: 40, channel: 'spread', invert: true });
  await rows(page).first().locator('[data-lfo-assignment-enable]').click();
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'assignment-disabled');
  await rows(page).first().locator('[data-lfo-assignment-remove]').click();
  const afterRemoval = await page.evaluate(() => window.LfoMode.getState());
  expect(afterRemoval.lfoSources[0].assignments).toEqual(beforeRemoval.lfoSources[0].assignments.slice(1));
  expect(afterRemoval.lfoSources.slice(1)).toEqual(initial.lfoSources.slice(1));
  await page.locator('[data-lfo-slot="1"]').click();
  await expect(rows(page)).toHaveCount(1);
  await page.locator('[data-lfo-slot="0"]').click();
  await expect(rows(page)).toHaveCount(7);
  for (let index = 0; index < 7; index += 1) await rows(page).first().locator('[data-lfo-assignment-remove]').click();
  await expect(rows(page)).toHaveCount(0);
  const snapshot = await page.evaluate(() => window.LfoMode.getAudioEngine().getState());
  expect(snapshot.lfoSources[0].assignments).toEqual([]);
  expect(snapshot.lfoTargetId).toBe('');
  expect(await page.evaluate(() => {
    const engine = window.LfoMode.getAudioEngine();
    return [engine.bandGainLeft, engine.bandGainRight, engine.dryWet, engine.filterFrequencyHz, engine.resonance];
  })).toEqual(baseBefore);
});

test('lost-target row and source slot retain IDs through LP -> Formant -> LP and source/assignment disabling', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-module-power="filter"]').click();
  await page.locator('[data-mode="lfo"]').click();
  await page.locator('[data-module-power="lfo"]').click();
  await page.locator('[data-lfo-source-enable]').click();
  await rows(page).first().locator('[data-lfo-target]').selectOption('filter.frequencyHz');
  await amount(rows(page).first(), 23);
  await rows(page).first().locator('[data-lfo-assignment-invert]').check();
  const assigned = (await page.evaluate(() => window.LfoMode.getState())).lfoSources[0].assignments;
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'active');
  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-filter-type="formant"]').click();
  await page.locator('[data-mode="lfo"]').click();
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'target-unavailable');
  await expect(page.locator('[data-lfo-slot="0"]')).toHaveAttribute('data-lost-targets', '1');
  expect((await page.evaluate(() => window.LfoMode.getState())).lfoSources[0].assignments).toEqual(assigned);
  await page.locator('[data-lfo-slot="1"]').click();
  await expect(page.locator('[data-lfo-slot="0"] .lfo-slot-detail')).toContainText('UNAVAILABLE');
  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-filter-type="lowpass"]').click();
  await page.locator('[data-mode="lfo"]').click();
  await expect(page.locator('[data-lfo-slot="0"]')).toHaveAttribute('data-lost-targets', '0');
  await page.locator('[data-lfo-slot="0"]').click();
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'active');
  expect((await page.evaluate(() => window.LfoMode.getState())).lfoSources[0].assignments).toEqual(assigned);
  await rows(page).first().locator('[data-lfo-assignment-enable]').click();
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'assignment-disabled');
  await rows(page).first().locator('[data-lfo-assignment-enable]').click();
  await page.locator('[data-lfo-source-enable]').click();
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'source-disabled');
  await expect(page.locator('[data-lfo-slot="0"]')).toHaveAttribute('data-lost-targets', '0');
});

test('legacy and invalid assignments survive existing snapshot save/load without a schema version change', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('da-filta-sweetspots-v1', JSON.stringify({ version: 1, slots: {
    A: { name: 'Legacy LFO', state: { lfoEnabled: true, lfoWaveform: 'square', lfoAmount: 35,
      lfoTargetId: 'global.dryWet', lfoPhase: 90, lfoRateHz: 2 } },
    B: { name: 'Unknown target', state: { lfoModuleEnabled: true, lfoSources: [{ enabled: true, invert: true,
      assignments: [{ id: 'saved.lost', targetId: 'removed.target', amount: 27, channel: 'spread', invert: true }] }] } }
  } })));
  await page.goto('/');
  await page.locator('[data-dev-lab-group="sweetspots"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-sweetspot-load="A"]').click();
  await page.locator('[data-mode="lfo"]').click();
  const migrated = await page.evaluate(() => window.LfoMode.getState());
  expect(migrated.lfoSources[0]).toMatchObject({ enabled: true, waveform: 'square', rateHz: 2, phaseOffsetDeg: 90 });
  expect(migrated.lfoSources[0].assignments).toEqual([{ id: 'lfo.1.assignment.1', sourceId: 'lfo.1',
    targetId: 'global.dryWet', amount: 35, channel: 'both', invert: false, enabled: true }]);
  await page.locator('[data-sweetspot-load="B"]').click();
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'target-invalid');
  await expect(rows(page).first().locator('[data-lfo-target]')).toHaveValue('removed.target');
  await expect(rows(page).first().locator('[data-lfo-channel]')).toHaveValue('spread');
  await expect(rows(page).first().locator('[data-lfo-channel]')).toBeDisabled();
  await expect(page.locator('[data-lfo-slot="0"]')).toHaveAttribute('data-lost-targets', '1');
  const invalid = (await page.evaluate(() => window.LfoMode.getState())).lfoSources[0];
  expect(invalid.assignments[0]).toMatchObject({ id: 'saved.lost', targetId: 'removed.target', amount: 27, channel: 'spread', invert: true });
  await page.locator('[data-sweetspot-save="C"]').click();
  await rows(page).first().locator('[data-lfo-assignment-remove]').click();
  await page.locator('[data-sweetspot-load="C"]').click();
  expect((await page.evaluate(() => window.LfoMode.getState())).lfoSources[0]).toEqual(invalid);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('da-filta-sweetspots-v1')).version)).toBe(1);
});

test('production processor sums LFO, Envelope and Clock Mod before the final band clamp and restores bases', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async code => {
    const moduleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { Graph } = await import(moduleUrl); URL.revokeObjectURL(moduleUrl);
    const engine = new window.AudioEngine({});
    engine.setFilterbankEnabled(true); engine.setFilterEnabled(true);
    const state = engine.getState();
    state.lfoModuleEnabled = true;
    Object.assign(state.lfoSources[0], { enabled: true, waveform: 'square', phaseOffsetDeg: 0, rateHz: .01,
      assignments: [{ id: 'left1', targetId: 'filterbank.band.0.gainDb', amount: 100, channel: 'left' },
        { id: 'left2', targetId: 'filterbank.band.0.gainDb', amount: 100, channel: 'left' },
        { id: 'dry', targetId: 'global.dryWet', amount: 10 }] });
    Object.assign(state.lfoSources[1], { enabled: true, waveform: 'square', phaseOffsetDeg: 0, rateHz: .01,
      assignments: [{ id: 'right', targetId: 'filterbank.band.0.gainDb', amount: 25, channel: 'right', invert: true }] });
    state.envelopeModuleEnabled = true;
    Object.assign(state.envelopeSources[0], { enabled: true, targetId: 'filterbank.band.0.gainDb', amount: 100, invert: true, channel: 'left' });
    state.clockMod = { ...state.clockMod, enabled: true, waveform: 'saw', sourceFrequencyHz: .01,
      modulationGain: 100, rightInvert: true, internalBpm: 1, midpointDb: 0 };
    engine.setModulationState(state);
    const packet = engine.getModulationState();
    const options = { ...engine.getFilterbankState(), bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES],
      bandQs: [...window.Filterbank.BAND_QS], bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
      maxBandBoostDb: 12, maxBandCutDb: 12, modulationState: packet };
    const graph = new Graph(48000, options, 'linear', false);
    const bank = graph.bank;
    const base = [Array.from(bank.bandControls.left), Array.from(bank.bandControls.right), bank.dryWet];
    // Isolate the assignment/control calculation from detector settling. The
    // actual followers/clock/oscillators and production DSP are still used.
    bank.envelopeSources[0].value = .5;
    bank.clockMod.step();
    bank.updateModulationTargets();
    const capture = () => ({ left: bank.modulationDirectBandOffsetsByChannel.left[0],
      right: bank.modulationDirectBandOffsetsByChannel.right[0], clockL: bank.clockMod.valueDb('left', 0),
      clockR: bank.clockMod.valueDb('right', 0), finalL: bank.modulationBandGainTargets.left[0],
      finalR: bank.modulationBandGainTargets.right[0], dry: bank.effectiveDryWetTarget });
    const active = capture();
    const rowIds = bank.modulationCore.getAssignments().filter(item => item.sourceId === 'lfo.1').map(item => item.id);
    const empty = { ...packet, lfoModuleEnabled: false, envelopeModuleEnabled: false, clockMod: { ...packet.clockMod, enabled: false }, assignments: [] };
    bank.setModulationState(empty);
    const off = capture();
    const baseAfter = [Array.from(bank.bandControls.left), Array.from(bank.bandControls.right), bank.dryWet];
    const invalidCount = bank.modulationCore.getAssignments().length;
    const input = [[new Float32Array(128).fill(.02), new Float32Array(128).fill(.02)]];
    const output = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
    bank.process(input, output);
    return { active, off, base, baseAfter, rowIds, invalidCount,
      dryBase: engine.dryWet, finite: output.flat().every(channel => channel.every(Number.isFinite)) };
  }, browserBundle('http://localhost:3000'));
  expect(result.rowIds).toEqual(['left1', 'left2', 'dry']);
  expect(result.active.left).toBe(18); // +12 +12 -6, before Clock Mod
  expect(result.active.right).toBe(-3);
  expect(result.active.clockL).toBe(-12);
  expect(result.active.finalL).toBeCloseTo(10 ** (6 / 20), 10); // +18 -12; intermediate clamping would incorrectly produce 0 dB
  expect(result.active.finalR).toBeCloseTo(10 ** (Math.max(-12, Math.min(12, -3 + result.active.clockR)) / 20), 10);
  expect(result.active.dry).toBeCloseTo(result.dryBase + 5, 10);
  expect(result.off).toMatchObject({ left: 0, right: 0, clockL: 0, clockR: 0, finalL: 1, finalR: 1, dry: result.dryBase });
  expect(result.invalidCount).toBe(0);
  expect(result.baseAfter).toEqual(result.base);
  expect(result.finite).toBe(true);
});

test('rendered AudioWorklet audio matches aggregate routes, and zero/muted/disabled routes restore baseline output', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const engine = new window.AudioEngine({});
    engine.setFilterbankEnabled(true);
    const baseState = engine.getState();
    const render = async (assignments, enabled = true, sourceInvert = false) => {
      const state = JSON.parse(JSON.stringify(baseState));
      state.lfoModuleEnabled = enabled;
      Object.assign(state.lfoSources[0], { enabled: true, waveform: 'square', rateHz: .01, invert: sourceInvert, assignments });
      engine.setModulationState(state);
      const context = new OfflineAudioContext(2, 24000, 48000);
      await context.audioWorklet.addModule('/filterbank-processor.js');
      const bank = new AudioWorkletNode(context, 'da-filta-processor', {
        numberOfInputs: 1, numberOfOutputs: 2, outputChannelCount: [2, 1],
        processorOptions: { ...JSON.parse(JSON.stringify(engine.getFilterbankState())),
          bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
          modulationState: engine.getModulationState() }
      });
      const buffer = context.createBuffer(2, 24000, 48000);
      for (let channel = 0; channel < 2; channel += 1) {
        const samples = buffer.getChannelData(channel);
        for (let frame = 0; frame < samples.length; frame += 1) samples[frame] = .04 * Math.sin(2 * Math.PI * 777 * frame / 48000);
      }
      const source = context.createBufferSource(); source.buffer = buffer;
      source.connect(bank); bank.connect(context.destination, 0); source.start();
      const audio = await context.startRendering();
      return [Array.from(audio.getChannelData(0)), Array.from(audio.getChannelData(1))];
    };
    const targetId = 'filterbank.band.5.gainDb';
    const baseline = await render([]);
    const aggregate = await render([{ id: 'sum', targetId, amount: 30, channel: 'spread' }]);
    const multi = await render([{ id: 'first', targetId, amount: 20, channel: 'spread' },
      { id: 'second', targetId, amount: 10, channel: 'spread' }]);
    const invertedSource = await render([{ id: 'inverted', targetId, amount: 30, channel: 'spread', invert: true }], true, true);
    const zero = await render([{ id: 'zero', targetId, amount: 0 }]);
    const muted = await render([{ id: 'muted', targetId, amount: 80, enabled: false }]);
    const disabled = await render([{ id: 'disabled', targetId, amount: 80 }], false);
    const difference = (a, b) => {
      let peak = 0;
      for (let channel = 0; channel < 2; channel += 1) for (let frame = 0; frame < a[channel].length; frame += 1) {
        peak = Math.max(peak, Math.abs(a[channel][frame] - b[channel][frame]));
      }
      return peak;
    };
    return { aggregateDifference: difference(aggregate, multi), invertDifference: difference(aggregate, invertedSource),
      modulationDifference: difference(baseline, multi), zeroDifference: difference(baseline, zero),
      mutedDifference: difference(baseline, muted), disabledDifference: difference(baseline, disabled),
      finite: multi.every(channel => channel.every(Number.isFinite)), baseUnchanged: engine.getState().bandGainLeft.every(value => value === 0) };
  });
  expect(result.aggregateDifference).toBeLessThan(1e-7);
  expect(result.invertDifference).toBeLessThan(1e-7);
  expect(result.modulationDifference).toBeGreaterThan(1e-4);
  expect(result.zeroDifference).toBe(0);
  expect(result.mutedDifference).toBe(0);
  expect(result.disabledDifference).toBe(0);
  expect(result.finite).toBe(true);
  expect(result.baseUnchanged).toBe(true);
});
