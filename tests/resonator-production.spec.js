const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const { loadProbe } = require('./helpers/resonator-production.cjs');
const p = require('./helpers/dsp-performance.cjs');

test('constructors, restore and panic share product defaults and preserve explicit DEV cores', async ({ page }) => {
  await loadProbe(page);
  const report = await page.evaluate(async () => {
    const keys = ['feedbackCore', 'feedbackTopology', 'feedbackTap', 'wetModel', 'feedbackAllEngine', 'feedbackAllSource', 'feedbackAllLevel', 'positiveResonanceEngine', 'negativeResonanceMode', 'negativeResonanceCurve'];
    const pick = object => Object.fromEntries(keys.map(key => [key, object[key]]));
    const engine = new window.AudioEngine({});
    const context = new OfflineAudioContext(2, 128, 48000);
    const wrapper = await window.Filterbank.create(context, {});
    const Class = window.resonatorClasses(48000)['da-filta-processor'];
    const bank = new Class({ processorOptions: { bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS] } });
    const defaults = [pick(engine), pick(wrapper), pick(bank)];
    engine.applyState({}); wrapper.applyState({}); bank.applyState({});
    const missing = [pick(engine), pick(wrapper), pick(bank)];
    const restored = [];
    for (const core of ['current', 'zdf', 'zdf-per-band']) {
      const snapshot = { feedbackCore: core, feedbackTopology: 'local-loop-exp', feedbackTap: 'pre-gain', wetModel: 'reference-delta', feedbackAllEngine: 'legacy', feedbackAllSource: 'pre-gain-sum', feedbackAllLevel: 'raw' };
      engine.applyState(snapshot); wrapper.applyState(snapshot); bank.applyState(snapshot);
      restored.push([pick(engine), pick(wrapper), pick(bank)]);
      // Partial snapshots preserve the explicit architecture, including LOCAL LOOP EXP.
      wrapper.applyState({ resonance: .3 }); restored.push([pick(wrapper)]);
    }
    const isolated = { feedbackCore: 'current', feedbackTopology: 'isolated-tpt', feedbackTap: 'post-gain', wetModel: 'filterbank-sum', feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum' };
    wrapper.applyState(isolated); const alternate = pick(wrapper);
    engine.panic(); wrapper.panic(); bank.panic();
    const panic = [engine.feedbackCore, wrapper.feedbackCore, bank.feedbackCore];
    wrapper.dispose();
    return { defaults, missing, restored, alternate, panic };
  });
  const expected = { feedbackCore: 'zdf-per-band', feedbackTopology: 'common-bus', feedbackTap: 'post-gain', wetModel: 'filterbank-sum',
    feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum', feedbackAllLevel: 'sqrt10', positiveResonanceEngine: 'tpt', negativeResonanceMode: 'signed', negativeResonanceCurve: 'same-as-positive' };
  expect(report.defaults).toEqual([expected, expected, expected]); expect(report.missing).toEqual(report.defaults);
  for (let i = 0; i < report.restored.length; i++) for (const state of report.restored[i]) expect(state).toMatchObject({
    feedbackCore: ['current', 'zdf', 'zdf-per-band'][Math.floor(i / 2)], feedbackTopology: 'local-loop-exp',
    feedbackTap: 'pre-gain', wetModel: 'reference-delta', feedbackAllEngine: 'legacy', feedbackAllSource: 'pre-gain-sum', feedbackAllLevel: 'raw'
  });
  expect(report.alternate).toMatchObject({ feedbackCore: 'current', feedbackTopology: 'isolated-tpt', feedbackAllEngine: 'common-bus' });
  expect(report.panic).toEqual(['zdf-per-band', 'current', 'zdf-per-band']);
});

test('all retained cores and feedback-free product states match the frozen main audio exactly', async ({ page }) => {
  await loadProbe(page);
  const rows = await page.evaluate(() => {
    const rows = [];
    for (const rate of [44100, 48000, 96000]) {
      const before = window.resonatorBeforeClasses(rate)['da-filta-processor'], after = window.resonatorClasses(rate)['da-filta-processor'];
      const cases = ['current', 'zdf', 'zdf-per-band'].flatMap(core => [0, .7, -.7].map(resonance => ({ core, resonance, active: [3, 6], main: true })));
      cases.push({ core: 'current', resonance: .7, active: [4], options: { feedbackTopology: 'local-loop-exp', feedbackAllEngine: 'legacy' } },
        { core: 'current', resonance: -.7, active: [4], options: { feedbackTopology: 'isolated-tpt', feedbackAllEngine: 'legacy', wetModel: 'reference-delta' } },
        { core: 'zdf-per-band', resonance: 0, active: [4], main: true, defaultChange: true },
        { core: 'zdf-per-band', resonance: .7, active: [], defaultChange: true },
        { core: 'zdf-per-band', resonance: -.7, active: [], defaultChange: true });
      for (const config of cases) {
        const options = window.resonatorOptions(config);
        const a = new before({ processorOptions: { ...options, feedbackCore: config.defaultChange ? 'current' : options.feedbackCore } });
        const b = new after({ processorOptions: options });
        const input = [[new Float32Array(128), new Float32Array(128)]], outA = [[new Float32Array(128), new Float32Array(128)]], outB = [[new Float32Array(128), new Float32Array(128)]];
        let maximum = 0;
        for (let block = 0; block < 64; block++) {
          for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) input[0][c][i] = .03 * Math.sin((block * 128 + i) * .17 + c);
          a.process(input, outA); b.process(input, outB);
          for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) maximum = Math.max(maximum, Math.abs(outA[0][c][i] - outB[0][c][i]));
        }
        rows.push({ rate, config, maximum });
      }
    }
    return rows;
  });
  fs.writeFileSync(test.info().outputPath('frozen-parity.json'), JSON.stringify(rows, null, 2));
  for (const row of rows) expect(row.maximum, JSON.stringify(row)).toBe(0);
});

