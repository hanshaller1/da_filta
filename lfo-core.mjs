import { normalizeModulationAssignments } from './modulation-core.mjs';
import { SYNC_DIVISION_BEATS } from './clock-core.mjs';

export const LFO_WAVEFORMS = Object.freeze(['sine', 'triangle', 'saw-up', 'saw-down', 'square', 'pulse', 'sample-hold', 'noise']);
export const LFO_MIN_RATE_HZ = 0.01;
export const LFO_MAX_RATE_HZ = 20;
export const LFO_DEFAULT_COUNT = 4;
export const LFO_SYNC_DIVISIONS = Object.freeze(['1/32', '1/16', '1/8', '1/4', '1/2', '1/1', '2/1', '4/1']);

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};
const normalizeSeed = value => Number.isInteger(Number(value)) ? (Number(value) >>> 0) || 1 : 0x6d2b79f5;
const legacyFields = Object.freeze({
  enabled: 'lfoEnabled', waveform: 'lfoWaveform', rateHz: 'lfoRateHz', polarity: 'lfoPolarity',
  phase: 'lfoPhase', targetId: 'lfoTargetId', amount: 'lfoAmount', seed: 'lfoSeed'
});

export function normalizeLfoSourceState(source = {}, index = 0, legacy = false) {
  const waveform = source.waveform ?? (legacy ? source.lfoWaveform : undefined);
  const rate = source.rateHz ?? (legacy ? source.lfoRateHz : undefined);
  const phase = source.phaseOffsetDeg ?? source.phaseDegrees ?? (legacy ? source.lfoPhase : undefined);
  const targetId = source.targetId ?? (legacy ? source.lfoTargetId : undefined);
  const enabled = source.enabled ?? (legacy ? source.lfoEnabled : undefined);
  const amount = source.amount ?? (legacy ? source.lfoAmount : undefined);
  const seed = source.seed ?? (legacy ? source.lfoSeed : undefined);
  const id = `lfo.${index + 1}`;
  const assignments = normalizeModulationAssignments(Array.isArray(source.assignments) ? source.assignments : [{
    targetId, amount: clamp(amount, 0, 100, 25), channel: source.channel,
    // Legacy LFO invert is already applied by the oscillator, not the route.
    invert: false
  }], id);
  const first = assignments[0];
  return {
    id,
    enabled: enabled === true,
    waveform: LFO_WAVEFORMS.includes(waveform) ? waveform : 'sine',
    rateMode: source.rateMode === 'sync' ? 'sync' : 'free',
    rateHz: clamp(rate, LFO_MIN_RATE_HZ, LFO_MAX_RATE_HZ, 1),
    syncDivision: LFO_SYNC_DIVISIONS.includes(source.syncDivision) ? source.syncDivision : '1/4',
    polarity: source.polarity === 'unipolar' || (legacy && source.lfoPolarity === 'unipolar') ? 'unipolar' : 'bipolar',
    phaseOffsetDeg: clamp(phase, 0, 360, 0),
    outputAmount: clamp(source.outputAmount, 0, 100, 100),
    assignments,
    // Read aliases for old snapshots/API consumers. Assignments own routing.
    amount: first?.amount ?? 0,
    targetId: first?.targetId ?? '',
    channel: first?.channel ?? 'both',
    invert: source.invert === true,
    seed: normalizeSeed(seed)
  };
}

export function createLfoSources(count = LFO_DEFAULT_COUNT, initialSource = {}) {
  const safeCount = Math.max(0, Math.floor(clamp(count, 0, LFO_DEFAULT_COUNT, LFO_DEFAULT_COUNT)));
  return Array.from({ length: safeCount }, (_, index) => normalizeLfoSourceState(
    index === 0 ? initialSource : {}, index, index === 0 && Object.keys(initialSource).some(key => key.startsWith('lfo'))
  ));
}

