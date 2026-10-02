const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { OptimizedCharacterArchitecture } = require('./helpers/input-character-architecture-optimized.cjs');
const { ratesFor } = require('./helpers/input-character-architecture-p3b4.cjs');
const p = require('./helpers/input-character-oversampling.cjs');
const { measureProductionGraph } = require('./helpers/measure-input-character-full-graph.cjs');

function productionClass(rate, contextExtras = {}) {
  let Class;
  const context = vm.createContext({ sampleRate: rate,
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (_, value) => { Class = value; }, ...contextExtras });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../input-preamp-processor.js'), 'utf8'), context);
  return { Class, context };
}

test('input stage keeps gain and character independent while preserving distinct stable curves', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const render = async ({ gainDb = 0, stage = 'linear', characterAmount = 1, processorGainDb = gainDb }) => {
      const sampleRate = 48000;
      const length = sampleRate;
      const context = new OfflineAudioContext(1, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/input-preamp-processor.js', location.href));
      const input = context.createBuffer(1, length, sampleRate);
      const sourceData = input.getChannelData(0);
      for (let index = 0; index < length; index += 1) sourceData[index] = 0.72 * Math.sin((2 * Math.PI * 480 * index) / sampleRate);
      const source = context.createBufferSource(); source.buffer = input;
      const gain = context.createGain(); gain.gain.value = 10 ** (gainDb / 20);
      const preamp = new AudioWorkletNode(context, 'resonant-input-preamp-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { inputGainDb: processorGainDb, stage, characterAmount }
      });
      source.connect(gain).connect(preamp).connect(context.destination); source.start();
      const rendered = await context.startRendering();
      const output = rendered.getChannelData(0);
      let rms = 0; let dc = 0; let finite = true; let peak = 0;
      for (let index = sampleRate / 2; index < length; index += 1) {
        const sample = output[index]; rms += sample * sample; dc += sample; peak = Math.max(peak, Math.abs(sample)); finite &&= Number.isFinite(sample);
      }
      const start = sampleRate / 2; const frames = length - start;
      return { output: Array.from(output.slice(start)), rms: Math.sqrt(rms / frames), dc: dc / frames, peak, finite };
    };
    const maxDifference = (left, right) => left.output.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - right.output[index])), 0);
    const linear0 = await render({ characterAmount: 0 });
    const linear50 = await render({ characterAmount: 0.5 });
    const linear100 = await render({ characterAmount: 1 });
    const gain12 = await render({ gainDb: 12, characterAmount: 0 });
    const silk0 = await render({ stage: 'silk', characterAmount: 0 });
    const silk50 = await render({ stage: 'silk', characterAmount: 0.5 });
    const silk100 = await render({ stage: 'silk', characterAmount: 1 });
    const stages = {};
    for (const stage of ['silk', 'tape', 'tube', 'console', 'crunch', 'destroy']) stages[stage] = await render({ stage, characterAmount: 1 });
    const processorGain0 = await render({ gainDb: 12, stage: 'console', characterAmount: 1, processorGainDb: 0 });
    const processorGain24 = await render({ gainDb: 12, stage: 'console', characterAmount: 1, processorGainDb: 24 });
    const destroyHigh = await render({ gainDb: 24, stage: 'destroy', characterAmount: 1 });
    const lowCharacterHighGain = await render({ gainDb: 24, stage: 'crunch', characterAmount: 0.1 });
    return {
      linearDifferences: [maxDifference(linear0, linear50), maxDifference(linear0, linear100)],
      gainRatio: gain12.rms / linear0.rms,
      silkZeroDifference: maxDifference(linear0, silk0),
      silkMidpointError: silk50.output.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - (linear0.output[index] + 0.5 * (silk100.output[index] - linear0.output[index])))), 0),
      pairDifferences: Object.values(stages).map((stage, index, values) => values.slice(index + 1).map(other => maxDifference(stage, other))),
      tubeDc: stages.tube.dc,
      processorGainDifference: maxDifference(processorGain0, processorGain24),
      destroyHigh, lowCharacterHighGain
    };
  });

  expect(report.linearDifferences).toEqual([0, 0]);
  expect(report.gainRatio).toBeCloseTo(10 ** (12 / 20), 5);
  expect(report.silkZeroDifference).toBe(0);
  expect(report.silkMidpointError).toBeLessThan(1e-7);
  expect(report.pairDifferences.flat()).toEqual(expect.arrayContaining([expect.any(Number)]));
  for (const difference of report.pairDifferences.flat()) expect(difference).toBeGreaterThan(1e-4);
  expect(Math.abs(report.tubeDc)).toBeLessThan(2e-3);
  expect(report.processorGainDifference).toBeLessThan(1e-7);
  expect(report.destroyHigh.finite).toBe(true);
  expect(report.lowCharacterHighGain.finite).toBe(true);
  expect(errors).toEqual([]);
});

