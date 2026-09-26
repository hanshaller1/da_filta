const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const p = require('./helpers/input-character-oversampling.cjs');
const { CharacterArchitecture, ratesFor } = require('./helpers/input-character-architecture.cjs');
const { measureAdaptive, source, spectral, variants } = require('./helpers/measure-input-character-adaptive.cjs');
const { measureFullGraph } = require('./helpers/measure-input-character-full-graph.cjs');
const filename = path.join(__dirname, 'measurements/input-character-adaptive-oversampling.json');
const stages = ['linear', 'silk', 'tape', 'tube', 'console', 'crunch', 'destroy'];
function update(data) {
  const report = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {};
  fs.writeFileSync(filename, JSON.stringify(Object.assign(report, data), null, 2) + '\n');
}

test('adaptive alias matrix: paired host rates, transients, high-drive DESTROY and references', () => {
  test.setTimeout(240_000);
  const previous = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {};
  const measurements = measureAdaptive();
  for (const row of [...measurements.tones, ...measurements.signals, ...measurements.stress]) {
    expect(row.finite).toBe(true); expect(Number.isFinite(row.referenceError.rms)).toBe(true);
  }
  expect(measurements.pairs).toHaveLength(108);
  expect(measurements.stressPairs).toHaveLength(8);
  const sourceHashes = Object.fromEntries(['input-preamp-processor.js', 'filterbank-processor.js', 'tpt-svf.js', 'dynamic-eq-core.mjs', 'output-guard-processor.js', 'output-protection-processor.js'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')]));
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'measurements/input-character-production-architecture.json'), 'utf8'));
  const cpuRuns = previous.cpuRuns || (previous.nativeRender ? [{ date: previous.date, nativeRender: previous.nativeRender }] : []);
  fs.writeFileSync(filename, JSON.stringify({ date: new Date().toISOString(), sourceHashes, baselineCpuDate: baseline.date, oldNativeRender: baseline.nativeRender, cpuRuns, ...measurements }, null, 2) + '\n');
});

test('adaptive difference path stays neutral and matches offline curves for all amounts', () => {
  test.setTimeout(120_000);
  const rows = [];
  for (const rate of [44100, 48000, 96000]) for (const stage of stages) {
    const rates = ratesFor(rate, true), factor = rates[stage];
    const input = Float32Array.from({ length: 4096 }, (_, i) => .1 + .8 * Math.sin(i * .179) + (i === 900 ? .2 : 0));
    const up = p.prepare(input, factor), shaped = p.wet(up, rate, stage, factor), linear = p.down(up, factor);
    const dry = new Float32Array(input.length); dry.set(input.subarray(0, input.length - 192), 192);
    for (const amount of [0, .25, .5, .75, 1]) {
      const graph = new CharacterArchitecture(rate, stage, 'A', amount, rates);
      const identity = new CharacterArchitecture(rate, stage, 'A', amount, rates);
      if (stage === 'tube') identity.tube.shape = (_, x) => x;
      else if (stage !== 'linear') identity.branches[stage].node.shape = (_, x) => x;
      const wet = p.mix(input, shaped, linear, factor, amount, 'C'), expected = new Float64Array(input.length), pad = 192 - p.delay(factor);
      expected.set(wet.subarray(0, input.length - pad), pad);
      const actual = new Float32Array(input.length), neutral = new Float32Array(input.length);
      for (let i = 0; i < input.length; i += 128) {
        const block = input.subarray(i, i + 128), output = graph.process([block, block]);
        expect(p.error(output[0], output[1]).maximum).toBe(0);
        actual.set(output[0], i); neutral.set(identity.process([block, block])[0], i);
      }
      const error = p.error(actual, expected).maximum, neutralError = p.error(neutral, dry).maximum;
      expect(error).toBeLessThan(3e-7); expect(neutralError).toBe(0);
      if (amount === 0 || stage === 'linear') expect(p.error(actual, dry).maximum).toBe(0);
      rows.push({ rate, stage, factor, amount, resamplerDelay: p.delay(factor), padding: pad, latency: 192, offlineError: error, identityError: neutralError, dryError: p.error(actual, dry).maximum });
    }
  }
  update({ mix: rows });
});

