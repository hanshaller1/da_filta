import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULATION_TARGETS,
  ModulationCore,
  getModulationTarget,
  isModulationTargetActive,
  mapModulationValue
} from '../modulation-core.mjs';

test('registry descriptors expose stable metadata and V1.5 continuous targets', () => {
  assert.equal(MODULATION_TARGETS.length, 27);
  for (const target of MODULATION_TARGETS) {
    assert.ok(target.id && target.label && target.group && target.mapping);
    assert.deepEqual(target.clamp, { min: target.min, max: target.max });
  }
  assert.ok(getModulationTarget('filterbank.band.9.gainDb'));
  for (const id of ['global.dryWet', 'global.spread', 'filterbank.feedbackAllAmount', 'filter.slope',
    'filter.bandwidth', 'dynamicEq.attackMs', 'dynamicEq.releaseMs']) assert.ok(getModulationTarget(id));
  assert.equal(getModulationTarget('filterbank.band.0.feedback'), null);
  assert.equal(getModulationTarget('button.power'), null);
});

test('bipolar, unipolar, logarithmic mapping and clamping stay finite', () => {
  const dbTarget = getModulationTarget('dynamicEq.thresholdDb');
  assert.equal(mapModulationValue(dbTarget, -24, 0, 0), -24);
  assert.equal(mapModulationValue(dbTarget, -24, -1, 50), -39);
  assert.equal(mapModulationValue(dbTarget, -24, { value: 1, range: 'unipolar' }, 100), 0);
  assert.equal(mapModulationValue(dbTarget, -24, 1, 100), 0);
  const frequency = getModulationTarget('filter.frequencyHz');
  const geometricCenter = Math.sqrt(29 * 11000);
  const downFrequency = mapModulationValue(frequency, geometricCenter, -1, 100);
  const upFrequency = mapModulationValue(frequency, geometricCenter, 1, 100);
  assert.ok(Math.abs(downFrequency - 29) < 1e-9);
  assert.ok(Math.abs(upFrequency - 11000) < 1e-8);
  assert.ok(Number.isFinite(mapModulationValue(frequency, NaN, Infinity, Infinity)));
});

test('assignments preserve base values, add sources and clamp only effective values', () => {
  const core = new ModulationCore();
  const base = { resonance: 0.25 };
  const context = {
    filterbankEnabled: true,
    baseResonance: base.resonance,
    effectiveResonance: base.resonance,
    setEffectiveResonance(value) { this.effectiveResonance = value; }
  };
  assert.equal(core.setAssignment({ sourceId: 'lfo.1', targetId: 'global.resonance', amount: 100 }), true);
  assert.equal(core.setSourceValue('lfo.1', 0.5), true);
  core.evaluate(context);
  assert.equal(context.effectiveResonance, 0.75);
  assert.deepEqual(base, { resonance: 0.25 });
  core.setSourceValue('macro.1', -1);
  core.setAssignment({ sourceId: 'macro.1', targetId: 'global.resonance', amount: 25 });
  assert.equal(core.getEffectiveValue('global.resonance', context), 0.5);
  assert.equal(core.setAssignment({ sourceId: 'lfo.1', targetId: 'not.registered', amount: 20 }), false);
});

test('filterbank target range follows the active cut and boost limits', () => {
  const core = new ModulationCore();
  const channelOffsets = { left: new Float64Array(10), right: new Float64Array(10) };
  const context = {
    filterbankEnabled: true,
    maxBandCutDb: 36,
    maxBandBoostDb: 18,
    getModulationBandBaseDb: () => 0,
    setModulationBandOffset: (index, channel, value) => { channelOffsets[channel][index] = value; },
    modulationDirectBandOffsetsDb: new Float64Array(10)
  };
  core.setAssignment({ sourceId: 'lfo.1', targetId: 'filterbank.band.5.gainDb', amount: 100 });
  core.setSourceValue('lfo.1', .5);
  assert.equal(core.getEffectiveValue('filterbank.band.5.gainDb', context), 13.5);
  core.evaluate(context);
  assert.equal(channelOffsets.left[5], 13.5);
  assert.equal(channelOffsets.right[5], 13.5);
  assert.equal(core.getEffectiveValue('filterbank.band.5.gainDb', { ...context, maxBandCutDb: 60, maxBandBoostDb: 24 }), 21);
});

test('multiple independent sources sum deterministically on one target and preserve base state', () => {
  const core = new ModulationCore();
  const context = { filterbankEnabled: true, baseResonance: .2, effectiveResonance: .2,
    setEffectiveResonance(value) { this.effectiveResonance = value; } };
  core.setAssignment({ sourceId: 'lfo.1', targetId: 'global.resonance', amount: 25 });
  core.setAssignment({ sourceId: 'lfo.2', targetId: 'global.resonance', amount: 25 });
  core.setSourceValue('lfo.1', 1); core.setSourceValue('lfo.2', -.5);
  core.evaluate(context);
  assert.equal(context.effectiveResonance, .325);
  core.evaluate(context);
  assert.equal(context.effectiveResonance, .325);
  assert.equal(context.baseResonance, .2);
});

