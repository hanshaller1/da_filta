import { timeCoefficient } from './dynamic-eq-core.mjs';
import { normalizeModulationAssignments } from './modulation-core.mjs';

export const ENVELOPE_DEFAULT_COUNT = 4;
export const ENVELOPE_DETECTOR_MODES = Object.freeze(['peak', 'rms']);
export const ENVELOPE_MIN_ATTACK_MS = 1;
export const ENVELOPE_MAX_ATTACK_MS = 500;
export const ENVELOPE_MIN_RELEASE_MS = 10;
export const ENVELOPE_MAX_RELEASE_MS = 3000;
export const ENVELOPE_MIN_SENSITIVITY = 0;
export const ENVELOPE_MAX_SENSITIVITY = 400;
export const ENVELOPE_MIN_THRESHOLD_DB = -60;
export const ENVELOPE_MAX_THRESHOLD_DB = 0;
export const ENVELOPE_DEFAULT_THRESHOLD_DB = -48;
export const ENVELOPE_MIN_DELAY_MS = 0;
export const ENVELOPE_MAX_DELAY_MS = 2000;

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

export function normalizeEnvelopeSourceState(source = {}, index = 0) {
  const id = `envelope.${index + 1}`;
  const assignments = normalizeModulationAssignments(Array.isArray(source.assignments) ? source.assignments : [{
    targetId: source.targetId, amount: clamp(source.amount, 0, 100, 50), channel: source.channel,
    invert: source.invert === true
  }], id);
  const first = assignments[0];
  return {
    id, assignments, outputAmount: clamp(source.outputAmount, 0, 100, 100),
    enabled: source.enabled === true,
    detectorMode: ENVELOPE_DETECTOR_MODES.includes(source.detectorMode) ? source.detectorMode : 'peak',
    attack: clamp(source.attack, ENVELOPE_MIN_ATTACK_MS, ENVELOPE_MAX_ATTACK_MS, 20),
    release: clamp(source.release, ENVELOPE_MIN_RELEASE_MS, ENVELOPE_MAX_RELEASE_MS, 250),
    delay: clamp(source.delay, ENVELOPE_MIN_DELAY_MS, ENVELOPE_MAX_DELAY_MS, 0),
    sensitivity: clamp(source.sensitivity, ENVELOPE_MIN_SENSITIVITY, ENVELOPE_MAX_SENSITIVITY, 100),
    thresholdDb: clamp(source.thresholdDb, ENVELOPE_MIN_THRESHOLD_DB, ENVELOPE_MAX_THRESHOLD_DB, ENVELOPE_DEFAULT_THRESHOLD_DB),
    amount: first?.amount ?? 0, targetId: first?.targetId ?? '',
    channel: first?.channel ?? 'both', invert: first?.invert ?? false
  };
}

export function normalizeEnvelopeSources(source = {}, requestedCount) {
  const supplied = Array.isArray(source.envelopeSources) ? source.envelopeSources : null;
  return Array.from({ length: ENVELOPE_DEFAULT_COUNT }, (_, index) => normalizeEnvelopeSourceState(supplied?.[index] || {}, index));
}

export function normalizeEnvelopeState(source = {}) {
  const envelopeSources = normalizeEnvelopeSources(source);
  return { envelopeCount: envelopeSources.length, envelopeSources };
}

export class EnvelopeFollower {
  constructor(source = {}) {
    this.sourceId = 'envelope.1';
    this.enabled = false;
    this.detectorMode = 'peak';
    this.attack = 20;
    this.release = 250;
    this.effectiveAttack = this.attack;
    this.effectiveRelease = this.release;
    this.outputAmount = 100;
    this.effectiveOutputAmount = 100;
    this.delay = 0;
    this.delaySamples = 0;
    this.delayRemainingSamples = 0;
    this.delayWaiting = false;
    this.delayActive = false;
    this.coefficientDelayMs = -1;
    this.sensitivity = 100;
    this.thresholdDb = ENVELOPE_DEFAULT_THRESHOLD_DB;
    this.thresholdLevel = 10 ** (this.thresholdDb / 20);
    this.rawLevel = 0;
    this.value = 0;
    this.sampleRate = 0;
    this.attackCoefficient = 0;
    this.releaseCoefficient = 0;
    this.coefficientAttackMs = -1;
    this.coefficientReleaseMs = -1;
    this.rmsSampleRate = 0;
    this.rmsWindow = new Float64Array(1);
    this.rmsWindowIndex = 0;
    this.rmsSamplesSeen = 0;
    this.rmsEnergy = 0;
    this.configure(source);
  }

