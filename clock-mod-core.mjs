import { LfoOscillator, LFO_MIN_RATE_HZ, LFO_MAX_RATE_HZ, LFO_SYNC_DIVISIONS } from './lfo-core.mjs';
import { SYNC_DIVISION_BEATS } from './clock-core.mjs';

export const CLOCK_MOD_BAND_COUNT = 10;
export const CLOCK_MOD_WAVEFORMS = Object.freeze(['sine', 'square', 'triangle', 'saw', 'random']);
export const CLOCK_MOD_DIRECTIONS = Object.freeze(['forward', 'backward', 'ping-pong', 'random']);
export const CLOCK_MOD_CLOCK_SOURCES = Object.freeze(['internal', 'midi']);
export const CLOCK_MOD_MIN_BPM = 1;
export const CLOCK_MOD_MAX_BPM = 10000;
export const CLOCK_MOD_DEFAULT_OSCILLATOR_SEED = 0x6d2b79f5;
export const CLOCK_MOD_DEFAULT_DIRECTION_SEED = 0x13579bdf;

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};
const normalizeSeed = (value, fallback) => Number.isInteger(Number(value)) ? (Number(value) >>> 0) || 1 : fallback;
const normalizeWaveform = waveform => CLOCK_MOD_WAVEFORMS.includes(waveform) ? waveform : 'sine';
const oscillatorWaveform = waveform => waveform === 'saw' ? 'saw-up' : waveform === 'random' ? 'sample-hold' : waveform;

export function normalizeClockModState(source = {}) {
  const state = source?.clockMod && typeof source.clockMod === 'object' ? source.clockMod : source;
  return {
    enabled: state.enabled === true,
    waveform: normalizeWaveform(state.waveform),
    sourceFrequencyHz: clamp(state.sourceFrequencyHz, LFO_MIN_RATE_HZ, LFO_MAX_RATE_HZ, 1),
    modulationGain: clamp(state.modulationGain, 0, 100, 0),
    midpointDb: clamp(state.midpointDb, -60, 24, 0),
    direction: CLOCK_MOD_DIRECTIONS.includes(state.direction) ? state.direction : 'forward',
    clockSource: CLOCK_MOD_CLOCK_SOURCES.includes(state.clockSource) ? state.clockSource : 'internal',
    internalBpm: clamp(state.internalBpm, CLOCK_MOD_MIN_BPM, CLOCK_MOD_MAX_BPM, 120),
    clockScale: LFO_SYNC_DIVISIONS.includes(state.clockScale) ? state.clockScale : '1/4',
    rightInvert: state.rightInvert === true,
    lockedBands: Array.from({ length: CLOCK_MOD_BAND_COUNT }, (_, index) => state.lockedBands?.[index] === true),
    oscillatorSeed: normalizeSeed(state.oscillatorSeed, CLOCK_MOD_DEFAULT_OSCILLATOR_SEED),
    directionSeed: normalizeSeed(state.directionSeed, CLOCK_MOD_DEFAULT_DIRECTION_SEED)
  };
}

// Clock Mod is a filterbank layer, not a modulation-core source. Its oscillator
// borrows LFO's sample clock and waveform/S&H implementation while its clock,
// progression, and per-band holds stay independent of LFO assignments.
export class ClockModCore {
  constructor(source = {}, { maxBandBoostDb = 12, maxBandCutDb = 12 } = {}) {
    this.config = normalizeClockModState(source);
    this.maxBandBoostDb = this.readLimit(maxBandBoostDb, 12);
    this.maxBandCutDb = this.readLimit(maxBandCutDb, 12);
    this.config.midpointDb = this.clampValue(this.config.midpointDb);
    this.currentBand = 0;
    this.pingPongDirection = 1;
    this.lastTriggeredBand = -1;
    this.heldLeft = new Float64Array(CLOCK_MOD_BAND_COUNT);
    this.heldRight = new Float64Array(CLOCK_MOD_BAND_COUNT);
    this.heldSample = new Float64Array(CLOCK_MOD_BAND_COUNT);
    this.heldLeft.fill(this.config.midpointDb);
    this.heldRight.fill(this.config.midpointDb);
    this.oscillatorPhase = 0;
    this.midiClockStepIndex = null;
    this.directionRandomState = this.config.directionSeed;
    this.oscillator = new LfoOscillator({
      enabled: this.config.enabled,
      waveform: oscillatorWaveform(this.config.waveform),
      rateHz: this.config.sourceFrequencyHz,
      seed: this.config.oscillatorSeed
    });
    if (this.config.enabled) this.oscillator.reset(0);
  }

  readLimit(value, fallback) {
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  }

  clampValue(value) { return Math.min(this.maxBandBoostDb, Math.max(-this.maxBandCutDb, value)); }

  setBandLimits(maxBandBoostDb, maxBandCutDb) {
    const nextBoost = this.readLimit(maxBandBoostDb, this.maxBandBoostDb);
    const nextCut = this.readLimit(maxBandCutDb, this.maxBandCutDb);
    if (nextBoost === this.maxBandBoostDb && nextCut === this.maxBandCutDb) return false;
    this.maxBandBoostDb = nextBoost;
    this.maxBandCutDb = nextCut;
    this.config.midpointDb = this.clampValue(this.config.midpointDb);
    for (let band = 0; band < CLOCK_MOD_BAND_COUNT; band += 1) {
      this.heldLeft[band] = this.clampValue(this.heldLeft[band]);
      this.heldRight[band] = this.clampValue(this.heldRight[band]);
    }
    return true;
  }

