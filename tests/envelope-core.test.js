const test = require('node:test');
const assert = require('node:assert/strict');
const { EnvelopeFollower, normalizeEnvelopeState, normalizeEnvelopeSources } = require('../envelope-core.mjs');
const { ModulationCore } = require('../modulation-core.mjs');

test('Envelope state defaults and restores count-based source settings', () => {
  const defaults = normalizeEnvelopeState();
  assert.equal(defaults.envelopeCount, 4);
  assert.deepEqual(defaults.envelopeSources[0], {
    id: 'envelope.1', enabled: false, detectorMode: 'peak', attack: 20, release: 250, delay: 0,
    sensitivity: 100, thresholdDb: -48, amount: 50, targetId: '', channel: 'both', invert: false
  });
  const restored = normalizeEnvelopeState({ envelopeSources: [{
    enabled: true, detectorMode: 'rms', attack: 35, release: 800, sensitivity: 240,
    thresholdDb: -32, amount: 62, targetId: 'filterbank.band.3.gainDb', channel: 'spread', invert: true
  }] });
  assert.deepEqual(restored.envelopeSources[0], {
    id: 'envelope.1', enabled: true, detectorMode: 'rms', attack: 35, release: 800,
    sensitivity: 240, thresholdDb: -32, delay: 0, amount: 62, targetId: 'filterbank.band.3.gainDb', channel: 'spread', invert: true
  });
  assert.deepEqual(normalizeEnvelopeSources({ envelopeCount: 3 }).map(source => source.id), ['envelope.1', 'envelope.2', 'envelope.3', 'envelope.4']);
  assert.ok(defaults.envelopeSources.slice(1).every(source => !source.enabled && source.delay === 0));
});

test('legacy one-source state expands to four independent, stable source records', () => {
  const state = normalizeEnvelopeState({ envelopeSources: [{ enabled: true, delay: 120, targetId: 'global.resonance' }] });
  assert.deepEqual(state.envelopeSources.map(source => source.id), ['envelope.1', 'envelope.2', 'envelope.3', 'envelope.4']);
  assert.equal(state.envelopeSources[0].enabled, true);
  assert.equal(state.envelopeSources[0].delay, 120);
  assert.equal(state.envelopeSources[0].targetId, 'global.resonance');
  for (const source of state.envelopeSources.slice(1)) {
    assert.equal(source.enabled, false);
    assert.equal(source.delay, 0);
    assert.equal(source.targetId, '');
  }
  state.envelopeSources[0].attack = 99;
  state.envelopeSources[1].release = 900;
  assert.equal(state.envelopeSources[1].attack, 20);
  assert.equal(state.envelopeSources[0].release, 250);
});

test('threshold state defaults to -48 dB and clamps to -60..0 dB', () => {
  assert.equal(normalizeEnvelopeState().envelopeSources[0].thresholdDb, -48);
  assert.equal(normalizeEnvelopeState({ envelopeSources: [{ thresholdDb: -100 }] }).envelopeSources[0].thresholdDb, -60);
  assert.equal(normalizeEnvelopeState({ envelopeSources: [{ thresholdDb: 20 }] }).envelopeSources[0].thresholdDb, 0);
  assert.equal(normalizeEnvelopeState({ envelopeSources: [{ thresholdDb: 'bad' }] }).envelopeSources[0].thresholdDb, -48);
});

test('threshold follows sensitivity before attack and release in PEAK mode', () => {
  const follower = new EnvelopeFollower({ enabled: true, detectorMode: 'peak', thresholdDb: -30, sensitivity: 100, attack: 100, release: 100 });
  for (let index = 0; index < 2400; index += 1) follower.process(.01, .01, 48000);
  assert.ok(follower.rawLevel > 0 && follower.rawLevel < follower.thresholdLevel);
  assert.ok(follower.value < 1e-6);
  for (let index = 0; index < 2400; index += 1) follower.process(.5, .5, 48000);
  assert.ok(follower.rawLevel > follower.thresholdLevel);
  assert.ok(follower.value > 0 && follower.value < follower.rawLevel, 'attack smooths the gated detector');
  const beforeRelease = follower.value;
  follower.process(0, 0, 48000);
  assert.ok(follower.value < beforeRelease && follower.value > 0, 'release decays after the detector falls below threshold');
});