test('gate, signed resonance and DEV core transitions keep finite audio and private histories', async ({ page }) => {
  await loadProbe(page);
  const report = await page.evaluate(() => {
    const Class = window.resonatorClasses(48000)['da-filta-processor'];
    const bank = new Class({ processorOptions: window.resonatorOptions({ active: [4], main: true }) });
    const input = [[new Float32Array(128), new Float32Array(128)]], output = [[new Float32Array(128), new Float32Array(128)]];
    let finite = true, peak = 0, jump = 0, previous = 0;
    const render = blocks => { for (let block = 0; block < blocks; block++) {
      for (let i = 0; i < 128; i++) input[0][0][i] = .02 * Math.sin(i * .18);
      bank.process(input, output);
      for (const value of output[0][0]) { finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value)); jump = Math.max(jump, Math.abs(value - previous)); previous = value; }
    } };
    render(32); bank.setBandFeedback('left', 4, false); render(32); bank.setBandFeedback('left', 4, true); render(32);
    bank.setFeedbackAll('left', false); render(32); bank.setFeedbackAll('left', true); render(32);
    for (const value of [0, -.7, .7]) { bank.setBaseResonance(value); render(128); }
    const locals = [...bank.zdfPerBandLocalReturns.left], main = bank.zdfPerBandMainReturns.left;
    const states = bank.baseFilters.left.map(filter => [filter.ic1eq, filter.ic2eq]);
    bank.setFeedbackCore('current');
    const switchStates = bank.baseFilters.left.map(filter => [filter.ic1eq, filter.ic2eq]);
    render(16); bank.setFeedbackCore('zdf'); render(16); bank.setFeedbackCore('zdf-per-band');
    const retained = { locals: [...bank.zdfPerBandLocalReturns.left], main: bank.zdfPerBandMainReturns.left };
    render(32); bank.setBaseResonance(0, true); render(1);
    const zero = [...bank.zdfPerBandLocalReturns.left, bank.zdfPerBandMainReturns.left];
    bank.panic(); render(1);
    return { finite, peak, jump, locals, main, states, switchStates, retained, zero, resets: bank.zdfNonFiniteResetCount.left + bank.zdfPerBandCoupledNonFiniteCounts.left };
  });
  expect(report.finite).toBe(true); expect(report.resets).toBe(0);
  expect(report.switchStates).toEqual(report.states); expect(report.retained).toEqual({ locals: report.locals, main: report.main });
  expect(report.zero).toEqual(Array(11).fill(0));
  // At this small excitation / subcritical feedback, a full-scale jump indicates a state leak.
  expect(report.peak).toBeLessThan(1); expect(report.jump).toBeLessThan(1);
});

