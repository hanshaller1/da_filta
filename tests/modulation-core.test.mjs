import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULATION_TARGETS,
  ModulationCore,
  getModulationTarget,
  normalizeModulationAssignments,
  getModulationAssignmentStatus,
  isModulationTargetActive,
  mapModulationValue
} from '../modulation-core.mjs';

test('registry descriptors expose stable metadata and V1.5 continuous targets', () => {
  assert.equal(MODULATION_TARGETS.length, 47);
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
  assert.equal(core.setAssignment({ sourceId: 'lfo.1', targetId: 'not.registered', amount: 20 }), true);
  assert.equal(getModulationAssignmentStatus(core.getAssignments().at(-1), context).reason, 'target-invalid');
  assert.equal(core.getEffectiveValue('global.resonance', context), 0.5);
});

test('four envelope source IDs contribute independently and sum on one effective target', () => {
  const core = new ModulationCore();
  const context = {
    filterbankEnabled: true, baseResonance: .1, effectiveResonance: .1,
    setEffectiveResonance(value) { this.effectiveResonance = value; }
  };
  for (const [id, value, amount] of [
    ['envelope.1', .2, 25], ['envelope.2', .4, 50], ['envelope.3', .8, 0], ['envelope.4', .6, 0]
  ]) {
    assert.equal(core.setSourceValue(id, value, 'unipolar'), true);
    assert.equal(core.setAssignment({ sourceId: id, targetId: 'global.resonance', amount }), true);
  }
  core.evaluate(context);
  assert.ok(Math.abs(context.effectiveResonance - .35) < 1e-12);
  core.setSourceValue('envelope.1', 0, 'unipolar');
  core.evaluate(context);
  assert.ok(Math.abs(context.effectiveResonance - .3) < 1e-12, 'removing ENV 1 contribution leaves ENV 2 intact');
  assert.equal(context.baseResonance, .1);
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
    { id: 'lfo.1:filterbank.band.4.gainDb', sourceId: 'lfo.1', targetId: 'filterbank.band.4.gainDb', amount: 25, channel: 'left', invert: false, enabled: true },
    { id: 'lfo.2:filterbank.band.4.gainDb', sourceId: 'lfo.2', targetId: 'filterbank.band.4.gainDb', amount: 25, channel: 'right', invert: true, enabled: true }
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

test('one source owns many stable independent routes, including duplicate targets and mute/remove', () => {
  const core = new ModulationCore();
  const context = { filterbankEnabled: true, baseResonance: .2, dryWet: 40,
    filterEnabled: true, filterShapeParams: { type: 'lowpass', frequencyHz: 1000 } };
  core.setSourceValue('lfo.1', 1);
  const routes = normalizeModulationAssignments(Array.from({ length: 32 }, (_, index) => ({
    id: `route.${index}`, targetId: index === 31 ? 'global.dryWet' : 'global.resonance', amount: 1
  })), 'lfo.1');
  core.setAssignments(routes);
  assert.equal(core.getAssignments().length, 32);
  assert.equal(core.compiledTargetMap.get('global.resonance').links.length, 1, 'duplicate rows compile to one source link');
  assert.ok(Math.abs(core.getEffectiveValue('global.resonance', context) - .51) < 1e-12);
  assert.equal(core.getEffectiveValue('global.dryWet', context), 40.5);
  core.setAssignment({ ...routes[0], amount: 10, invert: true });
  assert.ok(Math.abs(core.getEffectiveValue('global.resonance', context) - .4) < 1e-12);
  core.setAssignment({ ...routes[31], enabled: false });
  assert.equal(core.getEffectiveValue('global.dryWet', context), 40);
  assert.equal(core.removeAssignment('route.0'), true);
  assert.equal(core.getAssignments().length, 31);
  assert.ok(Math.abs(core.getEffectiveValue('global.resonance', context) - .5) < 1e-12);
  core.setSourceValue('lfo.1', 1, 'bipolar', false);
  assert.equal(core.getEffectiveValue('global.resonance', context), .2);
  core.removeAssignmentsForSource('lfo.1');
  assert.equal(core.getEffectiveValue('global.resonance', context), .2);
  assert.deepEqual([context.baseResonance, context.dryWet, context.filterShapeParams.frequencyHz], [.2, 40, 1000]);
});

test('every stereo channel and assignment invert has the declared sign and mono capabilities are central', () => {
  const core = new ModulationCore();
  const context = { filterbankEnabled: true, maxBandCutDb: 12, maxBandBoostDb: 12,
    getModulationBandBaseDb: () => 0, baseResonance: 0 };
  assert.deepEqual(getModulationTarget('global.resonance').channels, ['both']);
  assert.deepEqual(getModulationTarget('filterbank.band.4.gainDb').channels, ['both', 'left', 'right', 'spread']);
  core.setSourceValue('arbitrary.source', 1);
  for (const [channel, left, right] of [['both', 3, 3], ['left', 3, 0], ['right', 0, 3], ['spread', 3, -3]]) {
    for (const invert of [false, true]) {
      core.setAssignments([{ id: 'stereo', sourceId: 'arbitrary.source', targetId: 'filterbank.band.4.gainDb', amount: 25, channel, invert }]);
      assert.equal(core.getEffectiveValue('filterbank.band.4.gainDb', context, 'left'), left * (invert ? -1 : 1) || 0);
      assert.equal(core.getEffectiveValue('filterbank.band.4.gainDb', context, 'right'), right * (invert ? -1 : 1) || 0);
    }
  }
  core.setAssignment({ id: 'mono', sourceId: 'arbitrary.source', targetId: 'global.resonance', channel: 'spread', amount: 25 });
  assert.equal(core.getAssignments().at(-1).channel, 'both');
  assert.equal(core.getEffectiveValue('global.resonance', context), .25);
});

test('opposing sources and repeated assignments sum before the final dB and logarithmic clamps', () => {
  const core = new ModulationCore();
  const context = { filterbankEnabled: true, maxBandCutDb: 12, maxBandBoostDb: 12,
    getModulationBandBaseDb: () => 10, filterEnabled: true,
    filterShapeParams: { type: 'lowpass', frequencyHz: 9000 } };
  core.setSourceValue('lfo.1', 1); core.setSourceValue('envelope.1', -1);
  const routes = [];
  for (let index = 0; index < 1200; index += 1) {
    for (const targetId of ['filterbank.band.4.gainDb', 'filter.frequencyHz']) routes.push({
      id: `${index}.${targetId}`, sourceId: index < 600 ? 'lfo.1' : 'envelope.1', targetId, amount: 100
    });
  }
  core.setAssignments(routes);
  assert.equal(core.getEffectiveValue('filterbank.band.4.gainDb', context, 'left'), 10);
  assert.ok(Math.abs(core.getEffectiveValue('filter.frequencyHz', context) - 9000) < 1e-9);
  core.setAssignments(routes.reverse());
  assert.equal(core.getEffectiveValue('filterbank.band.4.gainDb', context, 'right'), 10);
  assert.ok(Math.abs(core.getEffectiveValue('filter.frequencyHz', context) - 9000) < 1e-9);
});

test('lost targets retain configuration, distinguish reasons and automatically reactivate', () => {
  const core = new ModulationCore();
  const context = { filterEnabled: true, filterShapeParams: { type: 'lowpass', frequencyHz: 1000 } };
  const [route] = normalizeModulationAssignments([{ id: 'saved.frequency', targetId: 'filter.frequencyHz', amount: 25, invert: true }], 'lfo.1');
  core.setAssignments([route]); core.setSourceValue('lfo.1', 1);
  const active = core.getEffectiveValue(route.targetId, context);
  assert.ok(active < 1000);
  assert.equal(getModulationAssignmentStatus(route, context).reason, 'active');
  assert.equal(getModulationAssignmentStatus(route, context, false).reason, 'source-disabled');
  assert.equal(getModulationAssignmentStatus({ ...route, enabled: false }, context).reason, 'assignment-disabled');
  context.filterShapeParams.type = 'formant';
  assert.equal(getModulationAssignmentStatus(route, context).reason, 'target-unavailable');
  assert.equal(core.getEffectiveValue(route.targetId, context), 1000);
  assert.deepEqual(core.getAssignments(), [route]);
  context.filterShapeParams.type = 'lowpass';
  assert.equal(core.getEffectiveValue(route.targetId, context), active);
  const [unknown] = normalizeModulationAssignments([{ id: 'saved.missing', targetId: 'removed.target', amount: 40, channel: 'spread', invert: true }], 'envelope.2');
  core.setAssignment(unknown);
  assert.equal(getModulationAssignmentStatus(unknown, context).reason, 'target-invalid');
  assert.deepEqual(core.getAssignments().at(-1), unknown);
  assert.equal(core.getEffectiveValue('removed.target', context), undefined);
  core.registerTarget({ id: 'removed.target', min: -1, max: 1, mapping: 'linear', getBase: () => 0 });
  core.setSourceValue('envelope.2', 1);
  assert.equal(core.getEffectiveValue('removed.target', context), -.4);
});

test('runtime updates reuse compiled target links and mutable source samples', () => {
  const core = new ModulationCore();
  core.setAssignments([{ id: 'one', sourceId: 'lfo.1', targetId: 'global.resonance', amount: 25 }]);
  const compiled = core.compiledTargets;
  const sample = core.sources.get('lfo.1');
  const links = core.compiledTargetMap.get('global.resonance').links;
  const context = { filterbankEnabled: true, baseResonance: 0, setEffectiveResonance(value) { this.effective = value; } };
  core.assignments[Symbol.iterator] = () => { throw new Error('runtime must use compiled links'); };
  for (let index = 0; index < 1000; index += 1) {
    core.setSourceValue('lfo.1', index / 1000);
    core.evaluate(context);
  }
  assert.equal(core.compiledTargets, compiled);
  assert.equal(core.sources.get('lfo.1'), sample);
  assert.equal(core.compiledTargetMap.get('global.resonance').links, links);
  assert.equal(context.effective, .999 * .25);
});
