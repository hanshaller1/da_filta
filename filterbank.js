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
  const POSITIVE_RESONANCE_DRIVE = 1;
  const POSITIVE_RESONANCE_DRIVE_SMOOTHING_SECONDS = 0.015;
  const POSITIVE_RESONANCE_DAMPING_FLOOR = 0.10;
  const POSITIVE_RESONANCE_DAMPING_FLOOR_SMOOTHING_SECONDS = 0.015;
  const POSITIVE_RESONANCE_OUTPUT_MODE = 'current-residual';
  const POSITIVE_RESONANCE_LATENCY_MODE = 'current';
  const POSITIVE_RESONANCE_CURVE = 'current';
  const REFERENCE_LEVEL = 1;
  const BAND_BOOST_DB = 12;
  const BAND_CUT_DB = 12;
  const FEEDBACK_ALL_LEVELS = Object.freeze(['raw', 'sqrt2', 'half', 'sqrt10', 'tenth', 'twentieth', 'fortieth', 'eightieth']);
  const FEEDBACK_ALL_NORMALIZATION = 1 / Math.sqrt(BAND_COUNT);
  const PROCESSOR_NAME = 'da-filta-processor';
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
  const normalizePositiveResonanceDrive = value => {
    const numericValue = Number(value);
    return numericValue === 1 || numericValue === 2 || numericValue === 4 || numericValue === 8 || numericValue === 16 || numericValue === 24 || numericValue === 32
      ? numericValue
      : POSITIVE_RESONANCE_DRIVE;
  };
  const normalizePositiveResonanceDampingFloor = value => {
    const numericValue = Number(value);
    return numericValue === 0.10 || numericValue === 0.05 || numericValue === 0.02
      || numericValue === 0 || numericValue === -0.02 || numericValue === -0.05 || numericValue === -0.10
      ? numericValue
      : POSITIVE_RESONANCE_DAMPING_FLOOR;
  };
  const normalizePositiveResonanceOutputMode = value => value === 'nonlinear-base' || value === 'full-nonlinear'
    ? value : POSITIVE_RESONANCE_OUTPUT_MODE;
  const normalizePositiveResonanceLatencyMode = value => value === 'matched' ? value : POSITIVE_RESONANCE_LATENCY_MODE;
  const normalizePositiveResonanceCurve = value => value === 'early' || value === 'aggressive' ? value : POSITIVE_RESONANCE_CURVE;
  const normalizeReferenceLevel = value => [1, 0.75, 0.5, 0.25, 0].includes(Number(value)) ? Number(value) : REFERENCE_LEVEL;
  const normalizeBandBoostDb = value => [12, 18, 24].includes(Number(value)) ? Number(value) : BAND_BOOST_DB;
  const normalizeBandCutDb = value => [12, 24, 36, 48, 60].includes(Number(value)) ? Number(value) : BAND_CUT_DB;
  const normalizeFeedbackAllLevel = value => FEEDBACK_ALL_LEVELS.includes(value) ? value : 'raw';
  const normalizePostGainFeedbackWeight = value => value === 'soft-knee' ? 'soft-knee' : 'current';
  const normalizeFeedbackAllResonanceCurve = value => value === 'soft-knee' ? 'soft-knee' : 'current';
  const normalizeFeedbackAllSaturationReturn = value => value === 'drive-4-return-0.2' ? 'drive-4-return-0.2' : 'current';
  const normalizeFeedbackAllAmount = value => Number.isFinite(Number(value)) ? Math.min(100, Math.max(0, Number(value))) : 100;
  const normalizeNegativeResonanceMode = value => ['damping', 'anti-resonance', 'phase'].includes(value) ? value : 'signed';
  const normalizeNegativeResonanceCurve = value => ['linear', 'squared', 'soft-knee'].includes(value) ? value : 'same-as-positive';
  const normalizeNegativeResonanceAmount = value => Number.isFinite(Number(value)) ? Math.min(200, Math.max(0, Number(value))) : 100;
  const normalizeNegativeResonancePhase = value => Number.isFinite(Number(value)) ? Math.min(180, Math.max(0, Number(value))) : 90;
  const normalizePositiveResonanceEngine = value => value === 'phase2' ? value : 'tpt';
  const normalizeLocalLoopTuning = value => value === 'compensated' ? 'compensated' : 'current';
  const normalizeFeedbackCore = value => value === 'zdf-per-band' ? 'zdf-per-band' : value === 'zdf' ? 'zdf' : 'current';
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
      this.positiveResonanceDrive = normalizePositiveResonanceDrive(initialState?.positiveResonanceDrive);
      this.positiveResonanceDampingFloor = normalizePositiveResonanceDampingFloor(initialState?.positiveResonanceDampingFloor);
      this.positiveResonanceOutputMode = normalizePositiveResonanceOutputMode(initialState?.positiveResonanceOutputMode);
      this.positiveResonanceLatencyMode = normalizePositiveResonanceLatencyMode(initialState?.positiveResonanceLatencyMode);
      this.positiveResonanceCurve = normalizePositiveResonanceCurve(initialState?.positiveResonanceCurve);
      this.referenceLevel = normalizeReferenceLevel(initialState?.referenceLevel);
      this.maxBandBoostDb = normalizeBandBoostDb(initialState?.maxBandBoostDb);
      this.maxBandCutDb = normalizeBandCutDb(initialState?.maxBandCutDb);
      this.positiveResonanceEngine = normalizePositiveResonanceEngine(initialState?.positiveResonanceEngine);
      this.feedbackTopology = initialState?.feedbackTopology === 'common-bus'
        ? 'common-bus'
        : initialState?.feedbackTopology === 'local-loop-exp' ? 'local-loop-exp' : 'isolated-tpt';
      this.feedbackCore = normalizeFeedbackCore(initialState?.feedbackCore);
      this.localLoopTuning = normalizeLocalLoopTuning(initialState?.localLoopTuning);
      this.feedbackTap = initialState?.feedbackTap === 'post-gain' ? 'post-gain' : 'pre-gain';
      this.wetModel = initialState?.wetModel === 'filterbank-sum' ? 'filterbank-sum' : 'reference-delta';
      this.commonBusSaturationMode = initialState?.commonBusSaturationMode === 'constant-ceiling' ? 'constant-ceiling' : 'current';
      this.commonBusDrive = [0.5, 1, 2, 4, 8, 16].includes(Number(initialState?.commonBusDrive)) ? Number(initialState.commonBusDrive) : 1;
      this.commonBusCeiling = [0.25, 0.5, 1, 2, 4].includes(Number(initialState?.commonBusCeiling)) ? Number(initialState.commonBusCeiling) : 1;
      this.feedbackAllEngine = initialState?.feedbackAllEngine === 'common-bus' ? 'common-bus' : 'legacy';
      this.feedbackAllSource = initialState?.feedbackAllSource === 'pre-gain-sum' ? 'pre-gain-sum' : 'post-gain-sum';
      this.postGainFeedbackWeight = normalizePostGainFeedbackWeight(initialState?.postGainFeedbackWeight);
      this.feedbackAllLevel = normalizeFeedbackAllLevel(initialState?.feedbackAllLevel);
      this.feedbackAllAmount = normalizeFeedbackAllAmount(initialState?.feedbackAllAmount);
      this.feedbackAllResonanceCurve = normalizeFeedbackAllResonanceCurve(initialState?.feedbackAllResonanceCurve);
      this.feedbackAllSaturationReturn = normalizeFeedbackAllSaturationReturn(initialState?.feedbackAllSaturationReturn);
      this.negativeResonanceMode = normalizeNegativeResonanceMode(initialState?.negativeResonanceMode);
      this.negativeResonanceCurve = normalizeNegativeResonanceCurve(initialState?.negativeResonanceCurve);
      this.negativeResonanceAmount = normalizeNegativeResonanceAmount(initialState?.negativeResonanceAmount);
      this.negativeResonanceLocal = initialState?.negativeResonanceLocal !== false;
      this.negativeResonanceMain = initialState?.negativeResonanceMain !== false;
      this.negativeResonancePhase = normalizeNegativeResonancePhase(initialState?.negativeResonancePhase);
      this.onDiagnostics = typeof initialState?.onDiagnostics === 'function' ? initialState.onDiagnostics : null;
      this.spectralCoreRequired = initialState?.spectralCoreRequired !== false;
      this.resonatorDiagnosticsEnabled = initialState?.collectResonatorDiagnostics === true;
      this.nonlinearResonatorDiagnosticsEnabled = this.resonatorDiagnosticsEnabled
        && initialState?.collectNonlinearResonatorDiagnostics !== false;
      this.onDynamicEqTelemetry = typeof initialState?.onDynamicEqTelemetry === 'function' ? initialState.onDynamicEqTelemetry : null;
      this.dynamicEqState = window.ResonantState.normalizeDynamicEqState(initialState);
      this.preDynamicGainDbLeft = [...(initialState?.preDynamicGainDbLeft || Array(BAND_COUNT).fill(0))];
      this.preDynamicGainDbRight = [...(initialState?.preDynamicGainDbRight || Array(BAND_COUNT).fill(0))];
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
          ...this.dynamicEqState,
          preDynamicGainDbLeft: this.preDynamicGainDbLeft,
          preDynamicGainDbRight: this.preDynamicGainDbRight,
          feedbackBandLeft: [...this.feedbackBandLeft],
          feedbackBandRight: [...this.feedbackBandRight],
          feedbackAllLeft: this.feedbackAllLeft,
          feedbackAllRight: this.feedbackAllRight,
          resonance: this.resonance,
          spectralCoreRequired: this.spectralCoreRequired,
          maxBandGainDb: MAX_BAND_GAIN_DB,
          maxBandBoostDb: this.maxBandBoostDb,
          maxBandCutDb: this.maxBandCutDb,
          referenceLevel: this.referenceLevel,
          positiveResonanceEngine: this.positiveResonanceEngine,
          feedbackTopology: this.feedbackTopology, feedbackCore: this.feedbackCore, localLoopTuning: this.localLoopTuning, feedbackTap: this.feedbackTap, wetModel: this.wetModel,
          commonBusSaturationMode: this.commonBusSaturationMode, commonBusDrive: this.commonBusDrive, commonBusCeiling: this.commonBusCeiling,
          feedbackAllEngine: this.feedbackAllEngine, feedbackAllSource: this.feedbackAllSource, postGainFeedbackWeight: this.postGainFeedbackWeight, feedbackAllLevel: this.feedbackAllLevel, feedbackAllAmount: this.feedbackAllAmount, feedbackAllResonanceCurve: this.feedbackAllResonanceCurve, feedbackAllSaturationReturn: this.feedbackAllSaturationReturn,
          negativeResonanceMode: this.negativeResonanceMode, negativeResonanceCurve: this.negativeResonanceCurve, negativeResonanceAmount: this.negativeResonanceAmount, negativeResonanceLocal: this.negativeResonanceLocal, negativeResonanceMain: this.negativeResonanceMain, negativeResonancePhase: this.negativeResonancePhase,
          smoothingTime: PARAMETER_SMOOTHING_SECONDS,
          feedbackGateSmoothingTime: FEEDBACK_GATE_SMOOTHING_SECONDS,
          resonanceSmoothingTime: RESONANCE_SMOOTHING_SECONDS,
          feedbackAllNormalization: FEEDBACK_ALL_NORMALIZATION,
          maxFeedbackGain: MAX_FEEDBACK_GAIN,
          maxAuditionGain: MAX_AUDITION_GAIN,
          resonatorDampingFloor: this.positiveResonanceDampingFloor,
          resonatorDampingFloorSmoothingTime: POSITIVE_RESONANCE_DAMPING_FLOOR_SMOOTHING_SECONDS,
          positiveResonanceAuditionGain: this.positiveResonanceAuditionGain,
          positiveResonanceAuditionGainSmoothingTime: POSITIVE_RESONANCE_AUDITION_GAIN_SMOOTHING_SECONDS,
          enableNonlinearPositiveResonator: true,
          positiveResonanceDrive: this.positiveResonanceDrive,
          positiveResonanceDriveSmoothingTime: POSITIVE_RESONANCE_DRIVE_SMOOTHING_SECONDS,
          positiveResonanceOutputMode: this.positiveResonanceOutputMode,
          positiveResonanceLatencyMode: this.positiveResonanceLatencyMode,
          positiveResonanceCurve: this.positiveResonanceCurve,
          collectResonatorDiagnostics: this.resonatorDiagnosticsEnabled,
          collectNonlinearResonatorDiagnostics: this.nonlinearResonatorDiagnosticsEnabled
        }
      });
      this.workletNode.port.onmessage = event => {
        if (event.data?.type === 'resonator-diagnostics') this.onDiagnostics?.(event.data);
        if (event.data?.type === 'dynamic-eq-telemetry') this.onDynamicEqTelemetry?.(event.data);
      };
      this.inputNode.connect(this.workletNode);
      this.workletNode.connect(this.outputNode);
    }

    get input() {
      return this.inputNode;
    }

    get output() {
      return this.outputNode;
    }

    setSpectralCoreRequired(required) {
      const nextValue = Boolean(required);
      if (this.disposed || nextValue === this.spectralCoreRequired) return nextValue;
      this.spectralCoreRequired = nextValue;
      this.workletNode.port.postMessage({ type: 'set-spectral-core-required', required: nextValue });
      return nextValue;
    }

    setResonatorDiagnosticsEnabled(enabled, nonlinearDetails = enabled) {
      const nextValue = Boolean(enabled);
      const nextDetails = nextValue && Boolean(nonlinearDetails);
      if (this.disposed || (nextValue === this.resonatorDiagnosticsEnabled
        && nextDetails === this.nonlinearResonatorDiagnosticsEnabled)) return nextValue;
      this.resonatorDiagnosticsEnabled = nextValue;
      this.nonlinearResonatorDiagnosticsEnabled = nextDetails;
      this.workletNode.port.postMessage({ type: 'set-resonator-diagnostics-enabled', enabled: nextValue,
        nonlinearDetails: nextDetails });
      return nextValue;
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

    setDynamicEq(source) {
      this.dynamicEqState = window.ResonantState.normalizeDynamicEqState(source);
      if (!this.disposed) this.workletNode.port.postMessage({ type: 'set-dynamic-eq', ...this.dynamicEqState });
      return this.dynamicEqState;
    }

    setPreDynamicGainDb(index, left, right) {
      this.preDynamicGainDbLeft[index] = left;
      this.preDynamicGainDbRight[index] = right;
      if (!this.disposed) this.workletNode.port.postMessage({ type: 'set-pre-dynamic-gain-db', index, left, right });
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

    panic() {
      this.feedbackBandLeft.fill(false);
      this.feedbackBandRight.fill(false);
      this.feedbackAllLeft = false;
      this.feedbackAllRight = false;
      this.resonance = 0;
      if (!this.disposed) this.workletNode.port.postMessage({ type: 'panic' });
    }

    setPositiveResonanceAuditionGain(value) {
      if (this.disposed) return;
      const nextValue = normalizePositiveResonanceAuditionGain(value);
      this.positiveResonanceAuditionGain = nextValue;
      this.workletNode.port.postMessage({ type: 'set-positive-resonance-audition-gain', value: nextValue });
      return nextValue;
    }

    setPositiveResonanceDrive(value) {
      if (this.disposed) return;
      const nextValue = normalizePositiveResonanceDrive(value);
      this.positiveResonanceDrive = nextValue;
      this.workletNode.port.postMessage({ type: 'set-positive-resonance-drive', value: nextValue });
      return nextValue;
    }

    setPositiveResonanceDampingFloor(value) {
      if (this.disposed) return;
      const nextValue = normalizePositiveResonanceDampingFloor(value);
      this.positiveResonanceDampingFloor = nextValue;
      this.workletNode.port.postMessage({ type: 'set-positive-resonance-damping-floor', value: nextValue });
      return nextValue;
    }

    setPositiveResonanceOutputMode(value) {
      if (this.disposed) return;
      const nextValue = normalizePositiveResonanceOutputMode(value);
      this.positiveResonanceOutputMode = nextValue;
      this.workletNode.port.postMessage({ type: 'set-positive-resonance-output-mode', value: nextValue });
      return nextValue;
    }

    setPositiveResonanceLatencyMode(value) {
      if (this.disposed) return;
      const nextValue = normalizePositiveResonanceLatencyMode(value);
      this.positiveResonanceLatencyMode = nextValue;
      this.workletNode.port.postMessage({ type: 'set-positive-resonance-latency-mode', value: nextValue });
      return nextValue;
    }

    setPositiveResonanceCurve(value) {
      if (this.disposed) return;
      const nextValue = normalizePositiveResonanceCurve(value);
      this.positiveResonanceCurve = nextValue;
      this.workletNode.port.postMessage({ type: 'set-positive-resonance-curve', value: nextValue });
      return nextValue;
    }

    setReferenceLevel(value) { if (!this.disposed) { this.referenceLevel = normalizeReferenceLevel(value); this.workletNode.port.postMessage({ type: 'set-reference-level', value: this.referenceLevel }); } return this.referenceLevel; }
    setBandBoostDb(value) { if (!this.disposed) { this.maxBandBoostDb = normalizeBandBoostDb(value); this.workletNode.port.postMessage({ type: 'set-band-boost-db', value: this.maxBandBoostDb }); } return this.maxBandBoostDb; }
    setBandCutDb(value) { if (!this.disposed) { this.maxBandCutDb = normalizeBandCutDb(value); this.workletNode.port.postMessage({ type: 'set-band-cut-db', value: this.maxBandCutDb }); } return this.maxBandCutDb; }
    setPositiveResonanceEngine(value) { if (!this.disposed) { this.positiveResonanceEngine = normalizePositiveResonanceEngine(value); this.workletNode.port.postMessage({ type: 'set-positive-resonance-engine', value: this.positiveResonanceEngine }); } return this.positiveResonanceEngine; }
    setFeedbackTopology(value) { if (!this.disposed) { this.feedbackTopology = value === 'common-bus' ? 'common-bus' : value === 'local-loop-exp' ? 'local-loop-exp' : 'isolated-tpt'; this.workletNode.port.postMessage({ type: 'set-feedback-topology', value: this.feedbackTopology }); } return this.feedbackTopology; }
    setFeedbackCore(value) { if (!this.disposed) { this.feedbackCore = normalizeFeedbackCore(value); this.workletNode.port.postMessage({ type: 'set-feedback-core', value: this.feedbackCore }); } return this.feedbackCore; }
    setLocalLoopTuning(value) { if (!this.disposed) { this.localLoopTuning = normalizeLocalLoopTuning(value); this.workletNode.port.postMessage({ type: 'set-local-loop-tuning', value: this.localLoopTuning }); } return this.localLoopTuning; }
    setFeedbackTap(value) { if (!this.disposed) { this.feedbackTap = value === 'post-gain' ? 'post-gain' : 'pre-gain'; this.workletNode.port.postMessage({ type: 'set-feedback-tap', value: this.feedbackTap }); } return this.feedbackTap; }
    setWetModel(value) { if (!this.disposed) { this.wetModel = value === 'filterbank-sum' ? 'filterbank-sum' : 'reference-delta'; this.workletNode.port.postMessage({ type: 'set-wet-model', value: this.wetModel }); } return this.wetModel; }
    setCommonBusSaturationMode(value) { if (!this.disposed) { this.commonBusSaturationMode = value === 'constant-ceiling' ? 'constant-ceiling' : 'current'; this.workletNode.port.postMessage({ type: 'set-common-bus-saturation-mode', value: this.commonBusSaturationMode }); } return this.commonBusSaturationMode; }
    setCommonBusDrive(value) { if (!this.disposed) { this.commonBusDrive = [0.5, 1, 2, 4, 8, 16].includes(Number(value)) ? Number(value) : 1; this.workletNode.port.postMessage({ type: 'set-common-bus-drive', value: this.commonBusDrive }); } return this.commonBusDrive; }
    setCommonBusCeiling(value) { if (!this.disposed) { this.commonBusCeiling = [0.25, 0.5, 1, 2, 4].includes(Number(value)) ? Number(value) : 1; this.workletNode.port.postMessage({ type: 'set-common-bus-ceiling', value: this.commonBusCeiling }); } return this.commonBusCeiling; }
    setFeedbackAllEngine(value) { if (!this.disposed) { this.feedbackAllEngine = value === 'common-bus' ? 'common-bus' : 'legacy'; this.workletNode.port.postMessage({ type: 'set-feedback-all-engine', value: this.feedbackAllEngine }); } return this.feedbackAllEngine; }
    setFeedbackAllSource(value) { if (!this.disposed) { this.feedbackAllSource = value === 'pre-gain-sum' ? 'pre-gain-sum' : 'post-gain-sum'; this.workletNode.port.postMessage({ type: 'set-feedback-all-source', value: this.feedbackAllSource }); } return this.feedbackAllSource; }
    setPostGainFeedbackWeight(value) { if (!this.disposed) { this.postGainFeedbackWeight = normalizePostGainFeedbackWeight(value); this.workletNode.port.postMessage({ type: 'set-post-gain-feedback-weight', value: this.postGainFeedbackWeight }); } return this.postGainFeedbackWeight; }
    setFeedbackAllLevel(value) { if (!this.disposed) { this.feedbackAllLevel = normalizeFeedbackAllLevel(value); this.workletNode.port.postMessage({ type: 'set-feedback-all-level', value: this.feedbackAllLevel }); } return this.feedbackAllLevel; }
    setFeedbackAllAmount(value) { if (!this.disposed) { this.feedbackAllAmount = normalizeFeedbackAllAmount(value); this.workletNode.port.postMessage({ type: 'set-feedback-all-amount', value: this.feedbackAllAmount }); } return this.feedbackAllAmount; }
    setFeedbackAllResonanceCurve(value) { if (!this.disposed) { this.feedbackAllResonanceCurve = normalizeFeedbackAllResonanceCurve(value); this.workletNode.port.postMessage({ type: 'set-feedback-all-resonance-curve', value: this.feedbackAllResonanceCurve }); } return this.feedbackAllResonanceCurve; }
    setFeedbackAllSaturationReturn(value) { if (!this.disposed) { this.feedbackAllSaturationReturn = normalizeFeedbackAllSaturationReturn(value); this.workletNode.port.postMessage({ type: 'set-feedback-all-saturation-return', value: this.feedbackAllSaturationReturn }); } return this.feedbackAllSaturationReturn; }
    setNegativeResonanceMode(value) { if (!this.disposed) { this.negativeResonanceMode = normalizeNegativeResonanceMode(value); this.workletNode.port.postMessage({ type: 'set-negative-resonance-mode', value: this.negativeResonanceMode }); } return this.negativeResonanceMode; }
    setNegativeResonanceCurve(value) { if (!this.disposed) { this.negativeResonanceCurve = normalizeNegativeResonanceCurve(value); this.workletNode.port.postMessage({ type: 'set-negative-resonance-curve', value: this.negativeResonanceCurve }); } return this.negativeResonanceCurve; }
    setNegativeResonanceAmount(value) { if (!this.disposed) { this.negativeResonanceAmount = normalizeNegativeResonanceAmount(value); this.workletNode.port.postMessage({ type: 'set-negative-resonance-amount', value: this.negativeResonanceAmount }); } return this.negativeResonanceAmount; }
    setNegativeResonanceLocal(value) { if (!this.disposed) { this.negativeResonanceLocal = Boolean(value); this.workletNode.port.postMessage({ type: 'set-negative-resonance-local', value: this.negativeResonanceLocal }); } return this.negativeResonanceLocal; }
    setNegativeResonanceMain(value) { if (!this.disposed) { this.negativeResonanceMain = Boolean(value); this.workletNode.port.postMessage({ type: 'set-negative-resonance-main', value: this.negativeResonanceMain }); } return this.negativeResonanceMain; }
    setNegativeResonancePhase(value) { if (!this.disposed) { this.negativeResonancePhase = normalizeNegativeResonancePhase(value); this.workletNode.port.postMessage({ type: 'set-negative-resonance-phase', value: this.negativeResonancePhase }); } return this.negativeResonancePhase; }

    applyState(snapshot) {
      if (this.disposed) return;
      this.dynamicEqState = window.ResonantState.normalizeDynamicEqState(snapshot);
      this.preDynamicGainDbLeft = [...(snapshot?.preDynamicGainDbLeft || Array(BAND_COUNT).fill(0))];
      this.preDynamicGainDbRight = [...(snapshot?.preDynamicGainDbRight || Array(BAND_COUNT).fill(0))];
      this.bandGainLeft = readBandControls(snapshot, 'bandGainLeft');
      this.bandGainRight = readBandControls(snapshot, 'bandGainRight');
      this.feedbackBandLeft = readFeedbackGates(snapshot, 'feedbackBandLeft');
      this.feedbackBandRight = readFeedbackGates(snapshot, 'feedbackBandRight');
      this.feedbackAllLeft = Boolean(snapshot?.feedbackAllLeft);
      this.feedbackAllRight = Boolean(snapshot?.feedbackAllRight);
      this.resonance = clampResonance(snapshot?.resonance);
      this.spectralCoreRequired = snapshot?.spectralCoreRequired !== false;
      this.resonatorDiagnosticsEnabled = snapshot?.collectResonatorDiagnostics === true;
      this.nonlinearResonatorDiagnosticsEnabled = this.resonatorDiagnosticsEnabled
        && snapshot?.collectNonlinearResonatorDiagnostics !== false;
      this.positiveResonanceAuditionGain = normalizePositiveResonanceAuditionGain(snapshot?.positiveResonanceAuditionGain ?? this.positiveResonanceAuditionGain);
      this.positiveResonanceDrive = normalizePositiveResonanceDrive(snapshot?.positiveResonanceDrive ?? this.positiveResonanceDrive);
      this.positiveResonanceDampingFloor = normalizePositiveResonanceDampingFloor(snapshot?.positiveResonanceDampingFloor ?? this.positiveResonanceDampingFloor);
      this.positiveResonanceOutputMode = normalizePositiveResonanceOutputMode(snapshot?.positiveResonanceOutputMode ?? this.positiveResonanceOutputMode);
      this.positiveResonanceLatencyMode = normalizePositiveResonanceLatencyMode(snapshot?.positiveResonanceLatencyMode ?? this.positiveResonanceLatencyMode);
      this.positiveResonanceCurve = normalizePositiveResonanceCurve(snapshot?.positiveResonanceCurve ?? this.positiveResonanceCurve);
      this.referenceLevel = normalizeReferenceLevel(snapshot?.referenceLevel ?? this.referenceLevel);
      this.maxBandBoostDb = normalizeBandBoostDb(snapshot?.maxBandBoostDb ?? this.maxBandBoostDb);
      this.maxBandCutDb = normalizeBandCutDb(snapshot?.maxBandCutDb ?? this.maxBandCutDb);
      this.positiveResonanceEngine = normalizePositiveResonanceEngine(snapshot?.positiveResonanceEngine ?? this.positiveResonanceEngine);
      this.feedbackTopology = snapshot?.feedbackTopology === 'common-bus'
        ? 'common-bus'
        : snapshot?.feedbackTopology === 'local-loop-exp' ? 'local-loop-exp' : this.feedbackTopology;
      this.feedbackCore = normalizeFeedbackCore(snapshot?.feedbackCore ?? this.feedbackCore);
      this.localLoopTuning = normalizeLocalLoopTuning(snapshot?.localLoopTuning ?? this.localLoopTuning);
      this.feedbackTap = snapshot?.feedbackTap === 'post-gain' ? 'post-gain' : this.feedbackTap;
      this.wetModel = snapshot?.wetModel === 'filterbank-sum' ? 'filterbank-sum' : this.wetModel;
      this.feedbackAllEngine = snapshot?.feedbackAllEngine === 'common-bus' ? 'common-bus' : this.feedbackAllEngine;
      this.feedbackAllSource = snapshot?.feedbackAllSource === 'pre-gain-sum' ? 'pre-gain-sum' : this.feedbackAllSource;
      this.postGainFeedbackWeight = normalizePostGainFeedbackWeight(snapshot?.postGainFeedbackWeight ?? this.postGainFeedbackWeight);
      if (snapshot?.feedbackAllLevel !== undefined) this.feedbackAllLevel = normalizeFeedbackAllLevel(snapshot.feedbackAllLevel);
      if (snapshot?.feedbackAllAmount !== undefined) this.feedbackAllAmount = normalizeFeedbackAllAmount(snapshot.feedbackAllAmount);
      this.feedbackAllResonanceCurve = normalizeFeedbackAllResonanceCurve(snapshot?.feedbackAllResonanceCurve ?? this.feedbackAllResonanceCurve);
      this.feedbackAllSaturationReturn = normalizeFeedbackAllSaturationReturn(snapshot?.feedbackAllSaturationReturn ?? this.feedbackAllSaturationReturn);
      this.negativeResonanceMode = normalizeNegativeResonanceMode(snapshot?.negativeResonanceMode ?? this.negativeResonanceMode);
      this.negativeResonanceCurve = normalizeNegativeResonanceCurve(snapshot?.negativeResonanceCurve ?? this.negativeResonanceCurve);
      this.negativeResonanceAmount = normalizeNegativeResonanceAmount(snapshot?.negativeResonanceAmount ?? this.negativeResonanceAmount);
      this.negativeResonanceLocal = snapshot?.negativeResonanceLocal !== undefined ? Boolean(snapshot.negativeResonanceLocal) : this.negativeResonanceLocal;
      this.negativeResonanceMain = snapshot?.negativeResonanceMain !== undefined ? Boolean(snapshot.negativeResonanceMain) : this.negativeResonanceMain;
      this.negativeResonancePhase = normalizeNegativeResonancePhase(snapshot?.negativeResonancePhase ?? this.negativeResonancePhase);
      this.workletNode.port.postMessage({
        type: 'apply-state',
        bandGainLeft: [...this.bandGainLeft],
        bandGainRight: [...this.bandGainRight],
        ...this.dynamicEqState,
        preDynamicGainDbLeft: this.preDynamicGainDbLeft,
        preDynamicGainDbRight: this.preDynamicGainDbRight,
        feedbackBandLeft: [...this.feedbackBandLeft],
        feedbackBandRight: [...this.feedbackBandRight],
        feedbackAllLeft: this.feedbackAllLeft,
        feedbackAllRight: this.feedbackAllRight,
        resonance: this.resonance,
        spectralCoreRequired: this.spectralCoreRequired,
        collectResonatorDiagnostics: this.resonatorDiagnosticsEnabled,
        collectNonlinearResonatorDiagnostics: this.nonlinearResonatorDiagnosticsEnabled,
        positiveResonanceAuditionGain: this.positiveResonanceAuditionGain,
        positiveResonanceDrive: this.positiveResonanceDrive,
        positiveResonanceDampingFloor: this.positiveResonanceDampingFloor,
        positiveResonanceOutputMode: this.positiveResonanceOutputMode,
        positiveResonanceLatencyMode: this.positiveResonanceLatencyMode,
        positiveResonanceCurve: this.positiveResonanceCurve
        , referenceLevel: this.referenceLevel, maxBandBoostDb: this.maxBandBoostDb, maxBandCutDb: this.maxBandCutDb, positiveResonanceEngine: this.positiveResonanceEngine
        , feedbackTopology: this.feedbackTopology, feedbackCore: this.feedbackCore, localLoopTuning: this.localLoopTuning, feedbackTap: this.feedbackTap, wetModel: this.wetModel
        , commonBusSaturationMode: this.commonBusSaturationMode, commonBusDrive: this.commonBusDrive, commonBusCeiling: this.commonBusCeiling
        , feedbackAllEngine: this.feedbackAllEngine, feedbackAllSource: this.feedbackAllSource, postGainFeedbackWeight: this.postGainFeedbackWeight, feedbackAllLevel: this.feedbackAllLevel, feedbackAllAmount: this.feedbackAllAmount, feedbackAllResonanceCurve: this.feedbackAllResonanceCurve, feedbackAllSaturationReturn: this.feedbackAllSaturationReturn
        , negativeResonanceMode: this.negativeResonanceMode, negativeResonanceCurve: this.negativeResonanceCurve, negativeResonanceAmount: this.negativeResonanceAmount, negativeResonanceLocal: this.negativeResonanceLocal, negativeResonanceMain: this.negativeResonanceMain, negativeResonancePhase: this.negativeResonancePhase
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
  Filterbank.POSITIVE_RESONANCE_DRIVE = POSITIVE_RESONANCE_DRIVE;
  Filterbank.POSITIVE_RESONANCE_DRIVE_SMOOTHING_SECONDS = POSITIVE_RESONANCE_DRIVE_SMOOTHING_SECONDS;
  Filterbank.POSITIVE_RESONANCE_DAMPING_FLOOR = POSITIVE_RESONANCE_DAMPING_FLOOR;
  Filterbank.POSITIVE_RESONANCE_OUTPUT_MODE = POSITIVE_RESONANCE_OUTPUT_MODE;
  Filterbank.POSITIVE_RESONANCE_LATENCY_MODE = POSITIVE_RESONANCE_LATENCY_MODE;
  Filterbank.POSITIVE_RESONANCE_CURVE = POSITIVE_RESONANCE_CURVE;
  Filterbank.POSITIVE_RESONANCE_DAMPING_FLOOR_SMOOTHING_SECONDS = POSITIVE_RESONANCE_DAMPING_FLOOR_SMOOTHING_SECONDS;
  Filterbank.FEEDBACK_ALL_NORMALIZATION = FEEDBACK_ALL_NORMALIZATION;
  Filterbank.PROCESSOR_NAME = PROCESSOR_NAME;
  window.Filterbank = Filterbank;
})();
