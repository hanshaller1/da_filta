const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const p = require('./helpers/input-character-oversampling.cjs');

test('test harness reproduces the actual browser worklet at host rate', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const browser = await page.evaluate(async () => {
    const rows = [];
    for (const rate of [44100, 48000, 96000]) for (const stage of ['linear', 'silk', 'tape', 'tube', 'console', 'crunch', 'destroy']) {
      const length = 4096, context = new OfflineAudioContext(1, length, rate);
      await context.audioWorklet.addModule(new URL('/input-preamp-processor.js', location.href));
      const buffer = context.createBuffer(1, length, rate);
      const input = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) input[i] = .8 * Math.sin(2 * Math.PI * 1000 * i / rate);
      const source = context.createBufferSource(); source.buffer = buffer;
      const node = new AudioWorkletNode(context, 'resonant-input-preamp-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { stage, characterAmount: 1, inputGainDb: 0 } });
      source.connect(node).connect(context.destination); source.start();
      const output = (await context.startRendering()).getChannelData(0);
      rows.push({ rate, stage, output: Array.from(output) });
    }
    return rows;
  });
  for (const row of browser) {
    const input = Float32Array.from({ length: 4096 }, (_, i) => .8 * Math.sin(2 * Math.PI * 1000 * i / row.rate));
    expect(p.error(p.processProduction(input, row.rate, row.stage), row.output).maximum, `${row.rate} ${row.stage}`).toBeLessThan(2e-7);
  }
});

test('FIR streaming prototype has measured rejection, matched impulse delay and neutral residual mix', () => {
  const quality = p.filterQuality();
  expect(quality.stopbandDb).toBeLessThan(-85);
  expect(quality.rippleDb).toBeLessThan(.001);
  for (const factor of [2, 4]) {
    const input = new Float32Array(2048); input[0] = .8;
    const up = p.prepare(input, factor), linear = p.down(up, factor);
    const shaped = p.wet(up, 48000, 'linear', factor);
    let peakIndex = 0;
    for (let i = 0; i < linear.length; i++) if (Math.abs(linear[i]) > Math.abs(linear[peakIndex])) peakIndex = i;
    expect(peakIndex).toBe(p.delay(factor));
    for (const amount of [0, .25, .5, .75, 1]) {
      const mixed = p.mix(input, shaped, linear, factor, amount, 'C');
      const expected = new Float32Array(input.length); expected[p.delay(factor)] = .8;
      expect(p.error(mixed, expected).maximum).toBe(0);
    }
    const stream = new p.StreamingPrototype(48000, 'linear', factor, 2), result = new Float32Array(input.length);
    for (let first = 0; first < input.length; first += 128) {
      const block = input.subarray(first, first + 128), output = stream.process([block, block]);
      expect(p.error(output[0], output[1]).maximum).toBe(0);
      result.set(output[0], first);
    }
    const expected = p.mix(input, shaped, linear, factor, 1, 'C');
    expect(p.error(result, expected).maximum).toBeLessThan(2e-7);
    const tone = Float32Array.from({ length: 2048 }, (_, i) => .8 * Math.sin(i * .17));
    const toneUp = p.prepare(tone, factor), toneLinear = p.down(toneUp, factor), toneWet = p.wet(toneUp, 48000, 'destroy', factor);
    for (const architecture of ['A', 'B', 'C']) {
      const stream = new p.StreamingPrototype(48000, 'destroy', factor, 1, architecture, .5);
      const actual = new Float32Array(tone.length);
      for (let first = 0; first < tone.length; first += 128) actual.set(stream.process([tone.subarray(first, first + 128)])[0], first);
      expect(p.error(actual, p.mix(tone, toneWet, toneLinear, factor, .5, architecture)).maximum).toBeLessThan(2e-7);
    }
  }
});

test('measured matrix stays finite and oversampling reduces representative aliases', () => {
  // Regenerate with: node tests/helpers/measure-input-character-oversampling.cjs
  const filename = path.join(__dirname, 'measurements/input-character-oversampling.json');
  const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
  expect(report.productionHash).toBe(createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../input-preamp-processor.js'))).digest('hex'));
  expect(report.tones.length).toBe(3942);
  expect(report.signals.length).toBe(1944);
  expect(report.tones.every(row => row.finite)).toBe(true);
  expect(report.signals.every(row => row.finite)).toBe(true);
  expect(report.validation.fftAmplitude).toBeCloseTo(.8, 6);
  for (const row of report.validation.streaming) expect(row.maximum, `${row.stage} ${row.factor}`).toBeLessThan(1e-5);
  for (const row of report.summary) {
    const [one, two, four] = row.representative;
    expect(two.aliasFundamental, row.stage).toBeLessThan(one.aliasFundamental);
    expect(four.aliasFundamental, row.stage).toBeLessThan(one.aliasFundamental);
  }
  expect(report.benchmarkSinkFinite).toBe(true);
  expect(report.switches).toHaveLength(36);
  expect(report.switches.every(row => row.finite && row.startDeviation < .001)).toBe(true);
  expect(report.tones.every(row => Math.abs(row.dc) < 1e-6)).toBe(true);
});
