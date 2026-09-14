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
  const GLOBAL_CONTROL_DEFINITIONS = Object.freeze({
    inputGain: Object.freeze({ min: 0, max: 24, step: 1, defaultValue: 0 }),
    resonance: Object.freeze({ min: -1, max: 1, step: 0.01, defaultValue: 0 }),
    dryWet: Object.freeze({ min: 0, max: 100, step: 1, defaultValue: 50 }),
    spread: Object.freeze({ min: -1, max: 1, step: 0.01, defaultValue: 0 }),
    volume: Object.freeze({ min: -60, max: 0, step: 1, defaultValue: -6 })
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
    resonance: GLOBAL_CONTROL_DEFINITIONS.resonance.defaultValue,
    dryWet: GLOBAL_CONTROL_DEFINITIONS.dryWet.defaultValue,
    spread: GLOBAL_CONTROL_DEFINITIONS.spread.defaultValue,
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
    GLOBAL_CONTROL_DEFINITIONS,
    clampBandGain,
    controlToBandGainDb,
    createInitialState,
    setBandBaseGain
  });
})();
