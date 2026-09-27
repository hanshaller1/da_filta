import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULATION_TARGETS,
  ModulationCore,
  getModulationTarget,
  isModulationTargetActive,
  mapModulationValue
} from '../modulation-core.mjs';

test('registry descriptors expose stable metadata and all V1 targets', () => {
  assert.equal(MODULATION_TARGETS.length, 20);
  for (const target of MODULATION_TARGETS) {
    assert.ok(target.id && target.label && target.group && target.mapping);
    assert.deepEqual(target.clamp, { min: target.min, max: target.max });
  }
  assert.ok(getModulationTarget('filterbank.band.9.gainDb'));
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
  const context = {
    filterbankEnabled: true,
    maxBandCutDb: 36,
    maxBandBoostDb: 18,
    getModulationBandBaseDb: () => 0,
    modulationDirectBandOffsetsDb: new Float64Array(10)
  };
  core.setAssignment({ sourceId: 'lfo.1', targetId: 'filterbank.band.5.gainDb', amount: 100 });
  core.setSourceValue('lfo.1', .5);
  assert.equal(core.getEffectiveValue('filterbank.band.5.gainDb', context), 13.5);
  core.evaluate(context);
  assert.equal(context.modulationDirectBandOffsetsDb[5], 13.5);
  assert.equal(core.getEffectiveValue('filterbank.band.5.gainDb', { ...context, maxBandCutDb: 60, maxBandBoostDb: 24 }), 21);
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