test('RMS threshold uses the RMS detector and sensitivity-adjusted level', () => {
  const follower = new EnvelopeFollower({ enabled: true, detectorMode: 'rms', thresholdDb: -36, sensitivity: 50, attack: 1 });
  for (let index = 0; index < 12000; index += 1) {
    const sample = .2 * Math.sin(index * Math.PI * 2 * 1000 / 48000);
    follower.process(sample, sample, 48000);
  }
  assert.ok(follower.rawLevel > 0.003 && follower.rawLevel < .1);
  assert.ok(follower.rawLevel > follower.thresholdLevel);
  assert.ok(follower.value > 0);
  follower.configure({ enabled: true, detectorMode: 'rms', thresholdDb: -20, sensitivity: 50, attack: 1 });
  for (let index = 0; index < 96000; index += 1) {
    const sample = .2 * Math.sin(index * Math.PI * 2 * 1000 / 48000);
    follower.process(sample, sample, 48000);
  }
  assert.ok(follower.value < 0.001, 'release approaches zero when the sensitivity-adjusted RMS falls below threshold');
});

test('delay defaults to zero, clamps to 0..2000 ms, and zero delay preserves immediate attack behavior', () => {
  assert.equal(normalizeEnvelopeState().envelopeSources[0].delay, 0);
  assert.equal(normalizeEnvelopeState({ envelopeSources: [{ delay: -10 }] }).envelopeSources[0].delay, 0);
  assert.equal(normalizeEnvelopeState({ envelopeSources: [{ delay: 2500 }] }).envelopeSources[0].delay, 2000);
  const withDelayZero = new EnvelopeFollower({ enabled: true, thresholdDb: -20, attack: 5, delay: 0 });
  const baseline = new EnvelopeFollower({ enabled: true, thresholdDb: -20, attack: 5 });
  for (let index = 0; index < 80; index += 1) {
    const signal = index < 40 ? .5 : 0;
    assert.equal(withDelayZero.process(signal, signal, 1000), baseline.process(signal, signal, 1000));
  }
});

test('delay starts once on threshold crossing and attack begins only after sustained threshold', () => {
  const follower = new EnvelopeFollower({ enabled: true, detectorMode: 'peak', thresholdDb: -20, delay: 10, attack: 1 });
  follower.process(.5, .5, 1000);
  assert.equal(follower.delayWaiting, true);
  assert.equal(follower.delayRemainingSamples, 10);
  for (let index = 0; index < 9; index += 1) {
    assert.equal(follower.process(.5, .5, 1000), 0);
    assert.equal(follower.delayWaiting, true);
  }
  assert.ok(follower.process(.5, .5, 1000) > 0);
  assert.equal(follower.delayActive, true);
  assert.equal(follower.delayRemainingSamples, 0);
});

test('falling below threshold cancels a pending delay without a ghost trigger', () => {
  const follower = new EnvelopeFollower({ enabled: true, thresholdDb: -20, delay: 10, attack: 1 });
  follower.process(.5, .5, 1000);
  for (let index = 0; index < 4; index += 1) follower.process(.5, .5, 1000);
  follower.process(0, 0, 1000);
  assert.equal(follower.delayWaiting, false);
  for (let index = 0; index < 20; index += 1) assert.equal(follower.process(0, 0, 1000), 0);
  follower.process(.5, .5, 1000);
  for (let index = 0; index < 9; index += 1) assert.equal(follower.process(.5, .5, 1000), 0);
  assert.ok(follower.process(.5, .5, 1000) > 0, 'a later crossing receives a fresh full delay');
});

test('retrigger delay lets release continue, then attack rises from the current envelope', () => {
  const follower = new EnvelopeFollower({ enabled: true, thresholdDb: -20, delay: 5, attack: 1, release: 100 });
  follower.process(.8, .8, 1000);
  for (let index = 0; index < 12; index += 1) follower.process(.8, .8, 1000);
  assert.ok(follower.value > .7);
  follower.process(0, 0, 1000);
  const releaseStart = follower.value;
  follower.process(.8, .8, 1000);
  const valueAtRetrigger = follower.value;
  assert.ok(valueAtRetrigger < releaseStart);
  for (let index = 0; index < 4; index += 1) {
    const before = follower.value;
    follower.process(.8, .8, 1000);
    assert.ok(follower.value < before, 'release continues while the new trigger waits');
  }
  const beforeAttack = follower.value;
  assert.ok(follower.process(.8, .8, 1000) > beforeAttack);
});

test('PEAK is unipolar, follows attack and release, and applies sensitivity gain', () => {
  const follower = new EnvelopeFollower({ enabled: true, detectorMode: 'peak', attack: 1, release: 10, sensitivity: 200 });
  let value = 0;
  for (let index = 0; index < 240; index += 1) value = follower.process(-0.25, 0.1, 48000);
  assert.ok(value > 0.49 && value <= 0.5);
  assert.ok(value >= 0);
  const beforeRelease = value;
  value = follower.process(0, 0, 48000);
  assert.ok(value < beforeRelease && value > 0);
  const clipped = new EnvelopeFollower({ enabled: true, sensitivity: 400, attack: 1 });
  for (let index = 0; index < 240; index += 1) clipped.process(1, 0, 48000);
  assert.ok(clipped.value > 0.99 && clipped.value <= 1);
});

