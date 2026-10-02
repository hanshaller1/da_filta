import test from 'node:test';
import assert from 'node:assert/strict';
import { ModulationCore, getModulationTarget, compileModulationGraph, wouldCreateModulationCycle,
  getModulationAssignmentStatus, normalizeModulationAssignments } from '../modulation-core.mjs';
import { normalizeEnvelopeState, EnvelopeFollower } from '../envelope-core.mjs';
import { normalizeClockModState } from '../clock-mod-core.mjs';
import { LfoOscillator } from '../lfo-core.mjs';

const route = (id, sourceId, targetId, extra = {}) => ({ id, sourceId, targetId, amount: 25, enabled: true, ...extra });

test('Envelope legacy routing migrates once, array routing remains authoritative and IDs round-trip', () => {
  const old = normalizeEnvelopeState({ envelopeSources: [{ enabled: true, targetId: 'filter.frequencyHz', amount: 42, invert: true }] });
  assert.deepEqual(old.envelopeSources[0].assignments, [route('envelope.1.assignment.1', 'envelope.1', 'filter.frequencyHz', { amount: 42, channel: 'both', invert: true })]);
  assert.deepEqual(normalizeEnvelopeState(JSON.parse(JSON.stringify(old))), old);
  const empty = normalizeEnvelopeState({ envelopeSources: [{ ...old.envelopeSources[0], assignments: [] }] });
  assert.equal(empty.envelopeSources[0].targetId, '');
  assert.equal(empty.envelopeSources[0].amount, 0);
  assert.equal(empty.envelopeSources[0].outputAmount, 100);
});

test('Clock legacy holds migrate to ten editable independent routes; explicit empty routing persists', () => {
  const clock = normalizeClockModState({ enabled: true, midpointDb: -3 });
  assert.equal(clock.assignments.length, 10);
  assert.equal(new Set(clock.assignments.map(item => item.id)).size, 10);
  assert.equal(clock.assignments[9].sourceId, 'clockMod.1.band.9');
  assert.equal(clock.assignments[9].targetId, 'filterbank.band.9.gainDb');
  assert.deepEqual(normalizeClockModState(JSON.parse(JSON.stringify(clock))), clock);
  assert.deepEqual(normalizeClockModState({ ...clock, assignments: [] }).assignments, []);
  const repeated = normalizeClockModState({ assignments: [{ id: 'a' }, { id: 'a' }] });
  assert.deepEqual(repeated.assignments.map(item => item.id), ['a', 'a.copy']);
});

test('twenty mono meta-targets expose continuous positive logarithmic rate/time ranges', () => {
  for (let index = 1; index <= 4; index++) for (const [family, parameter, mapping, range] of [
    ['lfo', 'rate', 'logarithmic', [.01, 20]], ['lfo', 'amount', 'normalized', [0, 100]],
    ['envelope', 'attack', 'logarithmic', [1, 500]], ['envelope', 'release', 'logarithmic', [10, 3000]],
    ['envelope', 'amount', 'normalized', [0, 100]]
  ]) {
    const target = getModulationTarget(`${family}.${index}.${parameter}`);
    assert.equal(target.mapping, mapping); assert.deepEqual(target.range, range);
    assert.deepEqual(target.channels, ['both']); assert.equal(target.modulationCapability, 'continuous');
    assert.equal(target.modulatorId, `${family}.${index}`);
  }
  assert.equal(getModulationTarget('lfo.1.phase'), null);
});

test('self, direct and multi-hop cycles are blocked, legal order and restored blockers are deterministic', () => {
  for (const ids of [['lfo.1'], ['lfo.1', 'lfo.2'], ['lfo.1', 'lfo.2', 'envelope.1'], ['lfo.1', 'lfo.2', 'envelope.1', 'envelope.2']]) {
    const routes = ids.map((id, index) => route(`edge.${index}`, id,
      `${ids[(index + 1) % ids.length]}.${ids[(index + 1) % ids.length].startsWith('lfo') ? 'amount' : 'attack'}`));
    const graph = compileModulationGraph(routes);
    assert.equal(graph.blocked.size, 1);
    assert.deepEqual([...compileModulationGraph([...routes].reverse()).blocked], [...graph.blocked]);
    assert.deepEqual(compileModulationGraph([...routes].reverse()).order, graph.order);
    assert.equal(wouldCreateModulationCycle(routes.slice(0, -1), routes.at(-1)), true);
  }
  const legal = [route('a', 'lfo.1', 'lfo.2.rate'), route('b', 'lfo.2', 'envelope.1.attack')];
  const graph = compileModulationGraph(legal);
  assert.equal(graph.blocked.size, 0);
  assert.ok(graph.order.indexOf('lfo.1') < graph.order.indexOf('lfo.2'));
  assert.ok(graph.order.indexOf('lfo.2') < graph.order.indexOf('envelope.1'));
});

