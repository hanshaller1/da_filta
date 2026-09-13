(function () {
  const {
    BAND_DEFINITIONS,
    BAND_COUNT,
    BAND_GAIN_MAX,
    clampBandGain,
    setBandBaseGain
  } = window.ResonantState;

  const MAX_BAND_GAIN_DB = 12;
  const PARAMETER_SMOOTHING_SECONDS = 0.015;
  const FEEDBACK_GATE_SMOOTHING_SECONDS = 0.008;
  const RESONANCE_SMOOTHING_SECONDS = 0.015;
  const MAX_FEEDBACK_GAIN = 1.25;
  const MAX_AUDITION_GAIN = 0.25;
  const RESONATOR_DAMPING_FLOOR = 0.1;
  const POSITIVE_RESONANCE_AUDITION_GAIN = 0.10;
  const POSITIVE_RESONANCE_AUDITION_GAIN_SMOOTHING_SECONDS = 0.015;
  const FEEDBACK_ALL_NORMALIZATION = 1 / Math.sqrt(BAND_COUNT);
  const PROCESSOR_NAME = 'resonant-filterbank-processor';
  const workletModuleLoads = new WeakMap();
  const bandFrequencies = Object.freeze(BAND_DEFINITIONS.map(band => band.frequency));
  const bandBoundaries = Object.freeze(
    bandFrequencies.slice(0, -1).map((frequency, index) => Math.sqrt(frequency * bandFrequencies[index + 1]))
  );
  const bandQs = Object.freeze(bandFrequencies.map((frequency, index) => {
    const lower = index === 0 ? (frequency * frequency) / bandBoundaries[0] : bandBoundaries[index - 1];
    const upper = index === BAND_COUNT - 1 ? (frequency * frequency) / bandBoundaries[BAND_COUNT - 2] : bandBoundaries[index];
    return frequency / (upper - lower);
  }));

  const controlToGainDb = control => MAX_BAND_GAIN_DB * (Number(control) / BAND_GAIN_MAX);
  const controlToDeltaGain = control => 10 ** (controlToGainDb(control) / 20) - 1;
  const clampResonance = value => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.min(1, Math.max(-1, numericValue));
  };
  const normalizePositiveResonanceAuditionGain = value => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0
      ? numericValue
      : POSITIVE_RESONANCE_AUDITION_GAIN;
  };
  const normalizeChannel = channel => {
    if (channel === 'left' || channel === 'L') return 'left';
    if (channel === 'right' || channel === 'R') return 'right';
    throw new RangeError('Ungültiger Audiokanal.');
  };
  const readBandControls = (snapshot, property) => {
    const values = Array.isArray(snapshot?.[property]) ? snapshot[property] : [];
    return Array.from({ length: BAND_COUNT }, (_, index) => clampBandGain(values[index] ?? 0));
  };
  const readFeedbackGates = (snapshot, property) => {
    const values = Array.isArray(snapshot?.[property]) ? snapshot[property] : [];
    return Array.from({ length: BAND_COUNT }, (_, index) => Boolean(values[index]));
  };
  const getWorkletModuleUrl = () => new URL('filterbank-processor.js', window.location.href).href;

  const loadWorkletModule = async audioContext => {
    if (!audioContext?.audioWorklet?.addModule) {
      throw new Error('AudioWorklet wird von diesem Browser oder AudioContext nicht unterstützt.');
    }

    const existingLoad = workletModuleLoads.get(audioContext);
    if (existingLoad) return existingLoad;

    const load = audioContext.audioWorklet.addModule(getWorkletModuleUrl()).catch(error => {
      workletModuleLoads.delete(audioContext);
      throw new Error(`Filterbank-AudioWorklet konnte nicht geladen werden: ${error?.message || error}`);
    });
    workletModuleLoads.set(audioContext, load);
    return load;
  };

  class Filterbank {
    static async create(audioContext, initialState) {
      await loadWorkletModule(audioContext);
      return new Filterbank(audioContext, initialState);
    }

    constructor(audioContext, initialState) {
      if (typeof AudioWorkletNode !== 'function') {
        throw new Error('AudioWorkletNode wird von diesem Browser nicht unterstützt.');
      }

      this.context = audioContext;
      this.disposed = false;
      this.bandGainLeft = readBandControls(initialState, 'bandGainLeft');
      this.bandGainRight = readBandControls(initialState, 'bandGainRight');
      this.feedbackBandLeft = readFeedbackGates(initialState, 'feedbackBandLeft');
      this.feedbackBandRight = readFeedbackGates(initialState, 'feedbackBandRight');
      this.feedbackAllLeft = Boolean(initialState?.feedbackAllLeft);
      this.feedbackAllRight = Boolean(initialState?.feedbackAllRight);
      this.resonance = clampResonance(initialState?.resonance);
      this.positiveResonanceAuditionGain = normalizePositiveResonanceAuditionGain(initialState?.positiveResonanceAuditionGain);
      this.inputNode = audioContext.createGain();
      this.outputNode = audioContext.createGain();
      this.inputNode.gain.value = 1;
      this.outputNode.gain.value = 1;
      this.workletNode = new AudioWorkletNode(audioContext, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: [...bandFrequencies],
          bandQs: [...bandQs],
          bandGainLeft: [...this.bandGainLeft],
          bandGainRight: [...this.bandGainRight],
          feedbackBandLeft: [...this.feedbackBandLeft],
          feedbackBandRight: [...this.feedbackBandRight],
          feedbackAllLeft: this.feedbackAllLeft,
          feedbackAllRight: this.feedbackAllRight,
          resonance: this.resonance,
          maxBandGainDb: MAX_BAND_GAIN_DB,
          smoothingTime: PARAMETER_SMOOTHING_SECONDS,
          feedbackGateSmoothingTime: FEEDBACK_GATE_SMOOTHING_SECONDS,
          resonanceSmoothingTime: RESONANCE_SMOOTHING_SECONDS,
          feedbackAllNormalization: FEEDBACK_ALL_NORMALIZATION,
          maxFeedbackGain: MAX_FEEDBACK_GAIN,
          maxAuditionGain: MAX_AUDITION_GAIN,
          resonatorDampingFloor: RESONATOR_DAMPING_FLOOR,
          positiveResonanceAuditionGain: this.positiveResonanceAuditionGain,
          positiveResonanceAuditionGainSmoothingTime: POSITIVE_RESONANCE_AUDITION_GAIN_SMOOTHING_SECONDS
        }
      });
      this.inputNode.connect(this.workletNode);
      this.workletNode.connect(this.outputNode);
    }

    get input() {
      return this.inputNode;
    }

    get output() {
      return this.outputNode;
    }

    setBandBaseGain(channel, index, value) {
      if (this.disposed) return;
      const normalizedChannel = normalizeChannel(channel);
      const target = normalizedChannel === 'left' ? this.bandGainLeft : this.bandGainRight;
      const nextValue = setBandBaseGain({ bandGainLeft: this.bandGainLeft, bandGainRight: this.bandGainRight }, normalizedChannel, index, value);
      target[index] = nextValue;
      this.workletNode.port.postMessage({
        type: 'set-band-base-gain',
        channel: normalizedChannel,
        index,
        value: nextValue
      });
      return nextValue;
    }

    setBandFeedback(channel, index, enabled) {
      if (this.disposed) return;
      if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT) throw new RangeError('Ungültiger Bandindex.');
      const normalizedChannel = normalizeChannel(channel);
      const target = normalizedChannel === 'left' ? this.feedbackBandLeft : this.feedbackBandRight;
      const nextValue = Boolean(enabled);
      target[index] = nextValue;
      this.workletNode.port.postMessage({
        type: 'set-band-feedback',
        channel: normalizedChannel,
        index,
        enabled: nextValue
      });
      return nextValue;
    }

    setFeedbackAll(channel, enabled) {
      if (this.disposed) return;
      const normalizedChannel = normalizeChannel(channel);
      const nextValue = Boolean(enabled);
      if (normalizedChannel === 'left') this.feedbackAllLeft = nextValue;
      else this.feedbackAllRight = nextValue;
      this.workletNode.port.postMessage({
        type: 'set-feedback-all',
        channel: normalizedChannel,
        enabled: nextValue
      });
      return nextValue;
    }

    setResonance(value) {
      if (this.disposed) return;
      const nextValue = clampResonance(value);
      this.resonance = nextValue;
      this.workletNode.port.postMessage({ type: 'set-resonance', value: nextValue });
      return nextValue;
    }

    setPositiveResonanceAuditionGain(value) {
      if (this.disposed) return;
      const nextValue = normalizePositiveResonanceAuditionGain(value);
      this.positiveResonanceAuditionGain = nextValue;
      this.workletNode.port.postMessage({ type: 'set-positive-resonance-audition-gain', value: nextValue });
      return nextValue;
    }

    applyState(snapshot) {
      if (this.disposed) return;
      this.bandGainLeft = readBandControls(snapshot, 'bandGainLeft');
      this.bandGainRight = readBandControls(snapshot, 'bandGainRight');
      this.feedbackBandLeft = readFeedbackGates(snapshot, 'feedbackBandLeft');
      this.feedbackBandRight = readFeedbackGates(snapshot, 'feedbackBandRight');
      this.feedbackAllLeft = Boolean(snapshot?.feedbackAllLeft);
      this.feedbackAllRight = Boolean(snapshot?.feedbackAllRight);
      this.resonance = clampResonance(snapshot?.resonance);
      this.positiveResonanceAuditionGain = normalizePositiveResonanceAuditionGain(snapshot?.positiveResonanceAuditionGain ?? this.positiveResonanceAuditionGain);
      this.workletNode.port.postMessage({
        type: 'apply-state',
        bandGainLeft: [...this.bandGainLeft],
        bandGainRight: [...this.bandGainRight],
        feedbackBandLeft: [...this.feedbackBandLeft],
        feedbackBandRight: [...this.feedbackBandRight],
        feedbackAllLeft: this.feedbackAllLeft,
        feedbackAllRight: this.feedbackAllRight,
        resonance: this.resonance,
        positiveResonanceAuditionGain: this.positiveResonanceAuditionGain
      });
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.workletNode.port.postMessage({ type: 'dispose' });
      this.workletNode.port.onmessage = null;
      if (typeof this.workletNode.port.close === 'function') this.workletNode.port.close();
      this.inputNode.disconnect();
      this.workletNode.disconnect();
      this.outputNode.disconnect();
    }
  }

  Filterbank.BAND_FREQUENCIES = bandFrequencies;
  Filterbank.BAND_BOUNDARIES = bandBoundaries;
  Filterbank.BAND_QS = bandQs;
  Filterbank.controlToGainDb = controlToGainDb;
  Filterbank.controlToDeltaGain = controlToDeltaGain;
  Filterbank.PARAMETER_SMOOTHING_SECONDS = PARAMETER_SMOOTHING_SECONDS;
  Filterbank.FEEDBACK_GATE_SMOOTHING_SECONDS = FEEDBACK_GATE_SMOOTHING_SECONDS;
  Filterbank.RESONANCE_SMOOTHING_SECONDS = RESONANCE_SMOOTHING_SECONDS;
  Filterbank.MAX_FEEDBACK_GAIN = MAX_FEEDBACK_GAIN;
  Filterbank.MAX_AUDITION_GAIN = MAX_AUDITION_GAIN;
  Filterbank.RESONATOR_DAMPING_FLOOR = RESONATOR_DAMPING_FLOOR;
  Filterbank.POSITIVE_RESONANCE_AUDITION_GAIN = POSITIVE_RESONANCE_AUDITION_GAIN;
  Filterbank.POSITIVE_RESONANCE_AUDITION_GAIN_SMOOTHING_SECONDS = POSITIVE_RESONANCE_AUDITION_GAIN_SMOOTHING_SECONDS;
  Filterbank.FEEDBACK_ALL_NORMALIZATION = FEEDBACK_ALL_NORMALIZATION;
  Filterbank.PROCESSOR_NAME = PROCESSOR_NAME;
  window.Filterbank = Filterbank;
})();