test('product LOCAL inputs are private and MAIN is a simultaneous shared return', async ({ page }) => {
  await loadProbe(page);
  const rows = await page.evaluate(() => {
    const configs = [{ active: [4] }, { active: [3, 6] }, { main: true }, { active: [4], main: true },
      { active: [3, 6], main: true }, { active: Array.from({ length: 10 }, (_, i) => i) },
      { active: [4], main: true, resonance: 0 }, { active: [4], main: true, resonance: -.7 }];
    return configs.map(config => { const { audio, bands, ...metrics } = window.resonatorProbe(48000, config); return { config, ...metrics }; });
  });
  for (const row of rows) {
    expect(row.finite).toBe(true); expect(row.inputError).toBe(0); expect(row.rightPeak).toBe(0);
    expect(row.solver.resets).toBe(0); expect(row.solver.residual).toBeLessThan(1e-8);
    for (let i = 0; i < 10; i++) {
      if ((row.config.active || []).includes(i) && row.config.resonance !== 0) expect(row.returnPeak[i]).toBeGreaterThan(0);
      else expect(row.returnPeak[i]).toBe(0);
    }
    if (row.config.main && row.config.resonance !== 0) expect(row.mainPeak).toBeGreaterThan(0);
    else expect(row.mainPeak).toBe(0);
  }
});

test('A/B LOCAL energy stays in its band while MAIN deliberately excites the bank', async ({ page }) => {
  await loadProbe(page);
  const rows = await page.evaluate(() => {
    const rows = [];
    for (const rate of [44100, 48000, 96000]) {
      const neutral = window.resonatorProbe(rate, { resonance: 0 });
      for (const core of ['current', 'zdf-per-band']) for (const main of [false, true]) {
        const probe = window.resonatorProbe(rate, { core, active: main ? [] : [4], main });
        const otherEnergy = probe.bands.reduce((sum, band, index) => sum + (index === 4 ? 0
          : band.reduce((energy, value, i) => energy + (value - neutral.bands[index][i]) ** 2, 0)), 0);
        const { audio, bands, ...metrics } = probe;
        rows.push({ rate, core, main, otherEnergy, ...metrics });
      }
    }
    return rows;
  });
  for (const rate of [44100, 48000, 96000]) {
    const rowsAtRate = rows.filter(row => row.rate === rate);
    const current = rowsAtRate.find(row => row.core === 'current' && !row.main);
    const local = rowsAtRate.find(row => row.core === 'zdf-per-band' && !row.main);
    const main = rowsAtRate.find(row => row.core === 'zdf-per-band' && row.main);
    expect(current.otherEnergy).toBeGreaterThan(0); expect(local.otherEnergy).toBe(0); expect(main.otherEnergy).toBeGreaterThan(0);
  }
  fs.writeFileSync(test.info().outputPath('cross-band.json'), JSON.stringify(rows, null, 2));
});

