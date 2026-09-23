(function () {
  const FILTER_TYPES = Object.freeze(['lowpass', 'highpass', 'bandpass', 'notch']);
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

  const createFilterShape = ({
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
    const normalizedType = normalizeFilterType(type);
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

  window.FilterShape = Object.freeze({
    FILTER_TYPES,
    FREQUENCY_MIN_HZ,
    FREQUENCY_MAX_HZ,
    clamp01,
    smoothstep01,
    normalizeFilterType,
    normalizeFilterFrequencyHz,
    normalizeFilterPercent,
    frequencyToSlider,
    sliderToFrequency,
    transitionOctavesForSlope,
    bandwidthOctavesForPercent,
    createFilterShape
  });
})();