test('RMS uses a short energy window and stays below the PEAK result for a full-scale sine-like signal', () => {
  const peak = new EnvelopeFollower({ enabled: true, detectorMode: 'peak', attack: 1 });
  const rms = new EnvelopeFollower({ enabled: true, detectorMode: 'rms', attack: 1 });
  for (let index = 0; index < 1200; index += 1) {
    const sample = Math.sin(index * Math.PI * 2 * 1000 / 48000);
    peak.process(sample, sample, 48000);
    rms.process(sample, sample, 48000);
  }
  assert.ok(peak.value > 0.97);
  assert.ok(rms.value > 0.69 && rms.value < 0.72);
  for (let index = 0; index < 96000; index += 1) rms.process(0, 0, 48000);
  assert.ok(rms.value < 0.001);
  assert.ok(Number.isFinite(rms.value));
});

test('disabling the envelope clears its value and processing silence remains finite', () => {
  const follower = new EnvelopeFollower({ enabled: true, attack: 1 });
  for (let index = 0; index < 200; index += 1) follower.process(0.8, 0.8, 48000);
  assert.ok(follower.value > 0.7);
  follower.configure({ enabled: false, attack: 1 });
  assert.equal(follower.value, 0);
  for (let index = 0; index < 1000; index += 1) assert.equal(follower.process(1, 1, 48000), 0);
  assert.ok(Number.isFinite(follower.value));
});

test('LFO and envelope assignments sum while preserving base values and target clamps', () => {
  const core = new ModulationCore();
  const context = { baseResonance: 0, filterbankEnabled: true, setEffectiveResonance(value) { this.effectiveResonance = value; } };
  core.setSourceValue('lfo.1', 0.25, 'bipolar');
  core.setSourceValue('envelope.1', 0.8, 'unipolar');
  core.setAssignment({ sourceId: 'lfo.1', targetId: 'global.resonance', amount: 50 });
  core.setAssignment({ sourceId: 'envelope.1', targetId: 'global.resonance', amount: 50 });
  core.evaluate(context);
  assert.equal(context.baseResonance, 0);
  assert.ok(Math.abs(context.effectiveResonance - 0.525) < 1e-12);
  context.baseResonance = 0.95;
  core.setSourceValue('lfo.1', 1, 'bipolar');
  core.setSourceValue('envelope.1', 1, 'unipolar');
  core.setAssignment({ sourceId: 'lfo.1', targetId: 'global.resonance', amount: 100 });
  core.setAssignment({ sourceId: 'envelope.1', targetId: 'global.resonance', amount: 100 });
  core.evaluate(context);
  assert.equal(context.effectiveResonance, 1);
  assert.equal(context.baseResonance, 0.95);
  core.removeSource('envelope.1');
  core.removeSource('lfo.1');
  core.evaluate(context);
  assert.equal(context.effectiveResonance, 0.95);
});

test('stereo channel assignments support BOTH, LEFT, RIGHT, and opposite SPREAD', () => {
  const core = new ModulationCore();
  const context = { filterbankEnabled: true, maxBandBoostDb: 24, maxBandCutDb: 60, getModulationBandBaseDb: () => 0 };
  core.setSourceValue('envelope.1', 0.5, 'unipolar');
  for (const channel of ['both', 'left', 'right', 'spread']) {
    core.setAssignment({ sourceId: 'envelope.1', targetId: 'filterbank.band.0.gainDb', amount: 100, channel });
    const left = core.getEffectiveValue('filterbank.band.0.gainDb', context, 'left');
    const right = core.getEffectiveValue('filterbank.band.0.gainDb', context, 'right');
    if (channel === 'both') assert.equal(left, right);
    if (channel === 'left') assert.ok(left > 0 && right === 0);
    if (channel === 'right') assert.ok(left === 0 && right > 0);
    if (channel === 'spread') assert.ok(left > 0 && right < 0 && left === -right);
  }
  core.setAssignment({ sourceId: 'envelope.1', targetId: 'global.resonance', amount: 100, channel: 'spread' });
  assert.equal(core.getAssignments().find(item => item.targetId === 'global.resonance').channel, 'both');
});

test('invert reverses the unipolar envelope contribution once at the assignment', () => {
  const core = new ModulationCore();
  const context = { baseResonance: 0, filterbankEnabled: true };
  core.setSourceValue('envelope.1', 0.75, 'unipolar');
  core.setAssignment({ sourceId: 'envelope.1', targetId: 'global.resonance', amount: 100, invert: true });
  assert.equal(core.getEffectiveValue('global.resonance', context), -0.75);
});