test('production oversampling matches the prepared controller in the real stereo worklet at all rates', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const rows = await page.evaluate(async () => {
    const rows = [];
    for (const rate of [44100, 48000, 96000]) for (const stage of ['linear', 'silk', 'tape', 'tube', 'console', 'crunch', 'destroy']) for (const amount of [0, .5, 1]) {
      const length = 4096, context = new OfflineAudioContext(2, length, rate);
      await context.audioWorklet.addModule('/input-preamp-processor.js');
      const buffer = context.createBuffer(2, length, rate);
      for (let c = 0; c < 2; c++) for (let i = 0; i < length; i++) {
        buffer.getChannelData(c)[i] = c === 0
          ? .15 + .8 * Math.sin(i * .173) + (i === 1024 ? 12 : 0)
          : .3 * Math.cos(i * .217);
      }
      const source = context.createBufferSource(); source.buffer = buffer;
      const node = new AudioWorkletNode(context, 'resonant-input-preamp-processor', { outputChannelCount: [2], processorOptions: { stage, characterAmount: amount } });
      source.connect(node).connect(context.destination); source.start();
      const output = await context.startRendering();
      rows.push({ rate, stage, amount, output: [Array.from(output.getChannelData(0)), Array.from(output.getChannelData(1))] });
    }
    return rows;
  });
  let maximum = 0, neutralMaximum = 0, finite = true;
  for (const row of rows) {
    const reference = new OptimizedCharacterArchitecture(row.rate, row.stage, 'A', row.amount, ratesFor(row.rate, true), 'lean');
    const inputs = [new Float32Array(128), new Float32Array(128)];
    for (let first = 0; first < 4096; first += 128) {
      for (let i = 0; i < 128; i++) {
        const n = first + i;
        inputs[0][i] = .15 + .8 * Math.sin(n * .173) + (n === 1024 ? 12 : 0);
        inputs[1][i] = .3 * Math.cos(n * .217);
      }
      const expected = reference.process(inputs);
      for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) {
        const actual = row.output[c][first + i];
        finite &&= Number.isFinite(actual);
        maximum = Math.max(maximum, Math.abs(actual - expected[c][i]));
        if (row.amount === 0 || row.stage === 'linear') neutralMaximum = Math.max(neutralMaximum, Math.abs(actual - expected[c][i]));
      }
    }
  }
  expect(maximum).toBeLessThan(2e-7);
  expect(neutralMaximum).toBe(0);
  expect(finite).toBe(true);
  console.log('PRODUCTION_CHARACTER_PARITY=' + JSON.stringify({ cases: rows.length, maximum, latencySamples: 192 }));
});

