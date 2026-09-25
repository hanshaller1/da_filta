export const DYNAMIC_EQ_DEFAULTS = Object.freeze({
  dynamicEqEnabled: false,
  dynamicEqMode: 'cut',
  dynamicEqThresholdDb: -24,
  dynamicEqWindowDb: 6,
  dynamicEqRangeDb: 6,
  dynamicEqStrength: 100,
  dynamicEqAttackMs: 30,
  dynamicEqReleaseMs: 250,
  dynamicEqDetectorMode: 'rms'
});

export function clampParameter(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeDynamicEq(source = {}, bandCount = 10) {
  const mode = ['cut', 'boost', 'balance'].includes(source.dynamicEqMode) ? source.dynamicEqMode : 'cut';
  return {
    dynamicEqEnabled: source.dynamicEqEnabled === true,
    dynamicEqMode: mode,
    dynamicEqThresholdDb: clampParameter(source.dynamicEqThresholdDb, -60, 0, -24),
    dynamicEqWindowDb: clampParameter(source.dynamicEqWindowDb, 0, 12, 6),
    dynamicEqRangeDb: clampParameter(source.dynamicEqRangeDb, 0, 12, 6),
    dynamicEqStrength: clampParameter(source.dynamicEqStrength, 0, 100, 100),
    dynamicEqAttackMs: clampParameter(source.dynamicEqAttackMs, 1, 500, 30),
    dynamicEqReleaseMs: clampParameter(source.dynamicEqReleaseMs, 10, 2000, 250),
    dynamicEqDetectorMode: source.dynamicEqDetectorMode === 'peak' ? 'peak' : 'rms',
    dynamicEqBandSensitivity: Array.from({ length: bandCount }, (_, i) =>
      clampParameter(source.dynamicEqBandSensitivity?.[i], 0, 100, 100))
  };
}

export function targetGainDb(levelDb, settings, sensitivity = 100) {
  if (sensitivity <= 0 || settings.dynamicEqStrength <= 0 || settings.dynamicEqRangeDb <= 0) return 0;
  const upper = settings.dynamicEqThresholdDb + settings.dynamicEqWindowDb / 2;
  const lower = settings.dynamicEqThresholdDb - settings.dynamicEqWindowDb / 2;
  if (settings.dynamicEqMode !== 'boost' && levelDb > upper)
    return -Math.min(settings.dynamicEqRangeDb, (levelDb - upper) * settings.dynamicEqStrength / 100) * sensitivity / 100;
  if (settings.dynamicEqMode !== 'cut' && levelDb < lower)
    return Math.min(settings.dynamicEqRangeDb, (lower - levelDb) * settings.dynamicEqStrength / 100) * sensitivity / 100;
  return 0;
}

export function smoothGain(current, target, attackCoefficient, releaseCoefficient) {
  // A sign change first releases to zero; the opposite correction attacks on later samples.
  if (current * target < 0) target = 0;
  const coefficient = Math.abs(target) > Math.abs(current) ? attackCoefficient : releaseCoefficient;
  const result = target + coefficient * (current - target);
  return Number.isFinite(result) && Math.abs(result) >= 1e-4 ? result : 0;
}

export function timeCoefficient(milliseconds, sampleRate) {
  return Math.exp(-1 / (Math.max(0.001, milliseconds) * 0.001 * sampleRate));
}
