import test from 'node:test';
import assert from 'node:assert/strict';
import { MACRO_COUNT, MODULATION_TARGETS, ModulationCore, normalizeMacroState,
  getModulationAssignmentStatus, compileModulationGraph, wouldCreateModulationCycle,
  mapModulationValue, getModulationTarget } from '../modulation-core.mjs';
import { normalizeModulationState } from '../lfo-core.mjs';
import { normalizeEnvelopeState } from '../envelope-core.mjs';
import { normalizeClockModState } from '../clock-mod-core.mjs';

const context = () => ({ filterbankEnabled: true, baseResonance: .17,
  filterEnabled: true, filterShapeParams: { type: 'lowpass', frequencyHz: 1000 },
  effectiveFilterShapeParams: {}, dryWet: 50, dynamicEqEnabled: true, dynamicEqThresholdDb: -30,
  dynamicEqEffectiveSettings: {}, maxBandCutDb: 12, maxBandBoostDb: 12,
  getModulationBandBaseDb: () => 0, setEffectiveResonance(value) { this.effectiveResonance = value; } });
const route = (id, targetId = 'global.resonance', amount = 50, extra = {}) => ({ id, targetId, amount, ...extra });
function configure(source) {
  const state = normalizeMacroState(source);
  const core = new ModulationCore();
  for (const macro of state.macroSources) core.setSourceValue(macro.id, macro.value / 100, 'unipolar');
  core.setAssignments(state.macroSources.flatMap(macro => macro.assignments));
  return { core, state };
}

test('four static macro defaults and legacy migration leave existing modulation state intact', () => {
  assert.equal(MACRO_COUNT, 4);
  const legacy = { lfoEnabled: true, lfoAmount: 37, envelopeSources: [{ enabled: true, attack: 40 }], clockMod: { enabled: true } };
  const before = [normalizeModulationState(legacy), normalizeEnvelopeState(legacy), normalizeClockModState(legacy.clockMod)];
  const defaults = normalizeMacroState(legacy);
  assert.deepEqual(defaults.macroSources, Array.from({ length: 4 }, (_, index) => ({ id: `macro.${index + 1}`, value: 0, assignments: [] })));
  Object.assign(legacy, defaults);
  assert.deepEqual([normalizeModulationState(legacy), normalizeEnvelopeState(legacy), normalizeClockModState(legacy.clockMod)], before);
  assert.deepEqual(normalizeMacroState(null), defaults);
  const malformed = normalizeMacroState({ macroSources: [{ value: Infinity }, { value: -1 }, { value: 150 }] });
  assert.deepEqual(malformed.macroSources.slice(0, 3).map(source => source.value), [0, 0, 100]);
});

test('manual value is unipolar: zero neutral, half value is half contribution, base remains untouched', () => {
  const { core } = configure({ macroSources: [{ value: 100, assignments: [route('r')] }] });
  const ctx = context(); core.evaluate(ctx);
  assert.equal(ctx.baseResonance, .17); assert.equal(ctx.effectiveResonance, .67);
  core.setSourceValue('macro.1', .5, 'unipolar');
  core.setAssignments([ { ...route('r', 'global.resonance', 80), sourceId: 'macro.1' } ]);
  core.evaluate(ctx); assert.equal(ctx.effectiveResonance, .17 + .4);
  core.setSourceValue('macro.1', 0, 'unipolar'); core.evaluate(ctx);
  assert.equal(ctx.effectiveResonance, ctx.baseResonance);
  assert.equal(core.getEffectiveValue('filter.frequencyHz', ctx), 1000);
});

test('signed amounts and assignment invert share one mapping and invert exactly once', () => {
  for (const amount of [0, 50, 100, -50, -100]) for (const invert of [false, true]) {
    const { core, state } = configure({ macroSources: [{ value: 50, assignments: [route('signed', 'global.resonance', amount, { invert })] }] });
    assert.equal(state.macroSources[0].assignments[0].amount, amount);
    const ctx = { ...context(), baseResonance: 0 };
    const expected = .5 * amount / 100 * (invert ? -1 : 1);
    assert.equal(core.getEffectiveValue('global.resonance', ctx), expected || 0);
    assert.equal(mapModulationValue(getModulationTarget('global.resonance'), 0, .5, amount), .5 * amount / 100 || 0);
  }
});