export function normalizeLfoSources(source = {}) {
  const supplied = Array.isArray(source.lfoSources) ? source.lfoSources : null;
  const count = LFO_DEFAULT_COUNT;
  return Array.from({ length: count }, (_, index) => supplied
    ? normalizeLfoSourceState(supplied[index] || {}, index)
    : normalizeLfoSourceState(source, index, index === 0));
}

export function paginateLfoSources(sources = [], pageSize = 4) {
  const list = Array.isArray(sources) ? sources : [];
  const size = Math.max(1, Math.floor(clamp(pageSize, 1, 256, 4)));
  return Array.from({ length: Math.ceil(list.length / size) }, (_, page) =>
    list.slice(page * size, (page + 1) * size));
}

// Flat V1 fields remain part of the public state shape for snapshot and API
// compatibility. New code owns source-specific settings in lfoSources.
export function normalizeLfoState(source = {}) {
  const target = typeof source.lfoTargetId === 'string' ? source.lfoTargetId.trim() : '';
  return {
    lfoEnabled: source.lfoEnabled === true,
    lfoWaveform: LFO_WAVEFORMS.includes(source.lfoWaveform) ? source.lfoWaveform : 'sine',
    lfoRateHz: clamp(source.lfoRateHz, LFO_MIN_RATE_HZ, LFO_MAX_RATE_HZ, 1),
    lfoPolarity: source.lfoPolarity === 'unipolar' ? 'unipolar' : 'bipolar',
    lfoPhase: clamp(source.lfoPhase, 0, 360, 0),
    lfoTargetId: target,
    lfoAmount: clamp(source.lfoAmount, 0, 100, 25),
    lfoSeed: normalizeSeed(source.lfoSeed)
  };
}

export function normalizeModulationState(source = {}) {
  const lfoSources = normalizeLfoSources(source);
  const first = lfoSources[0] || normalizeLfoSourceState({}, 0);
  const moduleEnabled = source.lfoModuleEnabled === undefined ? source.lfoEnabled === true : source.lfoModuleEnabled === true;
  return {
    ...normalizeLfoState({
      lfoEnabled: moduleEnabled,
      lfoWaveform: first.waveform,
      lfoRateHz: first.rateHz,
      lfoPolarity: first.polarity,
      lfoPhase: first.phaseOffsetDeg,
      lfoTargetId: first.targetId,
      lfoAmount: first.amount,
      lfoSeed: first.seed
    }),
    lfoModuleEnabled: moduleEnabled,
    // Signed generic assignments keep an accurate read alias; the standalone
    // legacy normalizer retains its original malformed-state contract.
    lfoAmount: first.amount,
    lfoCount: lfoSources.length,
    lfoSources
  };
}

export function waveformSample(waveform, phase, heldRandom = 0, nextNoise = heldRandom) {
  const cycle = ((Number.isFinite(phase) ? phase : 0) % 1 + 1) % 1;
  if (waveform === 'triangle') return 1 - 4 * Math.abs(cycle - 0.5);
  if (waveform === 'saw-up') return cycle * 2 - 1;
  if (waveform === 'saw-down') return 1 - cycle * 2;
  if (waveform === 'square') return cycle < 0.5 ? 1 : -1;
  if (waveform === 'pulse') return cycle < 0.25 ? 1 : -1;
  if (waveform === 'sample-hold') return clamp(heldRandom, -1, 1, 0);
  if (waveform === 'noise') {
    const t = cycle * cycle * (3 - 2 * cycle);
    return clamp(heldRandom, -1, 1, 0) + (clamp(nextNoise, -1, 1, 0) - clamp(heldRandom, -1, 1, 0)) * t;
  }
  return Math.sin(cycle * Math.PI * 2);
}

export function rateToSlider(rateHz) {
  const rate = clamp(rateHz, LFO_MIN_RATE_HZ, LFO_MAX_RATE_HZ, 1);
  return Math.round(Math.log(rate / LFO_MIN_RATE_HZ) / Math.log(LFO_MAX_RATE_HZ / LFO_MIN_RATE_HZ) * 1000);
}

