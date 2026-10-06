import test from 'node:test';
import assert from 'node:assert/strict';
import { PresetStore, PRESET_STORAGE_KEY, SNAPSHOT_STORAGE_KEY, presetStructureKey } from '../presets-core.mjs';
import { presetFixture } from './helpers/preset-contract.mjs';
import { ModulationCore } from '../modulation-core.mjs';
const { contract, defaults } = presetFixture();
const memory = () => { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), data }; };
const clean = value => JSON.parse(JSON.stringify(value));
test('legacy v1 eight-macro library and snapshots load without writes, normalize and export four sources', () => {
  const legacy = contract.clonePresetState(contract.init);
  legacy.macroSources = Array.from({ length: 8 }, (_, i) => ({ id: `macro.${i + 1}`, value: i * 12,
    assignments: [{ id: `legacy.${i}`, sourceId: `macro.${i + 1}`, targetId: 'global.resonance', amount: 20, channel: 'both', invert: false, enabled: true }] }));
  const storage = memory();
  storage.setItem(PRESET_STORAGE_KEY, JSON.stringify({ format: 'da_filta-preset-library', version: 1, presets: [
    { id: 'legacy', format: 'da_filta-preset', version: 1, name: 'Legacy', state: legacy }] }));
  const b = clean(legacy); b.macroSources.forEach(source => { source.value = 100; });
  storage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify({ format: 'da_filta-snapshots', version: 1, slots: { A: legacy, B: b } }));
  const before = [...storage.data.entries()];
  const store = new PresetStore(contract, storage);
  assert.equal(store.error, ''); assert.deepEqual([...storage.data.entries()], before);
  const expected = legacy.macroSources.slice(0, 4);
  assert.deepEqual(store.entry('legacy').state.macroSources, expected);
  assert.deepEqual(store.snapshots.A.macroSources, expected);
  assert.equal(store.snapshots.B.macroSources.length, 4);
  assert.deepEqual(store.exportPreset('legacy').state.macroSources, expected);
  assert.deepEqual(store.exportLibrary().presets[0].state.macroSources, expected);
  const imported = new PresetStore(contract, memory());
  imported.import(JSON.stringify({ format: 'da_filta-preset', version: 1, name: 'Old', state: legacy }));
  assert.deepEqual(imported.presets[0].state.macroSources, expected);
  for (const percent of [0, 25, 50, 75, 100]) {
    const morphed = contract.interpolatePresetState(legacy, b, percent);
    assert.equal(morphed.macroSources.length, 4);
    assert.deepEqual(morphed.macroSources.map(source => source.value), expected.map(source => source.value + (100 - source.value) * percent / 100));
  }
  store.capture('A', legacy);
  assert.equal(JSON.parse(storage.getItem(SNAPSHOT_STORAGE_KEY)).slots.A.macroSources.length, 4);
  assert.equal(contract.init.macroSources.length, 4);
  assert.ok(contract.init.macroSources.every(source => source.value === 0 && source.assignments.length === 0));
});
function endpoints() {
  const a = contract.clonePresetState(contract.init), b = contract.clonePresetState(a);
  Object.assign(a, { resonance: -.4, dryWet: 20, filterFrequencyHz: 100, dynamicEqThresholdDb: -50 });
  Object.assign(b, { resonance: .8, dryWet: 80, filterFrequencyHz: 10000, dynamicEqThresholdDb: -10, filterType: 'highpass' });
  a.bandGainLeft[0] = -100; b.bandGainLeft[0] = 100; b.feedbackBandLeft[0] = true;
  a.lfoSources[0].rateHz = .1; b.lfoSources[0].rateHz = 10; b.lfoSources[0].waveform = 'square'; b.lfoSources[0].rateMode = 'sync';
  a.envelopeSources[0].attack = 2; b.envelopeSources[0].attack = 200;
  a.macroSources[0].value = 0; b.macroSources[0].value = 100;
  a.macroSources[0].assignments = [{ id: 'same', sourceId: 'macro.1', targetId: 'global.resonance', amount: -100, channel: 'both', invert: true, enabled: false }];
  b.macroSources[0].assignments = [{ ...a.macroSources[0].assignments[0], amount: 100 }];
  return { a, b };
}
test('production projection reuses defaults, saves bases, excludes session and runtime fields, normalizes invalid input', () => {
  const excluded = { volumeDb: -20, outputGuardEnabled: false, outputProtectionEnabled: false, feedbackCore: 'current', wetModel: 'reference-delta',
    audioStatus: 'ON', devices: ['private'], theme: 'dark', selectedWorkspaceMode: 'presets', effectiveResonance: .9, runtimePhase: 10 };
  const state = contract.capturePresetState({ ...defaults, ...excluded, resonance: .2, inputGainDb: 7 });
  assert.equal(state.resonance, .2); assert.equal(state.inputGainDb, 7);
  for (const key of Object.keys(excluded)) assert.equal(key in state, false, key);
  assert.deepEqual(clean(contract.normalizePresetState(null)), clean(contract.init));
  const malformed = contract.normalizePresetState({ filterFrequencyHz: 'oops', resonance: '1', bandGainLeft: [Infinity, -1000],
    lfoSources: [null], envelopeSources: ['bad'], macroSources: [{ value: 900, assignments: [null, { id: 'lost', targetId: 'removed', amount: -50 }] }] });
  assert.equal(malformed.filterFrequencyHz, contract.init.filterFrequencyHz); assert.equal(malformed.resonance, 0);
  assert.equal(malformed.bandGainLeft.length, 10); assert.equal(malformed.bandGainLeft[1], -100);
  assert.equal(malformed.lfoSources.length, 4); assert.equal(malformed.envelopeSources.length, 4); assert.equal(malformed.macroSources.length, 4);
  assert.equal(malformed.macroSources[0].assignments[1].targetId, 'removed');
  assert.equal('midiStatus' in state.lfoClock, false); assert.equal('running' in state.lfoClock, false);
  const expandedSpread = contract.capturePresetState({ ...defaults, spreadMaxOffsetDb: 12, spread: 9 });
  assert.equal(expandedSpread.spread, 9); assert.equal('spreadMaxOffsetDb' in expandedSpread, false);
});
test('semantic numeric morph at 0/25/50/75/100 has exact endpoints and immutable inputs', () => {
  const { a, b } = endpoints(), before = JSON.stringify({ a, b });
  for (const percent of [0, 25, 50, 75, 100]) {
    const state = contract.interpolatePresetState(a, b, percent), t = percent / 100;
    assert.equal(state.resonance, t === 0 ? a.resonance : t === 1 ? b.resonance : a.resonance + (b.resonance - a.resonance) * t);
    assert.equal(state.dryWet, 20 + 60 * t); assert.equal(state.bandGainLeft[0], -100 + 200 * t);
    assert.ok(Math.abs(state.filterFrequencyHz - 100 * 100 ** t) < 1e-10);
    assert.ok(Math.abs(state.lfoSources[0].rateHz - .1 * 100 ** t) < 1e-12);
    assert.ok(Math.abs(state.envelopeSources[0].attack - 2 * 100 ** t) < 1e-12);
    assert.equal(state.dynamicEqThresholdDb, -50 + 40 * t); assert.equal(state.macroSources[0].value, percent);
    assert.equal(state.macroSources[0].assignments[0].amount, -100 + 200 * t);
    if (percent === 0) assert.deepEqual(state, contract.clonePresetState(a));
    if (percent === 100) assert.deepEqual(state, contract.clonePresetState(b));
  }
  assert.equal(JSON.stringify({ a, b }), before);
});
test('band morph is linear in dB even across asymmetric cut/boost ranges; zero times have a finite linear fallback', () => {
  const { a, b } = endpoints(); b.envelopeSources[0].delay = 100;
  const state = contract.interpolatePresetState(a, b, 50, { maxBandBoostDb: 24, maxBandCutDb: 60 });
  assert.equal(state.bandGainLeft[0], -30); // (-60 + 24)/2 = -18 dB, expressed in current control coordinates.
  assert.equal(state.envelopeSources[0].delay, 50);
});
test('discrete midpoint and mismatched assignment topology follow A below 50 and B at/above 50', () => {
  const { a, b } = endpoints(); b.macroSources[0].assignments[0].targetId = 'filter.frequencyHz';
  for (const percent of [0, 25, 49, 50, 75, 100]) {
    const state = contract.interpolatePresetState(a, b, percent), side = percent < 50 ? a : b;
    assert.equal(state.filterType, side.filterType); assert.equal(state.feedbackBandLeft[0], side.feedbackBandLeft[0]);
    assert.equal(state.lfoSources[0].waveform, side.lfoSources[0].waveform); assert.equal(state.lfoSources[0].rateMode, side.lfoSources[0].rateMode);
    assert.deepEqual(state.macroSources[0].assignments, side.macroSources[0].assignments);
  }
  assert.equal(presetStructureKey(contract.interpolatePresetState(a, b, 51)), presetStructureKey(contract.interpolatePresetState(a, b, 99)));
});
test('non-monotonic morph sequence never accumulates endpoint drift', () => {
  const { a, b } = endpoints();
  for (const percent of [0, 33, 77, 10, 90, 0, 100, 0]) {
    const state = contract.interpolatePresetState(a, b, percent);
    if (percent === 0 || percent === 100) assert.deepEqual(state, contract.clonePresetState(percent ? b : a));
  }
});
test('library actions are explicit, INIT is read-only, snapshots persist separately, and exports round-trip', () => {
  const storage = memory(), store = new PresetStore(contract, storage), { a, b } = endpoints();
  const entry = store.saveAs('  Sound  ', a); assert.equal(entry.name, 'Sound');
  assert.throws(() => store.saveAs('Sound', b)); assert.throws(() => store.saveAs('', a)); assert.throws(() => store.saveAs('x'.repeat(65), a));
  store.capture('A', a); store.capture('B', b); store.update(entry.id, b); store.rename(entry.id, 'Renamed');
  const duplicate = store.duplicate(entry.id, 'Copy'); assert.notEqual(duplicate.id, entry.id);
  const restored = new PresetStore(contract, storage);
  assert.deepEqual(restored.presets, store.presets); assert.deepEqual(restored.snapshots, store.snapshots);
  assert.ok(Object.isFrozen(restored.snapshots.A.macroSources));
  assert.throws(() => store.delete('factory:init')); assert.throws(() => store.update('factory:init', a));
  const single = JSON.stringify(store.exportPreset(entry.id)), library = JSON.stringify(store.exportLibrary());
  const imported = new PresetStore(contract, memory()); imported.import(single); imported.import(library);
  assert.equal(imported.presets.length, 3); assert.equal(new Set(imported.presets.map(item => item.name)).size, 3);
  assert.equal(new Set(imported.presets.map(item => item.id)).size, 3);
  assert.deepEqual(imported.presets[0].state, b);
  store.delete(entry.id); assert.equal(store.snapshots.A.resonance, a.resonance); assert.ok(store.entry(duplicate.id));
  assert.ok(storage.data.has(PRESET_STORAGE_KEY)); assert.ok(storage.data.has(SNAPSHOT_STORAGE_KEY));
  const conflicting = memory(), first = store.exportPreset(duplicate.id);
  conflicting.setItem(PRESET_STORAGE_KEY, JSON.stringify({ format: 'da_filta-preset-library', version: 1,
    presets: [{ ...first, id: 'duplicate' }, { ...first, id: 'duplicate' }] }));
  const recovered = new PresetStore(contract, conflicting);
  assert.equal(new Set(recovered.presets.map(item => item.id)).size, 2);
  assert.equal(new Set(recovered.presets.map(item => item.name)).size, 2);
});
test('invalid/forward imports are atomic and storage failures keep the in-memory library usable', () => {
  const store = new PresetStore(contract, memory()); store.saveAs('Keep', contract.init);
  for (const data of ['{', JSON.stringify({ format: 'nope', version: 1 }), JSON.stringify({ format: 'da_filta-preset', version: 2 }),
    JSON.stringify({ format: 'da_filta-preset-library', version: 1, presets: [store.exportPreset(store.presets[0].id), { version: 9 }] })]) {
    assert.throws(() => store.import(data)); assert.equal(store.presets.length, 1);
  }
  const broken = new PresetStore(contract, { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } });
  assert.match(broken.error, /nicht lesbar/); broken.saveAs('Memory', contract.init); assert.equal(broken.presets.length, 1); assert.match(broken.error, /Nicht dauerhaft gespeichert/);
});
test('continuous amount updates reuse compiled handles and aggregate duplicates, channels and cycle blockers', () => {
  const core = new ModulationCore(); core.setSourceValue('macro.1', .5, 'unipolar');
  const routes = [{ id: 'one', sourceId: 'macro.1', targetId: 'global.resonance', amount: 10, channel: 'both', invert: false, enabled: true },
    { id: 'two', sourceId: 'macro.1', targetId: 'global.resonance', amount: 20, channel: 'both', invert: true, enabled: true }];
  core.setAssignments(routes); const handles = core.compiledTargets, count = core.compilationCount;
  assert.equal(core.setAssignmentAmounts(routes.map(row => ({ ...row, amount: 40 }))), true);
  assert.equal(core.getEffectiveValue('global.resonance', { filterbankEnabled: true, baseResonance: .17 }), .17);
  assert.equal(core.compiledTargets, handles); assert.equal(core.compilationCount, count);
  assert.equal(core.setAssignmentAmounts(routes.map(row => ({ ...row, targetId: 'filter.frequencyHz' }))), false);
  // Compare the amount-only path against the established structural compiler,
  // including stereo held taps, lost targets and blocked feedback edges.
  const matrix = ['both', 'left', 'right', 'spread'].map((channel, index) => ({ id: channel, sourceId: 'clockMod.1.band.0',
    targetId: 'filterbank.band.4.gainDb', amount: 0, channel, invert: index % 2 === 0, enabled: true }));
  matrix.push({ id: 'cycle', sourceId: 'lfo.1', targetId: 'lfo.1.rate', amount: 0, channel: 'both', invert: false, enabled: true },
    { id: 'meta', sourceId: 'macro.1', targetId: 'lfo.1.rate', amount: 0, channel: 'both', invert: false, enabled: true },
    { id: 'lost', sourceId: 'macro.1', targetId: 'missing.target', amount: 0, channel: 'spread', invert: false, enabled: true });
  const fast = new ModulationCore(), reference = new ModulationCore();
  for (const instance of [fast, reference]) {
    instance.setAssignments(matrix); instance.setSourceValue('macro.1', .5, 'unipolar'); instance.setSourceValue('lfo.1', 1);
    Object.assign(instance.sources.get('clockMod.1.band.0'), { enabled: true, value: .5, rightValue: -.5, nativeUnit: 'dB', nativeValue: 3, nativeRightValue: -3 });
  }
  const graph = fast.graph, compiled = fast.compiledTargets, context = { filterbankEnabled: true,
    maxBandCutDb: 12, maxBandBoostDb: 12, getModulationBandBaseDb: () => 0,
    lfoModuleEnabled: true, lfoSources: [{ enabled: true, rateMode: 'free', rateHz: 1 }] };
  for (const amount of [0, 50, 100, -50, -100]) {
    const changed = matrix.map((row, index) => ({ ...row, amount: amount / (index + 1) }));
    assert.equal(fast.setAssignmentAmounts(changed), true); reference.setAssignments(changed);
    for (const target of ['filterbank.band.4.gainDb', 'lfo.1.rate', 'missing.target']) for (const channel of ['left', 'right'])
      assert.equal(fast.getEffectiveValue(target, context, channel), reference.getEffectiveValue(target, context, channel));
    assert.equal(fast.graph, graph); assert.equal(fast.compiledTargets, compiled);
    assert.ok(fast.graph.blocked.has('lfo.1:cycle'));
  }
});
