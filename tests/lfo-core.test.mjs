import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LfoOscillator,
  LFO_WAVEFORMS,
  createLfoSources,
  normalizeLfoState,
  normalizeModulationState,
  paginateLfoSources,
  rateToSlider,
  sliderToRate,
  waveformSample
} from '../lfo-core.mjs';
import { ClockCore, SYNC_DIVISION_BEATS } from '../clock-core.mjs';
import { ModulationCore, getModulationTarget, mapModulationValue } from '../modulation-core.mjs';

test('legacy flat state migrates to lfo.1 and the product keeps exactly four sources', () => {
  const legacy = normalizeModulationState({ lfoEnabled: true, lfoWaveform: 'triangle', lfoRateHz: 2.5,
    lfoPolarity: 'unipolar', lfoPhase: 90, lfoTargetId: 'filter.frequencyHz', lfoAmount: 55, lfoSeed: 123 });
  assert.equal(legacy.lfoModuleEnabled, true);
  assert.deepEqual(legacy.lfoSources[0], {
    id: 'lfo.1', enabled: true, waveform: 'triangle', rateMode: 'free', rateHz: 2.5, syncDivision: '1/4',
    polarity: 'unipolar', phaseOffsetDeg: 90, amount: 55, targetId: 'filter.frequencyHz', channel: 'both', invert: false, seed: 123,
    assignments: [{ id: 'lfo.1.assignment.1', sourceId: 'lfo.1', targetId: 'filter.frequencyHz', amount: 55, channel: 'both', invert: false, enabled: true }]
  });
  assert.deepEqual(legacy.lfoSources.slice(1).map(source => [source.id, source.enabled]), [['lfo.2', false], ['lfo.3', false], ['lfo.4', false]]);
  assert.deepEqual(createLfoSources(20).map(source => source.id), ['lfo.1', 'lfo.2', 'lfo.3', 'lfo.4']);
  const sources = normalizeModulationState({ lfoSources: createLfoSources(20) }).lfoSources;
  assert.equal(sources.length, 4);
  assert.deepEqual(paginateLfoSources(sources, 4).map(page => page.length), [4]);
});

test('legacy normalizer and source settings clamp malformed values safely', () => {
  assert.deepEqual(normalizeLfoState({}), {
    lfoEnabled: false, lfoWaveform: 'sine', lfoRateHz: 1, lfoPolarity: 'bipolar',
    lfoPhase: 0, lfoTargetId: '', lfoAmount: 25, lfoSeed: 0x6d2b79f5
  });
  const malformed = normalizeLfoState({ lfoEnabled: 1, lfoWaveform: 'not-a-wave', lfoRateHz: NaN,
    lfoPolarity: 'mono', lfoPhase: Infinity, lfoTargetId: {}, lfoAmount: -4 });
  assert.deepEqual(malformed, { ...normalizeLfoState({}), lfoAmount: 0 });
});

test('legacy single routes migrate without double invert and round-trip as independent assignments', () => {
  for (const waveform of LFO_WAVEFORMS) for (const polarity of ['bipolar', 'unipolar']) for (const invert of [false, true]) {
    const legacy = { enabled: true, waveform, polarity, invert, targetId: 'global.resonance', amount: 55,
      phaseOffsetDeg: 90, seed: 234, rateHz: 2 };
    const migrated = normalizeModulationState({ lfoModuleEnabled: true, lfoSources: [legacy] });
    const source = migrated.lfoSources[0];
    assert.equal(source.invert, invert);
    assert.equal(source.assignments[0].invert, false);
    const before = new LfoOscillator(legacy);
    const after = new LfoOscillator(source);
    const core = new ModulationCore();
    core.setAssignments(source.assignments);
    for (let frame = 0; frame < 12000; frame += 1) {
      const a = before.advance(48000); const b = after.advance(48000);
      assert.equal(a, b);
      if (frame % 128 !== 0) continue;
      core.setSourceValue(source.id, b, polarity);
      assert.ok(Math.abs(core.getEffectiveValue('global.resonance', { filterbankEnabled: true, baseResonance: .1 })
        - mapModulationValue(getModulationTarget('global.resonance'), .1, a, 55)) < 1e-12);
    }
    assert.deepEqual(normalizeModulationState(JSON.parse(JSON.stringify(migrated))), migrated);
  }
});

