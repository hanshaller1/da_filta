import test from 'node:test';
import assert from 'node:assert/strict';
import { ClockCore } from '../clock-core.mjs';
import { ClockModCore, normalizeClockModState } from '../clock-mod-core.mjs';

const makeCore = (overrides = {}, limits = {}) => new ClockModCore({
  enabled: true, waveform: 'saw', sourceFrequencyHz: 1, modulationGain: 100,
  midpointDb: 0, direction: 'forward', ...overrides
}, limits);

test('legacy and malformed state gets safe Clock Mod defaults without runtime arrays', () => {
  assert.deepEqual(normalizeClockModState({}), {
    id: 'clockMod.1', assignments: Array.from({ length: 10 }, (_, band) => ({
      id: `clockMod.1.assignment.band.${band}`, sourceId: `clockMod.1.band.${band}`,
      targetId: `filterbank.band.${band}.gainDb`, amount: 100, channel: 'both', invert: false, enabled: true
    })),
    enabled: false, waveform: 'sine', sourceFrequencyHz: 1, modulationGain: 0, midpointDb: 0,
    direction: 'forward', clockSource: 'internal', internalBpm: 120, clockScale: '1/4',
    rightInvert: false, lockedBands: Array(10).fill(false), oscillatorSeed: 0x6d2b79f5,
    directionSeed: 0x13579bdf
  });
  const normalized = normalizeClockModState({ enabled: 1, waveform: 'bad', sourceFrequencyHz: 1e5,
    modulationGain: -1, midpointDb: Infinity, direction: 'random', clockSource: 'midi',
    internalBpm: 10001, clockScale: 'bad', lockedBands: [true, false] });
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.waveform, 'sine');
  assert.equal(normalized.sourceFrequencyHz, 20);
  assert.equal(normalized.modulationGain, 0);
  assert.equal(normalized.midpointDb, 0);
  assert.equal(normalized.internalBpm, 10000);
  assert.equal(normalized.clockScale, '1/4');
  assert.deepEqual(normalized.lockedBands.slice(0, 3), [true, false, false]);
});

test('sample and hold writes only the current band and preserves the other nine holds', () => {
  const core = makeCore();
  assert.equal(core.step(), 0);
  assert.equal(core.heldLeft[0], -12);
  const beforeLeft = [...core.heldLeft];
  const beforeRight = [...core.heldRight];
  core.oscillator.sampleValue = 0.5;
  assert.equal(core.step(), 1);
  assert.equal(core.heldLeft[1], 6);
  assert.equal(core.heldRight[1], 6);
  for (let band = 0; band < 10; band += 1) {
    if (band === 1) continue;
    assert.equal(core.heldLeft[band], beforeLeft[band]);
    assert.equal(core.heldRight[band], beforeRight[band]);
  }
});

test('forward, backward, and ping-pong progression follows the configured band order', () => {
  const forward = makeCore({ direction: 'forward' });
  assert.deepEqual(Array.from({ length: 12 }, () => forward.step()), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
  const backward = makeCore({ direction: 'backward' });
  backward.currentBand = 9;
  assert.deepEqual(Array.from({ length: 12 }, () => backward.step()), [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 9, 8]);
  const pingPong = makeCore({ direction: 'ping-pong' });
  assert.deepEqual(Array.from({ length: 21 }, () => pingPong.step()), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2]);
});

test('random progression is seeded, stays in range, and uses a stream separate from random wave S&H', () => {
  const first = makeCore({ direction: 'random', directionSeed: 10, oscillatorSeed: 11, waveform: 'random' });
  const second = makeCore({ direction: 'random', directionSeed: 10, oscillatorSeed: 11, waveform: 'random' });
  const sequenceA = Array.from({ length: 32 }, () => first.step());
  const sequenceB = Array.from({ length: 32 }, () => second.step());
  assert.deepEqual(sequenceA, sequenceB);
  assert.equal(sequenceA[0], 0, 'reset begins on Band 1 before random progression selects the next band');
  assert.ok(sequenceA.every(index => index >= 0 && index < 10));
  assert.ok(new Set(sequenceA.slice(1)).size > 1);
  const progressionState = first.directionRandomState;
  first.oscillator.nextRandomBipolar();
  assert.equal(first.directionRandomState, progressionState);
});

test('locked bands resolve to midpoint without materializing a new held sample', () => {
  const lockedBands = Array(10).fill(false); lockedBands[0] = true;
  const core = makeCore({ midpointDb: -3, modulationGain: 100, lockedBands });
  const before = [core.heldLeft[0], core.heldRight[0], core.heldSample[0]];
  assert.equal(core.step(), 0);
  assert.deepEqual([core.heldLeft[0], core.heldRight[0], core.heldSample[0]], before);
  assert.equal(core.valueDb('left', 0), -3);
  assert.equal(core.valueDb('right', 0), -3);
  assert.equal(core.step(), 1);
  assert.equal(core.lastTriggeredBand, 1);
});

