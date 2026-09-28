import { timeCoefficient } from './dynamic-eq-core.mjs';

export const ENVELOPE_DEFAULT_COUNT = 1;
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

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

export function normalizeEnvelopeSourceState(source = {}, index = 0) {
  return {
    id: `envelope.${index + 1}`,
    enabled: source.enabled === true,
    detectorMode: ENVELOPE_DETECTOR_MODES.includes(source.detectorMode) ? source.detectorMode : 'peak',
    attack: clamp(source.attack, ENVELOPE_MIN_ATTACK_MS, ENVELOPE_MAX_ATTACK_MS, 20),
    release: clamp(source.release, ENVELOPE_MIN_RELEASE_MS, ENVELOPE_MAX_RELEASE_MS, 250),
    sensitivity: clamp(source.sensitivity, ENVELOPE_MIN_SENSITIVITY, ENVELOPE_MAX_SENSITIVITY, 100),
    thresholdDb: clamp(source.thresholdDb, ENVELOPE_MIN_THRESHOLD_DB, ENVELOPE_MAX_THRESHOLD_DB, ENVELOPE_DEFAULT_THRESHOLD_DB),
    amount: clamp(source.amount, 0, 100, 50),
    targetId: typeof source.targetId === 'string' ? source.targetId.trim() : '',
    channel: ['left', 'right', 'spread'].includes(source.channel) ? source.channel : 'both',
    invert: source.invert === true
  };
}

export function normalizeEnvelopeSources(source = {}, requestedCount) {
  const supplied = Array.isArray(source.envelopeSources) ? source.envelopeSources : null;
  const rawCount = requestedCount ?? source.envelopeCount ?? supplied?.length ?? ENVELOPE_DEFAULT_COUNT;
  const count = Math.max(1, Math.floor(clamp(rawCount, 1, 256, ENVELOPE_DEFAULT_COUNT)));
  return Array.from({ length: count }, (_, index) => normalizeEnvelopeSourceState(supplied?.[index] || {}, index));
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
    this.enabled = state.enabled;
    this.detectorMode = state.detectorMode;
    this.attack = state.attack;
    this.release = state.release;
    this.sensitivity = state.sensitivity;
    this.thresholdDb = state.thresholdDb;
    this.thresholdLevel = 10 ** (this.thresholdDb / 20);
    if (detectorChanged || disabled) this.reset();
    return this;
  }

  updateTimeConstants(sampleRate) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return;
    if (sampleRate !== this.sampleRate || this.attack !== this.coefficientAttackMs || this.release !== this.coefficientReleaseMs) {
      this.sampleRate = sampleRate;
      this.coefficientAttackMs = this.attack;
      this.coefficientReleaseMs = this.release;
      this.attackCoefficient = timeCoefficient(this.attack, sampleRate);
      this.releaseCoefficient = timeCoefficient(this.release, sampleRate);
    }
    if (this.detectorMode === 'rms' && sampleRate !== this.rmsSampleRate) {
      this.rmsSampleRate = sampleRate;
      this.rmsWindow = new Float64Array(Math.max(1, Math.round(sampleRate * 0.01)));
      this.rmsWindowIndex = 0;
      this.rmsSamplesSeen = 0;
      this.rmsEnergy = 0;
    }
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
    const target = this.rawLevel >= this.thresholdLevel ? this.rawLevel : 0;
    const coefficient = target > this.value ? this.attackCoefficient : this.releaseCoefficient;
    const next = target + coefficient * (this.value - target);
    this.value = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0;
    return this.value;
  }

  reset() {
    this.value = 0;
    this.rawLevel = 0;
    this.rmsWindow.fill(0);
    this.rmsWindowIndex = 0;
    this.rmsSamplesSeen = 0;
    this.rmsEnergy = 0;
  }
}