test('assignment arrays are authoritative, preserve unknown IDs and do not resurrect removed legacy targets', () => {
  const state = normalizeModulationState({ lfoModuleEnabled: true, lfoSources: [{
    enabled: true, targetId: 'global.resonance', amount: 95, channel: 'right', invert: true,
    assignments: [{ id: 'stable', targetId: 'removed.target', amount: 12, channel: 'spread', invert: true },
      { id: 'second', targetId: 'global.dryWet', amount: 22, channel: 'left', enabled: false }]
  }] });
  const source = state.lfoSources[0];
  assert.deepEqual(source.assignments.map(item => [item.id, item.targetId, item.channel, item.invert]),
    [['stable', 'removed.target', 'spread', true], ['second', 'global.dryWet', 'both', false]]);
  assert.equal(source.invert, true);
  source.assignments = [];
  const emptied = normalizeModulationState(state);
  assert.deepEqual(emptied.lfoSources[0].assignments, []);
  assert.equal(emptied.lfoTargetId, '');
  assert.equal(emptied.lfoAmount, 0);
  assert.equal(emptied.lfoSources.length, 4);
});

test('eight waveform generators remain finite and expose distinct expected points', () => {
  assert.deepEqual([...LFO_WAVEFORMS], ['sine', 'triangle', 'saw-up', 'saw-down', 'square', 'pulse', 'sample-hold', 'noise']);
  assert.ok(Math.abs(waveformSample('sine', .25) - 1) < 1e-12);
  assert.equal(waveformSample('triangle', .5), 1);
  assert.equal(waveformSample('saw-up', 0), -1);
  assert.equal(waveformSample('saw-down', 0), 1);
  assert.equal(waveformSample('square', .25), 1);
  assert.equal(waveformSample('square', .5), -1);
  assert.equal(waveformSample('pulse', .24), 1);
  assert.equal(waveformSample('pulse', .25), -1);
  assert.equal(waveformSample('sample-hold', .7, .37), .37);
  assert.equal(waveformSample('noise', .5, -1, 1), 0);
  for (const waveform of LFO_WAVEFORMS) {
    for (let index = 0; index <= 1000; index += 1) {
      const value = waveformSample(waveform, index / 1000, .73, -.42);
      assert.ok(Number.isFinite(value) && value >= -1 && value <= 1);
    }
  }
});

test('free-rate slider remains logarithmic over 0.01 through 20 Hz', () => {
  assert.equal(sliderToRate(0), .01);
  assert.equal(sliderToRate(1000), 20);
  for (const rate of [.01, .1, 1, 20]) assert.ok(Math.abs(sliderToRate(rateToSlider(rate)) / rate - 1) < .005);
});