export function sliderToRate(value) {
  const position = clamp(value, 0, 1000, rateToSlider(1)) / 1000;
  return LFO_MIN_RATE_HZ * Math.pow(LFO_MAX_RATE_HZ / LFO_MIN_RATE_HZ, position);
}

export class LfoOscillator {
  constructor(source = {}) {
    this.enabled = false;
    this.moduleEnabled = true;
    this.waveform = 'sine';
    this.polarity = 'bipolar';
    this.invert = false;
    this.rateMode = 'free';
    this.syncDivision = '1/4';
    this.rateHz = 1;
    this.effectiveRateHz = 1;
    this.outputAmount = 100;
    this.effectiveOutputAmount = 100;
    this.phaseDegrees = 0;
    this.phaseOffset = 0;
    this.phase = 0;
    this.phaseOrigin = 0;
    this.phaseFrameCounter = 0;
    this.phaseSampleRate = 0;
    this.currentCycleIndex = 0;
    this.syncResetBeat = 0;
    this.seed = 0x6d2b79f5;
    this.randomState = this.seed;
    this.heldRandom = 0;
    this.nextNoise = 0;
    this.sampleValue = 0;
    this.configure(source);
  }

  nextRandomBipolar() {
    let value = this.randomState >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value >>> 0 || 1;
    return (this.randomState / 0xffffffff) * 2 - 1;
  }

  reset(clockBeat = 0) {
    this.phase = 0;
    this.phaseOrigin = this.phase;
    this.phaseFrameCounter = 0;
    this.phaseSampleRate = 0;
    this.syncResetBeat = Number.isFinite(clockBeat) ? clockBeat : 0;
    this.currentCycleIndex = Math.floor(this.phase);
    this.randomState = this.seed;
    this.heldRandom = this.nextRandomBipolar();
    this.nextNoise = this.nextRandomBipolar();
    this.sampleValue = this.readSample();
    return this.phase;
  }

  configure(source = {}) {
    const legacy = Object.keys(source).some(key => key.startsWith('lfo'));
    const previous = {
      enabled: this.enabled, waveform: this.waveform, rateHz: this.rateHz, rateMode: this.rateMode,
      syncDivision: this.syncDivision, polarity: this.polarity, phaseOffsetDeg: this.phaseDegrees,
      amount: 25, outputAmount: this.outputAmount, targetId: '', channel: 'both', invert: this.invert, seed: this.seed
    };
    const merged = legacy ? {
      ...previous,
      ...source,
      enabled: source.enabled ?? source.lfoEnabled ?? previous.enabled,
      waveform: source.waveform ?? source.lfoWaveform ?? previous.waveform,
      rateHz: source.rateHz ?? source.lfoRateHz ?? previous.rateHz,
      polarity: source.polarity ?? source.lfoPolarity ?? previous.polarity,
      phaseOffsetDeg: source.phaseOffsetDeg ?? source.lfoPhase ?? previous.phaseOffsetDeg,
      targetId: source.targetId ?? source.lfoTargetId ?? previous.targetId,
      amount: source.amount ?? source.lfoAmount ?? previous.amount,
      seed: source.seed ?? source.lfoSeed ?? previous.seed
    } : { ...previous, ...source };
    const next = normalizeLfoSourceState(merged);
    const moduleEnabled = source.lfoModuleEnabled ?? source.moduleEnabled;
    const wasEnabled = this.enabled;
    const phaseChanged = next.phaseOffsetDeg !== this.phaseDegrees;
    const rateChanged = next.rateHz !== this.rateHz || next.rateMode !== this.rateMode || next.syncDivision !== this.syncDivision;
    this.waveform = next.waveform;
    this.rateHz = next.rateHz;
    this.effectiveRateHz = next.rateHz;
    this.outputAmount = next.outputAmount;
    this.effectiveOutputAmount = next.outputAmount;
    this.rateMode = next.rateMode;
    this.syncDivision = next.syncDivision;
    this.polarity = next.polarity;
    this.invert = next.invert;
    this.phaseDegrees = next.phaseOffsetDeg;
    this.phaseOffset = next.phaseOffsetDeg / 360;
    this.seed = next.seed;
    if (moduleEnabled !== undefined) this.moduleEnabled = moduleEnabled === true;
    this.enabled = next.enabled;
    if (!wasEnabled && this.enabled) this.reset();
    else {
      if (phaseChanged && this.enabled) this.currentCycleIndex = Math.floor(this.phase);
      if (rateChanged && this.enabled) {
        this.phaseOrigin = this.phase;
        this.phaseFrameCounter = 0;
        this.phaseSampleRate = 0;
        this.currentCycleIndex = Math.floor(this.phaseOrigin);
      }
      if (!this.enabled || !this.moduleEnabled) this.sampleValue = 0;
    }
    return next;
  }