  configure(source = {}, clockCore = null) {
    const previous = this.config;
    const next = normalizeClockModState({ ...previous, ...source,
      lockedBands: source.lockedBands ?? previous.lockedBands });
    next.midpointDb = this.clampValue(next.midpointDb);
    this.config = next;
    this.oscillator.configure({
      enabled: next.enabled,
      waveform: oscillatorWaveform(next.waveform),
      rateHz: next.sourceFrequencyHz,
      seed: next.oscillatorSeed
    });
    const becameEnabled = !previous.enabled && next.enabled;
    if (becameEnabled) {
      this.resetProgression();
      clockCore?.resetClockModPhase?.();
      this.directionRandomState = next.directionSeed;
      this.oscillator.reset(0);
    }
    if (previous.directionSeed !== next.directionSeed && !becameEnabled) this.directionRandomState = next.directionSeed;
    if (becameEnabled || previous.clockSource !== next.clockSource || previous.clockScale !== next.clockScale) {
      this.midiClockStepIndex = clockCore && Number.isFinite(clockCore.midiBeatPosition)
        ? Math.floor(clockCore.midiBeatPosition / (SYNC_DIVISION_BEATS[next.clockScale] || 1)) : null;
    }
    return this.config;
  }

  resetProgression() {
    this.currentBand = 0;
    this.pingPongDirection = 1;
    this.lastTriggeredBand = -1;
    this.directionRandomState = this.config.directionSeed;
  }

  get nextBandIndex() {
    return this.currentBand;
  }

  getModulationDepthDb() {
    const availableDepthDb = Math.max(0, Math.min(
      this.maxBandBoostDb - this.config.midpointDb,
      this.config.midpointDb + this.maxBandCutDb
    ));
    return availableDepthDb * this.config.modulationGain / 100;
  }

  resetMidiProgression(clockCore) {
    this.resetProgression();
    const scaleBeats = SYNC_DIVISION_BEATS[this.config.clockScale] || 1;
    this.midiClockStepIndex = clockCore && Number.isFinite(clockCore.midiBeatPosition)
      ? Math.floor(clockCore.midiBeatPosition / scaleBeats) : 0;
  }

  nextDirectionRandom() {
    let value = this.directionRandomState >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.directionRandomState = value >>> 0 || 1;
    return this.directionRandomState / 0x100000000;
  }

  step() {
    const band = this.currentBand;
    if (!this.config.lockedBands[band]) {
      const oscillatorValue = Number.isFinite(this.oscillator.sampleValue) ? this.oscillator.sampleValue : 0;
      const modulationDepthDb = this.getModulationDepthDb();
      const heldOffsetDb = oscillatorValue * modulationDepthDb;
      const clockModValueDb = this.clampValue(this.config.midpointDb + heldOffsetDb);
      const rightHeldOffsetDb = this.config.rightInvert ? -heldOffsetDb : heldOffsetDb;
      const clockModRightValueDb = this.clampValue(this.config.midpointDb + rightHeldOffsetDb);
      this.heldSample[band] = oscillatorValue;
      this.heldLeft[band] = clockModValueDb;
      this.heldRight[band] = clockModRightValueDb;
    }
    this.lastTriggeredBand = band;
    this.advanceProgression();
    return band;
  }

  advanceProgression() {
    if (this.config.direction === 'forward') {
      this.currentBand = (this.currentBand + 1) % CLOCK_MOD_BAND_COUNT;
      return;
    }
    if (this.config.direction === 'backward') {
      this.currentBand = (this.currentBand + CLOCK_MOD_BAND_COUNT - 1) % CLOCK_MOD_BAND_COUNT;
      return;
    }
    if (this.config.direction === 'random') {
      this.currentBand = Math.floor(this.nextDirectionRandom() * CLOCK_MOD_BAND_COUNT);
      return;
    }
    const next = this.currentBand + this.pingPongDirection;
    if (next >= CLOCK_MOD_BAND_COUNT) {
      this.pingPongDirection = -1;
      this.currentBand = CLOCK_MOD_BAND_COUNT - 2;
    } else if (next < 0) {
      this.pingPongDirection = 1;
      this.currentBand = 1;
    } else this.currentBand = next;
  }

  valueDb(channel, band) {
    if (!Number.isInteger(band) || band < 0 || band >= CLOCK_MOD_BAND_COUNT) return 0;
    if (!this.config.enabled) return 0;
    if (this.config.lockedBands[band]) return this.config.midpointDb;
    return channel === 'right' ? this.heldRight[band] : this.heldLeft[band];
  }

  advance(sampleRate, clockCore) {
    if (!this.config.enabled) return 0;
    const safeRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
    this.oscillator.advance(safeRate, 0, true);
    this.oscillatorPhase = this.oscillator.phase;
    if (this.config.clockSource === 'internal') {
      const steps = clockCore?.advanceClockModSteps?.(this.config.internalBpm, safeRate) || 0;
      if (steps < 1) return 0;
      // ClockCore bounds this to three possible events per sample, preventing
      // unbounded work or a carried backlog at the 10,000 BPM ceiling.
      let changedMask = 0;
      for (let index = 0; index < steps; index += 1) changedMask |= 1 << this.step();
      return changedMask;
    }
    if (!clockCore?.midiTransportRunning || !Number.isFinite(clockCore.midiBeatPosition)) return 0;
    const scaleBeats = SYNC_DIVISION_BEATS[this.config.clockScale] || 1;
    const clockStep = Math.floor((clockCore.midiBeatPosition + 1e-10) / scaleBeats);
    if (this.midiClockStepIndex === null) {
      this.midiClockStepIndex = clockStep;
      return 0;
    }
    const due = clockStep - this.midiClockStepIndex;
    if (due < 1) return 0;
    const steps = Math.min(32, due);
    this.midiClockStepIndex = clockStep;
    let changedMask = 0;
    for (let index = 0; index < steps; index += 1) changedMask |= 1 << this.step();
    return changedMask;
  }
}
