const { test, expect } = require('playwright/test');

const renderPerBandProbe = async page => page.evaluate(async () => {
  const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
  const qs = [...window.Filterbank.BAND_QS];
  const moduleUrl = new URL('/filterbank-processor.js', location.href);
  const render = async ({
    core = 'zdf-per-band', sampleRate = 48000, active = [3], gainLeft = [], gainRight = [],
    resonance = 1, tap = 'pre-gain', stereo = false, duration = 0.55, feedbackAll = false, sourceBand = 3,
    feedbackAllSource = 'post-gain-sum', feedbackAllLevel = 'raw', saturationMode = 'current',
    commonBusDrive = 1, commonBusCeiling = 1, feedbackAllSaturationReturn = 'current', feedbackAllAmount = 100, event = null
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
        feedbackAllEngine: 'common-bus', feedbackAllSource, feedbackAllLevel, commonBusSaturationMode: saturationMode,
        commonBusDrive, commonBusCeiling, feedbackAllSaturationReturn, feedbackAllAmount, wetModel: 'filterbank-sum',
        collectResonatorDiagnostics: true
      }
    });
    node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') packets.push(event.data); };
    const source = context.createBufferSource(); source.buffer = input;
    source.connect(node).connect(context.destination); source.start();
    const suspend = event && context.suspend(event.time).then(async () => { node.port.postMessage(event.message); await context.resume(); });
    const rendering = context.startRendering(); if (suspend) await suspend;
    const output = await rendering;
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
      rightDiagnostics: packets.at(-1)?.right,
      diagnosticPackets: packets.map(packet => packet.left)
    };
  };

  const unified = await render({ core: 'zdf', active: [3], tap: 'post-gain', gainLeft: [[3, 50]] });
  const perBand = await render({ active: [3], tap: 'post-gain', gainLeft: [[3, 50]] });
  let oneBandDifference = 0;
  for (let i = 0; i < unified.output.length; i += 1) oneBandDifference = Math.max(oneBandDifference, Math.abs(unified.output[i] - perBand.output[i]));

  const perBandWithMainRequested = await render({ active: [3], tap: 'post-gain', gainLeft: [[3, 50]], feedbackAll: true });
  let mainRequestDifference = 0;
  for (let i = 0; i < perBand.output.length; i += 1) mainRequestDifference = Math.max(mainRequestDifference, Math.abs(perBand.output[i] - perBandWithMainRequested.output[i]));
  const perBandWithMain100 = await render({ active: [3], tap: 'post-gain', gainLeft: [[3, 50]], feedbackAll: true, feedbackAllAmount: 100 });
  const perBandWithMain0 = await render({ active: [3], tap: 'post-gain', gainLeft: [[3, 50]], feedbackAll: true, feedbackAllAmount: 0 });
  const mainAmounts = await Promise.all([25, 50, 75].map(feedbackAllAmount => render({ active: [], feedbackAll: true, sourceBand: 5, feedbackAllAmount })));
  const liveAmount = await render({ active: [3], feedbackAll: true, event: { time: .14, message: { type: 'set-feedback-all-amount', value: 0 } } });
  let amount100Difference = 0; let amount0LocalDifference = 0;
  for (let i = 0; i < perBand.output.length; i += 1) {
    amount100Difference = Math.max(amount100Difference, Math.abs(perBandWithMainRequested.output[i] - perBandWithMain100.output[i]));
    amount0LocalDifference = Math.max(amount0LocalDifference, Math.abs(perBand.output[i] - perBandWithMain0.output[i]));
  }

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
  const mainOnly = await render({ active: [], feedbackAll: true, sourceBand: 5 });
  const multiWithMain = await render({ active: [1, 3, 7], feedbackAll: true, sourceBand: 3 });
  const foreignWithMainLow = await render({ active: [3], feedbackAll: true, gainLeft: [[1, -100], [5, -100]] });
  const foreignWithMainHigh = await render({ active: [3], feedbackAll: true, gainLeft: [[1, 100], [5, 100]] });
  const mainPre = await render({ active: [], feedbackAll: true, feedbackAllSource: 'pre-gain-sum', gainLeft: [[3, 100]] });
  const mainPost = await render({ active: [], feedbackAll: true, feedbackAllSource: 'post-gain-sum', gainLeft: [[3, 100]] });
  const negativeMain = await render({ active: [3], feedbackAll: true, resonance: -1 });
  const mainLevels = await Promise.all(['raw', 'sqrt2', 'half', 'sqrt10', 'tenth', 'twentieth', 'fortieth', 'eightieth']
    .map(feedbackAllLevel => render({ active: [], feedbackAll: true, feedbackAllLevel, sourceBand: 5 })));
  const specialMain = await render({ active: [3], feedbackAll: true, feedbackAllSaturationReturn: 'drive-4-return-0.2' });
  const ceilingMain = await render({ active: [3], feedbackAll: true, saturationMode: 'constant-ceiling', commonBusDrive: 8, commonBusCeiling: .5 });

  return {
    oneBandDifference, mainRequestDifference, amount100Difference, amount0LocalDifference,
    unified, perBand, perBandWithMainRequested, foreignLow, foreignHigh, preLow, preHigh, postLow, postHigh, multiple, singleBand2, singleBand4, singleBand8, neutral, negative, stereo,
    mainOnly, multiWithMain, foreignWithMainLow, foreignWithMainHigh, mainPre, mainPost, negativeMain, mainLevels, specialMain, ceilingMain, perBandWithMain100, perBandWithMain0, mainAmounts, liveAmount
  };
});

