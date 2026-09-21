const { test, expect } = require('playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const frequencies = [29, 61, 115, 218, 411, 777, 1500, 2800, 5200, 11000];
const boundaries = frequencies.slice(0, -1).map((frequency, index) => Math.sqrt(frequency * frequencies[index + 1]));
const qs = frequencies.map((frequency, index) => {
  const lower = index === 0 ? frequency ** 2 / boundaries[0] : boundaries[index - 1];
  const upper = index === frequencies.length - 1 ? frequency ** 2 / boundaries.at(-1) : boundaries[index];
  return frequency / (upper - lower);
});

function loadProcessor(source) {
  const tptSource = fs.readFileSync(path.join(root, 'tpt-svf.js'), 'utf8')
    .replaceAll('export class ', 'class ');
  const processorSource = source
    .replace(/^import .*?;\s*$/m, '')
    .replace(/registerProcessor\('da-filta-processor', DaFiltaProcessor\);/, 'globalThis.DaFiltaProcessor = DaFiltaProcessor;');
  const context = {
    Math, Number, Array, Float64Array, Object, console, sampleRate: 48000,
    AudioWorkletProcessor: class {
      constructor() { this.port = { onmessage: null, postMessage() {} }; }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(`${tptSource}\n${processorSource}`, context, { filename: 'filterbank-processor.js' });
  return context.DaFiltaProcessor;
}

const CurrentProcessor = loadProcessor(fs.readFileSync(path.join(root, 'filterbank-processor.js'), 'utf8'));
const PreZdfProcessor = loadProcessor(execFileSync('git', ['show', 'd39cbb5^:filterbank-processor.js'], {
  cwd: root, encoding: 'utf8'
}));

function options(overrides = {}) {
  return {
    bandFrequencies: frequencies, bandQs: qs,
    bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
    feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === 5),
    feedbackBandRight: Array(10).fill(false),
    feedbackAllLeft: false, feedbackAllRight: false,
    resonance: 1, feedbackTopology: 'common-bus', feedbackCore: 'current',
    feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum',
    feedbackAllLevel: 'raw', feedbackTap: 'post-gain', wetModel: 'filterbank-sum',
    ...overrides
  };
}

function run(processor, frames, input = frame => 0) {
  const output = new Array(frames);
  for (let frame = 0; frame < frames; frame += 1) output[frame] = processor.processChannelFrame(input(frame), 'left');
  return output;
}

function baseState(processor) {
  return processor.baseFilters.left.map(filter => ({
    frequency: filter.frequency, ic1eq: filter.ic1eq, ic2eq: filter.ic2eq,
    low: filter.low, band: filter.band, high: filter.high, unitBand: filter.unitBand
  }));
}

function currentReturns(processor) {
  return {
    common: { ...processor.commonFeedbackReturns },
    local: { left: [...processor.localFeedbackReturns.left], right: [...processor.localFeedbackReturns.right] },
    main: { ...processor.mainCommonFeedbackReturns },
    legacy: { left: [...processor.feedbackReturns.left], right: [...processor.feedbackReturns.right] }
  };
}

test('CURRENT remains bit-identical to the pre-ZDF processor across established configurations', () => {
  const configurations = [
    {}, { feedbackTap: 'pre-gain' },
    { feedbackBandLeft: Array(10).fill(false), feedbackAllLeft: true },
    { feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === 5), feedbackAllLeft: true },
    { resonance: -1 },
    { feedbackBandLeft: Array(10).fill(false), feedbackAllLeft: true, resonance: -1 },
    { feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === 5), feedbackAllLeft: true, resonance: -1 },
    { feedbackTopology: 'local-loop-exp', localLoopTuning: 'current' },
    { feedbackTopology: 'local-loop-exp', localLoopTuning: 'compensated' },
    { feedbackAllSaturationReturn: 'drive-4-return-0.2', feedbackBandLeft: Array(10).fill(false), feedbackAllLeft: true },
    { feedbackAllResonanceCurve: 'soft-knee', feedbackBandLeft: Array(10).fill(false), feedbackAllLeft: true },
    { commonBusSaturationMode: 'constant-ceiling', commonBusDrive: 4, commonBusCeiling: 2 },
    { bandGainLeft: Array.from({ length: 10 }, (_, index) => index === 5 ? 100 : 0), feedbackTap: 'post-gain' }
  ];
  let maxDifference = 0;
  for (const configuration of configurations) {
    const before = new PreZdfProcessor({ processorOptions: options(configuration) });
    const current = new CurrentProcessor({ processorOptions: options(configuration) });
    const input = frame => frame < 1500 ? 0.02 * Math.sin(2 * Math.PI * 777 * frame / 48000) : 0;
    const beforeOutput = run(before, 8192, input);
    const currentOutput = run(current, 8192, input);
    for (let frame = 0; frame < currentOutput.length; frame += 1) {
      maxDifference = Math.max(maxDifference, Math.abs(beforeOutput[frame] - currentOutput[frame]));
    }
  }
  expect(maxDifference).toBe(0);
});