test('unavailable and disabled sources reserve enabled graph edges; disabled assignments can be enabled only safely', () => {
  const first = route('a', 'lfo.1', 'lfo.2.rate');
  const back = route('b', 'lfo.2', 'lfo.1.rate');
  const graph = compileModulationGraph([first, back]);
  assert.equal(graph.blocked.size, 1);
  assert.equal(compileModulationGraph([first, { ...back, enabled: false }]).blocked.size, 0);
  assert.equal(wouldCreateModulationCycle([first], back), true);
});

test('graph validation runs only when assignment structure or target ownership changes', () => {
  const core = new ModulationCore();
  const assignment = route('stable', 'lfo.1', 'lfo.2.rate');
  core.setAssignments([assignment]);
  const graph = core.graph, count = core.graphCompilationCount;
  core.setSourceValue('lfo.1', .5);
  core.setAssignment({ ...assignment, amount: 70, invert: true });
  assert.equal(core.graph, graph); assert.equal(core.graphCompilationCount, count);
  core.setAssignment({ ...assignment, enabled: false });
  assert.equal(core.graphCompilationCount, count + 1);
  core.setAssignment({ ...assignment, targetId: 'envelope.1.attack' });
  assert.equal(core.graphCompilationCount, count + 2);
});

test('meta mappings sum sources before clamp, preserve bases and reactivate from sync to free', () => {
  const core = new ModulationCore();
  const lfo = new LfoOscillator({ enabled: true, rateHz: 2, outputAmount: 50 });
  const context = { lfoModuleEnabled: true, lfoSources: [null, lfo] };
  const a = route('a', 'lfo.1', 'lfo.2.rate', { amount: 100 });
  const b = route('b', 'envelope.1', 'lfo.2.rate', { amount: 100, invert: true });
  core.setAssignments([a, b]); core.setSourceValue('lfo.1', 1); core.setSourceValue('envelope.1', 1);
  assert.equal(core.getEffectiveValue('lfo.2.rate', context), 2);
  core.setSourceValue('envelope.1', .5);
  const expected = 2 * (20 / .01) ** .25;
  assert.ok(Math.abs(core.getEffectiveValue('lfo.2.rate', context) - expected) < 1e-10);
  core.evaluateRecords(core.modulatorTargets.get('lfo.2'), context);
  assert.equal(lfo.rateHz, 2); assert.ok(lfo.effectiveRateHz > 2);
  lfo.rateMode = 'sync'; assert.equal(core.getEffectiveValue('lfo.2.rate', context), 2);
  assert.equal(getModulationAssignmentStatus(a, context).reason, 'target-unavailable');
  lfo.rateMode = 'free'; assert.ok(core.getEffectiveValue('lfo.2.rate', context) > 2);
  core.setAssignments([]); core.evaluateRecords(core.modulatorTargets.get('lfo.2'), context);
  assert.equal(lfo.effectiveRateHz, 2); assert.equal(lfo.effectiveOutputAmount, 50);
});

test('cycle restore keeps rows while excluding their DSP contribution and distinguishes status reasons', () => {
  const core = new ModulationCore();
  const self = route('self', 'lfo.1', 'lfo.1.rate');
  core.setAssignments([self]); core.setSourceValue('lfo.1', 1);
  const context = { lfoModuleEnabled: true, lfoSources: [{ enabled: true, rateMode: 'free', rateHz: 2 }], modulationGraph: core.graph };
  assert.equal(core.getEffectiveValue(self.targetId, context), 2);
  assert.equal(core.getAssignments()[0].id, 'self');
  assert.equal(getModulationAssignmentStatus(self, context).reason, 'cycle-blocked');
  assert.equal(getModulationAssignmentStatus({ ...self, targetId: 'missing' }, context).reason, 'target-invalid');
  assert.equal(getModulationAssignmentStatus({ ...self, enabled: false }, context).reason, 'assignment-disabled');
  assert.equal(getModulationAssignmentStatus(route('ok', 'lfo.2', 'lfo.1.rate'), context, false).reason, 'source-disabled');
});