test('ZDF PER-BAND keeps LOCAL loops private while MAIN is a shared ZDF return', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await renderPerBandProbe(page);
  // Unified ZDF deliberately has a wider combined LOCAL+MAIN bracket. The
  // Per-Band core has its own bounded local return, so parity is not an
  // acceptance criterion; each core is exercised independently below.
  expect(report.unified.finite).toBe(true);
  expect(report.mainRequestDifference).toBeGreaterThan(1e-8);
  expect(report.amount100Difference).toBe(0);
  expect(report.amount0LocalDifference).toBe(0);
  expect(report.perBandWithMain0.diagnostics.zdfPerBandMainReturn).toBe(0);
  expect(report.perBandWithMain0.diagnostics.zdfPerBandLocalReturnPeak).toEqual(report.perBand.diagnostics.zdfPerBandLocalReturnPeak);
  expect(report.perBandWithMain100.diagnostics.feedbackAllAmount).toBe(100);
  expect(report.mainAmounts.map(item => item.diagnostics.feedbackAllAmount)).toEqual([25, 50, 75]);
  expect(report.mainAmounts.map(item => item.diagnostics.mainFeedbackGain)).toEqual([.3125, .625, .9375]);
  expect(report.liveAmount.diagnosticPackets.some(packet => packet.feedbackAllAmountTarget === 0)).toBe(true);
  expect(report.liveAmount.diagnosticPackets.every(packet => Number.isFinite(packet.feedbackAllAmount))).toBe(true);
  expect(report.perBand.diagnostics.feedbackCoreEffective).toBe('zdf-per-band');
  expect(report.perBand.diagnostics.zdfPerBandLocalReturnPeak[3]).toBeGreaterThan(0);
  expect(Math.abs(report.perBandWithMainRequested.diagnostics.mainCommonFeedbackReturn)).toBeGreaterThan(0);
  expect(Math.abs(report.perBandWithMainRequested.diagnostics.zdfPerBandMainReturn)).toBeGreaterThan(0);
  expect(Math.abs(report.perBandWithMainRequested.diagnostics.zdfPerBandMainBus)).toBeGreaterThan(0);
  expect(Math.abs(report.mainOnly.diagnostics.zdfPerBandMainReturnPeak)).toBeGreaterThan(0);
  expect(report.mainOnly.diagnostics.zdfPerBandLocalReturnPeak.every(value => value === 0)).toBe(true);
  for (const index of [1, 3, 7]) expect(report.multiWithMain.diagnostics.zdfPerBandLocalReturnPeak[index]).toBeGreaterThan(0);
  expect(Math.abs(report.foreignWithMainLow.diagnostics.zdfPerBandMainReturnPeak
    - report.foreignWithMainHigh.diagnostics.zdfPerBandMainReturnPeak)).toBeGreaterThan(1e-8);
  expect(report.mainPre.output.some((value, index) => Math.abs(value - report.mainPost.output[index]) > 1e-8)).toBe(true);
  expect(Math.abs(report.negativeMain.diagnostics.zdfPerBandMainReturnPeak)).toBeGreaterThan(0);
  expect(report.mainLevels.map(item => item.diagnostics.mainFeedbackLevelScale)).toEqual([
    1, 1 / Math.sqrt(2), .5, 1 / Math.sqrt(10), .1, .05, .025, .0125
  ]);
  expect(Math.abs(report.specialMain.diagnostics.zdfPerBandMainReturnPeak)).toBeLessThanOrEqual(.2);
  expect(Math.abs(report.ceilingMain.diagnostics.zdfPerBandMainReturnPeak)).toBeLessThanOrEqual(.5);
  expect(report.foreignLow.diagnostics.zdfPerBandLocalReturnPeak[3]).toBe(report.foreignHigh.diagnostics.zdfPerBandLocalReturnPeak[3]);
  expect(report.preLow.diagnostics.zdfPerBandLocalReturnPeak[3]).toBe(report.preHigh.diagnostics.zdfPerBandLocalReturnPeak[3]);
  expect(report.postLow.diagnostics.zdfPerBandLocalReturnPeak[3]).not.toBe(report.postHigh.diagnostics.zdfPerBandLocalReturnPeak[3]);
  for (const index of [1, 3, 7]) expect(report.multiple.diagnostics.zdfPerBandLocalReturnPeak[index]).toBeGreaterThan(0);
  expect(report.multiple.diagnostics.zdfPerBandLocalReturnPeak[1]).toBe(report.singleBand2.diagnostics.zdfPerBandLocalReturnPeak[1]);
  expect(report.multiple.diagnostics.zdfPerBandLocalReturnPeak[3]).toBe(report.singleBand4.diagnostics.zdfPerBandLocalReturnPeak[3]);
  expect(report.multiple.diagnostics.zdfPerBandLocalReturnPeak[7]).toBe(report.singleBand8.diagnostics.zdfPerBandLocalReturnPeak[7]);
  expect(report.neutral.diagnostics.zdfPerBandLocalReturnPeak[3]).toBe(0);
  for (const item of [report.perBand, report.foreignLow, report.foreignHigh, report.preLow, report.preHigh, report.postLow, report.postHigh, report.multiple, report.singleBand2, report.singleBand4, report.singleBand8, report.neutral, report.negative, report.stereo, report.mainOnly, report.multiWithMain, report.foreignWithMainLow, report.foreignWithMainHigh, report.mainPre, report.mainPost, report.negativeMain, ...report.mainLevels, report.specialMain, report.ceilingMain, report.perBandWithMain100, report.perBandWithMain0, ...report.mainAmounts, report.liveAmount]) {
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
    const sourceSamples = [...buffer.getChannelData(0)];
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
    for (const sourceSample of sourceSamples) {
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
    const expected32 = new Float32Array(expected);
    const actual32 = new Float32Array(actual);
    const actualBits = new Uint32Array(actual32.buffer);
    const expectedBits = new Uint32Array(expected32.buffer);
    let bitDifferences = 0;
    for (let index = 0; index < actualBits.length; index += 1) if (actualBits[index] !== expectedBits[index]) bitDifferences += 1;
    return {
      maximum: actual.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - expected[index])), 0),
      bitDifferences
    };
  });
  expect(difference.maximum).toBeLessThan(2e-7);
  expect(difference.bitDifferences).toBe(0);
});