  configure(source = {}) {
    const sourceIndex = /^envelope\.(\d+)$/.exec(source.id || 'envelope.1');
    const index = sourceIndex ? Math.max(0, Number(sourceIndex[1]) - 1) : 0;
    const state = normalizeEnvelopeSourceState(source, index);
    this.sourceId = typeof source.id === 'string' && /^envelope\.\d+$/.test(source.id) ? source.id : this.sourceId;
    const detectorChanged = state.detectorMode !== this.detectorMode;
    const disabled = this.enabled && !state.enabled;
    const delayChanged = state.delay !== this.delay;
    this.enabled = state.enabled;
    this.detectorMode = state.detectorMode;
    this.attack = state.attack;
    this.release = state.release;
    this.effectiveAttack = state.attack;
    this.effectiveRelease = state.release;
    this.outputAmount = state.outputAmount;
    this.effectiveOutputAmount = state.outputAmount;
    this.delay = state.delay;
    this.sensitivity = state.sensitivity;
    this.thresholdDb = state.thresholdDb;
    this.thresholdLevel = 10 ** (this.thresholdDb / 20);
    if (this.sampleRate > 0) this.updateTimeConstants(this.sampleRate);
    if (detectorChanged || disabled) this.reset();
    else if (delayChanged) this.resetDelay();
    return this;
  }

  updateTimeConstants(sampleRate) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return;
    const sampleRateChanged = sampleRate !== this.sampleRate;
    if (sampleRateChanged || this.effectiveAttack !== this.coefficientAttackMs || this.effectiveRelease !== this.coefficientReleaseMs) {
      this.sampleRate = sampleRate;
      this.coefficientAttackMs = this.effectiveAttack;
      this.coefficientReleaseMs = this.effectiveRelease;
      this.attackCoefficient = timeCoefficient(this.effectiveAttack, sampleRate);
      this.releaseCoefficient = timeCoefficient(this.effectiveRelease, sampleRate);
    }
    if (sampleRateChanged || this.delay !== this.coefficientDelayMs) {
      this.coefficientDelayMs = this.delay;
      this.delaySamples = Math.max(0, Math.round(this.delay * sampleRate / 1000));
    }
    if (this.detectorMode === 'rms' && sampleRate !== this.rmsSampleRate) {
      this.rmsSampleRate = sampleRate;
      this.rmsWindow = new Float64Array(Math.max(1, Math.round(sampleRate * 0.01)));
      this.rmsWindowIndex = 0;
      this.rmsSamplesSeen = 0;
      this.rmsEnergy = 0;
    }
  }

  setEffectiveParameter(field, value) {
    if (field === 'attack') this.effectiveAttack = clamp(value, 1, 500, this.attack);
    else if (field === 'release') this.effectiveRelease = clamp(value, 10, 3000, this.release);
    else if (field === 'outputAmount') this.effectiveOutputAmount = clamp(value, 0, 100, this.outputAmount);
    if (this.sampleRate > 0) this.updateTimeConstants(this.sampleRate);
  }

  process(left = 0, right = 0, sampleRate = this.sampleRate) {
    if (!this.enabled) return this.value;
    this.updateTimeConstants(sampleRate);
    const safeLeft = Number.isFinite(left) ? left : 0;
    const safeRight = Number.isFinite(right) ? right : 0;
    let detector;
    if (this.detectorMode === 'rms') {
      const energy = (safeLeft * safeLeft + safeRight * safeRight) * 0.5;
      this.rmsEnergy += energy - this.rmsWindow[this.rmsWindowIndex];
      this.rmsWindow[this.rmsWindowIndex] = energy;
      this.rmsWindowIndex = (this.rmsWindowIndex + 1) % this.rmsWindow.length;
      this.rmsSamplesSeen = Math.min(this.rmsWindow.length, this.rmsSamplesSeen + 1);
      detector = Math.sqrt(Math.max(0, this.rmsEnergy / this.rmsSamplesSeen));
    } else detector = Math.max(Math.abs(safeLeft), Math.abs(safeRight));
    // Sensitivity retains its original meaning: gain is applied to the
    // detector result first. Threshold compares that normalized result.
    this.rawLevel = Math.min(1, Math.max(0, detector * this.sensitivity / 100));
    let target = 0;
    if (this.rawLevel >= this.thresholdLevel) {
      if (this.delayActive) target = this.rawLevel;
      else if (this.delayWaiting) {
        if (this.delayRemainingSamples <= 1) {
          this.delayWaiting = false;
          this.delayRemainingSamples = 0;
          this.delayActive = true;
          target = this.rawLevel;
        } else this.delayRemainingSamples -= 1;
      } else if (this.delaySamples === 0) {
        this.delayActive = true;
        target = this.rawLevel;
      } else {
        this.delayWaiting = true;
        this.delayRemainingSamples = this.delaySamples;
      }
    } else {
      if (this.delayWaiting || this.delayActive) this.resetDelay();
    }
    const coefficient = target > this.value ? this.attackCoefficient : this.releaseCoefficient;
    const next = target + coefficient * (this.value - target);
    this.value = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0;
    return this.value;
  }

  reset() {
    this.value = 0;
    this.rawLevel = 0;
    this.resetDelay();
    this.rmsWindow.fill(0);
    this.rmsWindowIndex = 0;
    this.rmsSamplesSeen = 0;
    this.rmsEnergy = 0;
  }

  resetDelay() {
    this.delayRemainingSamples = 0;
    this.delayWaiting = false;
    this.delayActive = false;
  }
}