test('production stage fades retain live TUBE state, deterministic stereo and allocation-free rendering', () => {
  test.setTimeout(120_000);
  const switches = [['linear', 'tape'], ['tape', 'destroy'], ['destroy', 'tube'], ['tube', 'destroy'], ['destroy', 'linear']];
  let maximum = 0, stereoMaximum = 0, deterministicMaximum = 0;
  for (const rate of [44100, 48000, 96000]) for (const [from, to] of switches) for (const amount of [0, .5, 1]) {
    const { Class, context } = productionClass(rate);
    const actual = new Class({ processorOptions: { stage: from, characterAmount: amount } });
    const twin = new Class({ processorOptions: { stage: from, characterAmount: amount } });
    const gold = new OptimizedCharacterArchitecture(rate, from, 'A', amount, ratesFor(rate, true), 'lean');
    const inputs = [new Float32Array(128), new Float32Array(128)], outputs = [new Float32Array(128), new Float32Array(128)];
    const twinOutputs = [new Float32Array(128), new Float32Array(128)];
    const inputWrapper = [inputs], outputWrapper = [outputs], twinWrapper = [twinOutputs];
    const buffers = actual.branches.map(b => [b.shaped, b.correction, b.padding, b.resetFilters, b.resetBuffers]);
    // A new DSP buffer/object via constructors would now fail the render test.
    vm.runInContext('Array = Float32Array = Float64Array = class { constructor() { throw new Error("render allocation"); } };', context);
    for (let block = 0; block < 160; block++) {
      if (block === 10) { actual.handleMessage({ type: 'set-input-stage', value: to }); twin.handleMessage({ type: 'set-input-stage', value: to }); gold.request(to); }
      for (let i = 0; i < 128; i++) inputs[0][i] = inputs[1][i] = .2 + .6 * Math.sin((block * 128 + i) * .197);
      actual.process(inputWrapper, outputWrapper); twin.process(inputWrapper, twinWrapper);
      const expected = gold.process(inputs);
      for (let i = 0; i < 128; i++) {
        maximum = Math.max(maximum, Math.abs(outputs[0][i] - expected[0][i]));
        stereoMaximum = Math.max(stereoMaximum, Math.abs(outputs[0][i] - outputs[1][i]));
        deterministicMaximum = Math.max(deterministicMaximum, Math.abs(outputs[0][i] - twinOutputs[0][i]));
      }
    }
    expect(actual.active.index).toBe(Class.STAGES[to]);
    expect(actual.target).toBe(null);
    expect(Array.from(actual.tubePreviousOutput)).toEqual(Array.from(gold.tube.tubePreviousOutput));
    for (let i = 0; i < buffers.length; i++) {
      const b = actual.branches[i];
      for (const [j, value] of [b.shaped, b.correction, b.padding, b.resetFilters, b.resetBuffers].entries()) expect(value).toBe(buffers[i][j]);
    }
  }
  expect(maximum).toBeLessThan(2e-7);
  expect(stereoMaximum).toBe(0);
  expect(deterministicMaximum).toBe(0);
  for (const rate of [44100, 48000, 96000]) {
    const { Class } = productionClass(rate);
    const silent = new Class({ processorOptions: { stage: 'linear', characterAmount: 1 } });
    const outputs = [new Float32Array(128), new Float32Array(128)];
    const inputWrapper = [[]], outputWrapper = [outputs];
    silent.handleMessage({ type: 'set-input-stage', value: 'tube' });
    silent.process(inputWrapper, outputWrapper);
    silent.handleMessage({ type: 'set-input-stage', value: 'destroy' });
    silent.handleMessage({ type: 'set-input-stage', value: 'silk' });
    for (let block = 0; block < 250; block++) {
      silent.process(inputWrapper, outputWrapper);
      expect(outputs[0].every(value => value === 0)).toBe(true);
      expect(outputs[1].every(value => value === 0)).toBe(true);
    }
    expect(silent.active.index).toBe(Class.STAGES.silk);
    expect(silent.target).toBe(null);
    expect(Array.from(silent.tubePreviousOutput)).toEqual([0, 0]);
  }
});