test('ZDF PER-BAND commits one LOCAL plus the shared MAIN from the coupled affine solution', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const difference = await page.evaluate(async () => {
    const sampleRate = 48000; const length = 256; const activeBand = 3; const resonance = 0.6;
    const level = 1 / Math.sqrt(10); const feedbackGain = 1.25 * resonance * resonance;
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES]; const qs = [...window.Filterbank.BAND_QS];
    const input = Array.from({ length }, (_, index) => index < 96 ? 0.02 * Math.sin(2 * Math.PI * 218 * index / sampleRate) : 0);
    const context = new OfflineAudioContext(1, length, sampleRate);
    await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
    const buffer = context.createBuffer(1, length, sampleRate); buffer.getChannelData(0).set(input);
    const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: {
      bandFrequencies: frequencies, bandQs: qs, bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
      feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === activeBand), feedbackBandRight: Array(10).fill(false),
      feedbackAllLeft: true, feedbackAllRight: false, resonance, feedbackTopology: 'common-bus', feedbackCore: 'zdf-per-band', feedbackAllEngine: 'common-bus', feedbackAllLevel: 'sqrt10', wetModel: 'filterbank-sum'
    }});
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(node).connect(context.destination); source.start();
    const actual = [...(await context.startRendering()).getChannelData(0)];

    const filters = frequencies.map((frequency, index) => {
      const g = Math.tan(Math.PI * frequency / sampleRate); const baseK = 1 / qs[index]; const a1 = 1 / (1 + g * (g + baseK));
      return { baseK, a1, a2: g * a1, a3: g * g * a1, ic1eq: 0, ic2eq: 0 };
    });
    let local = 0; let main = 0; const expected = [];
    for (const sourceSample of input) {
      const p = filters.map(filter => filter.baseK * (filter.a1 * filter.ic1eq + filter.a2 * (sourceSample - filter.ic2eq)));
      const d = filters.map(filter => filter.baseK * filter.a2);
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const y = p.map((value, index) => value + d[index] * ((index === activeBand ? local : 0) + main));
        const mainBus = level * y.reduce((sum, value) => sum + value, 0);
        const localTanh = Math.tanh(feedbackGain * y[activeBand]); const mainTanh = Math.tanh(feedbackGain * mainBus);
        const fLocal = local - localTanh; const fMain = main - mainTanh;
        if (Math.max(Math.abs(fLocal), Math.abs(fMain)) < 1e-12) break;
        const alpha = feedbackGain * d[activeBand] * (1 - localTanh * localTanh);
        const beta = feedbackGain * level * (1 - mainTanh * mainTanh);
        const a = 1 - alpha; const b = -alpha; const c = -beta * d[activeBand];
        const h = 1 - beta * d.reduce((sum, value) => sum + value, 0);
        const determinant = a * h - b * c;
        const deltaLocal = (-fLocal * h + b * fMain) / determinant;
        const deltaMain = (c * fLocal - a * fMain) / determinant;
        local = Math.max(-1, Math.min(1, local + deltaLocal));
        main = Math.max(-1, Math.min(1, main + deltaMain));
      }
      let sum = 0;
      for (let band = 0; band < filters.length; band += 1) {
        const current = filters[band]; const sample = (sourceSample + (band === activeBand ? local : 0)) + main;
        const v3 = sample - current.ic2eq; const bandValue = current.a1 * current.ic1eq + current.a2 * v3;
        const low = current.ic2eq + current.a2 * current.ic1eq + current.a3 * v3;
        current.ic1eq = 2 * bandValue - current.ic1eq; current.ic2eq = 2 * low - current.ic2eq;
        sum += current.baseK * bandValue;
      }
      expected.push(sum);
    }
    return actual.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - expected[index])), 0);
  });
  expect(difference).toBeLessThan(3e-7);
});

