(function () {
  const {
    BAND_COUNT,
    BAND_GAIN_MIN,
    BAND_GAIN_MAX,
    clampBandGain,
    getEffectiveBandGains,
    normalizeSpreadCurve,
    normalizeSpreadMaxOffsetDb,
    clampSpread
  } = window.ResonantState;
  const dbToGain = db => 10 ** (Number(db) / 20);
  const dryWetGains = value => {
    const wet = Math.min(100, Math.max(0, Number(value))) / 100;
    return { dry: 1 - wet, wet };
  };
  const INPUT_PREAMP_PROCESSOR_NAME = 'resonant-input-preamp-processor';
  const INPUT_PREAMP_STAGES = Object.freeze(['linear', 'silk', 'tape', 'tube', 'console', 'crunch', 'destroy']);
  const FEEDBACK_ALL_LEVELS = Object.freeze(['raw', 'sqrt2', 'half', 'sqrt10', 'tenth', 'twentieth', 'fortieth', 'eightieth']);
  const inputPreampModuleLoads = new WeakMap();
  const loadInputPreampModule = async audioContext => {
    if (!audioContext?.audioWorklet?.addModule) throw new Error('AudioWorklet wird von diesem Browser oder AudioContext nicht unterstÃ¼tzt.');
    const existingLoad = inputPreampModuleLoads.get(audioContext);
    if (existingLoad) return existingLoad;
    const moduleUrl = new URL('input-preamp-processor.js', window.location.href).href;
    const load = audioContext.audioWorklet.addModule(moduleUrl).catch(error => {
      inputPreampModuleLoads.delete(audioContext);
      throw new Error(`Input-Preamp-AudioWorklet konnte nicht geladen werden: ${error?.message || error}`);
    });
    inputPreampModuleLoads.set(audioContext, load);
    return load;
  };

  class AudioEngine {
    constructor({ onStatusChange, onDevicesChanged, onDiagnostics }) {
      this.onStatusChange = onStatusChange;
      this.onDevicesChanged = onDevicesChanged;
      this.onDiagnostics = onDiagnostics;
      this.status = 'OFF';
      this.inputGainDb = 0;
      this.inputPreampStage = 'linear';
      this.inputCharacterAmount = 50;
      this.resonance = 0;
      this.positiveResonanceAuditionGain = window.Filterbank?.POSITIVE_RESONANCE_AUDITION_GAIN ?? 0.1;
      this.positiveResonanceDrive = window.Filterbank?.POSITIVE_RESONANCE_DRIVE ?? 1;
      this.positiveResonanceDampingFloor = window.Filterbank?.POSITIVE_RESONANCE_DAMPING_FLOOR ?? 0.1;
      this.positiveResonanceOutputMode = window.Filterbank?.POSITIVE_RESONANCE_OUTPUT_MODE ?? 'current-residual';
      this.positiveResonanceLatencyMode = window.Filterbank?.POSITIVE_RESONANCE_LATENCY_MODE ?? 'current';
      this.positiveResonanceCurve = window.Filterbank?.POSITIVE_RESONANCE_CURVE ?? 'current';
      this.referenceLevel = 1;
      this.maxBandBoostDb = 12;
      this.maxBandCutDb = 12;
      this.spread = 0;
      this.spreadMode = 'CLASSIC';
      this.spreadCurve = 'linear';
      this.spreadMaxOffsetDb = 6;
      this.positiveResonanceEngine = 'tpt';
      this.feedbackTopology = 'isolated-tpt'; this.feedbackCore = 'current'; this.localLoopTuning = 'current'; this.feedbackTap = 'pre-gain'; this.wetModel = 'reference-delta';
      this.commonBusSaturationMode = 'current'; this.commonBusDrive = 1; this.commonBusCeiling = 1;
      this.feedbackAllEngine = 'legacy'; this.feedbackAllSource = 'post-gain-sum';
      this.postGainFeedbackWeight = 'current';
      this.feedbackAllLevel = 'raw';
      this.feedbackAllResonanceCurve = 'current';
      this.feedbackAllSaturationReturn = 'current';
      this.dryWet = 50;
      this.volumeDb = -6;
      this.context = null;
      this.stream = null;
      this.source = null;
      this.sourceBus = null;
      this.activeInputGate = null;
      this.sampleSource = null;
      this.sampleBufferCache = new Map();
      this.sourceMode = 'device';
      this.sample = null;
      this.inputGainNode = null;
      this.inputPreampNode = null;
      this.dryGainNode = null;
      this.wetGainNode = null;
      // Passive visual-analysis sidechain. It is deliberately not routed back
      // into the audible graph.
      this.spectrumSplitterNode = null;
      this.spectrumAnalyserLeft = null;
      this.spectrumAnalyserRight = null;
      this.mixBus = null;
      this.volumeGainNode = null;
      this.destination = null;
      this.outputElement = null;
      this.filterbank = null;
      this.bandGainLeft = Array(BAND_COUNT).fill(0);
      this.bandGainRight = Array(BAND_COUNT).fill(0);
      this.feedbackBandLeft = Array(BAND_COUNT).fill(false);
      this.feedbackBandRight = Array(BAND_COUNT).fill(false);
      this.feedbackAllLeft = false;
      this.feedbackAllRight = false;
      this.handleDeviceChange = () => this.refreshDevices().then(devices => this.onDevicesChanged?.(devices)).catch(() => {});
      if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', this.handleDeviceChange);
    }

    setStatus(status, message = '') {
      this.status = status;
      this.onStatusChange?.(status, message);
    }

    async refreshDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Gerätezugriff wird von diesem Browser nicht unterstützt.');
      const devices = await navigator.mediaDevices.enumerateDevices();
      return { inputs: devices.filter(device => device.kind === 'audioinput'), outputs: devices.filter(device => device.kind === 'audiooutput') };
    }

    setInputGainDb(value) {
      this.inputGainDb = Math.max(0, Math.min(24, Number(value)));
      this.setSmoothedParam(this.inputGainNode?.gain, dbToGain(this.inputGainDb));
      this.inputPreampNode?.port.postMessage({ type: 'set-input-gain-db', value: this.inputGainDb });
    }

    setInputPreampStage(value) {
      this.inputPreampStage = INPUT_PREAMP_STAGES.includes(value) ? value : 'linear';
      this.inputPreampNode?.port.postMessage({ type: 'set-input-stage', value: this.inputPreampStage });
      return this.inputPreampStage;
    }

    setInputCharacterAmount(value) {
      const numeric = Number(value);
      this.inputCharacterAmount = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 50;
      this.inputPreampNode?.port.postMessage({ type: 'set-character-amount', value: this.inputCharacterAmount / 100 });
      return this.inputCharacterAmount;
    }

    setDryWet(value, smoothingTime = 0.015) {
      this.dryWet = Math.max(0, Math.min(100, Number(value)));
      const gains = dryWetGains(this.dryWet);
      this.setSmoothedParam(this.dryGainNode?.gain, gains.dry, smoothingTime);
      this.setSmoothedParam(this.wetGainNode?.gain, gains.wet, smoothingTime);
    }

    panic() {
      this.setDryWet(0, 0.008);
      this.setResonance(0);
      this.feedbackBandLeft.fill(false);
      this.feedbackBandRight.fill(false);
      this.feedbackAllLeft = false;
      this.feedbackAllRight = false;
      this.filterbank?.panic();
      this.setInputGainDb(0);
    }

    setVolumeDb(value) {
      this.volumeDb = Math.max(-60, Math.min(0, Number(value)));
      this.setSmoothedParam(this.volumeGainNode?.gain, dbToGain(this.volumeDb));
    }

    setResonance(value) {
      const numericValue = Number(value);
      this.resonance = Number.isFinite(numericValue) ? Math.max(-1, Math.min(1, numericValue)) : 0;
      this.filterbank?.setResonance(this.resonance);
      return this.resonance;
    }

    setPositiveResonanceAuditionGain(value) {
      const numericValue = Number(value);
      this.positiveResonanceAuditionGain = Number.isFinite(numericValue) && numericValue > 0
        ? numericValue
        : (window.Filterbank?.POSITIVE_RESONANCE_AUDITION_GAIN ?? 0.1);
      this.filterbank?.setPositiveResonanceAuditionGain(this.positiveResonanceAuditionGain);
      return this.positiveResonanceAuditionGain;
    }

    setPositiveResonanceDrive(value) {
      const numericValue = Number(value);
      this.positiveResonanceDrive = numericValue === 1 || numericValue === 2 || numericValue === 4 || numericValue === 8 || numericValue === 16 || numericValue === 24 || numericValue === 32
        ? numericValue
        : (window.Filterbank?.POSITIVE_RESONANCE_DRIVE ?? 1);
      this.filterbank?.setPositiveResonanceDrive(this.positiveResonanceDrive);
      return this.positiveResonanceDrive;
    }

    setPositiveResonanceDampingFloor(value) {
      const numericValue = Number(value);
      this.positiveResonanceDampingFloor = numericValue === 0.10 || numericValue === 0.05 || numericValue === 0.02
        || numericValue === 0 || numericValue === -0.02 || numericValue === -0.05 || numericValue === -0.10
        ? numericValue
        : (window.Filterbank?.POSITIVE_RESONANCE_DAMPING_FLOOR ?? 0.1);
      this.filterbank?.setPositiveResonanceDampingFloor(this.positiveResonanceDampingFloor);
      return this.positiveResonanceDampingFloor;
    }

    setPositiveResonanceOutputMode(value) {
      this.positiveResonanceOutputMode = value === 'nonlinear-base' || value === 'full-nonlinear' ? value : 'current-residual';
      this.filterbank?.setPositiveResonanceOutputMode(this.positiveResonanceOutputMode);
      return this.positiveResonanceOutputMode;
    }

    setPositiveResonanceLatencyMode(value) {
      this.positiveResonanceLatencyMode = value === 'matched' ? value : 'current';
      this.filterbank?.setPositiveResonanceLatencyMode(this.positiveResonanceLatencyMode);
      return this.positiveResonanceLatencyMode;
    }

    setPositiveResonanceCurve(value) {
      this.positiveResonanceCurve = value === 'early' || value === 'aggressive' ? value : 'current';
      this.filterbank?.setPositiveResonanceCurve(this.positiveResonanceCurve);
      return this.positiveResonanceCurve;
    }

    setReferenceLevel(value) { this.referenceLevel = [1, 0.75, 0.5, 0.25, 0].includes(Number(value)) ? Number(value) : 1; this.filterbank?.setReferenceLevel(this.referenceLevel); return this.referenceLevel; }
    setBandBoostDb(value) { this.maxBandBoostDb = [12, 18, 24].includes(Number(value)) ? Number(value) : 12; this.filterbank?.setBandBoostDb(this.maxBandBoostDb); this.applyEffectiveBandGains(); return this.maxBandBoostDb; }
    setBandCutDb(value) { this.maxBandCutDb = [12, 24, 36, 48, 60].includes(Number(value)) ? Number(value) : 12; this.filterbank?.setBandCutDb(this.maxBandCutDb); this.applyEffectiveBandGains(); return this.maxBandCutDb; }
    setSpread(value) { this.spread = clampSpread(value); this.applyEffectiveBandGains(); return this.spread; }
    setSpreadMode(value) { this.spreadMode = value === 'FB_CH_SELECT' ? 'FB_CH_SELECT' : 'CLASSIC'; this.applyEffectiveBandGains(); return this.spreadMode; }
    setSpreadCurve(value) { this.spreadCurve = normalizeSpreadCurve(value); this.applyEffectiveBandGains(); return this.spreadCurve; }
    setSpreadMaxOffsetDb(value) { this.spreadMaxOffsetDb = normalizeSpreadMaxOffsetDb(value); this.applyEffectiveBandGains(); return this.spreadMaxOffsetDb; }
    setPositiveResonanceEngine(value) { this.positiveResonanceEngine = value === 'phase2' ? value : 'tpt'; this.filterbank?.setPositiveResonanceEngine(this.positiveResonanceEngine); return this.positiveResonanceEngine; }
    setFeedbackTopology(value) { this.feedbackTopology = value === 'common-bus' ? 'common-bus' : value === 'local-loop-exp' ? 'local-loop-exp' : 'isolated-tpt'; this.filterbank?.setFeedbackTopology(this.feedbackTopology); return this.feedbackTopology; }
    setFeedbackCore(value) { this.feedbackCore = value === 'zdf-per-band' ? 'zdf-per-band' : value === 'zdf' ? 'zdf' : 'current'; this.filterbank?.setFeedbackCore(this.feedbackCore); return this.feedbackCore; }
    setLocalLoopTuning(value) { this.localLoopTuning = value === 'compensated' ? 'compensated' : 'current'; this.filterbank?.setLocalLoopTuning(this.localLoopTuning); return this.localLoopTuning; }
    setFeedbackTap(value) { this.feedbackTap = value === 'post-gain' ? 'post-gain' : 'pre-gain'; this.filterbank?.setFeedbackTap(this.feedbackTap); return this.feedbackTap; }
    setWetModel(value) { this.wetModel = value === 'filterbank-sum' ? 'filterbank-sum' : 'reference-delta'; this.filterbank?.setWetModel(this.wetModel); return this.wetModel; }
    setCommonBusSaturationMode(value) { this.commonBusSaturationMode = value === 'constant-ceiling' ? 'constant-ceiling' : 'current'; this.filterbank?.setCommonBusSaturationMode(this.commonBusSaturationMode); return this.commonBusSaturationMode; }
    setCommonBusDrive(value) { this.commonBusDrive = [0.5, 1, 2, 4, 8, 16].includes(Number(value)) ? Number(value) : 1; this.filterbank?.setCommonBusDrive(this.commonBusDrive); return this.commonBusDrive; }
    setCommonBusCeiling(value) { this.commonBusCeiling = [0.25, 0.5, 1, 2, 4].includes(Number(value)) ? Number(value) : 1; this.filterbank?.setCommonBusCeiling(this.commonBusCeiling); return this.commonBusCeiling; }
    setFeedbackAllEngine(value) { this.feedbackAllEngine = value === 'common-bus' ? 'common-bus' : 'legacy'; this.filterbank?.setFeedbackAllEngine(this.feedbackAllEngine); return this.feedbackAllEngine; }
    setFeedbackAllSource(value) { this.feedbackAllSource = value === 'pre-gain-sum' ? 'pre-gain-sum' : 'post-gain-sum'; this.filterbank?.setFeedbackAllSource(this.feedbackAllSource); return this.feedbackAllSource; }
    setPostGainFeedbackWeight(value) { this.postGainFeedbackWeight = value === 'soft-knee' ? 'soft-knee' : 'current'; this.filterbank?.setPostGainFeedbackWeight(this.postGainFeedbackWeight); return this.postGainFeedbackWeight; }
    setFeedbackAllLevel(value) { this.feedbackAllLevel = FEEDBACK_ALL_LEVELS.includes(value) ? value : 'raw'; this.filterbank?.setFeedbackAllLevel(this.feedbackAllLevel); return this.feedbackAllLevel; }
    setFeedbackAllResonanceCurve(value) { this.feedbackAllResonanceCurve = value === 'soft-knee' ? 'soft-knee' : 'current'; this.filterbank?.setFeedbackAllResonanceCurve(this.feedbackAllResonanceCurve); return this.feedbackAllResonanceCurve; }
    setFeedbackAllSaturationReturn(value) { this.feedbackAllSaturationReturn = value === 'drive-4-return-0.2' ? 'drive-4-return-0.2' : 'current'; this.filterbank?.setFeedbackAllSaturationReturn(this.feedbackAllSaturationReturn); return this.feedbackAllSaturationReturn; }

    setBandBaseGain(channel, index, value) {
      if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT) throw new RangeError('Ungültiger Bandindex.');
      const nextValue = clampBandGain(value);
      const target = channel === 'left' ? this.bandGainLeft : this.bandGainRight;
      target[index] = nextValue;
      this.applyEffectiveBandGain(index);
      return nextValue;
    }

    getEffectiveBandGains(index) {
      return getEffectiveBandGains(this, index, {
        maxBandBoostDb: this.maxBandBoostDb,
        maxBandCutDb: this.maxBandCutDb
      });
    }

    get effectiveBandGainLeft() {
      return Array.from({ length: BAND_COUNT }, (_, index) => this.getEffectiveBandGains(index).leftControl);
    }

    get effectiveBandGainRight() {
      return Array.from({ length: BAND_COUNT }, (_, index) => this.getEffectiveBandGains(index).rightControl);
    }

    get effectiveBandGainDbLeft() {
      return Array.from({ length: BAND_COUNT }, (_, index) => this.getEffectiveBandGains(index).leftDb);
    }

    get effectiveBandGainDbRight() {
      return Array.from({ length: BAND_COUNT }, (_, index) => this.getEffectiveBandGains(index).rightDb);
    }

    applyEffectiveBandGain(index) {
      if (!this.filterbank) return;
      const effective = this.getEffectiveBandGains(index);
      this.filterbank.setBandBaseGain('left', index, effective.leftControl);
      this.filterbank.setBandBaseGain('right', index, effective.rightControl);
    }

    applyEffectiveBandGains() {
      if (!this.filterbank) return;
      for (let index = 0; index < BAND_COUNT; index += 1) this.applyEffectiveBandGain(index);
    }

    setBandFeedback(channel, index, enabled) {
      if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT) throw new RangeError('Ungültiger Bandindex.');
      if (channel !== 'left' && channel !== 'right') throw new RangeError('Ungültiger Audiokanal.');
      const target = channel === 'left' ? this.feedbackBandLeft : this.feedbackBandRight;
      const nextValue = Boolean(enabled);
      target[index] = nextValue;
      this.filterbank?.setBandFeedback(channel, index, nextValue);
      return nextValue;
    }

    setFeedbackAll(channel, enabled) {
      if (channel !== 'left' && channel !== 'right') throw new RangeError('Ungültiger Audiokanal.');
      const nextValue = Boolean(enabled);
      if (channel === 'left') this.feedbackAllLeft = nextValue;
      else this.feedbackAllRight = nextValue;
      this.filterbank?.setFeedbackAll(channel, nextValue);
      return nextValue;
    }

    getFilterbankState() {
      return {
        bandGainLeft: this.effectiveBandGainLeft,
        bandGainRight: this.effectiveBandGainRight,
        feedbackBandLeft: this.feedbackBandLeft,
        feedbackBandRight: this.feedbackBandRight,
        feedbackAllLeft: this.feedbackAllLeft,
        feedbackAllRight: this.feedbackAllRight,
        resonance: this.resonance,
        positiveResonanceAuditionGain: this.positiveResonanceAuditionGain,
        positiveResonanceDrive: this.positiveResonanceDrive,
        positiveResonanceDampingFloor: this.positiveResonanceDampingFloor,
        positiveResonanceOutputMode: this.positiveResonanceOutputMode,
        positiveResonanceLatencyMode: this.positiveResonanceLatencyMode,
        positiveResonanceCurve: this.positiveResonanceCurve
        , referenceLevel: this.referenceLevel, maxBandBoostDb: this.maxBandBoostDb, maxBandCutDb: this.maxBandCutDb, positiveResonanceEngine: this.positiveResonanceEngine
        , feedbackTopology: this.feedbackTopology, feedbackCore: this.feedbackCore, localLoopTuning: this.localLoopTuning, feedbackTap: this.feedbackTap, wetModel: this.wetModel
        , commonBusSaturationMode: this.commonBusSaturationMode, commonBusDrive: this.commonBusDrive, commonBusCeiling: this.commonBusCeiling
        , feedbackAllEngine: this.feedbackAllEngine, feedbackAllSource: this.feedbackAllSource, postGainFeedbackWeight: this.postGainFeedbackWeight, feedbackAllLevel: this.feedbackAllLevel, feedbackAllResonanceCurve: this.feedbackAllResonanceCurve, feedbackAllSaturationReturn: this.feedbackAllSaturationReturn
        , onDiagnostics: this.onDiagnostics
      };
    }

    getState() {
      const { onDiagnostics, ...filterbankState } = this.getFilterbankState();
      return {
        ...filterbankState,
        bandGainLeft: [...this.bandGainLeft],
        bandGainRight: [...this.bandGainRight],
        spread: this.spread,
        spreadMode: this.spreadMode,
        spreadCurve: this.spreadCurve,
        spreadMaxOffsetDb: this.spreadMaxOffsetDb,
        feedbackBandLeft: [...this.feedbackBandLeft],
        feedbackBandRight: [...this.feedbackBandRight],
        inputGainDb: this.inputGainDb,
        inputPreampStage: this.inputPreampStage,
        inputCharacterAmount: this.inputCharacterAmount,
        dryWet: this.dryWet,
        volumeDb: this.volumeDb
      };
    }

    applyState(snapshot) {
      const left = Array.isArray(snapshot?.bandGainLeft) ? snapshot.bandGainLeft : [];
      const right = Array.isArray(snapshot?.bandGainRight) ? snapshot.bandGainRight : [];
      const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
      this.bandGainLeft = Array.from({ length: BAND_COUNT }, (_, index) => clampBandGain(left[index] ?? 0));
      this.bandGainRight = Array.from({ length: BAND_COUNT }, (_, index) => clampBandGain(right[index] ?? 0));
      this.feedbackBandLeft = Array.from({ length: BAND_COUNT }, (_, index) => Boolean(snapshot?.feedbackBandLeft?.[index]));
      this.feedbackBandRight = Array.from({ length: BAND_COUNT }, (_, index) => Boolean(snapshot?.feedbackBandRight?.[index]));
      this.feedbackAllLeft = Boolean(snapshot?.feedbackAllLeft);
      this.feedbackAllRight = Boolean(snapshot?.feedbackAllRight);
      this.setSpreadMode(snapshot?.spreadMode ?? this.spreadMode);
      this.setSpreadCurve(snapshot?.spreadCurve ?? this.spreadCurve);
      this.setSpreadMaxOffsetDb(snapshot?.spreadMaxOffsetDb ?? this.spreadMaxOffsetDb);
      this.setSpread(snapshot?.spread ?? this.spread);
      if (snapshot?.inputGainDb !== undefined) this.setInputGainDb(finiteOr(snapshot.inputGainDb, this.inputGainDb));
      if (snapshot?.inputPreampStage !== undefined) this.setInputPreampStage(snapshot.inputPreampStage);
      if (snapshot?.inputCharacterAmount !== undefined) this.setInputCharacterAmount(finiteOr(snapshot.inputCharacterAmount, this.inputCharacterAmount));
      if (snapshot?.dryWet !== undefined) this.setDryWet(finiteOr(snapshot.dryWet, this.dryWet));
      if (snapshot?.volumeDb !== undefined) this.setVolumeDb(finiteOr(snapshot.volumeDb, this.volumeDb));
      this.setResonance(snapshot?.resonance);
      this.setPositiveResonanceDrive(snapshot?.positiveResonanceDrive ?? this.positiveResonanceDrive);
      this.setPositiveResonanceDampingFloor(snapshot?.positiveResonanceDampingFloor ?? this.positiveResonanceDampingFloor);
      this.setPositiveResonanceOutputMode(snapshot?.positiveResonanceOutputMode ?? this.positiveResonanceOutputMode);
      this.setPositiveResonanceLatencyMode(snapshot?.positiveResonanceLatencyMode ?? this.positiveResonanceLatencyMode);
      this.setPositiveResonanceCurve(snapshot?.positiveResonanceCurve ?? this.positiveResonanceCurve);
      this.setReferenceLevel(snapshot?.referenceLevel ?? this.referenceLevel);
      this.setBandBoostDb(snapshot?.maxBandBoostDb ?? this.maxBandBoostDb);
      this.setBandCutDb(snapshot?.maxBandCutDb ?? this.maxBandCutDb);
      this.setPositiveResonanceEngine(snapshot?.positiveResonanceEngine ?? this.positiveResonanceEngine);
      this.setFeedbackTopology(snapshot?.feedbackTopology ?? this.feedbackTopology);
      this.setFeedbackCore(snapshot?.feedbackCore ?? this.feedbackCore);
      this.setLocalLoopTuning(snapshot?.localLoopTuning ?? this.localLoopTuning);
      this.setFeedbackTap(snapshot?.feedbackTap ?? this.feedbackTap);
      this.setWetModel(snapshot?.wetModel ?? this.wetModel);
      this.setFeedbackAllEngine(snapshot?.feedbackAllEngine ?? this.feedbackAllEngine);
      this.setFeedbackAllSource(snapshot?.feedbackAllSource ?? this.feedbackAllSource);
      this.setPostGainFeedbackWeight(snapshot?.postGainFeedbackWeight ?? this.postGainFeedbackWeight);
      this.setFeedbackAllLevel(snapshot?.feedbackAllLevel ?? this.feedbackAllLevel);
      this.setFeedbackAllResonanceCurve(snapshot?.feedbackAllResonanceCurve ?? this.feedbackAllResonanceCurve);
      this.setFeedbackAllSaturationReturn(snapshot?.feedbackAllSaturationReturn ?? this.feedbackAllSaturationReturn);
      if (this.filterbank) this.filterbank.applyState(this.getFilterbankState());
    }

    setSmoothedParam(param, value, smoothingTime = 0.015) {
      this.setAudioParam(param, value, false, smoothingTime);
    }

    setAudioParam(param, value, immediate, smoothingTime = 0.015) {
      if (!param) return;
      if (immediate) { param.value = value; return; }
      const now = this.context?.currentTime || 0;
      if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(now);
      if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, now, smoothingTime);
      else param.value = value;
    }

    applyAudioParameters(immediate = false) {
      this.setAudioParam(this.inputGainNode?.gain, dbToGain(this.inputGainDb), immediate);
      this.inputPreampNode?.port.postMessage({ type: 'set-input-gain-db', value: this.inputGainDb });
      this.inputPreampNode?.port.postMessage({ type: 'set-input-stage', value: this.inputPreampStage });
      this.inputPreampNode?.port.postMessage({ type: 'set-character-amount', value: this.inputCharacterAmount / 100 });
      const gains = dryWetGains(this.dryWet);
      this.setAudioParam(this.dryGainNode?.gain, gains.dry, immediate);
      this.setAudioParam(this.wetGainNode?.gain, gains.wet, immediate);
      this.setAudioParam(this.volumeGainNode?.gain, dbToGain(this.volumeDb), immediate);
    }

    setGateGain(gate, value, time = this.context?.currentTime || 0, rampSeconds = 0) {
      const gain = gate?.gain;
      if (!gain) return;
      gain.cancelScheduledValues?.(time);
      if (!rampSeconds) { gain.setValueAtTime?.(value, time); gain.value = value; return; }
      gain.setValueAtTime?.(gain.value, time);
      if (gain.linearRampToValueAtTime) gain.linearRampToValueAtTime(value, time + rampSeconds);
      else if (gain.setTargetAtTime) gain.setTargetAtTime(value, time, Math.max(.001, rampSeconds / 3));
      else gain.value = value;
    }

    disconnectNode(node) {
      try { node?.disconnect?.(); } catch (_) {}
    }

    stopInputNodes({ immediate = false } = {}) {
      const context = this.context;
      const now = context?.currentTime || 0;
      const fadeSeconds = immediate ? 0 : .008;
      const oldGate = this.activeInputGate;
      const oldSource = this.source;
      const oldStream = this.stream;
      const oldSampleSource = this.sampleSource;
      this.activeInputGate = null;
      this.source = null;
      this.stream = null;
      this.sampleSource = null;
      this.setGateGain(oldGate, 0, now, fadeSeconds);
      if (oldSampleSource) {
        const { source, gain } = oldSampleSource;
        try { source.stop(now + fadeSeconds); } catch (_) {}
        source.onended = () => { this.disconnectNode(source); this.disconnectNode(gain); };
      }
      const dispose = () => {
        this.disconnectNode(oldSource);
        this.disconnectNode(oldGate);
        oldStream?.getTracks?.().forEach(track => track.stop());
      };
      if (immediate || !context) dispose();
      else window.setTimeout(dispose, Math.ceil((fadeSeconds + .004) * 1000));
    }

    createInputGate(startTime) {
      const gate = this.context.createGain();
      this.setGateGain(gate, 0, this.context.currentTime || 0);
      gate.connect(this.sourceBus);
      this.activeInputGate = gate;
      this.setGateGain(gate, 1, startTime, .008);
      return gate;
    }

    async loadSampleBuffer(sample) {
      if (!sample?.id || !sample?.path) throw new Error('Ungültige Sample-Konfiguration.');
      const cached = this.sampleBufferCache.get(sample.id);
      if (cached) return cached;
      const load = (async () => {
        const response = await fetch(sample.path);
        if (!response.ok) throw new Error(`Sample konnte nicht geladen werden: ${sample.name || sample.id}`);
        const data = await response.arrayBuffer();
        return this.context.decodeAudioData(data.slice(0));
      })().catch(error => { this.sampleBufferCache.delete(sample.id); throw error; });
      this.sampleBufferCache.set(sample.id, load);
      return load;
    }

    async activateDevice(inputDeviceId) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofonzugriff wird von diesem Browser nicht unterstützt.');
      const audioConstraints = { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      if (inputDeviceId) audioConstraints.deviceId = { exact: inputDeviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const source = this.context.createMediaStreamSource(stream);
      this.stopInputNodes();
      const gate = this.createInputGate((this.context.currentTime || 0) + .012);
      source.connect(gate);
      this.stream = stream;
      this.source = source;
      this.onDevicesChanged?.(await this.refreshDevices());
    }

    async activateSample(sample) {
      if (!sample?.path) throw new Error('Kein integriertes Sample ausgewählt.');
      const buffer = await this.loadSampleBuffer(sample);
      this.stopInputNodes();
      const now = this.context.currentTime || 0;
      const startTime = now + .02;
      const gate = this.createInputGate(startTime);
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(gate);
      source.start(startTime);
      this.sampleSource = { sample, source, gain, startTime };
    }

    async setSource({ sourceMode = 'device', inputDeviceId = '', sample = null } = {}) {
      if (!this.context || !this.sourceBus) return;
      const mode = sourceMode === 'sample' ? 'sample' : 'device';
      if (mode === 'sample') await this.activateSample(sample);
      else await this.activateDevice(inputDeviceId);
      this.sourceMode = mode;
      this.sample = sample;
    }

    ensureInputSpectrumAnalysers() {
      if (this.inputSpectrumAnalyserLeft && this.inputSpectrumAnalyserRight) return true;
      if (!this.context || !this.inputPreampNode || typeof this.context.createChannelSplitter !== 'function' || typeof this.context.createAnalyser !== 'function') return false;
      this.inputSpectrumSplitterNode = this.context.createChannelSplitter(2);
      this.inputSpectrumAnalyserLeft = this.context.createAnalyser();
      this.inputSpectrumAnalyserRight = this.context.createAnalyser();
      [this.inputSpectrumAnalyserLeft, this.inputSpectrumAnalyserRight].forEach(analyser => {
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.75;
        analyser.minDecibels = -90;
        analyser.maxDecibels = 0;
      });
      // Passive pre-filterbank measurement branch. It has no route to the
      // mix or destination and therefore cannot alter the audible path.
      this.inputPreampNode.connect(this.inputSpectrumSplitterNode);
      this.inputSpectrumSplitterNode.connect(this.inputSpectrumAnalyserLeft, 0);
      this.inputSpectrumSplitterNode.connect(this.inputSpectrumAnalyserRight, 1);
      return true;
    }

    async start({ inputDeviceId, outputDeviceId, sourceMode = 'device', sample = null }) {
      if (this.status === 'STARTING' || this.status === 'ON') return;
      this.setStatus('STARTING');
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('AudioContext ist in diesem Browser nicht verfügbar.');
        this.context = new AudioContextClass();
        await this.context.resume();
        this.sourceBus = this.context.createGain();
        this.inputGainNode = this.context.createGain();
        await loadInputPreampModule(this.context);
        this.inputPreampNode = new AudioWorkletNode(this.context, INPUT_PREAMP_PROCESSOR_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit',
          channelInterpretation: 'discrete',
          processorOptions: { inputGainDb: this.inputGainDb, stage: this.inputPreampStage, characterAmount: this.inputCharacterAmount / 100 }
        });
        this.dryGainNode = this.context.createGain();
        this.wetGainNode = this.context.createGain();
        if (typeof this.context.createChannelSplitter === 'function' && typeof this.context.createAnalyser === 'function') {
          this.spectrumSplitterNode = this.context.createChannelSplitter(2);
          this.spectrumAnalyserLeft = this.context.createAnalyser();
          this.spectrumAnalyserRight = this.context.createAnalyser();
          [this.spectrumAnalyserLeft, this.spectrumAnalyserRight].forEach(analyser => {
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.75;
            analyser.minDecibels = -90;
            analyser.maxDecibels = 0;
          });
        }
        this.mixBus = this.context.createGain();
        this.volumeGainNode = this.context.createGain();
        this.destination = this.context.createMediaStreamDestination();
        this.filterbank = await Filterbank.create(this.context, this.getFilterbankState());

        // The wet branch stays structurally unchanged; Filterbank owns its DSP internally.
        this.sourceBus.connect(this.inputGainNode);
        this.inputGainNode.connect(this.inputPreampNode);
        this.inputPreampNode.connect(this.dryGainNode);
        this.inputPreampNode.connect(this.filterbank.input);
        this.dryGainNode.connect(this.mixBus);
        this.filterbank.output.connect(this.wetGainNode);
        // Tap the actual stereo Filterbank output before dry/wet and master
        // volume. The splitter/analyser branch has no connection to audio out.
        if (this.spectrumSplitterNode && this.spectrumAnalyserLeft && this.spectrumAnalyserRight) {
          this.filterbank.output.connect(this.spectrumSplitterNode);
          this.spectrumSplitterNode.connect(this.spectrumAnalyserLeft, 0);
          this.spectrumSplitterNode.connect(this.spectrumAnalyserRight, 1);
        }
        this.wetGainNode.connect(this.mixBus);
        this.mixBus.connect(this.volumeGainNode);
        this.volumeGainNode.connect(this.destination);
        this.applyAudioParameters(true);
        await this.setSource({ sourceMode, inputDeviceId, sample });

        this.outputElement = document.createElement('audio');
        this.outputElement.autoplay = true;
        this.outputElement.srcObject = this.destination.stream;
        document.body.appendChild(this.outputElement);
        if (typeof this.outputElement.setSinkId === 'function') await this.outputElement.setSinkId(outputDeviceId || '');
        else if (outputDeviceId) throw new Error('Dieses Chrome-Setup unterstützt keine Audio-Auswahl.');
        await this.outputElement.play();
        this.setStatus('ON');
      } catch (error) {
        await this.cleanup();
        this.setStatus('ERROR', this.getErrorMessage(error));
        throw error;
      }
    }

    async stop() {
      await this.cleanup();
      this.setStatus('OFF');
    }

    async cleanup() {
      this.stopInputNodes({ immediate: true });
      if (this.filterbank) { this.filterbank.dispose(); this.filterbank = null; }
      [this.sourceBus, this.inputGainNode, this.inputPreampNode, this.dryGainNode, this.wetGainNode, this.inputSpectrumSplitterNode, this.inputSpectrumAnalyserLeft, this.inputSpectrumAnalyserRight, this.spectrumSplitterNode, this.spectrumAnalyserLeft, this.spectrumAnalyserRight, this.mixBus, this.volumeGainNode].forEach(node => this.disconnectNode(node));
      this.source = null;
      this.sourceBus = null;
      this.activeInputGate = null;
      this.sampleSource = null;
      this.inputGainNode = null;
      this.inputPreampNode = null;
      this.dryGainNode = null;
      this.wetGainNode = null;
      this.inputSpectrumSplitterNode = null;
      this.inputSpectrumAnalyserLeft = null;
      this.inputSpectrumAnalyserRight = null;
      this.spectrumSplitterNode = null;
      this.spectrumAnalyserLeft = null;
      this.spectrumAnalyserRight = null;
      this.mixBus = null;
      this.volumeGainNode = null;
      if (this.outputElement) { this.outputElement.pause(); this.outputElement.srcObject = null; this.outputElement.remove(); this.outputElement = null; }
      if (this.context) { await this.context.close(); this.context = null; }
      this.destination = null;
    }

    getErrorMessage(error) {
      if (error?.name === 'NotAllowedError') return 'Audio-Berechtigung wurde verweigert.';
      if (error?.name === 'NotFoundError') return 'Kein Audio-Eingabegerät gefunden.';
      if (error?.name === 'NotReadableError') return 'Das Audio-Eingabegerät ist nicht verfügbar.';
      return error?.message || 'Audio konnte nicht gestartet werden.';
    }
  }

  window.AudioEngine = AudioEngine;
})();
