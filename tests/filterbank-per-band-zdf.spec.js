const { test, expect } = require('playwright/test');

const renderPerBandProbe = async page => page.evaluate(async () => {
  const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
  const qs = [...window.Filterbank.BAND_QS];
  const moduleUrl = new URL('/filterbank-processor.js', location.href);
  const render = async ({
    core = 'zdf-per-band', sampleRate = 48000, active = [3], gainLeft = [], gainRight = [],
    resonance = 1, tap = 'pre-gain', stereo = false, duration = 0.55, feedbackAll = false, sourceBand = 3
  } = {}) => {
    const length = Math.round(sampleRate * duration);
    const context = new OfflineAudioContext(stereo ? 2 : 1, length, sampleRate);
    await context.audioWorklet.addModule(moduleUrl);
    const input = context.createBuffer(stereo ? 2 : 1, length, sampleRate);
    for (let channel = 0; channel < (stereo ? 2 : 1); channel += 1) {
      const samples = input.getChannelData(channel);
      const frequency = frequencies[sourceBand];
      const burst = Math.round(sampleRate * 0.06);
      for (let i = 0; i < burst; i += 1) samples[i] = 0.02 * Math.sin(2 * Math.PI * frequency * i / sampleRate);
    }
    const left = Array(10).fill(0); const right = Array(10).fill(0);
    gainLeft.forEach(([index, value]) => { left[index] = value; });
    gainRight.forEach(([index, value]) => { right[index] = value; });
    const packets = [];
    const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [stereo ? 2 : 1],
      processorOptions: {
        bandFrequencies: frequencies, bandQs: qs,
        bandGainLeft: left, bandGainRight: right,
        feedbackBandLeft: Array.from({ length: 10 }, (_, index) => active.includes(index)),
        feedbackBandRight: stereo ? Array.from({ length: 10 }, (_, index) => active.includes(index)) : Array(10).fill(false),
        feedbackAllLeft: feedbackAll, feedbackAllRight: feedbackAll,
        resonance, feedbackTopology: 'common-bus', feedbackCore: core, feedbackTap: tap,
        feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum', wetModel: 'filterbank-sum',
        collectResonatorDiagnostics: true
      }
    });
    node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') packets.push(event.data); };
    const source = context.createBufferSource(); source.buffer = input;
    source.connect(node).connect(context.destination); source.start();
    const output = await context.startRendering();
    await new Promise(resolve => setTimeout(resolve, 0));
    const samples = output.getChannelData(0);
    const start = Math.floor(samples.length * 0.70);
    let tailEnergy = 0; let crossings = 0;
    for (let i = start; i < samples.length; i += 1) {
      tailEnergy += samples[i] * samples[i];
      if (i > start && samples[i - 1] <= 0 && samples[i] > 0) crossings += 1;
    }
    return {
      output: [...samples],
      finite: samples.every(Number.isFinite),
      tailRms: Math.sqrt(tailEnergy / (samples.length - start)),
      frequency: crossings / ((samples.length - start) / sampleRate),
      diagnostics: packets.at(-1)?.left,
      rightDiagnostics: packets.at(-1)?.right
    };
  };

  const unified = await render({ core: 'zdf', active: [3], tap: 'post-gain', gainLeft: [[3, 50]] });
  const perBand = await render({ active: [3], tap: 'post-gain', gainLeft: [[3, 50]] });
  let oneBandDifference = 0;
  for (let i = 0; i < unified.output.length; i += 1) oneBandDifference = Math.max(oneBandDifference, Math.abs(unified.output[i] - perBand.output[i]));

  const perBandWithMainRequested = await render({ active: [3], tap: 'post-gain', gainLeft: [[3, 50]], feedbackAll: true });
  let mainRequestDifference = 0;
  for (let i = 0; i < perBand.output.length; i += 1) mainRequestDifference = Math.max(mainRequestDifference, Math.abs(perBand.output[i] - perBandWithMainRequested.output[i]));

  const foreignLow = await render({ active: [3], tap: 'post-gain', gainLeft: [[3, 50], [1, -100], [5, -100]] });
  const foreignHigh = await render({ active: [3], tap: 'post-gain', gainLeft: [[3, 50], [1, 100], [5, 100]] });
  const preLow = await render({ active: [3], tap: 'pre-gain', gainLeft: [[3, -100]] });
  const preHigh = await render({ active: [3], tap: 'pre-gain', gainLeft: [[3, 100]] });
  const postLow = await render({ active: [3], tap: 'post-gain', gainLeft: [[3, -100]] });
  const postHigh = await render({ active: [3], tap: 'post-gain', gainLeft: [[3, 100]] });
  const multiple = await render({ active: [1, 3, 7], tap: 'pre-gain' });
  const singleBand2 = await render({ active: [1], tap: 'pre-gain' });
  const singleBand4 = await render({ active: [3], tap: 'pre-gain' });
  const singleBand8 = await render({ active: [7], tap: 'pre-gain' });
  const neutral = await render({ active: [3], resonance: 0 });
  const negative = await render({ active: [3], resonance: -1 });
  const stereo = await render({ active: [3], tap: 'post-gain', stereo: true, gainLeft: [[3, 100]], gainRight: [[3, -100]] });

  return {
    oneBandDifference, mainRequestDifference,
    unified, perBand, perBandWithMainRequested, foreignLow, foreignHigh, preLow, preHigh, postLow, postHigh, multiple, singleBand2, singleBand4, singleBand8, neutral, negative, stereo
  };
});