test('audio-sample free phase, phase offset, reset, and parameter edits remain stable', () => {
  for (const rate of [.01, 1, 20]) {
    const oscillator = new LfoOscillator({ lfoEnabled: true, lfoRateHz: rate, lfoPhase: 0 });
    for (let frame = 0; frame < 48000; frame += 1) oscillator.advance(48000);
    assert.ok(Math.abs(oscillator.phase - (rate % 1)) < 1e-8);
  }
  const oscillator = new LfoOscillator({ lfoEnabled: true, lfoWaveform: 'saw-up', lfoRateHz: 1, lfoPhase: 90 });
  assert.equal(oscillator.phase, 0);
  assert.equal(oscillator.sampleValue, -.5);
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

test('polarity and invert affect only the sample; per-source random streams stay deterministic and independent', () => {
  const bipolar = new LfoOscillator({ lfoEnabled: true, lfoWaveform: 'triangle', lfoPhase: 180 });
  const unipolar = new LfoOscillator({ lfoEnabled: true, lfoWaveform: 'triangle', lfoPolarity: 'unipolar', lfoPhase: 180 });
  const inverted = new LfoOscillator({ lfoEnabled: true, lfoWaveform: 'triangle', lfoPolarity: 'bipolar', lfoPhase: 180, invert: true });
  assert.ok(unipolar.sampleValue >= 0 && unipolar.sampleValue <= 1);
  assert.ok(Math.abs(unipolar.sampleValue - (bipolar.sampleValue + 1) / 2) < 1e-12);
  assert.equal(inverted.sampleValue, -bipolar.sampleValue);
  const one = new LfoOscillator({ enabled: true, waveform: 'sample-hold', rateHz: 20, seed: 42 });
  const sameSeed = new LfoOscillator({ enabled: true, waveform: 'sample-hold', rateHz: 20, seed: 42 });
  const otherSeed = new LfoOscillator({ enabled: true, waveform: 'sample-hold', rateHz: 20, seed: 43 });
  assert.notEqual(one.sampleValue, otherSeed.sampleValue);
  for (let frame = 0; frame < 12000; frame += 1) assert.equal(one.advance(48000), sameSeed.advance(48000));
});

test('noise moves continuously and deterministically at the configured oscillator rate', () => {
  const one = new LfoOscillator({ enabled: true, waveform: 'noise', rateHz: 2, seed: 77 });
  const two = new LfoOscillator({ enabled: true, waveform: 'noise', rateHz: 2, seed: 77 });
  const samples = [];
  for (let frame = 0; frame < 24000; frame += 1) {
    const a = one.advance(48000); const b = two.advance(48000);
    assert.equal(a, b);
    if (frame % 6000 === 0) samples.push(a);
  }
  assert.equal(new Set(samples).size, samples.length);
  assert.ok(samples.every(value => value >= -1 && value <= 1));
});

test('inverted sample-hold and noise are exact sign reversals after polarity mapping', () => {
  for (const waveform of ['sample-hold', 'noise']) {
    for (const polarity of ['bipolar', 'unipolar']) {
      const base = new LfoOscillator({ enabled: true, waveform, polarity, rateHz: 1, seed: 12345 });
      const inverted = new LfoOscillator({ enabled: true, waveform, polarity, rateHz: 1, seed: 12345, invert: true });
      for (let frame = 0; frame <= 48000; frame += 1) {
        const baseValue = base.advance(48000);
        const invertedValue = inverted.advance(48000);
        assert.ok(Number.isFinite(baseValue) && Number.isFinite(invertedValue));
        assert.ok(Math.abs(invertedValue + baseValue) < 1e-12, `${waveform} ${polarity} invert must negate the final DSP sample`);
      }
    }
  }
});

test('internal clock produces audio-sample-accurate sync periods for note divisions', () => {
  const checks = [['1/4', 24000], ['1/2', 48000], ['1/1', 96000]];
  for (const [division, frames] of checks) {
    const clock = new ClockCore({ source: 'internal', bpm: 120, running: true });
    const oscillator = new LfoOscillator({ enabled: true, rateMode: 'sync', syncDivision: division });
    for (let frame = 0; frame < frames; frame += 1) oscillator.advance(48000, clock.advance(48000), true);
    assert.ok(Math.abs(oscillator.phase) < 1e-8, `${division} should complete at ${frames} samples`);
  }
  assert.deepEqual(Object.keys(SYNC_DIVISION_BEATS), ['1/32', '1/16', '1/8', '1/4', '1/2', '1/1', '2/1', '4/1']);
});

test('MIDI clock uses 24 PPQN, follows transport, and stop freezes sync phase only', () => {
  const clock = new ClockCore({ source: 'midi', midiBpm: 120, running: false });
  clock.start(true);
  for (let pulse = 0; pulse < 24; pulse += 1) {
    for (let sample = 0; sample < 1000; sample += 1) clock.advance(48000);
    clock.midiPulse();
  }
  assert.ok(Math.abs(clock.beatPosition - 1) < 1e-8);
  const phase = clock.beatPosition;
  clock.stop();
  for (let sample = 0; sample < 48000; sample += 1) clock.advance(48000);
  assert.equal(clock.beatPosition, phase);
  const sync = new LfoOscillator({ enabled: true, rateMode: 'sync', syncDivision: '1/4' });
  const free = new LfoOscillator({ enabled: true, rateMode: 'free', rateHz: 1 });
  for (let sample = 0; sample < 24000; sample += 1) {
    const beat = clock.advance(48000);
    sync.advance(48000, beat, clock.state.running);
    free.advance(48000, beat, clock.state.running);
  }
  assert.equal(sync.phase, 0);
  assert.ok(free.phase > 0.49 && free.phase < 0.51);
});

test('shared MIDI pulses stay stopped until START or CONTINUE when LFO uses internal clock', () => {
  const clock = new ClockCore({ source: 'internal', bpm: 120, running: true });
  assert.equal(clock.midiPulse(), false);
  assert.equal(clock.midiPulseCount, 0);

  clock.startMidi(true);
  assert.equal(clock.midiPulse(), true);
  assert.equal(clock.midiBeatPosition, 1 / 24);
  clock.stopMidi();
  const stoppedPosition = clock.midiBeatPosition;
  assert.equal(clock.midiPulse(), false);
  assert.equal(clock.midiBeatPosition, stoppedPosition);
  assert.equal(clock.midiPulseCount, 1);

  clock.continueMidi();
  assert.equal(clock.midiPulse(), true);
  assert.equal(clock.midiBeatPosition, 2 / 24);
});

test('MIDI clock anchors absolute PPQN pulses across beat rollover', () => {
  const clock = new ClockCore({ source: 'midi', midiBpm: 120, running: false });
  clock.start(true);
  for (let pulse = 1; pulse <= 23; pulse += 1) clock.midiPulse();
  assert.equal(clock.beatPosition, 23 / 24);

  // Simulate sample interpolation just before the next pulse. Pulse 24 must
  // anchor at beat 1 instead of wrapping to beat 0.
  clock.beatPosition = 0.99;
  clock.midiPulse();
  assert.equal(clock.beatPosition, 1);
  clock.midiPulse();
  assert.equal(clock.beatPosition, 25 / 24);
  for (let pulse = 26; pulse <= 48; pulse += 1) clock.midiPulse();
  assert.equal(clock.beatPosition, 2);
});

test('MIDI clock stays finite and correctly anchored through jitter and a tempo change', () => {
  const clock = new ClockCore({ source: 'midi', midiBpm: 120, running: false });
  clock.start(true);
  const jitteredSamples = [994, 1013, 984, 1008, 997, 1004, 1011, 989];
  for (let pulse = 1; pulse <= 48; pulse += 1) {
    for (let sample = 0; sample < jitteredSamples[(pulse - 1) % jitteredSamples.length]; sample += 1) clock.advance(48000);
    const beforePulse = clock.beatPosition;
    clock.midiPulse();
    assert.equal(clock.beatPosition, pulse / 24);
    assert.ok(Math.abs(beforePulse - pulse / 24) < 0.001, `pulse ${pulse} re-anchored by more than expected jitter`);
    assert.ok(Number.isFinite(clock.beatPosition));
  }
  assert.equal(clock.beatPosition, 2);

  clock.setMidiTempo(126);
  const changedTempoSamples = [950, 955, 952, 953, 951, 954];
  for (let pulse = 49; pulse <= 72; pulse += 1) {
    for (let sample = 0; sample < changedTempoSamples[(pulse - 49) % changedTempoSamples.length]; sample += 1) clock.advance(48000);
    const beforePulse = clock.beatPosition;
    clock.midiPulse();
    assert.equal(clock.beatPosition, pulse / 24);
    assert.ok(clock.beatPosition > beforePulse - 0.001);
    assert.ok(Number.isFinite(clock.beatPosition) && clock.beatPosition >= 0);
  }
  assert.equal(clock.beatPosition, 3);

  const anchored = clock.beatPosition;
  const pulseCount = clock.midiPulseCount;
  clock.stop();
  for (let sample = 0; sample < 24000; sample += 1) clock.advance(48000);
  assert.equal(clock.beatPosition, anchored);
  clock.continue();
  clock.advance(48000);
  clock.midiPulse();
  assert.equal(clock.midiPulseCount, pulseCount + 1);
  assert.equal(clock.beatPosition, (pulseCount + 1) / 24);

  clock.start(true);
  assert.equal(clock.midiPulseCount, 0);
  assert.equal(clock.beatPosition, 0);
});
