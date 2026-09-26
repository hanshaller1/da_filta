(function () {
  const BAND_DEFINITIONS = Object.freeze([
    Object.freeze({ frequency: 29, label: '29 Hz' }),
    Object.freeze({ frequency: 61, label: '61 Hz' }),
    Object.freeze({ frequency: 115, label: '115 Hz' }),
    Object.freeze({ frequency: 218, label: '218 Hz' }),
    Object.freeze({ frequency: 411, label: '411 Hz' }),
    Object.freeze({ frequency: 777, label: '777 Hz' }),
    Object.freeze({ frequency: 1500, label: '1.5 kHz' }),
    Object.freeze({ frequency: 2800, label: '2.8 kHz' }),
    Object.freeze({ frequency: 5200, label: '5.2 kHz' }),
    Object.freeze({ frequency: 11000, label: '11 kHz' })
  ]);

  const BAND_COUNT = BAND_DEFINITIONS.length;
  const BAND_GAIN_MIN = -100;
  const BAND_GAIN_MAX = 100;
  const BAND_GAIN_NEUTRAL = 0;
  const SPREAD_CURVES = Object.freeze(['linear', 'quadratic', 'smoothstep']);
  const SPREAD_MAX_OFFSET_VALUES = Object.freeze([3, 6, 9, 12]);
  const GLOBAL_CONTROL_DEFINITIONS = Object.freeze({
    inputGain: Object.freeze({ min: 0, max: 24, step: 0.5, defaultValue: 0 }),
    inputCharacterAmount: Object.freeze({ min: 0, max: 100, step: 1, defaultValue: 50 }),
    resonance: Object.freeze({ min: -1, max: 1, step: 0.01, defaultValue: 0 }),
    dryWet: Object.freeze({ min: 0, max: 100, step: 1, defaultValue: 50 }),
    // SPREAD is stored as the concrete per-channel dB offset. Its live
    // min/max are synchronized with spreadMaxOffsetDb by the UI.
    spread: Object.freeze({ min: -6, max: 6, step: 0.1, defaultValue: 0 }),
    volume: Object.freeze({ min: -60, max: 0, step: 0.5, defaultValue: -6 })
  });

  const createArray = (value) => Array(BAND_COUNT).fill(value);
  const normalizeDynamicEqState = source => {
    const limited = (value, min, max, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    };
    return {
      dynamicEqEnabled: source?.dynamicEqEnabled === true,
      dynamicEqMode: ['cut', 'boost', 'balance'].includes(source?.dynamicEqMode) ? source.dynamicEqMode : 'cut',
      dynamicEqThresholdDb: limited(source?.dynamicEqThresholdDb, -60, 0, -24),
      dynamicEqWindowDb: limited(source?.dynamicEqWindowDb, 0, 12, 6),
      dynamicEqRangeDb: limited(source?.dynamicEqRangeDb, 0, 12, 6),
      dynamicEqCutRangeDb: limited(source?.dynamicEqCutRangeDb, 0, 12, limited(source?.dynamicEqRangeDb, 0, 12, 6)),
      dynamicEqBoostRangeDb: limited(source?.dynamicEqBoostRangeDb, 0, 12, limited(source?.dynamicEqRangeDb, 0, 12, 6)),
      dynamicEqStrength: limited(source?.dynamicEqStrength, 0, 100, 100),
      dynamicEqAttackMs: limited(source?.dynamicEqAttackMs, 1, 500, 30),
      dynamicEqReleaseMs: limited(source?.dynamicEqReleaseMs, 10, 2000, 250),
      dynamicEqDetectorMode: source?.dynamicEqDetectorMode === 'peak' ? 'peak' : 'rms',
      detectorReferenceMode: source?.detectorReferenceMode === 'REL' ? 'REL' : 'ABS',
      stereoDetectorMode: source?.stereoDetectorMode === 'DUAL' ? 'DUAL' : 'LINKED',
      learnedReferenceDb: Array.from({ length: BAND_COUNT }, (_, index) => limited(source?.learnedReferenceDb?.[index], -120, 12, -120)),
      learnedReferenceValid: source?.learnedReferenceValid === true,
      learnedReferenceFrozen: source?.learnedReferenceFrozen === true,
      dynamicEqBandSensitivity: Array.from({ length: BAND_COUNT }, (_, index) => limited(source?.dynamicEqBandSensitivity?.[index], 0, 100, 100))
    };
  };
  const clampBandGain = value => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return BAND_GAIN_NEUTRAL;
    return Math.min(BAND_GAIN_MAX, Math.max(BAND_GAIN_MIN, numericValue));
  };
  const controlToBandGainDb = (control, maxBandBoostDb = 12, maxBandCutDb = 12) => {
    const normalizedControl = clampBandGain(control) / BAND_GAIN_MAX;
    const boostDb = Number(maxBandBoostDb);
    const cutDb = Number(maxBandCutDb);
    const safeBoostDb = Number.isFinite(boostDb) ? boostDb : 12;
    const safeCutDb = Number.isFinite(cutDb) ? cutDb : 12;
    return normalizedControl >= 0 ? safeBoostDb * normalizedControl : safeCutDb * normalizedControl;
  };
  const clampSpread = (value, maxOffsetDb = 6) => {
    const numericValue = Number(value);
    const limit = normalizeSpreadMaxOffsetDb(maxOffsetDb);
    return Number.isFinite(numericValue) ? Math.min(limit, Math.max(-limit, numericValue)) : 0;
  };
  const normalizeBandGainLimit = (value, fallback = 12) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
  };
  const clampBandGainDb = (value, maxBandBoostDb = 12, maxBandCutDb = 12) => {
    const numericValue = Number(value);
    const boostDb = normalizeBandGainLimit(maxBandBoostDb);
    const cutDb = normalizeBandGainLimit(maxBandCutDb);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.min(boostDb, Math.max(-cutDb, numericValue));
  };
  const bandGainDbToControl = (value, maxBandBoostDb = 12, maxBandCutDb = 12) => {
    const gainDb = clampBandGainDb(value, maxBandBoostDb, maxBandCutDb);
    const limit = gainDb >= 0 ? normalizeBandGainLimit(maxBandBoostDb) : normalizeBandGainLimit(maxBandCutDb);
    return clampBandGain((gainDb / limit) * BAND_GAIN_MAX);
  };
  const normalizeSpreadCurve = value => SPREAD_CURVES.includes(value) ? value : 'linear';
  const FILTER_EXTRA_FIELDS = Object.freeze(['filterBellFrequencyHz', 'filterLowShelfFrequencyHz', 'filterHighShelfFrequencyHz', 'filterTiltPivotHz', 'filterBellWidth', 'filterLowShelfSlope', 'filterHighShelfSlope', 'filterTiltSlope', 'filterGainDb', 'filterLowShelfGainDb', 'filterHighShelfGainDb', 'filterTiltDb', 'filterFormantVowel', 'filterFormantShiftSemitones', 'filterFormantWidth', 'filterFormantAmount', 'filterBaxandallBassDb', 'filterBaxandallTrebleDb', 'filterBaxandallCenterHz', 'filterBaxandallSlope']);
  const normalizeFilterState = source => Object.freeze({
    filterType: window.FilterShape.normalizeFilterType(source?.filterType),
    filterFrequencyHz: window.FilterShape.normalizeFilterFrequencyHz(source?.filterFrequencyHz),
    filterSlope: window.FilterShape.normalizeFilterPercent(source?.filterSlope),
    filterBandwidth: window.FilterShape.normalizeFilterPercent(source?.filterBandwidth),
    filterResonance: window.FilterShape.normalizeFilterPercent(source?.filterResonance, 0),
    filterDepth: window.FilterShape.normalizeFilterPercent(source?.filterDepth, 100),
    filterBellFrequencyHz: window.FilterShape.normalizeFilterFrequencyHz(source?.filterBellFrequencyHz),
    filterLowShelfFrequencyHz: window.FilterShape.normalizeFilterFrequencyHz(source?.filterLowShelfFrequencyHz),
    filterHighShelfFrequencyHz: window.FilterShape.normalizeFilterFrequencyHz(source?.filterHighShelfFrequencyHz),
    filterTiltPivotHz: window.FilterShape.normalizeFilterFrequencyHz(source?.filterTiltPivotHz),
    filterBellWidth: window.FilterShape.normalizeFilterPercent(source?.filterBellWidth),
    filterLowShelfSlope: window.FilterShape.normalizeFilterPercent(source?.filterLowShelfSlope),
    filterHighShelfSlope: window.FilterShape.normalizeFilterPercent(source?.filterHighShelfSlope),
    filterTiltSlope: window.FilterShape.normalizeFilterPercent(source?.filterTiltSlope),
    filterGainDb: window.FilterShape.normalizeFilterDb(source?.filterGainDb, 24, 60),
    filterLowShelfGainDb: window.FilterShape.normalizeFilterDb(source?.filterLowShelfGainDb, 24, 60),
    filterHighShelfGainDb: window.FilterShape.normalizeFilterDb(source?.filterHighShelfGainDb, 24, 60),
    filterTiltDb: window.FilterShape.normalizeFilterDb(source?.filterTiltDb, 24, 60),
    filterFormantVowel: Math.min(4, Math.max(0, Number(source?.filterFormantVowel) || 0)),
    filterFormantShiftSemitones: window.FilterShape.normalizeFormantShiftSemitones(source?.filterFormantShiftSemitones),
    filterFormantWidth: window.FilterShape.normalizeFilterPercent(source?.filterFormantWidth),
    filterFormantAmount: window.FilterShape.normalizeFilterPercent(source?.filterFormantAmount, 70),
    filterBaxandallBassDb: window.FilterShape.normalizeFilterDb(source?.filterBaxandallBassDb, 24, 60),
    filterBaxandallTrebleDb: window.FilterShape.normalizeFilterDb(source?.filterBaxandallTrebleDb, 24, 60),
    filterBaxandallCenterHz: window.FilterShape.normalizeFilterFrequencyHz(source?.filterBaxandallCenterHz),
    filterBaxandallSlope: window.FilterShape.normalizeFilterPercent(source?.filterBaxandallSlope)
  });
  const normalizeSpreadMaxOffsetDb = value => SPREAD_MAX_OFFSET_VALUES.includes(Number(value)) ? Number(value) : 6;
  const bandGainDbToBipolarPercent = (value, maxBandBoostDb = 12, maxBandCutDb = 12) => {
    const gainDb = clampBandGainDb(value, maxBandBoostDb, maxBandCutDb);
    const limit = gainDb >= 0 ? normalizeBandGainLimit(maxBandBoostDb) : normalizeBandGainLimit(maxBandCutDb);
    return (gainDb / limit) * 100;
  };
  const getEffectiveBandGains = (targetState, index, options = {}) => {
    if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT) throw new RangeError('Ungültiger Bandindex.');
    const maxBandBoostDb = normalizeBandGainLimit(options.maxBandBoostDb, 12);
    const maxBandCutDb = normalizeBandGainLimit(options.maxBandCutDb, 12);
    const baseLeftDb = controlToBandGainDb(targetState?.bandGainLeft?.[index], maxBandBoostDb, maxBandCutDb);
    const baseRightDb = controlToBandGainDb(targetState?.bandGainRight?.[index], maxBandBoostDb, maxBandCutDb);
    const leftDb = clampBandGainDb(baseLeftDb, maxBandBoostDb, maxBandCutDb);
    const rightDb = clampBandGainDb(baseRightDb, maxBandBoostDb, maxBandCutDb);
    const leftControl = clampBandGain(targetState?.bandGainLeft?.[index]);
    const rightControl = clampBandGain(targetState?.bandGainRight?.[index]);
    return Object.freeze({
      baseLeftDb,
      baseRightDb,
      offsetDb: Math.abs(leftDb - rightDb) / 2,
      leftDb,
      rightDb,
      leftControl,
      rightControl
    });
  };
  const getBandGainArray = (targetState, channel) => {
    if (channel === 'left') return targetState.bandGainLeft;
    if (channel === 'right') return targetState.bandGainRight;
    throw new RangeError('Ungültiger Audiokanal.');
  };

  const createInitialState = () => ({
    activeMode: 'FB',
    selectedWorkspaceMode: 'filterbank',
    filterbankEnabled: true,
    filterEnabled: false,
    ...normalizeDynamicEqState(),
    filterType: 'lowpass',
    filterFrequencyHz: 777,
    filterSlope: 50,
    filterBandwidth: 50,
    filterResonance: 0,
    filterDepth: 100,
    filterBellFrequencyHz: 777,
    filterLowShelfFrequencyHz: 777,
    filterHighShelfFrequencyHz: 777,
    filterTiltPivotHz: 777,
    filterBellWidth: 50,
    filterLowShelfSlope: 50,
    filterHighShelfSlope: 50,
    filterTiltSlope: 50,
    filterGainDb: 0,
    filterLowShelfGainDb: 0,
    filterHighShelfGainDb: 0,
    filterTiltDb: 0,
    filterFormantVowel: 0,
    filterFormantShiftSemitones: 0,
    filterFormantWidth: 50,
    filterFormantAmount: 70,
    filterBaxandallBassDb: 0,
    filterBaxandallTrebleDb: 0,
    filterBaxandallCenterHz: 777,
    filterBaxandallSlope: 50,
    spreadMode: 'CLASSIC',
    channelSelection: 'LR',
    inputGain: GLOBAL_CONTROL_DEFINITIONS.inputGain.defaultValue,
    inputCharacterAmount: GLOBAL_CONTROL_DEFINITIONS.inputCharacterAmount.defaultValue,
    resonance: GLOBAL_CONTROL_DEFINITIONS.resonance.defaultValue,
    dryWet: GLOBAL_CONTROL_DEFINITIONS.dryWet.defaultValue,
    spread: GLOBAL_CONTROL_DEFINITIONS.spread.defaultValue,
    spreadCurve: 'linear',
    spreadMaxOffsetDb: 6,
    perChannelBands: false,
    bandChannelLinked: createArray(false),
    volume: GLOBAL_CONTROL_DEFINITIONS.volume.defaultValue,
    audioStatus: 'OFF',
    audioError: '',
    bandGainLeft: createArray(BAND_GAIN_NEUTRAL),
    bandGainRight: createArray(BAND_GAIN_NEUTRAL),
    feedbackBandLeft: createArray(false),
    feedbackBandRight: createArray(false),
    feedbackAllLeft: false,
    feedbackAllRight: false
  });

  const setBandBaseGain = (targetState, channel, index, value) => {
    if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT) throw new RangeError('Ungültiger Bandindex.');
    const nextValue = clampBandGain(value);
    getBandGainArray(targetState, channel)[index] = nextValue;
    return nextValue;
  };

  window.ResonantState = Object.freeze({
    BAND_DEFINITIONS,
    BAND_COUNT,
    BAND_GAIN_MIN,
    BAND_GAIN_MAX,
    BAND_GAIN_NEUTRAL,
    SPREAD_CURVES,
    SPREAD_MAX_OFFSET_VALUES,
    GLOBAL_CONTROL_DEFINITIONS,
    FILTER_EXTRA_FIELDS,
    clampBandGain,
    clampBandGainDb,
    clampSpread,
    bandGainDbToControl,
    bandGainDbToBipolarPercent,
    controlToBandGainDb,
    createInitialState,
    getEffectiveBandGains,
    normalizeSpreadCurve,
    normalizeSpreadMaxOffsetDb,
    normalizeFilterState,
    normalizeDynamicEqState,
    setBandBaseGain
  });
})();
