(function () {
  const FILTER_TYPE_DEFINITIONS = Object.freeze([
    { id: 'lowpass', displayName: 'LOW PASS', shortName: 'LP', category: 'CLASSIC', primary: 'frequency', secondary: ['slope', 'resonance', 'widthDisabled', 'depth'], marker: 'frequency', descriptor: '10-BAND CONTROL SHAPE' },
    { id: 'highpass', displayName: 'HIGH PASS', shortName: 'HP', category: 'CLASSIC', primary: 'frequency', secondary: ['slope', 'resonance', 'widthDisabled', 'depth'], marker: 'frequency', descriptor: '10-BAND CONTROL SHAPE' },
    { id: 'bandpass', displayName: 'BAND PASS', shortName: 'BP', category: 'CLASSIC', primary: 'frequency', secondary: ['slope', 'resonance', 'width', 'depth'], marker: 'frequency', descriptor: '10-BAND CONTROL SHAPE' },
    { id: 'notch', displayName: 'NOTCH', shortName: 'NOTCH', category: 'CLASSIC', primary: 'frequency', secondary: ['slope', 'resonance', 'width', 'depth'], marker: 'frequency', descriptor: '10-BAND CONTROL SHAPE' },
    { id: 'bell', displayName: 'PEAK / BELL', shortName: 'BELL', category: 'EQ / TONE', primary: 'bellFrequency', secondary: ['gain', 'bellWidth', 'disabled', 'disabled'], marker: 'bellFrequency', descriptor: 'BELL SHAPE' },
    { id: 'lowshelf', displayName: 'LOW SHELF', shortName: 'LOW', category: 'EQ / TONE', primary: 'lowShelfFrequency', secondary: ['lowShelfGain', 'lowShelfSlope', 'disabled', 'disabled'], marker: 'lowShelfFrequency', descriptor: 'SHELF SHAPE' },
    { id: 'highshelf', displayName: 'HIGH SHELF', shortName: 'HIGH', category: 'EQ / TONE', primary: 'highShelfFrequency', secondary: ['highShelfGain', 'highShelfSlope', 'disabled', 'disabled'], marker: 'highShelfFrequency', descriptor: 'SHELF SHAPE' },
    { id: 'tilt', displayName: 'TILT', shortName: 'TILT', category: 'EQ / TONE', primary: 'pivot', secondary: ['tilt', 'tiltSlope', 'disabled', 'disabled'], marker: 'pivot', descriptor: 'TILT SHAPE' },
    { id: 'baxandall', displayName: 'BAXANDALL / TONE', shortName: 'TONE', category: 'EQ / TONE', primary: 'toneCenter', secondary: ['bass', 'treble', 'toneSlope', 'disabled'], marker: 'toneCenter', descriptor: 'BASS / TREBLE TONE SHAPE' },
    { id: 'formant', displayName: 'FORMANT / VOWEL', shortName: 'VOWEL', category: 'FORMANT', primary: 'vowel', secondary: ['shift', 'formantWidth', 'amount', 'disabled'], marker: 'formants', descriptor: '3-FORMANT VOWEL SHAPE' }
  ].map(definition => Object.freeze({ ...definition, secondary: Object.freeze(definition.secondary) })));
  const FILTER_TYPES = Object.freeze(FILTER_TYPE_DEFINITIONS.map(definition => definition.id));
  const FORMANT_SHIFT_MIN_SEMITONES = -36;
  const FORMANT_SHIFT_MAX_SEMITONES = 24;
  const FILTER_CONTROL_DEFINITIONS = Object.freeze({
    frequency: { label: 'FREQUENCY', field: 'filterFrequencyHz', min: 0, max: 1000, step: 1, format: 'frequency' },
    bellFrequency: { label: 'FREQUENCY', field: 'filterBellFrequencyHz', min: 0, max: 1000, step: 1, format: 'frequency' },
    lowShelfFrequency: { label: 'FREQUENCY', field: 'filterLowShelfFrequencyHz', min: 0, max: 1000, step: 1, format: 'frequency' },
    highShelfFrequency: { label: 'FREQUENCY', field: 'filterHighShelfFrequencyHz', min: 0, max: 1000, step: 1, format: 'frequency' },
    pivot: { label: 'PIVOT', field: 'filterTiltPivotHz', min: 0, max: 1000, step: 1, format: 'frequency' },
    toneCenter: { label: 'TONE CENTER', field: 'filterBaxandallCenterHz', min: 0, max: 1000, step: 1, format: 'frequency' },
    vowel: { label: 'VOWEL', field: 'filterFormantVowel', min: 0, max: 4, step: 0.01, format: 'vowel' },
    slope: { label: 'SLOPE', field: 'filterSlope', min: 0, max: 100, step: 1, format: 'percent' },
    resonance: { label: 'RESONANCE', field: 'filterResonance', min: 0, max: 100, step: 1, format: 'percent' },
    width: { label: 'WIDTH', field: 'filterBandwidth', min: 0, max: 100, step: 1, format: 'percent' },
    widthDisabled: { label: 'WIDTH', field: 'filterBandwidth', min: 0, max: 100, step: 1, format: 'percent', disabled: true },
    bellWidth: { label: 'WIDTH', field: 'filterBellWidth', min: 0, max: 100, step: 1, format: 'percent' },
    lowShelfSlope: { label: 'SLOPE', field: 'filterLowShelfSlope', min: 0, max: 100, step: 1, format: 'percent' },
    highShelfSlope: { label: 'SLOPE', field: 'filterHighShelfSlope', min: 0, max: 100, step: 1, format: 'percent' },
    tiltSlope: { label: 'SLOPE', field: 'filterTiltSlope', min: 0, max: 100, step: 1, format: 'percent' },
    depth: { label: 'DEPTH', field: 'filterDepth', min: 0, max: 100, step: 1, format: 'percent' },
    gain: { label: 'GAIN', field: 'filterGainDb', min: 'cut', max: 'boost', step: 0.1, format: 'db' },
    lowShelfGain: { label: 'GAIN', field: 'filterLowShelfGainDb', min: 'cut', max: 'boost', step: 0.1, format: 'db' },
    highShelfGain: { label: 'GAIN', field: 'filterHighShelfGainDb', min: 'cut', max: 'boost', step: 0.1, format: 'db' },
    tilt: { label: 'TILT', field: 'filterTiltDb', min: 'cut', max: 'boost', step: 0.1, format: 'db' },
    shift: { label: 'SHIFT', field: 'filterFormantShiftSemitones', min: FORMANT_SHIFT_MIN_SEMITONES, max: FORMANT_SHIFT_MAX_SEMITONES, step: 0.1, format: 'semitones' },
    formantWidth: { label: 'WIDTH', field: 'filterFormantWidth', min: 0, max: 100, step: 1, format: 'percent' },
    amount: { label: 'AMOUNT', field: 'filterFormantAmount', min: 0, max: 100, step: 1, format: 'percent' },
    bass: { label: 'BASS', field: 'filterBaxandallBassDb', min: 'cut', max: 'boost', step: 0.1, format: 'db' },
    treble: { label: 'TREBLE', field: 'filterBaxandallTrebleDb', min: 'cut', max: 'boost', step: 0.1, format: 'db' },
    toneSlope: { label: 'SLOPE', field: 'filterBaxandallSlope', min: 0, max: 100, step: 1, format: 'percent' },
    disabled: { label: '—', field: null, min: 0, max: 100, step: 1, format: 'percent' }
  });
  const FORMANT_VOWELS = Object.freeze(['A', 'E', 'I', 'O', 'U']);
  const FORMANT_FREQUENCIES = Object.freeze([[800, 1150, 2900], [400, 1700, 2600], [350, 2000, 2800], [450, 800, 2830], [325, 700, 2530]]);
  const FREQUENCY_MIN_HZ = 29;
  const FREQUENCY_MAX_HZ = 11000;

  const clamp = (value, minimum, maximum, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
  };
  const clamp01 = value => clamp(value, 0, 1, 0);
  const smoothstep01 = value => {
    const x = clamp01(value);
    return x * x * (3 - 2 * x);
  };
  const normalizeFilterType = value => FILTER_TYPES.includes(value) ? value : 'lowpass';
  const normalizeFilterFrequencyHz = value => clamp(value, FREQUENCY_MIN_HZ, FREQUENCY_MAX_HZ, 777);
  const normalizeFilterPercent = (value, fallback = 50) => clamp(value, 0, 100, fallback);
  const normalizeFormantShiftSemitones = value => clamp(
    value, FORMANT_SHIFT_MIN_SEMITONES, FORMANT_SHIFT_MAX_SEMITONES, 0
  );
  const safeLimit = (value, fallback = 12) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  const normalizeFilterDb = (value, boost = 12, cut = 12) => clamp(value, -safeLimit(cut), safeLimit(boost), 0);
  const octave = frequency => Math.log2(Math.max(1, Number(frequency) || FREQUENCY_MIN_HZ));
  const formantCenters = (vowel = 0, shiftSemitones = 0) => {
    const position = clamp(vowel, 0, 4, 0);
    const first = Math.floor(position);
    const next = Math.min(4, first + 1);
    const t = position - first;
    const shift = Math.pow(2, normalizeFormantShiftSemitones(shiftSemitones) / 12);
    return FORMANT_FREQUENCIES[first].map((frequency, index) => Math.pow(frequency, 1 - t) * Math.pow(FORMANT_FREQUENCIES[next][index], t) * shift);
  };
  const frequencyToSlider = value => Math.round(
    Math.log(normalizeFilterFrequencyHz(value) / FREQUENCY_MIN_HZ)
      / Math.log(FREQUENCY_MAX_HZ / FREQUENCY_MIN_HZ) * 1000
  );
  const sliderToFrequency = value => {
    const t = clamp(value, 0, 1000, frequencyToSlider(777)) / 1000;
    return FREQUENCY_MIN_HZ * Math.pow(FREQUENCY_MAX_HZ / FREQUENCY_MIN_HZ, t);
  };
  const transitionOctavesForSlope = slope => 3 - 2.75 * (normalizeFilterPercent(slope) / 100);
  const bandwidthOctavesForPercent = bandwidth => 0.5 + 5.5 * (normalizeFilterPercent(bandwidth) / 100);
  const lowpassWeightAt = (x, cutoff, transitionOctaves) => {
    const edgeLow = cutoff - transitionOctaves / 2;
    return 1 - smoothstep01((x - edgeLow) / transitionOctaves);
  };
  const highpassWeightAt = (x, cutoff, transitionOctaves) => 1 - lowpassWeightAt(x, cutoff, transitionOctaves);
  const gaussianAt = (x, center, width) => {
    const normalizedDistance = (x - center) / Math.max(0.01, width);
    return Math.exp(-0.5 * normalizedDistance * normalizedDistance);
  };

  const createClassicFilterShape = ({
    type = 'lowpass',
    frequencyHz = 777,
    slope = 50,
    bandwidth = 50,
    resonance = 0,
    depth = 100,
    bandDefinitions = [],
    maxBandBoostDb = 12,
    maxBandCutDb = 12
  } = {}) => {
    const normalizedType = type;
    const cutoff = Math.log2(normalizeFilterFrequencyHz(frequencyHz));
    const transitionOctaves = transitionOctavesForSlope(slope);
    const bandwidthOctaves = bandwidthOctavesForPercent(bandwidth);
    const lowerEdge = cutoff - bandwidthOctaves / 2;
    const upperEdge = cutoff + bandwidthOctaves / 2;
    const depthAmount = normalizeFilterPercent(depth, 100) / 100;
    const resonanceAmount = Math.pow(normalizeFilterPercent(resonance, 0) / 100, 1.35);
    const resonanceWidth = Math.min(0.7, Math.max(0.16, transitionOctaves * 0.22));
    const boostDb = Math.max(0, Number.isFinite(Number(maxBandBoostDb)) ? Number(maxBandBoostDb) : 12);
    const cutDb = Math.max(0, Number.isFinite(Number(maxBandCutDb)) ? Number(maxBandCutDb) : 12);

    return bandDefinitions.map(definition => {
      const frequency = Number(definition?.frequency ?? definition);
      const x = Math.log2(Math.max(FREQUENCY_MIN_HZ, Math.min(FREQUENCY_MAX_HZ, frequency)));
      const lowpass = lowpassWeightAt(x, cutoff, transitionOctaves);
      const highpass = 1 - lowpass;
      const bandShape = highpassWeightAt(x, lowerEdge, transitionOctaves)
        * lowpassWeightAt(x, upperEdge, transitionOctaves);
      const passWeight = normalizedType === 'lowpass'
        ? lowpass
        : normalizedType === 'highpass'
          ? highpass
          : normalizedType === 'bandpass'
            ? bandShape
            : 1 - bandShape;
      const cutGainDb = -cutDb * (1 - clamp01(passWeight)) * depthAmount;
      const resonanceProfile = normalizedType === 'notch'
        ? Math.max(gaussianAt(x, lowerEdge, resonanceWidth), gaussianAt(x, upperEdge, resonanceWidth))
        : gaussianAt(x, cutoff, normalizedType === 'bandpass' ? Math.max(resonanceWidth, bandwidthOctaves * 0.12) : resonanceWidth);
      // At full resonance, the profile center can reach maxBandBoostDb even
      // when it sits on a partially attenuated filter edge. DEPTH therefore
      // controls only the cut while resonance remains an independent layer.
      const resonanceGainDb = resonanceProfile * resonanceAmount * (boostDb + Math.max(0, -cutGainDb));
      const gainDb = cutGainDb + resonanceGainDb;
      return Math.min(boostDb, Math.max(-cutDb, Number.isFinite(gainDb) ? gainDb : -cutDb));
    });
  };

  const createFilterShape = (options = {}) => {
    const type = normalizeFilterType(options.type);
    if (['lowpass', 'highpass', 'bandpass', 'notch'].includes(type)) return createClassicFilterShape({ ...options, type });
    const boost = safeLimit(options.maxBandBoostDb);
    const cut = safeLimit(options.maxBandCutDb);
    const gain = value => normalizeFilterDb(value, boost, cut);
    const frequency = normalizeFilterFrequencyHz(options.frequencyHz);
    const slope = normalizeFilterPercent(options.slope);
    const width = normalizeFilterPercent(options.bandwidth);
    const center = octave(frequency);
    const bellWidth = 0.25 + width / 100 * 3.75;
    const transition = transitionOctavesForSlope(slope);
    const formants = formantCenters(options.formantVowel, options.formantShiftSemitones);
    const formantWidth = 0.18 + (normalizeFilterPercent(options.formantWidth) / 100) * 0.44;
    const formantAmount = normalizeFilterPercent(options.formantAmount, 70) / 100;
    const toneCenter = octave(normalizeFilterFrequencyHz(options.baxandallCenterHz));
    const toneTransition = 2.5 + (100 - normalizeFilterPercent(options.baxandallSlope)) / 100 * 2;
    const rangeLow = octave(FREQUENCY_MIN_HZ);
    const rangeHigh = octave(FREQUENCY_MAX_HZ);
    const profiles = {
      bell: x => gain(options.gainDb) * gaussianAt(x, center, bellWidth / 2.355),
      lowshelf: x => gain(options.lowShelfGainDb) * lowpassWeightAt(x, center, transition),
      highshelf: x => gain(options.highShelfGainDb) * highpassWeightAt(x, center, transition),
      tilt: x => {
        const tilt = gain(options.tiltDb);
        if (tilt === 0) return 0;
        const distance = x - center;
        const available = distance < 0 ? Math.max(.01, center - rangeLow) : Math.max(.01, rangeHigh - center);
        const normalized = Math.min(1, Math.abs(distance) / available);
        const curvature = 0.5 + (100 - slope) / 100 * 1.5;
        return tilt * Math.sign(distance) * Math.pow(normalized, curvature);
      },
      formant: x => {
        const peak = formants.reduce((sum, formant, index) => sum + [1, .8, .65][index] * gaussianAt(x, octave(formant), formantWidth), 0);
        return boost * formantAmount * Math.min(1, peak);
      },
      baxandall: x => gain(options.baxandallBassDb) * lowpassWeightAt(x, toneCenter - 1, toneTransition)
        + gain(options.baxandallTrebleDb) * highpassWeightAt(x, toneCenter + 1, toneTransition)
    };
    return (options.bandDefinitions || []).map(definition => {
      const x = octave(definition?.frequency ?? definition);
      const value = profiles[type](x);
      return Math.max(-cut, Math.min(boost, Number.isFinite(value) ? value : 0));
    });
  };

  const shapeParametersFromState = source => {
    const type = normalizeFilterType(source.filterType);
    const definition = FILTER_TYPE_DEFINITIONS.find(candidate => candidate.id === type);
    const primary = FILTER_CONTROL_DEFINITIONS[definition.primary];
    const secondary = definition.secondary.map(key => FILTER_CONTROL_DEFINITIONS[key]);
    const slope = secondary.find(control => control.label === 'SLOPE');
    const width = secondary.find(control => control.label === 'WIDTH');
    return {
      type,
      frequencyHz: primary.format === 'frequency' ? source[primary.field] : source.filterFrequencyHz,
      slope: slope?.field ? source[slope.field] : source.filterSlope,
      bandwidth: width?.field ? source[width.field] : source.filterBandwidth,
      resonance: source.filterResonance,
      depth: source.filterDepth,
      gainDb: source.filterGainDb,
      lowShelfGainDb: source.filterLowShelfGainDb,
      highShelfGainDb: source.filterHighShelfGainDb,
      tiltDb: source.filterTiltDb,
      formantVowel: source.filterFormantVowel,
      formantShiftSemitones: source.filterFormantShiftSemitones,
      formantWidth: source.filterFormantWidth,
      formantAmount: source.filterFormantAmount,
      baxandallBassDb: source.filterBaxandallBassDb,
      baxandallTrebleDb: source.filterBaxandallTrebleDb,
      baxandallCenterHz: source.filterBaxandallCenterHz,
      baxandallSlope: source.filterBaxandallSlope
    };
  };

  window.FilterShape = Object.freeze({
    FILTER_TYPES,
    FILTER_TYPE_DEFINITIONS,
    FILTER_CONTROL_DEFINITIONS,
    FORMANT_VOWELS,
    FORMANT_SHIFT_MIN_SEMITONES,
    FORMANT_SHIFT_MAX_SEMITONES,
    normalizeFormantShiftSemitones,
    formantCenters,
    FREQUENCY_MIN_HZ,
    FREQUENCY_MAX_HZ,
    clamp01,
    smoothstep01,
    normalizeFilterType,
    normalizeFilterFrequencyHz,
    normalizeFilterPercent,
    normalizeFilterDb,
    frequencyToSlider,
    sliderToFrequency,
    transitionOctavesForSlope,
    bandwidthOctavesForPercent,
    shapeParametersFromState,
    createFilterShape
  });
})();