test('ZDF PER-BAND keeps LOCAL loops isolated, signed, and MAIN-free', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await renderPerBandProbe(page);
  // Unified ZDF deliberately has a wider combined LOCAL+MAIN bracket. The
  // Per-Band core has its own bounded local return, so parity is not an
  // acceptance criterion; each core is exercised independently below.
  expect(report.unified.finite).toBe(true);
  expect(report.mainRequestDifference).toBe(0);
  expect(report.perBand.diagnostics.feedbackCoreEffective).toBe('zdf-per-band');
  expect(report.perBand.diagnostics.zdfPerBandLocalReturnPeak[3]).toBeGreaterThan(0);
  expect(report.perBandWithMainRequested.diagnostics.mainCommonFeedbackReturn).toBe(0);
  expect(report.perBandWithMainRequested.diagnostics.mainTapSum).toBe(0);
  expect(report.foreignLow.diagnostics.zdfPerBandLocalReturnPeak[3]).toBe(report.foreignHigh.diagnostics.zdfPerBandLocalReturnPeak[3]);
  expect(report.preLow.diagnostics.zdfPerBandLocalReturnPeak[3]).toBe(report.preHigh.diagnostics.zdfPerBandLocalReturnPeak[3]);
  expect(report.postLow.diagnostics.zdfPerBandLocalReturnPeak[3]).not.toBe(report.postHigh.diagnostics.zdfPerBandLocalReturnPeak[3]);
  for (const index of [1, 3, 7]) expect(report.multiple.diagnostics.zdfPerBandLocalReturnPeak[index]).toBeGreaterThan(0);
  expect(report.multiple.diagnostics.zdfPerBandLocalReturnPeak[1]).toBe(report.singleBand2.diagnostics.zdfPerBandLocalReturnPeak[1]);
  expect(report.multiple.diagnostics.zdfPerBandLocalReturnPeak[3]).toBe(report.singleBand4.diagnostics.zdfPerBandLocalReturnPeak[3]);
  expect(report.multiple.diagnostics.zdfPerBandLocalReturnPeak[7]).toBe(report.singleBand8.diagnostics.zdfPerBandLocalReturnPeak[7]);
  expect(report.neutral.diagnostics.zdfPerBandLocalReturnPeak[3]).toBe(0);
  for (const item of [report.perBand, report.foreignLow, report.foreignHigh, report.preLow, report.preHigh, report.postLow, report.postHigh, report.multiple, report.singleBand2, report.singleBand4, report.singleBand8, report.neutral, report.negative, report.stereo]) {
    expect(item.finite).toBe(true);
  }
  expect(report.negative.diagnostics.zdfPerBandLocalReturnPeak[3]).toBeGreaterThan(0);
  expect(report.stereo.diagnostics.zdfPerBandLocalReturnPeak[3]).not.toBe(report.stereo.rightDiagnostics.zdfPerBandLocalReturnPeak[3]);
});