test('native A/B measures frequency, tails, signed resonance and neutral response at three rates', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  const rows = await page.evaluate(async () => {
    const rows = [], frequencies = [...window.Filterbank.BAND_FREQUENCIES], qs = [...window.Filterbank.BAND_QS];
    for (const rate of [44100, 48000, 96000]) for (const band of [1, 4, 5, 7, 8, 9]) {
      for (const core of ['current', 'zdf-per-band']) for (const resonance of [0, .7, 1, -.7]) {
        const length = Math.round(rate * .8), context = new OfflineAudioContext(1, length, rate);
        await context.audioWorklet.addModule('/filterbank-processor.js');
        const input = context.createBuffer(1, length, rate), samples = input.getChannelData(0);
        for (let i = 0; i < Math.round(rate * .06); i++) samples[i] = .02 * Math.sin(2 * Math.PI * frequencies[band] * i / rate);
        const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, { outputChannelCount: [1], processorOptions: {
          bandFrequencies: frequencies, bandQs: qs, bandGainLeft: Array(10).fill(0),
          feedbackBandLeft: Array.from({ length: 10 }, (_, i) => i === band), resonance,
          feedbackCore: core, feedbackTopology: 'common-bus', feedbackTap: 'post-gain', wetModel: 'filterbank-sum',
          feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum', feedbackAllLevel: 'sqrt10'
        } });
        const source = context.createBufferSource(); source.buffer = input; source.connect(node).connect(context.destination); source.start();
        const output = (await context.startRendering()).getChannelData(0);
        let peak = 0, energy = 0, tail = 0, ringEnergy = 0, crossings = 0;
        const start = Math.round(rate * .5);
        for (let i = 0; i < length; i++) {
          peak = Math.max(peak, Math.abs(output[i])); energy += output[i] ** 2;
          if (i >= Math.round(rate * .06) && i < Math.round(rate * .12)) ringEnergy += output[i] ** 2;
          if (i >= start) { tail += output[i] ** 2; if (i > start && output[i - 1] <= 0 && output[i] > 0) crossings++; }
        }
        // Sustained oscillation frequency is estimated over the final 300 ms.
        rows.push({ rate, band: band + 1, nominal: frequencies[band], core, resonance, finite: output.every(Number.isFinite),
          peak, rms: Math.sqrt(energy / length), ringRms: Math.sqrt(ringEnergy / Math.round(rate * .06)), tailRms: Math.sqrt(tail / (length - start)),
          frequency: Math.sqrt(tail / (length - start)) > 1e-5 ? crossings / .3 : null });
      }
    }
    return rows;
  });
  fs.writeFileSync(test.info().outputPath('native-audio.json'), JSON.stringify(rows, null, 2));
  for (const row of rows) {
    expect(row.finite).toBe(true);
    if (row.core === 'zdf-per-band' && row.resonance === 1) {
      expect(row.tailRms).toBeGreaterThan(.005);
      expect(Math.abs(row.frequency - row.nominal) / row.nominal).toBeLessThan(.06);
    }
  }
  for (const row of rows.filter(row => row.resonance === .7 && row.core === 'zdf-per-band')) {
    const neutral = rows.find(other => other.rate === row.rate && other.band === row.band && other.core === row.core && other.resonance === 0);
    expect(row.ringRms).toBeGreaterThan(neutral.ringRms);
  }
});

test('product solver cost and fallbacks for six LOCAL/MAIN configurations', async ({ page }) => {
  test.setTimeout(90000);
  await loadProbe(page);
  const rows = await page.evaluate(() => {
    const rows = [];
    for (const rate of [48000, 96000]) for (let index = 0; index < 6; index++) {
      const counts = [1, 5, 10, 0, 5, 10], main = index >= 3, count = counts[index];
      const config = { active: Array.from({ length: count }, (_, i) => i), main, resonance: .7, duration: .5,
        performanceSignal: true, options: { bandGainLeft: Array(10).fill(25) } };
      const baseline = window.resonatorProbe(rate, { ...config, baseline: true });
      const { audio, bands: outputs, ...metrics } = window.resonatorProbe(rate, config);
      rows.push({ rate, count, main, beforeSolver: baseline.solver, ...metrics });
    }
    return rows;
  });
  fs.writeFileSync(test.info().outputPath('solver.json'), JSON.stringify(rows, null, 2));
  for (const row of rows) { expect(row.finite).toBe(true); expect(row.solver.resets).toBe(0); expect(row.solver.residual).toBeLessThan(1e-8); expect(row.solver.fallbackRate).toBe(0); }
});

