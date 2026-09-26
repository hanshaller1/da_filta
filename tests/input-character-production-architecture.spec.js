const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { CharacterArchitecture } = require('./helpers/input-character-architecture.cjs');
const { measureFullGraph } = require('./helpers/measure-input-character-full-graph.cjs');
const p = require('./helpers/input-character-oversampling.cjs');
const filename = path.join(__dirname, 'measurements/input-character-production-architecture.json');
const switches = [['linear', 'tape'], ['tape', 'tube'], ['tube', 'destroy'], ['destroy', 'silk'], ['destroy', 'linear']];

test('fixed and variable latency architecture: switches, partial amount, live TUBE state', () => {
  test.setTimeout(240_000);
  const rows = [];
  for (const rate of [44100, 48000, 96000]) for (const model of ['A', 'B', 'C']) for (const [from, to] of switches) for (const amount of [0, .5, 1]) {
    const graph = new CharacterArchitecture(rate, from, model, amount);
    const reference = model === 'A' && amount === .5 ? new CharacterArchitecture(rate, to, model, amount) : null;
    const oldReference = reference ? new CharacterArchitecture(rate, from, model, amount) : null;
    const firstBlock = Math.ceil(rate * .05 / 128), blocks = Math.ceil(rate * .24 / 128);
    const input = Float32Array.from({ length: blocks * 128 }, (_, i) => .12 + .6 * Math.sin(2 * Math.PI * 1373 * i / rate) + (i % 2048 === 0 ? .2 : 0));
    let neutralError = 0, stereoError = 0, warmError = 0, nonfinite = 0, firstJump = 0, endError = 0, statePeak = 0, fadeReferenceError = 0;
    for (let block = 0; block < blocks; block++) {
      if (block === firstBlock) graph.request(to);
      const data = input.subarray(block * 128, (block + 1) * 128);
      const previous = graph.output[0][127];
      const warming = graph.warmFrames > 0, fading = Boolean(graph.target), activeBefore = graph.active;
      let expectedWeight = graph.weight;
      const output = graph.process([data, data]);
      const gold = reference?.process([data, data]);
      const oldGold = oldReference?.process([data, data]);
      for (let i = 0; i < 128; i++) {
        const n = block * 128 + i;
        nonfinite += Number.isFinite(output[0][i]) ? 0 : 1;
        stereoError = Math.max(stereoError, Math.abs(output[0][i] - output[1][i]));
        if (gold) {
          if (fading && !warming) expectedWeight = 1 + graph.smoothing * (expectedWeight - 1);
          const expected = warming || !fading && activeBefore === from ? oldGold[0][i] : fading ? oldGold[0][i] + expectedWeight * (gold[0][i] - oldGold[0][i]) : gold[0][i];
          fadeReferenceError = Math.max(fadeReferenceError, Math.abs(output[0][i] - expected));
        }
        if (amount === 0) neutralError = Math.max(neutralError, Math.abs(output[0][i] - (input[n - 192] || 0)));
        if (gold && block === blocks - 1) endError = Math.max(endError, Math.abs(output[0][i] - gold[0][i]));
      }
      if (block === firstBlock) firstJump = Math.abs(output[0][0] - previous);
      if (reference && to !== 'linear' && block >= firstBlock + 3) warmError = Math.max(warmError, p.error(graph.branches[to].correction[0], reference.branches[to].correction[0]).maximum);
      statePeak = Math.max(statePeak, ...Array.from(graph.tube.tubePreviousOutput, Math.abs));
    }
    const before = Array.from(graph.tube.tubePreviousOutput); graph.panic();
    expect(Array.from(graph.tube.tubePreviousOutput)).toEqual(before);
    expect(graph.active).toBe(to);
    expect(nonfinite).toBe(0); expect(stereoError).toBe(0); expect(statePeak).toBeLessThan(2);
    if (model === 'A' && amount === 0) expect(neutralError).toBe(0);
    if (reference) { expect(warmError).toBeLessThan(3e-7); expect(endError).toBe(0); expect(fadeReferenceError).toBeLessThan(3e-7); }
    rows.push({ rate, model, from, to, amount, oldDelay: graph.latency(from), newDelay: graph.latency(to), neutralError, stereoError, warmError, endError, fadeReferenceError, firstJump, statePeak, nonfinite });
  }
  // Rapid requests resolve to the most recent requested stage after the current fade.
  const queued = new CharacterArchitecture(48000, 'linear', 'A', 0);
  queued.request('tube'); queued.request('destroy'); queued.request('silk');
  const silence = new Float32Array(128);
  for (let i = 0; i < 120; i++) queued.process([silence, silence]);
  expect(queued.active).toBe('silk'); expect(queued.target).toBe(null);
  expect(Array.from(queued.tube.tubePreviousOutput)).toEqual([0, 0]);
  const report = { date: new Date().toISOString(), productionHash: createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../input-preamp-processor.js'))).digest('hex'), switches: rows,
    delayComb: [128, 192, 64].map(samples => ({ samples, firstNullHz48k: 48000 / (2 * samples), firstNullHz96k: 96000 / (2 * samples), middleFadeGain: 0 })),
    tube: [44100, 48000, 96000].map(rate => ({ hostRate: rate, internalRate: rate * 2, pole: Math.pow(.9987, 48000 / (rate * 2)), cutoffHz: -48000 * Math.log(.9987) / (2 * Math.PI) })) };
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
});