test('stereo band assignments route independently and invert only the selected contribution', () => {
  const core = new ModulationCore();
  const offsets = { left: new Float64Array(10), right: new Float64Array(10) };
  const context = {
    filterbankEnabled: true, maxBandCutDb: 12, maxBandBoostDb: 12,
    getModulationBandBaseDb: (_index, channel) => channel === 'left' ? 6 : -2,
    setModulationBandOffset: (index, channel, value) => { offsets[channel][index] = value; }
  };
  core.setAssignment({ sourceId: 'lfo.1', targetId: 'filterbank.band.4.gainDb', amount: 25, channel: 'left' });
  core.setAssignment({ sourceId: 'lfo.2', targetId: 'filterbank.band.4.gainDb', amount: 25, channel: 'right', invert: true });
  core.setSourceValue('lfo.1', 1); core.setSourceValue('lfo.2', 1);
  core.evaluate(context);
  assert.equal(offsets.left[4], 3);
  assert.equal(offsets.right[4], -3);
  assert.deepEqual(core.getAssignments(), [
    { sourceId: 'lfo.1', targetId: 'filterbank.band.4.gainDb', amount: 25, channel: 'left' },
    { sourceId: 'lfo.2', targetId: 'filterbank.band.4.gainDb', amount: 25, channel: 'right', invert: true }
  ]);
});

test('dry/wet and spread use effective setters without changing base values', () => {
  const core = new ModulationCore();
  const context = {
    filterbankEnabled: true,
    dryWet: 50, baseSpread: 0, spreadMaxOffsetDb: 6, spreadMode: 'CLASSIC', perChannelBands: false,
    dryWetEffective: 50, spreadEffective: 0,
    setEffectiveDryWet(value) { this.dryWetEffective = value; },
    setEffectiveSpread(value) { this.spreadEffective = value; }
  };
  core.setAssignment({ sourceId: 'lfo.1', targetId: 'global.dryWet', amount: 100 });
  core.setAssignment({ sourceId: 'lfo.2', targetId: 'global.spread', amount: 100 });
  core.setSourceValue('lfo.1', .6); core.setSourceValue('lfo.2', 1);
  core.evaluate(context);
  assert.equal(context.dryWetEffective, 80);
  assert.equal(context.spreadEffective, 6);
  assert.deepEqual([context.dryWet, context.baseSpread], [50, 0]);
});

test('continuous FB All amount and existing Dynamic EQ attack/release stay effective-only targets', () => {
  const core = new ModulationCore();
  const context = {
    filterbankEnabled: true, baseFeedbackAllAmount: 50, feedbackAllEffective: 50,
    dynamicEqEnabled: true, dynamicEqAttackMs: 30, dynamicEqReleaseMs: 250,
    dynamicEqEffectiveSettings: { dynamicEqAttackMs: 30, dynamicEqReleaseMs: 250 },
    setEffectiveFeedbackAllAmount(value) { this.feedbackAllEffective = value; },
    setEffectiveDynamicEqTimes(attack, release) { this.effectiveTimes = [attack, release]; }
  };
  core.setAssignment({ sourceId: 'lfo.1', targetId: 'filterbank.feedbackAllAmount', amount: 100 });
  core.setAssignment({ sourceId: 'lfo.2', targetId: 'dynamicEq.attackMs', amount: 100 });
  core.setAssignment({ sourceId: 'lfo.3', targetId: 'dynamicEq.releaseMs', amount: 100 });
  core.setSourceValue('lfo.1', .5); core.setSourceValue('lfo.2', -1); core.setSourceValue('lfo.3', 1);
  core.evaluate(context);
  assert.equal(context.feedbackAllEffective, 75);
  assert.equal(context.dynamicEqEffectiveSettings.dynamicEqAttackMs, 1);
  assert.equal(context.dynamicEqEffectiveSettings.dynamicEqReleaseMs, 1245);
  assert.deepEqual(context.effectiveTimes, [1, 1245]);
  assert.deepEqual([context.baseFeedbackAllAmount, context.dynamicEqAttackMs, context.dynamicEqReleaseMs], [50, 30, 250]);
});

test('inactive targets keep their assignment and return the unmodified base', () => {
  const core = new ModulationCore();
  const context = {
    filterEnabled: true,
    filterShapeParams: { type: 'formant', formantVowel: 2 },
    effectiveFilterShapeParams: { type: 'formant', formantVowel: 2 }
  };
  assert.equal(isModulationTargetActive('filter.formantVowel', context), true);
  core.setAssignment({ sourceId: 'lfo.1', targetId: 'filter.formantVowel', amount: 100 });
  core.setSourceValue('lfo.1', 1);
  assert.equal(core.getEffectiveValue('filter.formantVowel', context), 4);
  context.filterShapeParams.type = 'lowpass';
  assert.equal(isModulationTargetActive('filter.formantVowel', context), false);
  assert.equal(core.getEffectiveValue('filter.formantVowel', context), 2);
  assert.equal(core.getAssignments()[0].targetId, 'filter.formantVowel');
  context.filterShapeParams.type = 'formant';
  assert.equal(core.getEffectiveValue('filter.formantVowel', context), 4);
});
