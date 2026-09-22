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
    spread: Object.freeze({ min: -1, max: 1, step: 0.01, defaultValue: 0 }),
    volume: Object.freeze({ min: -60, max: 0, step: 0.5, defaultValue: -6 })
  });

  const createArray = (value) => Array(BAND_COUNT).fill(value);
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
  const clampSpread = value => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.min(1, Math.max(-1, numericValue)) : 0;
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
  const normalizeSpreadMaxOffsetDb = value => SPREAD_MAX_OFFSET_VALUES.includes(Number(value)) ? Number(value) : 6;
  const spreadCurveValue = (magnitude, curve = 'linear') => {
    const m = Math.min(1, Math.max(0, Math.abs(Number(magnitude) || 0)));
    if (normalizeSpreadCurve(curve) === 'quadratic') return m * m;
    if (normalizeSpreadCurve(curve) === 'smoothstep') return m * m * (3 - 2 * m);
    return m;
  };
  const getEffectiveBandGains = (targetState, index, options = {}) => {
    if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT) throw new RangeError('Ungültiger Bandindex.');
    const maxBandBoostDb = normalizeBandGainLimit(options.maxBandBoostDb, 12);
    const maxBandCutDb = normalizeBandGainLimit(options.maxBandCutDb, 12);
    const baseLeftDb = controlToBandGainDb(targetState?.bandGainLeft?.[index], maxBandBoostDb, maxBandCutDb);
    const baseRightDb = controlToBandGainDb(targetState?.bandGainRight?.[index], maxBandBoostDb, maxBandCutDb);
    const spreadMode = options.spreadMode ?? targetState?.spreadMode ?? 'CLASSIC';
    const activeMode = options.activeMode ?? targetState?.activeMode ?? 'FB';
    const spread = activeMode === 'FB' && spreadMode === 'CLASSIC' ? clampSpread(options.spread ?? targetState?.spread) : 0;
    const offsetDb = spreadCurveValue(Math.abs(spread), options.spreadCurve ?? targetState?.spreadCurve)
      * normalizeSpreadMaxOffsetDb(options.spreadMaxOffsetDb ?? targetState?.spreadMaxOffsetDb);
    const leftOffsetDb = spread < 0 ? offsetDb : spread > 0 ? -offsetDb : 0;
    const rightOffsetDb = -leftOffsetDb;
    const leftDb = clampBandGainDb(baseLeftDb + leftOffsetDb, maxBandBoostDb, maxBandCutDb);
    const rightDb = clampBandGainDb(baseRightDb + rightOffsetDb, maxBandBoostDb, maxBandCutDb);
    // Keep the legacy control values byte-for-byte intact when CLASSIC SPREAD
    // is neutral or inactive. This makes the zero-spread DSP path identical to
    // the pre-spread handoff instead of merely mathematically equivalent.
    const leftControl = spread === 0 ? clampBandGain(targetState?.bandGainLeft?.[index]) : bandGainDbToControl(leftDb, maxBandBoostDb, maxBandCutDb);
    const rightControl = spread === 0 ? clampBandGain(targetState?.bandGainRight?.[index]) : bandGainDbToControl(rightDb, maxBandBoostDb, maxBandCutDb);
    return Object.freeze({
      baseLeftDb,
      baseRightDb,
      offsetDb,
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
    feedbackAllRight: false,
    modulated: createArray(false)
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
    clampBandGain,
    clampBandGainDb,
    clampSpread,
    bandGainDbToControl,
    controlToBandGainDb,
    createInitialState,
    getEffectiveBandGains,
    normalizeSpreadCurve,
    normalizeSpreadMaxOffsetDb,
    setBandBaseGain
  });
})();