test('LINEAR neutrality, continuous inactive TUBE decay and moderate DESTROY drive', () => {
  test.setTimeout(120_000);
  const destroy = [], neutral = [], dc = [];
  for (const rate of [44100, 48000, 96000]) {
    for (const amount of [0, .25, .5, .75, 1]) {
      const graph = new CharacterArchitecture(rate, 'linear', 'A', amount);
      const input = Float32Array.from({ length: 4096 }, (_, i) => 3 * Math.sin(i * .179));
      const result = new Float32Array(input.length);
      for (let i = 0; i < input.length; i += 128) result.set(graph.process([input.subarray(i, i + 128), input.subarray(i, i + 128)])[0], i);
      const expected = new Float32Array(input.length); expected.set(input.subarray(0, input.length - 192), 192);
      const maximum = p.error(result, expected).maximum;
      expect(maximum).toBe(0); neutral.push({ rate, amount, maximum });
    }
    const graph = new CharacterArchitecture(rate, 'linear', 'A', 0);
    const constant = new Float32Array(128).fill(.4); let peak = 0, increasesAfterWarmup = 0, previous = Infinity;
    const blocks = Math.ceil(rate / 128);
    for (let i = 0; i < blocks; i++) {
      graph.process([constant, constant]);
      const state = Math.abs(graph.tube.tubePreviousOutput[0]); peak = Math.max(peak, state);
      if (i > 5 && state > previous + 1e-12) increasesAfterWarmup++;
      previous = state;
    }
    // Kaiser interpolator has a small phase-to-phase DC gain ripple. The internal
    // alternating residue is bounded; it is not a growing or retained DC offset.
    expect(increasesAfterWarmup).toBe(0); expect(previous).toBeLessThan(1e-6);
    dc.push({ rate, peak, final: previous, increasesAfterWarmup });
    for (const gainDb of [0, 6, 12, 24]) for (const factor of [1, 4]) {
      const amplitude = .25 * 10 ** (gainDb / 20), frequency = 10000;
      const input = Float32Array.from({ length: Math.round(rate * .35) + 256 }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
      const up = p.prepare(input, factor), output = p.mix(input, p.wet(up, rate, 'destroy', factor), p.down(up, factor), factor, 1);
      const segment = output.slice(Math.round(rate * .25) + p.delay(factor), Math.round(rate * .35) + p.delay(factor));
      const spec = p.spectrum(segment), fundamentalBin = Math.round(frequency * segment.length / rate);
      const fundamentalPower = spec.re[fundamentalBin] ** 2 + spec.im[fundamentalBin] ** 2;
      let aliases = 0;
      for (let k = 1; k < spec.re.length; k++) {
        const isHarmonic = k % fundamentalBin === 0;
        if (!isHarmonic) aliases += (2 * k === segment.length ? .5 : 1) * (spec.re[k] ** 2 + spec.im[k] ** 2);
      }
      const metric = p.metrics(segment); expect(metric.finite).toBe(true);
      destroy.push({ rate, sourcePeak: .25, gainDb, characterInputPeak: amplitude, frequency, amount: 1, factor, aliasFundamentalPercent: 100 * Math.sqrt(aliases / fundamentalPower), ...metric });
    }
  }
  const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
  Object.assign(report, { destroyModerate: destroy, linearNeutrality: neutral, inactiveTubeDc: dc });
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
});

test('complete production DSP load in browser and real AudioWorklet, stereo 48/96 kHz', async ({ page }) => {
  test.setTimeout(240_000);
  const result = await measureFullGraph(page);
  const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
  Object.assign(report, result, { machine: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, platform: os.platform(), arch: os.arch(), node: process.version }, caveat: 'nativeRender is Chromium trace wall duration of RealtimeAudioDestinationHandler::Render, frames=128, after 250ms warmup, including the Worklet and native branches. Replay p99 is main-thread complete-DSP timing, not callback timing. Live Date.now durations are millisecond-quantized; currentFrame continuity does not detect device underruns. Trace instrumentation adds overhead and 2-second runs do not prove long-session stability.' });
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
});
