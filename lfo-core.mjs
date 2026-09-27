export const LFO_WAVEFORMS = Object.freeze(['sine', 'triangle', 'saw-up', 'saw-down', 'square', 'sample-hold']);
export const LFO_MIN_RATE_HZ = 0.01;
export const LFO_MAX_RATE_HZ = 20;
const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

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
    lfoSeed: Number.isInteger(Number(source.lfoSeed)) ? (Number(source.lfoSeed) >>> 0) || 1 : 0x6d2b79f5
  };
}

export function waveformSample(waveform, phase, heldRandom = 0) {
  const cycle = ((Number.isFinite(phase) ? phase : 0) % 1 + 1) % 1;
  if (waveform === 'triangle') return 1 - 4 * Math.abs(cycle - 0.5);
  if (waveform === 'saw-up') return cycle * 2 - 1;
  if (waveform === 'saw-down') return 1 - cycle * 2;
  if (waveform === 'square') return cycle < 0.5 ? 1 : -1;
  if (waveform === 'sample-hold') return clamp(heldRandom, -1, 1, 0);
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
    this.waveform = 'sine';
    this.polarity = 'bipolar';
    this.rateHz = 1;
    this.phaseDegrees = 0;
    this.phaseOffset = 0;
    this.phase = 0;
    this.phaseOrigin = 0;
    this.phaseFrameCounter = 0;
    this.phaseSampleRate = 0;
    this.currentCycleIndex = 0;
    this.seed = 0x6d2b79f5;
    this.randomState = this.seed;
    this.heldRandom = 0;
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

  reset() {
    this.phase = 0;
    this.phaseOrigin = this.phase;
    this.phaseFrameCounter = 0;
    this.phaseSampleRate = 0;
    this.currentCycleIndex = Math.floor(this.phase + this.phaseOffset);
    this.randomState = this.seed;
    this.heldRandom = this.nextRandomBipolar();
    this.sampleValue = this.readSample();
    return this.phase;
  }

  configure(source = {}) {
    const next = normalizeLfoState({
      lfoEnabled: this.enabled,
      lfoWaveform: this.waveform,
      lfoRateHz: this.rateHz,
      lfoPolarity: this.polarity,
      lfoPhase: this.phaseDegrees,
      lfoSeed: this.seed,
      ...source
    });
    const wasEnabled = this.enabled;
    const phaseChanged = next.lfoPhase !== this.phaseDegrees;
    const rateChanged = next.lfoRateHz !== this.rateHz;
    this.waveform = next.lfoWaveform;
    this.rateHz = next.lfoRateHz;
    this.polarity = next.lfoPolarity;
    this.phaseDegrees = next.lfoPhase;
    this.phaseOffset = next.lfoPhase / 360;
    this.seed = next.lfoSeed;
    if (!wasEnabled && next.lfoEnabled) {
      this.enabled = true;
      this.reset();
    } else {
      this.enabled = next.lfoEnabled;
      if (phaseChanged && this.enabled) {
        this.currentCycleIndex = Math.floor(this.phase + this.phaseOffset);
      }
      if (rateChanged && this.enabled) {
        this.phaseOrigin = this.phase;
        this.phaseFrameCounter = 0;
        this.phaseSampleRate = 0;
        this.currentCycleIndex = Math.floor(this.phase + this.phaseOffset);
      }
      if (!this.enabled) this.sampleValue = 0;
    }
    return next;
  }

  readSample() {
    const bipolar = waveformSample(this.waveform, this.phase + this.phaseOffset, this.heldRandom);
    return this.polarity === 'unipolar' ? (bipolar + 1) / 2 : bipolar;
  }

  advance(sampleRate) {
    if (!this.enabled) {
      this.sampleValue = 0;
      return 0;
    }
    const safeRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
    if (this.phaseSampleRate !== safeRate) {
      this.phaseOrigin = this.phase;
      this.phaseFrameCounter = 0;
      this.phaseSampleRate = safeRate;
      this.currentCycleIndex = Math.floor(this.phaseOrigin + this.phaseOffset);
    }
    this.phaseFrameCounter += 1;
    const unwrappedPhase = this.phaseOrigin + this.phaseFrameCounter * this.rateHz / safeRate;
    const cycleIndex = Math.floor(unwrappedPhase + this.phaseOffset);
    this.phase = unwrappedPhase - cycleIndex;
    if (cycleIndex !== this.currentCycleIndex) {
      if (this.waveform === 'sample-hold') this.heldRandom = this.nextRandomBipolar();
      this.currentCycleIndex = cycleIndex;
    }
    this.sampleValue = this.readSample();
    return this.sampleValue;
  }
}
