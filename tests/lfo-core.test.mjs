import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LfoOscillator,
  LFO_WAVEFORMS,
  normalizeLfoState,
  rateToSlider,
  sliderToRate,
  waveformSample
} from '../lfo-core.mjs';

test('legacy LFO state normalizes to a safe disabled default', () => {
  assert.deepEqual(normalizeLfoState({}), {
    lfoEnabled: false, lfoWaveform: 'sine', lfoRateHz: 1, lfoPolarity: 'bipolar',
    lfoPhase: 0, lfoTargetId: '', lfoAmount: 25, lfoSeed: 0x6d2b79f5
  });
  const malformed = normalizeLfoState({ lfoEnabled: 1, lfoWaveform: 'noise', lfoRateHz: NaN,
    lfoPolarity: 'mono', lfoPhase: Infinity, lfoTargetId: {}, lfoAmount: -4 });
  assert.deepEqual(malformed, { ...normalizeLfoState({}), lfoAmount: 0 });
});

test('all six waveform generators stay in the bipolar range and define expected phase points', () => {
  assert.deepEqual([...LFO_WAVEFORMS], ['sine', 'triangle', 'saw-up', 'saw-down', 'square', 'sample-hold']);
  assert.ok(Math.abs(waveformSample('sine', .25) - 1) < 1e-12);
  assert.equal(waveformSample('triangle', .5), 1);
  assert.equal(waveformSample('saw-up', 0), -1);
  assert.equal(waveformSample('saw-down', 0), 1);
  assert.equal(waveformSample('square', .75), -1);
  assert.equal(waveformSample('sample-hold', .7, .37), .37);
  for (const waveform of LFO_WAVEFORMS) {
    for (let index = 0; index <= 1000; index += 1) {
      const value = waveformSample(waveform, index / 1000, .73);
      assert.ok(Number.isFinite(value) && value >= -1 && value <= 1);
    }
  }
});

test('free-rate slider is logarithmic and spans 0.01 Hz through 20 Hz', () => {
  assert.equal(sliderToRate(0), .01);
  assert.equal(sliderToRate(1000), 20);
  for (const rate of [.01, .1, 1, 20]) {
    assert.ok(Math.abs(sliderToRate(rateToSlider(rate)) / rate - 1) < .005);
  }
});

test('audio-thread phase follows sample count, power/reset start at zero, and offset/rate/wave changes preserve it', () => {
  for (const rate of [.01, 1, 20]) {
    const oscillator = new LfoOscillator({ lfoEnabled: true, lfoRateHz: rate, lfoPhase: 0 });
    for (let frame = 0; frame < 48000; frame += 1) oscillator.advance(48000);
    assert.ok(Math.abs(oscillator.phase - (rate % 1)) < 1e-8);
  }
  const oscillator = new LfoOscillator({ lfoEnabled: true, lfoWaveform: 'saw-up', lfoRateHz: 1, lfoPhase: 90 });
  assert.equal(oscillator.phase, 0);
  assert.equal(oscillator.sampleValue, -0.5);
  oscillator.advance(48000);
  const phase = oscillator.phase;
  oscillator.configure({ lfoWaveform: 'triangle', lfoRateHz: 20, lfoPhase: 180 });
  assert.equal(oscillator.phase, phase);
  oscillator.configure({ lfoEnabled: false });
  assert.equal(oscillator.advance(48000), 0);
  oscillator.configure({ lfoEnabled: true });
  assert.equal(oscillator.phase, 0);
  assert.equal(oscillator.sampleValue, 1);
});

test('unipolar is the same waveform remapped to 0..1 and sample-and-hold is seeded', () => {
  const bipolar = new LfoOscillator({ lfoEnabled: true, lfoWaveform: 'triangle', lfoPhase: 180 });
  const unipolar = new LfoOscillator({ lfoEnabled: true, lfoWaveform: 'triangle', lfoPolarity: 'unipolar', lfoPhase: 180 });
  assert.ok(bipolar.sampleValue >= -1 && bipolar.sampleValue <= 1);
  assert.ok(unipolar.sampleValue >= 0 && unipolar.sampleValue <= 1);
  assert.ok(Math.abs(unipolar.sampleValue - (bipolar.sampleValue + 1) / 2) < 1e-12);
  const one = new LfoOscillator({ lfoEnabled: true, lfoWaveform: 'sample-hold', lfoRateHz: 20, lfoSeed: 42 });
  const two = new LfoOscillator({ lfoEnabled: true, lfoWaveform: 'sample-hold', lfoRateHz: 20, lfoSeed: 42 });
  for (let frame = 0; frame < 12000; frame += 1) assert.equal(one.advance(48000), two.advance(48000));
});