test('midpoint and asymmetric band limits determine a safe shared depth', () => {
  const core = makeCore({ midpointDb: 10, modulationGain: 100 }, { maxBandBoostDb: 18, maxBandCutDb: 6 });
  assert.equal(core.getModulationDepthDb(), 8);
  core.oscillator.sampleValue = 1;
  core.step();
  assert.equal(core.heldLeft[0], 18);
  core.resetProgression();
  core.oscillator.sampleValue = -1;
  core.step();
  assert.equal(core.heldLeft[0], 2);
  const midpoint = makeCore({ waveform: 'sine', midpointDb: -3, modulationGain: 66.6666666667 });
  midpoint.oscillator.sampleValue = 0.5;
  midpoint.step();
  assert.ok(Math.abs(midpoint.heldLeft[0]) < 1e-9);
});

test('right invert mirrors the sampled offset around midpoint and clamps independently', () => {
  const core = makeCore({ midpointDb: -3, modulationGain: 200 / 3, rightInvert: true });
  core.oscillator.sampleValue = 0.5;
  core.step();
  assert.equal(core.heldLeft[0], 0);
  assert.equal(core.heldRight[0], -6);
  const clipped = makeCore({ midpointDb: 11, modulationGain: 100, rightInvert: true }, { maxBandBoostDb: 12, maxBandCutDb: 12 });
  clipped.oscillator.sampleValue = 1;
  clipped.step();
  assert.equal(clipped.heldLeft[0], 12);
  assert.equal(clipped.heldRight[0], 10);
});

test('reset preserves holds and writes Band 1 before applying direction', () => {
  const core = makeCore();
  core.step();
  const held = [...core.heldLeft];
  core.currentBand = 8;
  core.resetProgression();
  assert.equal(core.currentBand, 0);
  assert.deepEqual([...core.heldLeft], held);
  assert.equal(core.step(), 0);

  for (const direction of ['backward', 'random']) {
    const directed = makeCore({ direction, directionSeed: 2 });
    directed.resetProgression();
    assert.equal(directed.nextBandIndex, 0);
    assert.equal(directed.step(), 0, `${direction} reset still writes Band 1 first`);
    assert.equal(directed.nextBandIndex, direction === 'backward'
      ? 9 : directed.currentBand);
  }
  const backwardSequence = makeCore({ direction: 'backward' });
  backwardSequence.resetProgression();
  assert.equal(backwardSequence.step(), 0);
  assert.deepEqual(Array.from({ length: 11 }, () => backwardSequence.step()), [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 9]);
});

test('source oscillator rate is independent from internal clock rate', () => {
  const core = makeCore({ waveform: 'sine', sourceFrequencyHz: 2, internalBpm: 60 });
  const clock = new ClockCore();
  let steps = 0;
  core.step = () => { steps += 1; return 0; };
  for (let frame = 0; frame < 12000; frame += 1) { clock.advance(48000); core.advance(48000, clock); }
  assert.equal(steps, 0);
  assert.ok(Math.abs(core.oscillatorPhase - 0.5) < 1e-8);
  for (let frame = 12000; frame < 48000; frame += 1) { clock.advance(48000); core.advance(48000, clock); }
  assert.equal(steps, 1);
  assert.ok(Math.abs(core.oscillatorPhase) < 1e-8);
});

test('internal 60 and 120 BPM produce one and two steps per second', () => {
  const runForSecond = bpm => {
    const core = makeCore({ internalBpm: bpm });
    const clock = new ClockCore();
    let steps = 0;
    core.step = () => { steps += 1; return steps % 10; };
    for (let frame = 0; frame < 48000; frame += 1) { clock.advance(48000); core.advance(48000, clock); }
    return steps;
  };
  assert.equal(runForSecond(60), 1);
  assert.equal(runForSecond(120), 2);
});

test('MIDI clock uses shared beat phase, scale, and START/STOP/CONTINUE behavior', () => {
  const clock = new ClockCore({ source: 'internal', bpm: 60, midiBpm: 120 });
  const core = makeCore({ clockSource: 'midi', clockScale: '1/8' });
  let steps = 0;
  core.step = () => { steps += 1; return steps % 10; };
  clock.startMidi(true);
  core.resetMidiProgression(clock);
  for (let frame = 0; frame < 12000; frame += 1) {
    clock.advance(48000);
    core.advance(48000, clock);
  }
  assert.equal(steps, 1);
  const held = [...core.heldLeft];
  clock.stopMidi();
  for (let frame = 0; frame < 12000; frame += 1) {
    clock.advance(48000);
    core.advance(48000, clock);
  }
  assert.equal(steps, 1);
  assert.deepEqual([...core.heldLeft], held);
  clock.continueMidi();
  for (let frame = 0; frame < 12000; frame += 1) {
    clock.advance(48000);
    core.advance(48000, clock);
  }
  assert.equal(steps, 2);
  clock.startMidi(true);
  core.resetMidiProgression(clock);
  assert.equal(core.currentBand, 0);
  assert.deepEqual([...core.heldLeft], held);
});

test('10,000 BPM remains finite with bounded per-sample work', () => {
  const core = makeCore({ internalBpm: 10000, sourceFrequencyHz: 20, direction: 'random' });
  const clock = new ClockCore();
  let steps = 0;
  core.step = () => { steps += 1; return steps % 10; };
  for (let frame = 0; frame < 48000; frame += 1) { clock.advance(48000); core.advance(48000, clock); }
  assert.equal(steps, 166);
  assert.ok(Number.isFinite(clock.clockModTickPhase));
  assert.ok(Number.isFinite(core.oscillatorPhase));
  assert.ok(clock.clockModTickPhase >= 0 && clock.clockModTickPhase < 1);
});