  readSample(phase = this.phase) {
    const raw = waveformSample(this.waveform, phase + this.phaseOffset, this.heldRandom, this.nextNoise);
    const polarityValue = this.polarity === 'unipolar' ? (raw + 1) / 2 : raw;
    return this.invert ? -polarityValue : polarityValue;
  }

  setEffectiveParameter(field, value) {
    if (field === 'outputAmount') this.effectiveOutputAmount = clamp(value, 0, 100, this.outputAmount);
    if (field !== 'rateHz') return;
    const next = clamp(value, LFO_MIN_RATE_HZ, LFO_MAX_RATE_HZ, this.rateHz);
    if (next === this.effectiveRateHz) return;
    // Re-anchor at the existing phase; changing frequency never resets the
    // oscillator or its seeded random stream. Sync divisions remain untouched.
    this.phaseOrigin = this.phase;
    this.phaseFrameCounter = 0;
    this.currentCycleIndex = Math.floor(this.phaseOrigin);
    this.effectiveRateHz = next;
  }

  advance(sampleRate, clockBeat = 0, clockRunning = true) {
    if (!this.enabled || !this.moduleEnabled) { this.sampleValue = 0; return 0; }
    const safeRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
    if (this.rateMode === 'sync') {
      if (!clockRunning) return this.sampleValue;
      const beatCount = Number.isFinite(clockBeat) ? clockBeat : 0;
      const beatsPerCycle = SYNC_DIVISION_BEATS[this.syncDivision] || 1;
      const unwrapped = (beatCount - this.syncResetBeat) / beatsPerCycle;
      const cycleIndex = Math.floor(unwrapped);
      this.phase = ((unwrapped - cycleIndex) % 1 + 1) % 1;
      if (cycleIndex !== this.currentCycleIndex) this.onCycleChange(cycleIndex);
      this.currentCycleIndex = cycleIndex;
      this.sampleValue = this.readSample();
      return this.sampleValue;
    }
    if (this.phaseSampleRate !== safeRate) {
      this.phaseOrigin = this.phase;
      this.phaseFrameCounter = 0;
      this.phaseSampleRate = safeRate;
      this.currentCycleIndex = Math.floor(this.phaseOrigin);
    }
    this.phaseFrameCounter += 1;
    const unwrappedPhase = this.phaseOrigin + this.phaseFrameCounter * this.effectiveRateHz / safeRate;
    const cycleIndex = Math.floor(unwrappedPhase);
    this.phase = unwrappedPhase - cycleIndex;
    if (cycleIndex !== this.currentCycleIndex) this.onCycleChange(cycleIndex);
    this.currentCycleIndex = cycleIndex;
    this.sampleValue = this.readSample();
    return this.sampleValue;
  }

  onCycleChange(cycleIndex) {
    if (this.waveform === 'sample-hold') this.heldRandom = this.nextRandomBipolar();
    if (this.waveform === 'noise') {
      this.heldRandom = this.nextNoise;
      this.nextNoise = this.nextRandomBipolar();
    }
    this.currentCycleIndex = cycleIndex;
  }
}