test('small-signal resonance peaks retain band centres and narrow without tuning compensation', async ({ page }) => {
  test.setTimeout(90000);
  await loadProbe(page);
  const rows = await page.evaluate(() => {
    const rows = [], ratios = [.6, .8, .9, .95, 1, 1.05, 1.1, 1.2, 1.4];
    for (const rate of [44100, 48000, 96000]) {
      const Class = window.resonatorClasses(rate)['da-filta-processor'];
      for (const band of [1, 4, 5, 7, 8, 9]) for (const core of ['current', 'zdf-per-band']) for (const resonance of [0, .7, -.7]) {
        const nominal = window.Filterbank.BAND_FREQUENCIES[band], response = [];
        for (const ratio of ratios) {
          const frequency = nominal * ratio;
          const bank = new Class({ processorOptions: window.resonatorOptions({ core, resonance, active: [band], options: { localLoopTuning: 'compensated' } }) });
          const settle = Math.ceil(rate * 20 / nominal), count = Math.ceil(rate * 20 / frequency);
          let bandEnergy = 0, sumEnergy = 0;
          for (let i = 0; i < settle + count; i++) {
            const output = bank.processChannelFrame(1e-4 * Math.sin(2 * Math.PI * frequency * i / rate), 'left');
            if (i >= settle) { bandEnergy += bank.bandOutputs.left[band] ** 2; sumEnergy += output ** 2; }
          }
          response.push({ frequency, bandGain: Math.sqrt(2 * bandEnergy / count) / 1e-4, sumGain: Math.sqrt(2 * sumEnergy / count) / 1e-4 });
        }
        const peak = response.reduce((best, row) => row.bandGain > best.bandGain ? row : best, response[0]);
        const width = response.filter(row => row.bandGain >= peak.bandGain / Math.SQRT2).length;
        rows.push({ rate, band: band + 1, core, resonance, nominal, peak, widthGridPoints: width, response });
      }
    }
    return rows;
  });
  fs.writeFileSync(test.info().outputPath('response.json'), JSON.stringify(rows, null, 2));
  for (const row of rows.filter(row => row.core === 'zdf-per-band' && row.resonance === .7)) {
    const neutral = rows.find(other => other.rate === row.rate && other.band === row.band && other.core === row.core && other.resonance === 0);
    const negative = rows.find(other => other.rate === row.rate && other.band === row.band && other.core === row.core && other.resonance === -.7);
    expect(row.peak.frequency).toBe(row.nominal); expect(row.peak.bandGain).toBeGreaterThan(neutral.peak.bandGain);
    expect(row.widthGridPoints).toBeLessThan(neutral.widthGridPoints); expect(negative.peak.bandGain).toBeLessThan(neutral.peak.bandGain);
  }
});

test('LOCAL and MAIN onset survey records finite subcritical and oscillating states', async ({ page }) => {
  test.setTimeout(90000);
  await loadProbe(page);
  const rows = await page.evaluate(() => {
    const rows = [];
    for (const rate of [44100, 48000, 96000]) for (const main of [false, true]) for (const gain of main ? [0, 50] : [0]) for (const resonance of [.6, .8, .9, 1]) {
      const probe = window.resonatorProbe(rate, { active: main ? [] : [4], main, resonance, duration: .8,
        options: { bandGainLeft: Array(10).fill(gain) } });
      const start = Math.round(rate * .5); let tail = 0, crossings = 0;
      for (let i = start; i < probe.audio.length; i++) { tail += probe.audio[i] ** 2; if (i > start && probe.audio[i - 1] <= 0 && probe.audio[i] > 0) crossings++; }
      const tailRms = Math.sqrt(tail / (probe.audio.length - start));
      rows.push({ rate, main, gain, resonance, finite: probe.finite, tailRms, frequency: tailRms > 1e-5 ? crossings / .3 : null, solver: probe.solver });
    }
    return rows;
  });
  fs.writeFileSync(test.info().outputPath('onset.json'), JSON.stringify(rows, null, 2));
  for (const row of rows) { expect(row.finite).toBe(true); expect(row.solver.resets).toBe(0); }
  for (const rate of [44100, 48000, 96000]) {
    const local = rows.filter(row => row.rate === rate && !row.main);
    expect(local.at(-1).tailRms).toBeGreaterThan(.005); expect(local[0].tailRms).toBeLessThan(.005);
  }
});

test('native production graph callback cost for six LOCAL/MAIN configurations at 48/96 kHz', async ({ page }) => {
  test.setTimeout(90000);
  const configs = [{ bands: 1 }, { bands: 5 }, { bands: 10 }, { bands: 0, main: true }, { bands: 5, main: true }, { bands: 10, main: true }];
  const cases = [48000, 96000].flatMap(rate => configs.map(config => ({ ...config, rate, core: 'zdf-per-band', resonance: .7, name: `${config.bands}-LOCAL${config.main ? '+MAIN' : ''}` })));
  const report = await p.measureNative(page, cases);
  for (const row of report.live) { expect(row.actualRate).toBe(row.rate); expect(row.finite).toBe(true); expect(row.processorErrors).toBe(0); }
  fs.writeFileSync(test.info().outputPath('native-performance.json'), JSON.stringify(report, null, 2));
});