test('production oversampling reduces measured 48k aliases without changing the chosen curves', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const rows = await page.evaluate(async () => {
    const rows = [];
    for (const rate of [44100, 48000, 96000]) for (const stage of ['linear', 'silk', 'tape', 'tube', 'console', 'crunch', 'destroy']) for (const amplitude of [.03, .8]) {
      const length = Math.ceil(rate * .4 / 128) * 128, context = new OfflineAudioContext(2, length, rate);
      await context.audioWorklet.addModule('/input-preamp-processor.js');
      const buffer = context.createBuffer(2, length, rate);
      for (let c = 0; c < 2; c++) for (let i = 0; i < length; i++) buffer.getChannelData(c)[i] = amplitude * Math.sin(2 * Math.PI * 10000 * i / rate);
      const source = context.createBufferSource(); source.buffer = buffer;
      const node = new AudioWorkletNode(context, 'resonant-input-preamp-processor', { outputChannelCount: [2], processorOptions: { stage, characterAmount: 1 } });
      source.connect(node).connect(context.destination); source.start();
      const rendered = await context.startRendering(), output = rendered.getChannelData(0);
      const first = Math.round(rate * .25) + 192, end = first + Math.round(rate * .1);
      let peak = 0, dc = 0, energy = 0;
      for (let i = first; i < end; i++) { peak = Math.max(peak, Math.abs(output[i])); dc += output[i]; energy += output[i] ** 2; }
      rows.push({ rate, stage, amplitude, peak, dc: dc / (end - first), rms: Math.sqrt(energy / (end - first)), output: Array.from(output.slice(first, end)) });
    }
    return rows;
  });
  function aliases(data, rate) {
    const s = p.spectrum(data), fundamental = Math.round(10000 * data.length / rate);
    let alias = 0;
    for (let k = 1; k < s.re.length; k++) if (k % fundamental) alias += (2 * k === data.length ? .5 : 1) * (s.re[k] ** 2 + s.im[k] ** 2);
    return Math.sqrt(alias / (s.re[fundamental] ** 2 + s.im[fundamental] ** 2));
  }
  const metrics = [];
  for (const row of rows) {
    expect(row.output.every(Number.isFinite)).toBe(true);
    expect(Math.abs(row.dc)).toBeLessThan(1e-6);
    const length = Math.ceil(row.rate * .4 / 128) * 128;
    const input = Float32Array.from({ length }, (_, i) => row.amplitude * Math.sin(2 * Math.PI * 10000 * i / row.rate));
    const baseline = p.processProduction(input, row.rate, row.stage).slice(Math.round(row.rate * .25), Math.round(row.rate * .35));
    const before = aliases(baseline, row.rate), after = aliases(row.output, row.rate);
    if (row.rate === 48000 && row.amplitude === .8 && row.stage !== 'linear') expect(after, row.stage).toBeLessThan(before);
    metrics.push({ ...row, output: undefined, aliasBefore: before, aliasAfter: after });
  }
  fs.writeFileSync(test.info().outputPath('production-character-audio.json'), JSON.stringify(metrics, null, 2));
  console.log('PRODUCTION_CHARACTER_AUDIO=' + JSON.stringify(metrics.filter(row => row.rate === 48000 && row.amplitude === .8)));
});

test('installed Input Character runs the complete production graph and transitions at 48k and 96k', async ({ page }) => {
  test.setTimeout(180_000);
  const profile = process.env.P1C_INPUT_PROFILE;
  if (profile === 'baseline') await page.route('**/input-preamp-processor.js', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'helpers/input-character-legacy-processor.js'), 'utf8') }));
  const report = await measureProductionGraph(page, profile ? { rates: [96000], cases: ['linear', 'destroy', 'tube->destroy', 'destroy->tube', 'tape->destroy', 'destroy->tape'] } : {});
  fs.writeFileSync(test.info().outputPath('production-character-performance.json'), JSON.stringify(report, null, 2));
  console.log('PRODUCTION_CHARACTER_PERFORMANCE=' + JSON.stringify(report.nativeRender));
});
