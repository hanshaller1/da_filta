export const DYNAMIC_EQ_DEFAULTS = Object.freeze({
  dynamicEqEnabled: false,
  dynamicEqMode: 'cut',
  dynamicEqThresholdDb: -24,
  dynamicEqWindowDb: 6,
  dynamicEqRangeDb: 6,
  dynamicEqCutRangeDb: 6,
  dynamicEqBoostRangeDb: 6,
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
    dynamicEqCutRangeDb: clampParameter(source.dynamicEqCutRangeDb, 0, 12, clampParameter(source.dynamicEqRangeDb, 0, 12, 6)),
    dynamicEqBoostRangeDb: clampParameter(source.dynamicEqBoostRangeDb, 0, 12, clampParameter(source.dynamicEqRangeDb, 0, 12, 6)),
    dynamicEqStrength: clampParameter(source.dynamicEqStrength, 0, 100, 100),
    dynamicEqAttackMs: clampParameter(source.dynamicEqAttackMs, 1, 500, 30),
    dynamicEqReleaseMs: clampParameter(source.dynamicEqReleaseMs, 10, 2000, 250),
    dynamicEqDetectorMode: source.dynamicEqDetectorMode === 'peak' ? 'peak' : 'rms',
    detectorReferenceMode: source.detectorReferenceMode === 'REL' ? 'REL' : 'ABS',
    stereoDetectorMode: source.stereoDetectorMode === 'DUAL' ? 'DUAL' : 'LINKED',
    learnedReferenceDb: Array.from({ length: bandCount }, (_, i) => clampParameter(source.learnedReferenceDb?.[i], -120, 12, -120)),
    learnedReferenceValid: source.learnedReferenceValid === true,
    learnedReferenceFrozen: source.learnedReferenceFrozen === true,
    dynamicEqBandSensitivity: Array.from({ length: bandCount }, (_, i) =>
      clampParameter(source.dynamicEqBandSensitivity?.[i], 0, 100, 100))
  };
}

export function localSpectralReferenceDb(levels, band, frequencies = null, precomputedWeights = null) {
  let sum = 0;
  let weights = 0;
  for (let offset = -2; offset <= 2; offset += 1) {
    if (!offset) continue;
    const neighbor = band + offset;
    if (neighbor < 0 || neighbor >= levels.length) continue;
    let weight;
    if (precomputedWeights) weight = precomputedWeights[band][neighbor];
    else {
      const logDistance = frequencies?.[neighbor] > 0 && frequencies?.[band] > 0
        ? Math.abs(Math.log(frequencies[neighbor] / frequencies[band]))
        : Math.abs(offset);
      weight = 1 / Math.max(0.01, logDistance);
    }
    sum += levels[neighbor] * weight;
    weights += weight;
  }
  return weights ? sum / weights : levels[band];
}

export function targetGainDb(levelDb, settings, sensitivity = 100, band = -1, levels = null, frequencies = null, precomputedWeights = null) {
  const mode = settings.dynamicEqMode;
  const legacyRangeOverride = settings.dynamicEqCutRangeDb === settings.dynamicEqBoostRangeDb
    && settings.dynamicEqRangeDb !== settings.dynamicEqCutRangeDb;
  const cutRange = legacyRangeOverride ? settings.dynamicEqRangeDb : settings.dynamicEqCutRangeDb ?? settings.dynamicEqRangeDb;
  const boostRange = legacyRangeOverride ? settings.dynamicEqRangeDb : settings.dynamicEqBoostRangeDb ?? settings.dynamicEqRangeDb;
  if (sensitivity <= 0 || settings.dynamicEqStrength <= 0 || (mode === 'boost' ? boostRange : mode === 'cut' ? cutRange : Math.max(cutRange, boostRange)) <= 0) return 0;
  let comparedDb = levelDb;
  let centerDb = settings.dynamicEqThresholdDb;
  if (settings.detectorReferenceMode === 'REL') {
    comparedDb = settings.learnedReferenceValid && band >= 0
      ? levelDb - settings.learnedReferenceDb[band]
      : levelDb - localSpectralReferenceDb(levels || [levelDb], Math.max(0, band), frequencies, precomputedWeights);
    centerDb = 0;
  }
  const upper = centerDb + settings.dynamicEqWindowDb / 2;
  const lower = centerDb - settings.dynamicEqWindowDb / 2;
  if (settings.dynamicEqMode !== 'boost' && comparedDb > upper)
    return -Math.min(cutRange, (comparedDb - upper) * settings.dynamicEqStrength / 100) * sensitivity / 100;
  if (settings.dynamicEqMode !== 'cut' && comparedDb < lower)
    return Math.min(boostRange, (lower - comparedDb) * settings.dynamicEqStrength / 100) * sensitivity / 100;
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