test('adaptive switches, persistent TUBE and finite stereo legal extremes', () => {
  test.setTimeout(240_000);
  const transitions = [['linear', 'tape'], ['tape', 'linear'], ['tape', 'destroy'], ['destroy', 'tape'], ['destroy', 'linear'], ['linear', 'destroy'], ['tape', 'tube'], ['tube', 'destroy'], ['destroy', 'tube']];
  const rows = [], tube = [], extremes = [];
  for (const rate of [48000, 96000]) for (const [from, to] of transitions) for (const amount of [0, .25, .5, .75, 1]) {
    const rates = ratesFor(rate, true), graph = new CharacterArchitecture(rate, from, 'A', amount, rates);
    const old = new CharacterArchitecture(rate, from, 'A', amount, rates), next = new CharacterArchitecture(rate, to, 'A', amount, rates);
    const firstBlock = Math.ceil(rate * .05 / 128), blocks = Math.ceil(rate * .24 / 128);
    const input = Float32Array.from({ length: blocks * 128 }, (_, i) => .12 + .6 * Math.sin(2 * Math.PI * 1373 * i / rate) + (i % 2048 === 0 ? .2 : 0));
    let error = 0, dryError = 0, stereoError = 0, warmError = 0, peakState = 0;
    for (let block = 0; block < blocks; block++) {
      if (block === firstBlock) graph.request(to);
      const data = input.subarray(block * 128, (block + 1) * 128);
      const warming = graph.warmFrames > 0, fading = Boolean(graph.target), active = graph.active; let weight = graph.weight;
      const actual = graph.process([data, data]), a = old.process([data, data]), b = next.process([data, data]);
      for (let i = 0; i < 128; i++) {
        if (fading && !warming) weight = 1 + graph.smoothing * (weight - 1);
        const expected = warming || !fading && active === from ? a[0][i] : fading ? a[0][i] + weight * (b[0][i] - a[0][i]) : b[0][i];
        error = Math.max(error, Math.abs(expected - actual[0][i]));
        stereoError = Math.max(stereoError, Math.abs(actual[0][i] - actual[1][i]));
        if (amount === 0) dryError = Math.max(dryError, Math.abs(actual[0][i] - (input[block * 128 + i - 192] || 0)));
      }
      if (to !== 'linear' && block >= firstBlock + 3) warmError = Math.max(warmError, p.error(graph.branches[to].correction[0], next.branches[to].correction[0]).maximum);
      peakState = Math.max(peakState, ...Array.from(graph.tube.tubePreviousOutput, Math.abs));
    }
    const before = Array.from(graph.tube.tubePreviousOutput); graph.panic(); expect(Array.from(graph.tube.tubePreviousOutput)).toEqual(before);
    expect(graph.active).toBe(to); expect(error).toBeLessThan(3e-7); expect(stereoError).toBe(0); expect(dryError).toBe(0); expect(warmError).toBeLessThan(3e-7); expect(peakState).toBeLessThan(2);
    rows.push({ rate, from, to, amount, error, dryError, stereoError, warmError, peakState, latency: 192 });
  }
  for (const rate of [44100, 48000, 96000]) {
    const graph = new CharacterArchitecture(rate, 'linear', 'A', 0, ratesFor(rate, true));
    const input = new Float32Array(128).fill(.4); let previous = Infinity, increases = 0;
    for (let i = 0; i < Math.ceil(rate / 128); i++) {
      graph.process([input, input]); const value = Math.abs(graph.tube.tubePreviousOutput[0]);
      if (i > 5 && value > previous + 1e-12) increases++; previous = value;
    }
    const pole = graph.tube.tubeDcPole, internalRate = rate * ratesFor(rate, true).tube;
    expect(increases).toBe(0); expect(previous).toBeLessThan(rate === 96000 ? 1e-12 : 1e-6);
    expect(-internalRate * Math.log(pole) / (2 * Math.PI)).toBeCloseTo(9.937729373500819, 10);
    tube.push({ rate, internalRate, pole, cutoffHz: -internalRate * Math.log(pole) / (2 * Math.PI), dcFinal: previous, increases });
    for (const stage of stages) {
      const extreme = new CharacterArchitecture(rate, stage, 'A', 1, ratesFor(rate, true));
      const signal = Float32Array.from({ length: 128 }, (_, i) => (i % 3 === 0 ? 1 : -.8) * 10 ** (24 / 20));
      let peak = 0, nonfinite = 0, stereo = 0;
      for (let block = 0; block < 100; block++) {
        const out = extreme.process([signal, signal]);
        for (let i = 0; i < 128; i++) { peak = Math.max(peak, Math.abs(out[0][i])); nonfinite += Number.isFinite(out[0][i]) ? 0 : 1; stereo = Math.max(stereo, Math.abs(out[0][i] - out[1][i])); }
      }
      expect(nonfinite).toBe(0); expect(stereo).toBe(0); extremes.push({ rate, stage, peak, nonfinite, stereo });
    }
  }
  update({ transitions: rows, tube, extremes });
});

test('adaptive full DSP native AudioWorklet budget, including both DESTROY switch directions', async ({ page }) => {
  test.setTimeout(300_000);
  const result = await measureFullGraph(page, { adaptive: true, cases: [...stages, 'tube->destroy', 'destroy->tube', 'tape->destroy', 'destroy->tape'] });
  const cpuRuns = JSON.parse(fs.readFileSync(filename, 'utf8')).cpuRuns || [];
  cpuRuns.push({ date: new Date().toISOString(), nativeRender: result.nativeRender });
  update({ ...result, cpuRuns, machine: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, platform: os.platform(), arch: os.arch(), node: process.version }, cpuCaveat: 'Native Chromium 128-frame render wall duration; real stereo Worklet full graph and native analyzers. First 250ms separated, 0.4-0.8s switch window. Tracing adds overhead. Main-thread replays are supporting data, not callback-budget evidence. currentFrame continuity does not prove absence of device underruns.' });
});

test('paired adaptive host rates retain aligned fundamental phase and common-band level', () => {
  test.setTimeout(120_000);
  const pairs = [];
  for (const stage of stages.filter(x => x !== 'linear')) for (const frequency of [100, 1000, 5000, 10000, 18000, 20000]) for (const amplitude of [.03, .25, .8]) {
    const results = [48000, 96000].map(rate => {
      const factor = ratesFor(rate, true)[stage];
      const data = variants(source(rate, 'tone', amplitude, frequency), rate, stage, [factor])[factor];
      return spectral(data, rate, frequency, 24000);
    });
    const phase = results[1].fundamentalPhaseRadians - results[0].fundamentalPhaseRadians;
    const phaseDifference = Math.atan2(Math.sin(phase), Math.cos(phase));
    const gainDifferenceDb = 20 * Math.log10(results[1].fundamental / results[0].fundamental);
    expect(Math.abs(phaseDifference)).toBeLessThan(.001);
    expect(Math.abs(gainDifferenceDb)).toBeLessThan(.02);
    pairs.push({ stage, frequency, amplitude, phaseDifferenceRadians: phaseDifference, fundamentalGainDifferenceDb: gainDifferenceDb });
  }
  update({ pairedPhase: pairs });
});