test('one macro routes multiple targets; macros and LFO/Envelope sum before the final clamp', () => {
  const { core } = configure({ macroSources: [{ value: 100, assignments: [route('a', 'global.resonance', 80),
    route('b', 'filter.frequencyHz', 20), route('c', 'dynamicEq.thresholdDb', -50)] },
    { value: 100, assignments: [route('d', 'global.resonance', 80)] }] });
  const ctx = { ...context(), baseResonance: 0 };
  core.setSourceValue('lfo.1', -.8); core.setSourceValue('envelope.3', .2, 'unipolar');
  core.setAssignments([...core.getAssignments(), { ...route('lfo', 'global.resonance', 100), sourceId: 'lfo.1' },
    { ...route('env', 'global.resonance', 50), sourceId: 'envelope.3' }]);
  core.evaluate(ctx);
  assert.ok(Math.abs(ctx.effectiveResonance - .9) < 1e-15);
  assert.ok(ctx.effectiveFilterShapeParams.frequencyHz > 1000);
  assert.equal(ctx.dynamicEqEffectiveSettings.dynamicEqThresholdDb, -45);
  assert.equal(ctx.filterShapeParams.frequencyHz, 1000); assert.equal(ctx.dynamicEqThresholdDb, -30);
});

test('macro stereo channels reuse BOTH LEFT RIGHT and signed SPREAD; mono normalizes to BOTH', () => {
  for (const [channel, expected] of [['both', [6, 6]], ['left', [6, 0]], ['right', [0, 6]], ['spread', [6, -6]]]) {
    const { core, state } = configure({ macroSources: [{ value: 100, assignments: [route('band', 'filterbank.band.4.gainDb', 50, { channel })] }] });
    const ctx = context();
    assert.deepEqual(['left', 'right'].map(side => core.getEffectiveValue('filterbank.band.4.gainDb', ctx, side)), expected);
    assert.equal(state.macroSources[0].assignments[0].channel, channel);
  }
  const { state } = configure({ macroSources: [{ assignments: [route('mono', 'global.resonance', 50, { channel: 'spread' })] }] });
  assert.equal(state.macroSources[0].assignments[0].channel, 'both');
});

test('unavailable and unknown macro targets persist and automatically reactivate with the same ID', () => {
  const { core, state } = configure({ macroSources: [{ value: 100, assignments: [route('saved', 'filter.frequencyHz', 50), route('unknown', 'removed.target', -50)] }] });
  const [saved, unknown] = state.macroSources[0].assignments;
  const ctx = context(); const active = core.getEffectiveValue(saved.targetId, ctx);
  ctx.filterShapeParams.type = 'formant';
  assert.equal(getModulationAssignmentStatus(saved, ctx).reason, 'target-unavailable');
  assert.equal(core.getEffectiveValue(saved.targetId, ctx), 1000);
  assert.equal(getModulationAssignmentStatus(unknown, ctx).reason, 'target-invalid');
  ctx.filterShapeParams.type = 'lowpass';
  assert.equal(core.getEffectiveValue(saved.targetId, ctx), active);
  assert.equal(core.getAssignments()[0].id, 'saved');
});

test('macros reuse existing meta targets and DAG with no inbound macro edges or macro targets', () => {
  const { core } = configure({ macroSources: [{ value: 100, assignments: [route('rate', 'lfo.2.rate', 50), route('attack', 'envelope.1.attack', 50)] }] });
  assert.equal(MODULATION_TARGETS.length, 47);
  assert.equal(MODULATION_TARGETS.some(target => target.id.startsWith('macro.')), false);
  const graph = compileModulationGraph(core.getAssignments());
  assert.equal(graph.blocked.size, 0);
  assert.ok(graph.order.indexOf('macro.1') < graph.order.indexOf('lfo.2'));
  assert.ok(graph.order.indexOf('macro.1') < graph.order.indexOf('envelope.1'));
  assert.equal(wouldCreateModulationCycle(core.getAssignments(), { sourceId: 'macro.1', targetId: 'lfo.1.rate', id: 'legal' }), false);
});

test('all macro values and independent disabled inverted lost rows round-trip without runtime caches', () => {
  const state = normalizeMacroState({ macroSources: Array.from({ length: 8 }, (_, index) => ({ value: index * 13,
    assignments: [route(`row.${index}`, 'filterbank.band.4.gainDb', -50, { channel: 'spread', invert: true }),
      route(`off.${index}`, 'lfo.2.rate', 50, { enabled: false }), route(`lost.${index}`, 'removed.target', 100)] })) });
  assert.deepEqual(state.macroSources.map(source => source.id), ['macro.1', 'macro.2', 'macro.3', 'macro.4']);
  assert.deepEqual(state.macroSources.map(source => source.value), [0, 13, 26, 39]);
  assert.deepEqual(normalizeMacroState(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(Object.keys(state.macroSources[0]), ['id', 'value', 'assignments']);
});