test('effective frequency edits preserve phase/random state and envelope times preserve detector/delay history', () => {
  const oscillator = new LfoOscillator({ enabled: true, rateHz: 2, waveform: 'noise' });
  for (let index = 0; index < 100; index++) oscillator.advance(48000);
  const before = [oscillator.phase, oscillator.randomState, oscillator.heldRandom, oscillator.nextNoise];
  oscillator.setEffectiveParameter('rateHz', 12);
  assert.deepEqual([oscillator.phase, oscillator.randomState, oscillator.heldRandom, oscillator.nextNoise], before);
  oscillator.advance(48000); assert.ok(Math.abs(oscillator.phase - before[0] - 12 / 48000) < 1e-14);
  assert.equal(oscillator.rateHz, 2);
  const follower = new EnvelopeFollower({ enabled: true, detectorMode: 'rms', delay: 20 });
  follower.updateTimeConstants(48000); for (let index = 0; index < 600; index++) follower.process(.3, .2, 48000);
  const window = follower.rmsWindow, state = [follower.value, follower.rmsWindowIndex, follower.delayRemainingSamples];
  follower.setEffectiveParameter('attack', 1); follower.setEffectiveParameter('release', 3000);
  assert.equal(follower.rmsWindow, window);
  assert.deepEqual([follower.value, follower.rmsWindowIndex, follower.delayRemainingSamples], state);
  assert.deepEqual([follower.attack, follower.release], [20, 250]);
  assert.ok(follower.attackCoefficient > 0 && follower.releaseCoefficient < 1);
});

test('Envelope multi-routes sum duplicate targets, spread/invert/mute/remove and preserve lost IDs', () => {
  const core = new ModulationCore();
  const assignments = normalizeModulationAssignments([
    { id: 'a', targetId: 'filterbank.band.4.gainDb', amount: 50, channel: 'spread' },
    { id: 'b', targetId: 'filterbank.band.4.gainDb', amount: 25, invert: true },
    { id: 'c', targetId: 'filter.frequencyHz', amount: 30 },
    { id: 'd', targetId: 'dynamicEq.thresholdDb', amount: 20 }
  ], 'envelope.1');
  core.setAssignments(assignments); core.setSourceValue('envelope.1', .5, 'unipolar');
  const context = { filterbankEnabled: true, filterEnabled: true, dynamicEqEnabled: true,
    maxBandCutDb: 12, maxBandBoostDb: 12, getModulationBandBaseDb: () => 0,
    filterShapeParams: { type: 'lowpass', frequencyHz: 1000 }, dynamicEqThresholdDb: -30 };
  assert.equal(core.getEffectiveValue(assignments[0].targetId, context, 'left'), 1.5);
  assert.equal(core.getEffectiveValue(assignments[0].targetId, context, 'right'), -4.5);
  assert.ok(core.getEffectiveValue(assignments[2].targetId, context) > 1000);
  assert.equal(core.getEffectiveValue(assignments[3].targetId, context), -27);
  context.filterEnabled = false; assert.equal(core.getEffectiveValue(assignments[2].targetId, context), 1000);
  assert.equal(core.getAssignments()[2].id, 'c'); context.filterEnabled = true;
  assert.ok(core.getEffectiveValue(assignments[2].targetId, context) > 1000);
  core.setAssignment({ ...assignments[0], enabled: false }); core.removeAssignment('b');
  assert.equal(core.getEffectiveValue(assignments[0].targetId, context, 'left'), 0);
  core.setSourceValue('envelope.1', 0, 'unipolar', false);
  assert.equal(core.getEffectiveValue(assignments[3].targetId, context), -30);
});

test('SPREAD uses one signed contribution even when a held source has distinct stereo outputs', () => {
  const core = new ModulationCore();
  core.setAssignments([route('spread', 'clockMod.1.band.0', 'filterbank.band.4.gainDb', { amount: 100, channel: 'spread' })]);
  const source = core.sources.get('clockMod.1.band.0');
  source.enabled = true; source.value = .5; source.rightValue = -.5;
  source.nativeUnit = 'dB'; source.nativeValue = 3; source.nativeRightValue = -3;
  const context = { filterbankEnabled: true, maxBandCutDb: 12, maxBandBoostDb: 12, getModulationBandBaseDb: () => 0 };
  assert.equal(core.getEffectiveValue('filterbank.band.4.gainDb', context, 'left'), 3);
  assert.equal(core.getEffectiveValue('filterbank.band.4.gainDb', context, 'right'), -3);
  core.setAssignment({ ...core.getAssignments()[0], invert: true });
  assert.equal(core.getEffectiveValue('filterbank.band.4.gainDb', context, 'left'), -3);
  assert.equal(core.getEffectiveValue('filterbank.band.4.gainDb', context, 'right'), 3);
});