test('CURRENT to ZDF to CURRENT preserves CURRENT returns and does not reset shared base filters', () => {
  const processor = new CurrentProcessor({ processorOptions: options({ feedbackAllLeft: true }) });
  const input = frame => frame < 1500 ? 0.02 * Math.sin(2 * Math.PI * 777 * frame / 48000) : 0;
  run(processor, 2400, input);
  const returnsBefore = currentReturns(processor);
  const baseBefore = baseState(processor);

  processor.handleMessage({ type: 'set-feedback-core', value: 'zdf' });
  expect(currentReturns(processor)).toEqual(returnsBefore);
  expect(baseState(processor)).toEqual(baseBefore);

  const zdfOutput = run(processor, 512, frame => 0.01 * Math.sin(2 * Math.PI * 777 * frame / 48000));
  expect(zdfOutput.every(Number.isFinite)).toBe(true);
  expect(processor.zdfLocalReturn.left).not.toBe(0);
  expect(processor.zdfMainReturn.left).not.toBe(0);
  expect(currentReturns(processor)).toEqual(returnsBefore);
  const baseBeforeReturn = baseState(processor);

  processor.handleMessage({ type: 'set-feedback-core', value: 'current' });
  expect(currentReturns(processor)).toEqual(returnsBefore);
  expect(baseState(processor)).toEqual(baseBeforeReturn);
  const currentOutput = run(processor, 512, frame => 0.01 * Math.sin(2 * Math.PI * 777 * frame / 48000));
  expect(currentOutput.every(Number.isFinite)).toBe(true);
  // This exercised LOCAL+MAIN case remains within the normal bounded return
  // range after the round-trip; the important regression guard is that the
  // saved CURRENT return history is the only history used on return.
  expect(Math.max(...currentOutput.map(Math.abs))).toBeLessThan(4);
});

test('a resonance-zero core round-trip is output-identical to uninterrupted CURRENT processing', () => {
  const uninterrupted = new CurrentProcessor({ processorOptions: options({ resonance: 0 }) });
  const switched = new CurrentProcessor({ processorOptions: options({ resonance: 0 }) });
  const input = frame => frame < 900 ? 0.02 * Math.sin(2 * Math.PI * 777 * frame / 48000) : 0;
  run(uninterrupted, 1000, input);
  run(switched, 1000, input);
  const baseBefore = baseState(switched);
  switched.handleMessage({ type: 'set-feedback-core', value: 'zdf' });
  switched.handleMessage({ type: 'set-feedback-core', value: 'current' });
  expect(baseState(switched)).toEqual(baseBefore);
  const reference = run(uninterrupted, 512, frame => input(frame + 1000));
  const output = run(switched, 512, frame => input(frame + 1000));
  expect(output).toEqual(reference);
});