test('coupled LOCAL/MAIN Jacobian and Schur step agree with finite differences and a dense test reference', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(() => {
    const solve = count => {
      const p = Array.from({ length: 10 }, (_, index) => (index - 4) * .013);
      const d = Array.from({ length: 10 }, (_, index) => .015 + index * .001);
      const localWeight = Array.from({ length: 10 }, (_, index) => index < count ? .3 + index * .04 : 0);
      const mainWeight = Array.from({ length: 10 }, (_, index) => .8 + index * .02);
      const local = Array.from({ length: count }, (_, index) => (index - 2) * .01);
      const main = .02; const localGain = .75; const mainGain = .9; const gate = .8; const level = 1 / Math.sqrt(10);
      const residual = values => {
        const mainValue = values[count];
        const y = p.map((value, index) => value + d[index] * ((index < count ? values[index] : 0) + mainValue));
        const mainBus = gate * level * y.reduce((sum, value, index) => sum + mainWeight[index] * value, 0);
        return [
          ...Array.from({ length: count }, (_, index) => values[index] - Math.tanh(localGain * localWeight[index] * y[index])),
          mainValue - Math.tanh(mainGain * mainBus)
        ];
      };
      const values = [...local, main]; const f = residual(values); const y = p.map((value, index) => value + d[index] * ((index < count ? local[index] : 0) + main));
      const localTanh = Array.from({ length: count }, (_, index) => Math.tanh(localGain * localWeight[index] * y[index]));
      const mainBus = gate * level * y.reduce((sum, value, index) => sum + mainWeight[index] * value, 0);
      const mainTanh = Math.tanh(mainGain * mainBus);
      const a = localTanh.map((value, index) => 1 - (1 - value * value) * localGain * localWeight[index] * d[index]);
      const b = localTanh.map((value, index) => -(1 - value * value) * localGain * localWeight[index] * d[index]);
      const mainSlope = (1 - mainTanh * mainTanh) * mainGain * gate * level;
      const c = Array.from({ length: count }, (_, index) => -mainSlope * mainWeight[index] * d[index]);
      const h = 1 - mainSlope * mainWeight.reduce((sum, weight, index) => sum + weight * d[index], 0);
      const matrix = Array.from({ length: count + 1 }, () => Array(count + 1).fill(0));
      for (let index = 0; index < count; index += 1) { matrix[index][index] = a[index]; matrix[index][count] = b[index]; matrix[count][index] = c[index]; }
      matrix[count][count] = h;
      const epsilon = 1e-6; let derivativeError = 0;
      for (let column = 0; column <= count; column += 1) {
        const plus = [...values]; const minus = [...values]; plus[column] += epsilon; minus[column] -= epsilon;
        const fp = residual(plus); const fm = residual(minus);
        for (let row = 0; row <= count; row += 1) derivativeError = Math.max(derivativeError, Math.abs((fp[row] - fm[row]) / (2 * epsilon) - matrix[row][column]));
      }
      const augmented = matrix.map((row, index) => [...row, -f[index]]);
      for (let pivot = 0; pivot <= count; pivot += 1) {
        const factor = augmented[pivot][pivot];
        for (let column = pivot; column <= count + 1; column += 1) augmented[pivot][column] /= factor;
        for (let row = 0; row <= count; row += 1) if (row !== pivot) {
          const multiplier = augmented[row][pivot];
          for (let column = pivot; column <= count + 1; column += 1) augmented[row][column] -= multiplier * augmented[pivot][column];
        }
      }
      const dense = augmented.map(row => row[count + 1]);
      let schur = h; let numerator = -f[count];
      for (let index = 0; index < count; index += 1) { schur -= c[index] * b[index] / a[index]; numerator += c[index] * f[index] / a[index]; }
      const deltaMain = numerator / schur;
      const arrow = Array.from({ length: count }, (_, index) => (-f[index] - b[index] * deltaMain) / a[index]); arrow.push(deltaMain);
      const stepError = arrow.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - dense[index])), 0);
      return { derivativeError, stepError, schur };
    };
    return [solve(0), solve(1), solve(10)];
  });
  for (const item of report) {
    expect(Math.abs(item.schur)).toBeGreaterThan(1e-9);
    expect(item.derivativeError).toBeLessThan(2e-7);
    expect(item.stepError).toBeLessThan(1e-12);
  }
});