test('ZDF PER-BAND commits each Base-TPT state exactly once from its solved input', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const difference = await page.evaluate(async () => {
    const sampleRate = 48000; const length = 256; const activeBand = 3; const resonance = 0.6;
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES]; const qs = [...window.Filterbank.BAND_QS];
    const input = Array.from({ length }, (_, index) => index < 96 ? 0.02 * Math.sin(2 * Math.PI * 218 * index / sampleRate) : 0);
    const context = new OfflineAudioContext(1, length, sampleRate);
    await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
    const buffer = context.createBuffer(1, length, sampleRate); buffer.getChannelData(0).set(input);
    const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: {
      bandFrequencies: frequencies, bandQs: qs, bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
      feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === activeBand), feedbackBandRight: Array(10).fill(false),
      feedbackAllLeft: false, feedbackAllRight: false, resonance, feedbackTopology: 'common-bus', feedbackCore: 'zdf-per-band', wetModel: 'filterbank-sum'
    }});
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(node).connect(context.destination); source.start();
    const actual = [...(await context.startRendering()).getChannelData(0)];

    const filters = frequencies.map((frequency, index) => {
      const g = Math.tan(Math.PI * frequency / sampleRate); const baseK = 1 / qs[index]; const a1 = 1 / (1 + g * (g + baseK));
      return { baseK, a1, a2: g * a1, a3: g * g * a1, k: baseK, ic1eq: 0, ic2eq: 0 };
    });
    let localReturn = 0; const expected = [];
    const feedbackGain = 1.25 * resonance * resonance;
    for (const sourceSample of input) {
      const filter = filters[activeBand];
      const p = filter.baseK * (filter.a1 * filter.ic1eq + filter.a2 * (sourceSample - filter.ic2eq));
      const d = filter.baseK * filter.a2;
      let lower = -1; let upper = 1; let value = Math.max(lower, Math.min(upper, localReturn)); let residual = Infinity;
      for (let iteration = 0; iteration < 6; iteration += 1) {
        const shaped = Math.tanh(feedbackGain * (p + d * value)); const error = value - shaped; residual = Math.abs(error);
        if (error > 0) upper = value; else lower = value;
        if (residual < 1e-8) break;
        const derivative = 1 - feedbackGain * d * (1 - shaped * shaped); const candidate = Math.abs(derivative) > 1e-9 ? value - error / derivative : NaN;
        value = Number.isFinite(candidate) && candidate > lower && candidate < upper ? candidate : 0.5 * (lower + upper);
      }
      if (residual >= 1e-8) for (let step = 0; step < 20; step += 1) {
        value = 0.5 * (lower + upper); const error = value - Math.tanh(feedbackGain * (p + d * value)); residual = Math.abs(error);
        if (residual < 1e-8) break; if (error > 0) upper = value; else lower = value;
      }
      localReturn = value;
      let sum = 0;
      for (let band = 0; band < filters.length; band += 1) {
        const current = filters[band]; const sample = sourceSample + (band === activeBand ? localReturn : 0);
        const v3 = sample - current.ic2eq; const bandValue = current.a1 * current.ic1eq + current.a2 * v3;
        const low = current.ic2eq + current.a2 * current.ic1eq + current.a3 * v3;
        current.ic1eq = 2 * bandValue - current.ic1eq; current.ic2eq = 2 * low - current.ic2eq;
        sum += current.baseK * bandValue;
      }
      expected.push(sum);
    }
    return actual.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - expected[index])), 0);
  });
  expect(difference).toBeLessThan(2e-7);
});

test('ZDF PER-BAND retains high-band oscillation at 44.1, 48 and 96 kHz', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const rows = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const moduleUrl = new URL('/filterbank-processor.js', location.href);
    const result = [];
    for (const sampleRate of [44100, 48000, 96000]) for (const band of [7, 8, 9]) {
      const length = Math.round(sampleRate * 0.6);
      const context = new OfflineAudioContext(1, length, sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const input = context.createBuffer(1, length, sampleRate); const samples = input.getChannelData(0);
      for (let i = 0; i < Math.round(sampleRate * 0.06); i += 1) samples[i] = 0.02 * Math.sin(2 * Math.PI * frequencies[band] * i / sampleRate);
      const packets = [];
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: {
        bandFrequencies: frequencies, bandQs: qs, bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
        feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === band), feedbackBandRight: Array(10).fill(false),
        feedbackAllLeft: false, feedbackAllRight: false, resonance: 1, feedbackTopology: 'common-bus', feedbackCore: 'zdf-per-band', wetModel: 'filterbank-sum', collectResonatorDiagnostics: true
      }});
      node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') packets.push(event.data.left); };
      const source = context.createBufferSource(); source.buffer = input; source.connect(node).connect(context.destination); source.start();
      const output = (await context.startRendering()).getChannelData(0); await new Promise(resolve => setTimeout(resolve, 0));
      const start = Math.floor(length * 0.70); let energy = 0; let crossings = 0;
      for (let i = start; i < length; i += 1) { energy += output[i] ** 2; if (i > start && output[i - 1] <= 0 && output[i] > 0) crossings += 1; }
      result.push({ sampleRate, band, nominal: frequencies[band], finite: output.every(Number.isFinite), rms: Math.sqrt(energy / (length - start)), frequency: crossings / ((length - start) / sampleRate), diagnostics: packets.at(-1) });
    }
    return result;
  });
  console.log('PER-BAND ZDF HIGH-BAND SURVEY', JSON.stringify(rows.map(row => ({ sampleRate: row.sampleRate, band: row.band + 1, nominal: row.nominal, frequency: +row.frequency.toFixed(2), rms: +row.rms.toFixed(5), fallback: row.diagnostics?.zdfPerBandSolverFallbackCount?.[row.band] ?? 0 }))));
  for (const row of rows) {
    expect(row.finite, JSON.stringify(row)).toBe(true);
    expect(row.rms, JSON.stringify(row)).toBeGreaterThan(0.005);
    expect(Math.abs(row.frequency - row.nominal) / row.nominal, JSON.stringify(row)).toBeLessThan(0.06);
    expect(row.diagnostics.zdfPerBandLocalReturnPeak[row.band], JSON.stringify(row)).toBeGreaterThan(0);
  }
});

test('ZDF PER-BAND is selectable live and marks MAIN as inactive without rebuilding audio', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-feedback-core]').selectOption('zdf-per-band');
  await expect(page.locator('[data-feedback-core]')).toHaveValue('zdf-per-band');
  await expect(page.locator('.fb-all-toggle')).toBeDisabled();
  await expect(page.locator('.fb-all-toggle')).toHaveText('N/A');
  await page.locator('[data-feedback-core]').selectOption('zdf');
  await expect(page.locator('.fb-all-toggle')).toBeEnabled();
});