test('ZDF PER-BAND retains high-band oscillation at 44.1, 48 and 96 kHz', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const rows = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const moduleUrl = new URL('/filterbank-processor.js', location.href);
    const result = [];
    for (const sampleRate of [44100, 48000, 96000]) for (const band of [7, 8, 9]) for (const feedbackAll of [false, true]) {
      const length = Math.round(sampleRate * 0.6);
      const context = new OfflineAudioContext(1, length, sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const input = context.createBuffer(1, length, sampleRate); const samples = input.getChannelData(0);
      for (let i = 0; i < Math.round(sampleRate * 0.06); i += 1) samples[i] = 0.02 * Math.sin(2 * Math.PI * frequencies[band] * i / sampleRate);
      const packets = [];
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: {
        bandFrequencies: frequencies, bandQs: qs, bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
        feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === band), feedbackBandRight: Array(10).fill(false),
        feedbackAllLeft: feedbackAll, feedbackAllRight: false, resonance: 1, feedbackTopology: 'common-bus', feedbackCore: 'zdf-per-band', feedbackAllEngine: 'common-bus', feedbackAllLevel: 'sqrt10', wetModel: 'filterbank-sum', collectResonatorDiagnostics: true
      }});
      node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') packets.push(event.data.left); };
      const source = context.createBufferSource(); source.buffer = input; source.connect(node).connect(context.destination); source.start();
      const output = (await context.startRendering()).getChannelData(0); await new Promise(resolve => setTimeout(resolve, 0));
      const start = Math.floor(length * 0.70); let energy = 0; let crossings = 0;
      for (let i = start; i < length; i += 1) { energy += output[i] ** 2; if (i > start && output[i - 1] <= 0 && output[i] > 0) crossings += 1; }
      result.push({ sampleRate, band, feedbackAll, nominal: frequencies[band], finite: output.every(Number.isFinite), rms: Math.sqrt(energy / (length - start)), frequency: crossings / ((length - start) / sampleRate), diagnostics: packets.at(-1) });
    }
    return result;
  });
  console.log('PER-BAND ZDF HIGH-BAND SURVEY', JSON.stringify(rows.map(row => ({ sampleRate: row.sampleRate, band: row.band + 1, main: row.feedbackAll, nominal: row.nominal, frequency: +row.frequency.toFixed(2), rms: +row.rms.toFixed(5), fallback: row.diagnostics?.zdfPerBandCoupledFallbackCount ?? row.diagnostics?.zdfPerBandSolverFallbackCount?.[row.band] ?? 0, residual: row.diagnostics?.zdfPerBandCoupledSolverResidual }))));
  for (const row of rows) {
    expect(row.finite, JSON.stringify(row)).toBe(true);
    expect(row.rms, JSON.stringify(row)).toBeGreaterThan(0.005);
    expect(Math.abs(row.frequency - row.nominal) / row.nominal, JSON.stringify(row)).toBeLessThan(0.06);
    expect(row.diagnostics.zdfPerBandLocalReturnPeak[row.band], JSON.stringify(row)).toBeGreaterThan(0);
    if (row.feedbackAll) expect(Math.abs(row.diagnostics.zdfPerBandMainReturnPeak), JSON.stringify(row)).toBeGreaterThan(0);
  }
});

test('ZDF PER-BAND is selectable live and keeps MAIN selectable without rebuilding audio', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-feedback-core]').selectOption('zdf-per-band');
  await expect(page.locator('[data-feedback-core]')).toHaveValue('zdf-per-band');
  await expect(page.locator('.fb-all-toggle')).toBeEnabled();
  await expect(page.locator('.fb-all-toggle')).toHaveText('OFF');
  await page.locator('.fb-all-toggle').click();
  await expect(page.locator('.fb-all-toggle')).toHaveText('ON');
  await page.locator('[data-feedback-core]').selectOption('zdf');
  await expect(page.locator('.fb-all-toggle')).toBeEnabled();
});
