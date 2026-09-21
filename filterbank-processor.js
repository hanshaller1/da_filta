import { LinearTptSvf, OversampledPositiveTptResonator } from './tpt-svf.js';

const COMMON_BUS_RESONANCE_EPSILON = 1e-12;
const DIAGNOSTICS_UPDATE_HZ = 15;
const LOCAL_LOOP_COMPENSATED_BAND_INDEXES = Object.freeze([3, 5, 6, 7]);
const FEEDBACK_ALL_SOFT_KNEE_POINTS = Object.freeze([
  Object.freeze({ resonance: 0.50, gain: 0.25, slope: 1.0 }),
  Object.freeze({ resonance: 0.75, gain: 0.56, slope: 1.2 }),
  Object.freeze({ resonance: 0.95, gain: 0.80, slope: 1.2 }),
  Object.freeze({ resonance: 1.00, gain: 1.00, slope: 5.0 })
]);

class DaFiltaProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const processorOptions = options?.processorOptions || {};
    this.bandFrequencies = this.readBandDefinition(processorOptions.bandFrequencies, 'Frequenzen');
    this.bandQs = this.readBandDefinition(processorOptions.bandQs, 'Q-Werte');
    this.bandCount = this.bandFrequencies.length;
    this.maxBandGainDb = this.readPositiveOption(processorOptions.maxBandGainDb, 12);
    this.maxBandBoostDb = this.readBandBoostDb(processorOptions.maxBandBoostDb ?? this.maxBandGainDb);
    this.maxBandCutDb = this.readBandCutDb(processorOptions.maxBandCutDb ?? this.maxBandGainDb);
    this.referenceLevel = this.readReferenceLevel(processorOptions.referenceLevel);
    this.referenceLevelTarget = this.referenceLevel;
    this.positiveResonanceEngine = this.readPositiveResonanceEngine(processorOptions.positiveResonanceEngine);
    this.feedbackTopology = processorOptions.feedbackTopology === 'common-bus'
      ? 'common-bus'
      : processorOptions.feedbackTopology === 'local-loop-exp' ? 'local-loop-exp' : 'isolated-tpt';
    this.feedbackCore = processorOptions.feedbackCore === 'zdf' ? 'zdf' : 'current';
    this.localLoopTuning = this.readLocalLoopTuning(processorOptions.localLoopTuning);
    this.feedbackTap = processorOptions.feedbackTap === 'post-gain' ? 'post-gain' : 'pre-gain';
    this.wetModel = processorOptions.wetModel === 'filterbank-sum' ? 'filterbank-sum' : 'reference-delta';
    this.commonBusSaturationMode = processorOptions.commonBusSaturationMode === 'constant-ceiling' ? 'constant-ceiling' : 'current';
    this.commonBusDrive = this.readCommonBusDrive(processorOptions.commonBusDrive);
    this.commonBusDriveTarget = this.commonBusDrive;
    this.commonBusCeiling = this.readCommonBusCeiling(processorOptions.commonBusCeiling);
    this.commonBusCeilingTarget = this.commonBusCeiling;
    this.feedbackAllEngine = this.readFeedbackAllEngine(processorOptions.feedbackAllEngine);
    this.feedbackAllSource = this.readFeedbackAllSource(processorOptions.feedbackAllSource);
    this.postGainFeedbackWeight = this.readPostGainFeedbackWeight(processorOptions.postGainFeedbackWeight);
    this.feedbackAllLevel = this.readFeedbackAllLevel(processorOptions.feedbackAllLevel);
    this.feedbackAllResonanceCurve = this.readFeedbackAllResonanceCurve(processorOptions.feedbackAllResonanceCurve);
    this.feedbackAllSaturationReturn = this.readFeedbackAllSaturationReturn(processorOptions.feedbackAllSaturationReturn);
    this.maxFeedbackGain = this.readPositiveOption(processorOptions.maxFeedbackGain, 1.25);
    this.maxAuditionGain = this.readPositiveOption(processorOptions.maxAuditionGain, 0.25);
    this.resonatorDampingFloor = this.readResonatorDampingFloor(processorOptions.resonatorDampingFloor);
    this.resonatorDampingFloorTarget = this.resonatorDampingFloor;
    // The CAL floor is intentionally scoped to the audible nonlinear 2x
    // resonator. This retained linear scaffold stays at its established
    // value and cannot change the production character indirectly.
    this.linearResonatorDampingFloor = 0.1;
    this.enableNonlinearResonatorDiagnostics = processorOptions.enableNonlinearResonatorDiagnostics === true;
    this.enableNonlinearPositiveResonator = processorOptions.enableNonlinearPositiveResonator === true;
    this.enableNonlinearResonator = this.enableNonlinearResonatorDiagnostics || this.enableNonlinearPositiveResonator;
    this.positiveResonanceDrive = this.readDiagnosticDrive(
      processorOptions.positiveResonanceDrive ?? processorOptions.nonlinearResonatorDrive,
      this.enableNonlinearPositiveResonator ? 1 : 4
    );
    this.positiveResonanceDriveTarget = this.positiveResonanceDrive;
    this.positiveResonanceAuditionGain = this.readPositiveOption(processorOptions.positiveResonanceAuditionGain, 0.1);
    this.positiveResonanceAuditionGainTarget = this.positiveResonanceAuditionGain;
    this.positiveResonanceOutputMode = this.readPositiveResonanceOutputMode(processorOptions.positiveResonanceOutputMode);
    this.positiveResonanceOutputModeTarget = this.positiveResonanceOutputMode;
    this.positiveResonanceLatencyMode = this.readPositiveResonanceLatencyMode(processorOptions.positiveResonanceLatencyMode);
    this.positiveResonanceLatencyModeTarget = this.positiveResonanceLatencyMode;
    this.positiveResonanceCurve = this.readPositiveResonanceCurve(processorOptions.positiveResonanceCurve);
    this.feedbackAllNormalization = this.readPositiveOption(processorOptions.feedbackAllNormalization, 1 / Math.sqrt(this.bandCount));
    this.bandGainSmoothingCoefficient = this.smoothingCoefficient(processorOptions.smoothingTime, 0.015);
    this.feedbackGateSmoothingCoefficient = this.smoothingCoefficient(processorOptions.feedbackGateSmoothingTime, 0.008);
    this.resonanceSmoothingCoefficient = this.smoothingCoefficient(processorOptions.resonanceSmoothingTime, 0.015);
    this.positiveResonanceAuditionGainSmoothingCoefficient = this.smoothingCoefficient(
      processorOptions.positiveResonanceAuditionGainSmoothingTime,
      0.015
    );
    this.positiveResonanceDriveSmoothingCoefficient = this.smoothingCoefficient(
      processorOptions.positiveResonanceDriveSmoothingTime,
      0.015
    );
    this.resonatorDampingFloorSmoothingCoefficient = this.smoothingCoefficient(
      processorOptions.resonatorDampingFloorSmoothingTime,
      0.015
    );
    this.referenceLevelSmoothingCoefficient = this.smoothingCoefficient(0.015, 0.015);
    this.commonBusSmoothingCoefficient = this.smoothingCoefficient(0.015, 0.015);
    this.devModeSmoothingCoefficient = this.smoothingCoefficient(0.015, 0.015);
    this.positiveResonanceOutputWeights = new Float64Array(3);
    this.positiveResonanceOutputTargets = new Float64Array(3);
    this.positiveResonanceLatencyWeights = new Float64Array(2);
    this.positiveResonanceLatencyTargets = new Float64Array(2);
    this.setPositiveResonanceOutputMode(this.positiveResonanceOutputMode, true);
    this.setPositiveResonanceLatencyMode(this.positiveResonanceLatencyMode, true);
    this.disposed = false;
    this.bandControls = {
      left: this.readControls(processorOptions.bandGainLeft),
      right: this.readControls(processorOptions.bandGainRight)
    };
    this.deltaGains = {
      left: this.bandControls.left.map(control => this.controlToDeltaGain(control)),
      right: this.bandControls.right.map(control => this.controlToDeltaGain(control))
    };
    this.deltaTargets = {
      left: [...this.deltaGains.left],
      right: [...this.deltaGains.right]
    };
    this.feedbackGates = {
      left: this.readFeedbackGates(processorOptions.feedbackBandLeft),
      right: this.readFeedbackGates(processorOptions.feedbackBandRight)
    };
    this.feedbackGateTargets = {
      left: [...this.feedbackGates.left],
      right: [...this.feedbackGates.right]
    };
    this.feedbackAllGates = {
      left: processorOptions.feedbackAllLeft ? 1 : 0,
      right: processorOptions.feedbackAllRight ? 1 : 0
    };
    this.feedbackAllGateTargets = { ...this.feedbackAllGates };
    this.feedbackReturns = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.commonFeedbackReturns = { left: 0, right: 0 };
    this.localFeedbackReturns = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.mainCommonFeedbackReturns = { left: 0, right: 0 };
    this.mainCommonSaturationOutputs = { left: 0, right: 0 };
    this.mainCommonNonFiniteResetCounts = { left: 0, right: 0 };
    this.zdfReturn = { left: 0, right: 0 };
    this.zdfLocalReturn = { left: 0, right: 0 };
    this.zdfMainReturn = { left: 0, right: 0 };
    this.zdfLocalBus = { left: 0, right: 0 };
    this.zdfMainBus = { left: 0, right: 0 };
    this.zdfSolverIterations = { left: 0, right: 0 };
    this.zdfSolverMaxIterations = { left: 0, right: 0 };
    this.zdfSolverResidual = { left: 0, right: 0 };
    this.zdfSolverFallbackCount = { left: 0, right: 0 };
    this.zdfNonFiniteResetCount = { left: 0, right: 0 };
    this.bandOutputs = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.resonatorBandOutputs = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.resonanceResiduals = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.resonanceTarget = this.clampResonance(processorOptions.resonance);
    this.resonance = this.resonanceTarget;
    this.compensatedLocalLoopFrequencies = this.createCompensatedLocalLoopFrequencies();
    this.baseFilters = {
      left: this.createFilters(),
      right: this.createFilters()
    };
    this.applyLocalLoopTuning();
    this.resonatorFilters = {
      left: this.createFilters(),
      right: this.createFilters()
    };
    this.nonlinearResonatorFilters = this.enableNonlinearResonator ? {
      left: this.createOversampledResonatorFilters(),
      right: this.createOversampledResonatorFilters()
    } : null;
    this.resonatorMagnitudes = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.resonatorAuditionGates = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.collectResonatorDiagnostics = processorOptions.collectResonatorDiagnostics === true;
    this.diagnosticsFramesUntilPublish = Math.max(1, Math.round(sampleRate / DIAGNOSTICS_UPDATE_HZ));
    this.diagnosticsFrameCounter = 0;
    this.resonatorDiagnostics = {
      left: this.createResonatorDiagnostics(),
      right: this.createResonatorDiagnostics()
    };
    this.initializeResonatorMagnitudes();

    this.port.onmessage = event => this.handleMessage(event.data);
  }

  readBandDefinition(values, label) {
    if (!Array.isArray(values) || values.length !== 10 || values.some(value => !Number.isFinite(value) || value <= 0)) {
      throw new Error(`Ungültige Filterbank-${label}.`);
    }
    return [...values];
  }

  readPositiveOption(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  readReferenceLevel(value) {
    const numericValue = Number(value);
    return numericValue === 1 || numericValue === 0.75 || numericValue === 0.5 || numericValue === 0.25 || numericValue === 0
      ? numericValue : 1;
  }

  readBandBoostDb(value) {
    const numericValue = Number(value);
    return numericValue === 12 || numericValue === 18 || numericValue === 24 ? numericValue : 12;
  }

  readBandCutDb(value) {
    const numericValue = Number(value);
    return numericValue === 12 || numericValue === 24 || numericValue === 36 || numericValue === 48 || numericValue === 60 ? numericValue : 12;
  }

  readPositiveResonanceEngine(value) {
    return value === 'phase2' ? 'phase2' : 'tpt';
  }
  readLocalLoopTuning(value) { return value === 'compensated' ? 'compensated' : 'current'; }
  readFeedbackAllEngine(value) { return value === 'common-bus' ? 'common-bus' : 'legacy'; }
  readFeedbackAllSource(value) { return value === 'pre-gain-sum' ? 'pre-gain-sum' : 'post-gain-sum'; }
  readPostGainFeedbackWeight(value) { return value === 'soft-knee' ? 'soft-knee' : 'current'; }
  readFeedbackAllLevel(value) {
    return ['sqrt2', 'half', 'sqrt10', 'tenth', 'twentieth', 'fortieth', 'eightieth'].includes(value) ? value : 'raw';
  }
  readFeedbackAllResonanceCurve(value) { return value === 'soft-knee' ? 'soft-knee' : 'current'; }
  readFeedbackAllSaturationReturn(value) { return value === 'drive-4-return-0.2' ? 'drive-4-return-0.2' : 'current'; }
  feedbackAllLevelScale() {
    return this.feedbackAllLevel === 'sqrt2' ? 1 / Math.sqrt(2)
      : this.feedbackAllLevel === 'half' ? 0.5
        : this.feedbackAllLevel === 'sqrt10' ? 1 / Math.sqrt(10)
          : this.feedbackAllLevel === 'tenth' ? 0.1
            : this.feedbackAllLevel === 'twentieth' ? 0.05
              : this.feedbackAllLevel === 'fortieth' ? 0.025
                : this.feedbackAllLevel === 'eightieth' ? 0.0125
                  : 1;
  }
  postGainFeedbackWeightDb(audibleGainDb) {
    const inputDb = Number.isFinite(audibleGainDb) ? audibleGainDb : 0;
    if (inputDb <= 12) return inputDb;
    if (inputDb >= 24) return 18 + (inputDb - 24) * 0.5;
    const kneeDb = inputDb - 12;
    // C1 polynomial through (12, 12), (18, 15), and (24, 18). Its
    // endpoint slopes are 1 and 0.5 dB/dB, so the continuation is smooth.
    return 12 + kneeDb - kneeDb ** 2 / 6 + 5 * kneeDb ** 3 / 288 - kneeDb ** 4 / 1728;
  }
  mainPostGainFeedbackWeight(audibleGain) {
    if (this.postGainFeedbackWeight !== 'soft-knee') return audibleGain;
    const safeAudibleGain = Number.isFinite(audibleGain) && audibleGain > 0 ? audibleGain : 1;
    const kneeThreshold = 10 ** (12 / 20);
    // Returning the original factor below the knee preserves the CURRENT
    // arithmetic exactly for cuts, neutral, and boosts through +12 dB.
    if (safeAudibleGain <= kneeThreshold) return safeAudibleGain;
    const feedbackGain = 10 ** (this.postGainFeedbackWeightDb(20 * Math.log10(safeAudibleGain)) / 20);
    return Number.isFinite(feedbackGain) ? Math.min(safeAudibleGain, feedbackGain) : safeAudibleGain;
  }
  readCommonBusDrive(value) { return [0.5, 1, 2, 4, 8, 16].includes(Number(value)) ? Number(value) : 1; }
  readCommonBusCeiling(value) { return [0.25, 0.5, 1, 2, 4].includes(Number(value)) ? Number(value) : 1; }

  readResonatorDampingFloor(value) {
    const numericValue = Number(value);
    return numericValue === 0.1 || numericValue === 0.05 || numericValue === 0.02
      || numericValue === 0 || numericValue === -0.02 || numericValue === -0.05 || numericValue === -0.10
      ? numericValue
      : 0.1;
  }

  readDiagnosticDrive(value, fallback = 4) {
    const numericValue = Number(value);
    return numericValue === 1 || numericValue === 2 || numericValue === 4 || numericValue === 8 || numericValue === 16 || numericValue === 24 || numericValue === 32
      ? numericValue
      : fallback;
  }

  readPositiveResonanceOutputMode(value) {
    return value === 'nonlinear-base' || value === 'full-nonlinear' ? value : 'current-residual';
  }

  readPositiveResonanceLatencyMode(value) {
    return value === 'matched' ? 'matched' : 'current';
  }

  readPositiveResonanceCurve(value) {
    return value === 'early' || value === 'aggressive' ? value : 'current';
  }

  outputModeIndex(mode) {
    return mode === 'nonlinear-base' ? 1 : mode === 'full-nonlinear' ? 2 : 0;
  }

  latencyModeIndex(mode) {
    return mode === 'matched' ? 1 : 0;
  }

  smoothingCoefficient(value, fallback) {
    const smoothingTime = this.readPositiveOption(value, fallback);
    return Math.exp(-1 / Math.max(1, smoothingTime * sampleRate));
  }

  readControls(values) {
    return Array.from({ length: this.bandCount }, (_, index) => this.clampControl(values?.[index] ?? 0));
  }

  readFeedbackGates(values) {
    return Array.from({ length: this.bandCount }, (_, index) => values?.[index] ? 1 : 0);
  }

  clampControl(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.min(100, Math.max(-100, numericValue));
  }

  clampResonance(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.min(1, Math.max(-1, numericValue));
  }

  controlToDeltaGain(control) {
    const normalizedControl = this.clampControl(control) / 100;
    const gainDb = normalizedControl >= 0
      ? this.maxBandBoostDb * normalizedControl
      : this.maxBandCutDb * normalizedControl;
    return 10 ** (gainDb / 20) - 1;
  }

  getResonatorMagnitudeTarget(localGate) {
    if (localGate <= 1e-12 || this.resonanceTarget <= 0) return 0;
    const resonance = this.resonanceTarget;
    const curvedResonance = this.positiveResonanceCurve === 'early'
      ? Math.sqrt(resonance)
      : this.positiveResonanceCurve === 'aggressive'
        ? Math.cbrt(resonance)
        : resonance;
    return Math.min(1, localGate * curvedResonance);
  }

  getResonatorDampingScale(magnitude) {
    const normalizedMagnitude = Math.min(1, Math.max(0, magnitude));
    return 1 - (1 - this.resonatorDampingFloor) * normalizedMagnitude;
  }

  getLinearResonatorDampingScale(magnitude) {
    const normalizedMagnitude = Math.min(1, Math.max(0, magnitude));
    return 1 - (1 - this.linearResonatorDampingFloor) * normalizedMagnitude;
  }

  initializeResonatorMagnitudes() {
    for (const channel of ['left', 'right']) {
      for (let band = 0; band < this.bandCount; band += 1) {
        const magnitude = this.getResonatorMagnitudeTarget(this.feedbackGates[channel][band]);
        this.resonatorMagnitudes[channel][band] = magnitude;
        this.resonatorAuditionGates[channel][band] = magnitude > 1e-12 ? 1 : 0;
        this.resonatorFilters[channel][band].setDampingScale(this.getLinearResonatorDampingScale(magnitude));
      }
    }
  }

  createFilters() {
    const filters = new Array(this.bandCount);
    for (let index = 0; index < this.bandCount; index += 1) {
      filters[index] = new LinearTptSvf(sampleRate, this.bandFrequencies[index], this.bandQs[index]);
    }
    return filters;
  }

  isCompensatedLocalLoopBand(index) {
    return LOCAL_LOOP_COMPENSATED_BAND_INDEXES.includes(index);
  }

  tptBandpassPhase(centerFrequency, q, targetFrequency) {
    const g = Math.tan(Math.PI * centerFrequency / sampleRate);
    const k = 1 / q;
    const coefficientDenominator = 1 + g * (g + k);
    const b0 = (k * g) / coefficientDenominator;
    const d1 = (2 * (g * g - 1)) / coefficientDenominator;
    const d2 = (1 - g * k + g * g) / coefficientDenominator;
    const omega = (2 * Math.PI * targetFrequency) / sampleRate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    const cosine2 = Math.cos(2 * omega);
    const sine2 = Math.sin(2 * omega);
    const numeratorReal = b0 * (1 - cosine2);
    const numeratorImaginary = b0 * sine2;
    const denominatorReal = 1 + d1 * cosine + d2 * cosine2;
    const denominatorImaginary = -d1 * sine - d2 * sine2;
    const phase = Math.atan2(numeratorImaginary, numeratorReal) - Math.atan2(denominatorImaginary, denominatorReal);
    return phase > Math.PI ? phase - 2 * Math.PI : phase < -Math.PI ? phase + 2 * Math.PI : phase;
  }

  calculateCompensatedLocalLoopFrequency(frequency, q) {
    const targetOmega = (2 * Math.PI * frequency) / sampleRate;
    if (!Number.isFinite(targetOmega) || targetOmega <= 0 || frequency >= sampleRate / 2) return frequency;
    let lower = frequency;
    let upper = sampleRate * 0.49;
    const phaseError = centerFrequency => this.tptBandpassPhase(centerFrequency, q, frequency) - targetOmega;
    const lowerError = phaseError(lower);
    const upperError = phaseError(upper);
    if (!Number.isFinite(lowerError) || !Number.isFinite(upperError) || lowerError >= 0 || upperError <= 0) return frequency;
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const middle = (lower + upper) * 0.5;
      if (phaseError(middle) < 0) lower = middle;
      else upper = middle;
    }
    const result = (lower + upper) * 0.5;
    return Number.isFinite(result) && result > 0 && result < sampleRate / 2 ? result : frequency;
  }

  createCompensatedLocalLoopFrequencies() {
    return this.bandFrequencies.map((frequency, index) => this.isCompensatedLocalLoopBand(index)
      ? this.calculateCompensatedLocalLoopFrequency(frequency, this.bandQs[index])
      : frequency);
  }

  applyLocalLoopTuning() {
    if (!this.baseFilters) return;
    const useCompensatedFrequencies = this.feedbackCore !== 'zdf' && this.feedbackTopology === 'local-loop-exp'
      && this.positiveResonanceEngine === 'tpt'
      && this.localLoopTuning === 'compensated';
    for (const channel of ['left', 'right']) {
      for (let index = 0; index < this.bandCount; index += 1) {
        const frequency = useCompensatedFrequencies ? this.compensatedLocalLoopFrequencies[index] : this.bandFrequencies[index];
        const filter = this.baseFilters[channel][index];
        if (Math.abs(filter.frequency - frequency) > 1e-12) filter.setFrequency(frequency);
      }
    }
  }
  createOversampledResonatorFilters() {
    const filters = new Array(this.bandCount);
    for (let index = 0; index < this.bandCount; index += 1) {
      filters[index] = new OversampledPositiveTptResonator(
        sampleRate,
        this.bandFrequencies[index],
        this.bandQs[index]
      );
    }
    return filters;
  }

  createResonatorDiagnostics() {
    return {
      maximumResidual: 0,
      maximumState: 0,
      finite: true,
      frameCount: 0,
      sourcePeak: 0,
      sourceEnergy: 0,
      wetPeak: 0,
      wetEnergy: 0,
      // Passive diagnostics only: these values are aggregated at the existing
      // 15 Hz publish cadence and never feed back into the signal path.
      wetDcSum: 0,
      saturationActiveFrames: 0,
      positiveResonanceAuditionGain: 0,
      positiveResonanceAuditionGainTarget: 0,
      baseBandPeak: Array(this.bandCount).fill(0),
      baseBandEnergy: Array(this.bandCount).fill(0),
      bandPeak: Array(this.bandCount).fill(0),
      bandEnergy: Array(this.bandCount).fill(0),
      residualPeak: Array(this.bandCount).fill(0),
      residualEnergy: Array(this.bandCount).fill(0),
      localGates: Array(this.bandCount).fill(0),
      resonatorMagnitudes: Array(this.bandCount).fill(0),
      resonatorDampingScales: Array(this.bandCount).fill(1),
      resonatorAuditionGates: Array(this.bandCount).fill(0),
      nonlinearEnabled: this.enableNonlinearResonator,
      nonlinearDrive: this.positiveResonanceDrive,
      nonlinearDriveTarget: this.positiveResonanceDriveTarget,
      resonatorDampingFloor: this.resonatorDampingFloor,
      resonatorDampingFloorTarget: this.resonatorDampingFloorTarget,
      nonlinearBandPeak: Array(this.bandCount).fill(0),
      nonlinearBandEnergy: Array(this.bandCount).fill(0),
      nonlinearResidualPeak: Array(this.bandCount).fill(0),
      nonlinearResidualEnergy: Array(this.bandCount).fill(0),
      nonlinearStatePeak: Array(this.bandCount).fill(0),
      nonlinearSolverCalls: Array(this.bandCount).fill(0),
      nonlinearSolverIterationTotal: Array(this.bandCount).fill(0),
      nonlinearSolverIterationMaximum: Array(this.bandCount).fill(0),
      nonlinearConvergenceErrorMaximum: Array(this.bandCount).fill(0),
      nonlinearFallbackCounts: Array(this.bandCount).fill(0),
      nonlinearNonFiniteStateResets: Array(this.bandCount).fill(0),
      commonFeedbackReturn: 0,
      commonTapSum: 0,
      commonTapSumPeak: 0,
      commonSaturationInput: 0,
      commonSaturationOutput: 0,
      commonFeedbackReturnPeak: 0,
      localFeedbackReturnPeak: Array(this.bandCount).fill(0),
      mainCommonFeedbackReturn: 0,
      mainTapSum: 0,
      mainTapSumScaled: 0,
      mainSaturationInput: 0,
      mainSaturationOutput: 0,
      mainCommonFeedbackReturnPeak: 0,
      mainTapSumPeak: 0,
      mainTapSumScaledPeak: 0,
      mainFeedbackLevelScale: this.feedbackAllLevelScale(),
      mainFeedbackGain: 0,
      mainPostGainFeedbackWeightMode: this.postGainFeedbackWeight,
      mainPostGainFeedbackWeightDb: Array(this.bandCount).fill(0),
      firstMainTapSum: null,
      firstMainTapSumScaled: null,
      mainCommonNonFiniteResets: 0,
      resonanceTarget: 0,
      smoothedResonance: 0,
      localLoopTuning: this.localLoopTuning,
      feedbackCore: this.feedbackCore,
      feedbackCoreEffective: 'current',
      zdfLocalBus: 0,
      zdfMainBus: 0,
      zdfLocalBusPeak: 0,
      zdfMainBusPeak: 0,
      zdfTotalReturn: 0,
      zdfSolverIterations: 0,
      zdfSolverMaxIterations: 0,
      zdfSolverResidual: 0,
      zdfSolverLastResidual: 0,
      zdfSolverFallbackCount: 0,
      zdfNonFiniteResetCount: 0,
      dominantBaseBand: -1,
      baseFilterFrequencies: this.baseFilters?.left.map(filter => filter.frequency) ?? [],
      sampleCount: 0
    };
  }

  publishResonatorDiagnostics() {
    this.port.postMessage({
      type: 'resonator-diagnostics',
      left: { ...this.resonatorDiagnostics.left },
      right: { ...this.resonatorDiagnostics.right }
    });
    this.resonatorDiagnostics.left = this.createResonatorDiagnostics();
    this.resonatorDiagnostics.right = this.createResonatorDiagnostics();
  }

  processBandpass(filter, input) {
    return filter.process(input);
  }

  // For the existing TPT: unitBand = baseK * (a1*ic1eq + a2*(input-ic2eq)).
  // The two signed bus sums are therefore affine in the one shared return.
  solveZdfReturn(source, channel, feedbackAllGate) {
    const filters = this.baseFilters[channel];
    const gates = this.feedbackGates[channel];
    const gateTargets = this.feedbackGateTargets[channel];
    const gains = this.deltaGains[channel];
    const gainTargets = this.deltaTargets[channel];
    const localPost = this.feedbackTopology === 'common-bus' && this.feedbackTap === 'post-gain';
    const mainPost = this.feedbackAllSource === 'post-gain-sum';
    const level = this.feedbackAllLevelScale();
    let localA = 0; let localB = 0; let mainA = 0; let mainB = 0;
    for (let band = 0; band < this.bandCount; band += 1) {
      gates[band] = gateTargets[band] + this.feedbackGateSmoothingCoefficient * (gates[band] - gateTargets[band]);
      gains[band] = gainTargets[band] + this.bandGainSmoothingCoefficient * (gains[band] - gainTargets[band]);
      const filter = filters[band];
      if (!Number.isFinite(filter.ic1eq) || !Number.isFinite(filter.ic2eq)) {
        filter.reset();
        this.zdfNonFiniteResetCount[channel] += 1;
      }
      const a = filter.baseK * filter.a2;
      const b = filter.baseK * (filter.a1 * filter.ic1eq + filter.a2 * (source - filter.ic2eq));
      const audibleGain = 1 + gains[band];
      const localWeight = gates[band] * (localPost ? audibleGain : 1);
      const mainWeight = feedbackAllGate * level * (mainPost ? this.mainPostGainFeedbackWeight(audibleGain) : 1);
      localA += localWeight * a;
      localB += localWeight * b;
      mainA += mainWeight * a;
      mainB += mainWeight * b;
    }
    const signedResonance = Math.sign(this.resonance) * this.resonance * this.resonance;
    if (signedResonance === 0 || (localA === 0 && mainA === 0)) {
      this.zdfReturn[channel] = 0;
      this.zdfLocalReturn[channel] = 0;
      this.zdfMainReturn[channel] = 0;
      this.zdfLocalBus[channel] = localB;
      this.zdfMainBus[channel] = mainB;
      this.zdfSolverIterations[channel] = 0;
      this.zdfSolverResidual[channel] = 0;
      return 0;
    }
    const localGain = this.maxFeedbackGain * signedResonance;
    const mainCurveGain = this.feedbackAllResonanceCurve === 'soft-knee' && this.feedbackTopology === 'common-bus'
      ? this.feedbackAllSoftKneeGain(Math.abs(this.resonance)) : this.resonance * this.resonance;
    const mainGain = Math.sign(this.resonance) * this.maxFeedbackGain * mainCurveGain;
    const localConstantCeiling = this.feedbackTopology === 'common-bus'
      && this.commonBusSaturationMode === 'constant-ceiling';
    const localCeiling = localConstantCeiling ? this.commonBusCeiling : 1;
    const specialMain = this.feedbackAllSaturationReturn === 'drive-4-return-0.2'
      && this.feedbackTopology === 'common-bus' && this.commonBusSaturationMode === 'current';
    const mainCeiling = specialMain ? 0.2
      : this.commonBusSaturationMode === 'constant-ceiling' ? this.commonBusCeiling : 1;
    const localScale = localConstantCeiling ? this.commonBusDrive / localCeiling : 1;
    const mainScale = specialMain ? 4
      : this.commonBusSaturationMode === 'constant-ceiling' ? this.commonBusDrive / mainCeiling : 1;
    const localSlope = localGain * localA * localScale * localCeiling;
    const mainSlope = mainGain * mainA * mainScale * mainCeiling;
    const bound = localCeiling + mainCeiling;
    let lower = -bound; let upper = bound;
    let value = Math.max(lower, Math.min(upper, this.zdfReturn[channel]));
    let residual = Infinity; let iterations = 0; let fallback = false;
    for (; iterations < 6; iterations += 1) {
      const localTanh = Math.tanh(localScale * localGain * (localA * value + localB));
      const mainTanh = Math.tanh(mainScale * mainGain * (mainA * value + mainB));
      const error = value - localCeiling * localTanh - mainCeiling * mainTanh;
      residual = Math.abs(error);
      if (!Number.isFinite(error)) { fallback = true; break; }
      if (error > 0) upper = value; else lower = value;
      if (residual < 1e-8) { iterations += 1; break; }
      const derivative = 1 - localSlope * (1 - localTanh * localTanh)
        - mainSlope * (1 - mainTanh * mainTanh);
      const candidate = Math.abs(derivative) > 1e-9 ? value - error / derivative : NaN;
      if (!Number.isFinite(candidate) || candidate <= lower || candidate >= upper) {
        value = 0.5 * (lower + upper);
        fallback = true;
      } else value = candidate;
    }
    if (residual >= 1e-8) {
      fallback = true;
      for (let step = 0; step < 20; step += 1) {
        value = 0.5 * (lower + upper);
        const localTanh = Math.tanh(localScale * localGain * (localA * value + localB));
        const mainTanh = Math.tanh(mainScale * mainGain * (mainA * value + mainB));
        const error = value - localCeiling * localTanh - mainCeiling * mainTanh;
        if (!Number.isFinite(error)) break;
        residual = Math.abs(error);
        if (residual < 1e-8) break;
        if (error > 0) upper = value; else lower = value;
      }
    }
    if (!Number.isFinite(value) || !Number.isFinite(residual)) {
      value = 0;
      residual = 0;
      this.zdfNonFiniteResetCount[channel] += 1;
    }
    const localBus = localA * value + localB;
    const mainBus = mainA * value + mainB;
    const localReturn = localCeiling * Math.tanh(localScale * localGain * localBus);
    const mainReturn = mainCeiling * Math.tanh(mainScale * mainGain * mainBus);
    this.zdfReturn[channel] = value;
    this.zdfLocalReturn[channel] = Number.isFinite(localReturn) ? localReturn : 0;
    this.zdfMainReturn[channel] = Number.isFinite(mainReturn) ? mainReturn : 0;
    this.zdfLocalBus[channel] = Number.isFinite(localBus) ? localBus : 0;
    this.zdfMainBus[channel] = Number.isFinite(mainBus) ? mainBus : 0;
    this.zdfSolverIterations[channel] = iterations;
    this.zdfSolverMaxIterations[channel] = Math.max(this.zdfSolverMaxIterations[channel], iterations);
    this.zdfSolverResidual[channel] = residual;
    if (fallback) this.zdfSolverFallbackCount[channel] += 1;
    return value;
  }

  setBandControl(channel, index, value, immediate = false) {
    if ((channel !== 'left' && channel !== 'right') || !Number.isInteger(index) || index < 0 || index >= this.bandCount) return;
    const control = this.clampControl(value);
    const deltaGain = this.controlToDeltaGain(control);
    this.bandControls[channel][index] = control;
    this.deltaTargets[channel][index] = deltaGain;
    if (immediate) this.deltaGains[channel][index] = deltaGain;
  }

  setBandFeedback(channel, index, enabled, immediate = false) {
    if ((channel !== 'left' && channel !== 'right') || !Number.isInteger(index) || index < 0 || index >= this.bandCount) return;
    const gate = enabled ? 1 : 0;
    this.feedbackGateTargets[channel][index] = gate;
    if (immediate) this.feedbackGates[channel][index] = gate;
  }

  setFeedbackAll(channel, enabled, immediate = false) {
    if (channel !== 'left' && channel !== 'right') return;
    const gate = enabled ? 1 : 0;
    this.feedbackAllGateTargets[channel] = gate;
    if (immediate) this.feedbackAllGates[channel] = gate;
  }

  setResonance(value, immediate = false) {
    this.resonanceTarget = this.clampResonance(value);
    if (immediate) this.resonance = this.resonanceTarget;
  }

  setPositiveResonanceAuditionGain(value, immediate = false) {
    this.positiveResonanceAuditionGainTarget = this.readPositiveOption(value, 0.1);
    if (immediate) this.positiveResonanceAuditionGain = this.positiveResonanceAuditionGainTarget;
  }

  setPositiveResonanceDrive(value, immediate = false) {
    this.positiveResonanceDriveTarget = this.readDiagnosticDrive(value, 1);
    if (immediate) this.positiveResonanceDrive = this.positiveResonanceDriveTarget;
  }

  setPositiveResonanceDampingFloor(value, immediate = false) {
    this.resonatorDampingFloorTarget = this.readResonatorDampingFloor(value);
    if (immediate) this.resonatorDampingFloor = this.resonatorDampingFloorTarget;
  }

  setPositiveResonanceOutputMode(value, immediate = false) {
    this.positiveResonanceOutputModeTarget = this.readPositiveResonanceOutputMode(value);
    const selected = this.outputModeIndex(this.positiveResonanceOutputModeTarget);
    for (let index = 0; index < 3; index += 1) {
      this.positiveResonanceOutputTargets[index] = index === selected ? 1 : 0;
      if (immediate) this.positiveResonanceOutputWeights[index] = this.positiveResonanceOutputTargets[index];
    }
    if (immediate) this.positiveResonanceOutputMode = this.positiveResonanceOutputModeTarget;
  }

  setPositiveResonanceLatencyMode(value, immediate = false) {
    this.positiveResonanceLatencyModeTarget = this.readPositiveResonanceLatencyMode(value);
    const selected = this.latencyModeIndex(this.positiveResonanceLatencyModeTarget);
    for (let index = 0; index < 2; index += 1) {
      this.positiveResonanceLatencyTargets[index] = index === selected ? 1 : 0;
      if (immediate) this.positiveResonanceLatencyWeights[index] = this.positiveResonanceLatencyTargets[index];
    }
    if (immediate) this.positiveResonanceLatencyMode = this.positiveResonanceLatencyModeTarget;
  }

  setPositiveResonanceCurve(value) {
    this.positiveResonanceCurve = this.readPositiveResonanceCurve(value);
  }

  setReferenceLevel(value, immediate = false) {
    this.referenceLevelTarget = this.readReferenceLevel(value);
    if (immediate) this.referenceLevel = this.referenceLevelTarget;
  }

  setBandBoostDb(value, immediate = false) {
    this.maxBandBoostDb = this.readBandBoostDb(value);
    this.refreshDeltaTargets(immediate);
  }

  setBandCutDb(value, immediate = false) {
    this.maxBandCutDb = this.readBandCutDb(value);
    this.refreshDeltaTargets(immediate);
  }

  refreshDeltaTargets(immediate) {
    for (const channel of ['left', 'right']) {
      for (let index = 0; index < this.bandCount; index += 1) {
        const deltaGain = this.controlToDeltaGain(this.bandControls[channel][index]);
        this.deltaTargets[channel][index] = deltaGain;
        if (immediate) this.deltaGains[channel][index] = deltaGain;
      }
    }
  }

  setPositiveResonanceEngine(value) {
    const nextEngine = this.readPositiveResonanceEngine(value);
    if (nextEngine === this.positiveResonanceEngine) return;
    this.positiveResonanceEngine = nextEngine;
    if (this.feedbackTopology === 'local-loop-exp' && this.localLoopTuning === 'compensated') {
      this.clearLocalFeedbackReturns();
      this.applyLocalLoopTuning();
    }
  }
  clearMainCommonFeedbackReturns() {
    this.mainCommonFeedbackReturns.left = 0;
    this.mainCommonFeedbackReturns.right = 0;
    this.mainCommonSaturationOutputs.left = 0;
    this.mainCommonSaturationOutputs.right = 0;
  }

  clearLegacyFeedbackReturns() {
    for (const channel of ['left', 'right']) {
      for (let band = 0; band < this.bandCount; band += 1) this.feedbackReturns[channel][band] = 0;
    }
  }

  clearLocalFeedbackReturns() {
    this.localFeedbackReturns.left.fill(0);
    this.localFeedbackReturns.right.fill(0);
  }

  panic() {
    this.setResonance(0, true);
    for (const channel of ['left', 'right']) {
      this.feedbackGates[channel].fill(0);
      this.feedbackGateTargets[channel].fill(0);
      this.feedbackReturns[channel].fill(0);
      this.bandOutputs[channel].fill(0);
      this.resonatorBandOutputs[channel].fill(0);
      this.resonanceResiduals[channel].fill(0);
      this.resonatorMagnitudes[channel].fill(0);
      this.resonatorAuditionGates[channel].fill(0);
      this.resonatorFilters[channel].forEach(filter => filter.reset());
      this.nonlinearResonatorFilters?.[channel].forEach(filter => filter.reset());
    }
    this.feedbackAllGates.left = 0;
    this.feedbackAllGates.right = 0;
    this.feedbackAllGateTargets.left = 0;
    this.feedbackAllGateTargets.right = 0;
    this.commonFeedbackReturns.left = 0;
    this.commonFeedbackReturns.right = 0;
    this.clearLocalFeedbackReturns();
    this.clearMainCommonFeedbackReturns();
    this.clearLegacyFeedbackReturns();
    this.clearZdfReturns();
    if (this.feedbackCore === 'zdf') {
      for (const channel of ['left', 'right']) this.baseFilters[channel].forEach(filter => filter.reset());
    }
  }

  applyCommonBusSaturation(drive) {
    if (!Number.isFinite(drive)) return null;
    return this.commonBusSaturationMode === 'constant-ceiling'
      ? this.commonBusCeiling * Math.tanh((this.commonBusDrive * drive) / this.commonBusCeiling)
      : Math.tanh(drive);
  }

  applyMainCommonBusSaturation(drive) {
    if (!Number.isFinite(drive)) return null;
    const experimentActive = this.feedbackAllSaturationReturn === 'drive-4-return-0.2'
      && this.feedbackTopology === 'common-bus'
      && this.feedbackAllEngine === 'common-bus'
      && this.commonBusSaturationMode === 'current';
    if (!experimentActive) {
      const feedbackReturn = this.applyCommonBusSaturation(drive);
      return feedbackReturn === null ? null : { saturationOutput: feedbackReturn, feedbackReturn };
    }
    const saturationOutput = Math.tanh(4 * drive);
    return { saturationOutput, feedbackReturn: 0.2 * saturationOutput };
  }

  feedbackAllSoftKneeGain(resonance) {
    const value = Math.min(1, Math.max(0, Number.isFinite(resonance) ? resonance : 0));
    if (value <= 0.50) return value * value;
    if (value <= 0.75) {
      return this.cubicHermite(value, FEEDBACK_ALL_SOFT_KNEE_POINTS[0], FEEDBACK_ALL_SOFT_KNEE_POINTS[1]);
    }
    if (value <= 0.95) return 0.56 + 1.2 * (value - 0.75);
    if (value < 1) {
      return this.cubicHermite(value, FEEDBACK_ALL_SOFT_KNEE_POINTS[2], FEEDBACK_ALL_SOFT_KNEE_POINTS[3]);
    }
    return 1;
  }

  cubicHermite(value, start, end) {
    const width = end.resonance - start.resonance;
    const t = (value - start.resonance) / width;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * start.gain
      + (t3 - 2 * t2 + t) * width * start.slope
      + (-2 * t3 + 3 * t2) * end.gain
      + (t3 - t2) * width * end.slope;
  }

  mainCommonBusFeedbackGain(resonanceMagnitudeSquared) {
    if (this.feedbackAllResonanceCurve !== 'soft-knee' || this.feedbackTopology !== 'common-bus') {
      return this.maxFeedbackGain * resonanceMagnitudeSquared;
    }
    return this.maxFeedbackGain * this.feedbackAllSoftKneeGain(this.resonance);
  }

  setFeedbackTopology(value) {
    const nextTopology = value === 'common-bus' ? 'common-bus' : value === 'local-loop-exp' ? 'local-loop-exp' : 'isolated-tpt';
    if (this.feedbackCore === 'zdf' && nextTopology !== this.feedbackTopology) this.clearZdfReturns();
    if (this.feedbackTopology === 'local-loop-exp' && nextTopology !== 'local-loop-exp') this.clearLocalFeedbackReturns();
    this.feedbackTopology = nextTopology;
    this.applyLocalLoopTuning();
    if (this.feedbackTopology === 'isolated-tpt') this.clearMainCommonFeedbackReturns();
  }
  clearZdfReturns() {
    this.zdfReturn.left = this.zdfReturn.right = 0;
    this.zdfLocalReturn.left = this.zdfLocalReturn.right = 0;
    this.zdfMainReturn.left = this.zdfMainReturn.right = 0;
    this.zdfLocalBus.left = this.zdfLocalBus.right = 0;
    this.zdfMainBus.left = this.zdfMainBus.right = 0;
  }
  setFeedbackCore(value) {
    const nextCore = value === 'zdf' ? 'zdf' : 'current';
    if (nextCore === this.feedbackCore) return;
    this.feedbackCore = nextCore;
    // A core switch is not a panic: CURRENT and ZDF retain their own return
    // histories, while the base TPT filters remain shared and continuous.
    // Retuning for LOCAL LOOP EXP is intentionally state-preserving
    // (LinearTptSvf#setFrequency does not reset its integrators).
    this.applyLocalLoopTuning();
  }
  setLocalLoopTuning(value) {
    const nextTuning = this.readLocalLoopTuning(value);
    if (nextTuning === this.localLoopTuning) return;
    this.localLoopTuning = nextTuning;
    if (this.feedbackTopology === 'local-loop-exp') {
      this.clearLocalFeedbackReturns();
      this.applyLocalLoopTuning();
    }
  }
  setFeedbackTap(value) { this.feedbackTap = value === 'post-gain' ? 'post-gain' : 'pre-gain'; }
  setWetModel(value) { this.wetModel = value === 'filterbank-sum' ? 'filterbank-sum' : 'reference-delta'; }
  setCommonBusSaturationMode(value) { this.commonBusSaturationMode = value === 'constant-ceiling' ? 'constant-ceiling' : 'current'; }
  setCommonBusDrive(value, immediate = false) { this.commonBusDriveTarget = this.readCommonBusDrive(value); if (immediate) this.commonBusDrive = this.commonBusDriveTarget; }
  setCommonBusCeiling(value, immediate = false) { this.commonBusCeilingTarget = this.readCommonBusCeiling(value); if (immediate) this.commonBusCeiling = this.commonBusCeilingTarget; }
  setFeedbackAllEngine(value) {
    const nextValue = this.readFeedbackAllEngine(value);
    if (nextValue === this.feedbackAllEngine) return;
    this.feedbackAllEngine = nextValue;
    this.clearMainCommonFeedbackReturns();
    if (nextValue === 'common-bus') this.clearLegacyFeedbackReturns();
  }
  setFeedbackAllSource(value) { this.feedbackAllSource = this.readFeedbackAllSource(value); }
  setPostGainFeedbackWeight(value) { this.postGainFeedbackWeight = this.readPostGainFeedbackWeight(value); }
  setFeedbackAllLevel(value) { this.feedbackAllLevel = this.readFeedbackAllLevel(value); }
  setFeedbackAllResonanceCurve(value) { this.feedbackAllResonanceCurve = this.readFeedbackAllResonanceCurve(value); }
  setFeedbackAllSaturationReturn(value) { this.feedbackAllSaturationReturn = this.readFeedbackAllSaturationReturn(value); }

  applyState(data) {
    const leftControls = this.readControls(data.bandGainLeft);
    const rightControls = this.readControls(data.bandGainRight);
    const leftFeedback = this.readFeedbackGates(data.feedbackBandLeft);
    const rightFeedback = this.readFeedbackGates(data.feedbackBandRight);
    for (let index = 0; index < this.bandCount; index += 1) {
      this.setBandControl('left', index, leftControls[index], true);
      this.setBandControl('right', index, rightControls[index], true);
      this.setBandFeedback('left', index, leftFeedback[index], true);
      this.setBandFeedback('right', index, rightFeedback[index], true);
    }
    this.setFeedbackAll('left', data.feedbackAllLeft, true);
    this.setFeedbackAll('right', data.feedbackAllRight, true);
    this.setResonance(data.resonance, true);
    if (data.positiveResonanceAuditionGain !== undefined) {
      this.setPositiveResonanceAuditionGain(data.positiveResonanceAuditionGain, true);
    }
    if (data.positiveResonanceDrive !== undefined) {
      this.setPositiveResonanceDrive(data.positiveResonanceDrive, true);
    }
    if (data.positiveResonanceDampingFloor !== undefined) {
      this.setPositiveResonanceDampingFloor(data.positiveResonanceDampingFloor, true);
    }
    if (data.positiveResonanceOutputMode !== undefined) this.setPositiveResonanceOutputMode(data.positiveResonanceOutputMode, true);
    if (data.positiveResonanceLatencyMode !== undefined) this.setPositiveResonanceLatencyMode(data.positiveResonanceLatencyMode, true);
    if (data.positiveResonanceCurve !== undefined) this.setPositiveResonanceCurve(data.positiveResonanceCurve);
    if (data.referenceLevel !== undefined) this.setReferenceLevel(data.referenceLevel, true);
    if (data.maxBandBoostDb !== undefined) this.setBandBoostDb(data.maxBandBoostDb, true);
    if (data.maxBandCutDb !== undefined) this.setBandCutDb(data.maxBandCutDb, true);
    if (data.positiveResonanceEngine !== undefined) this.setPositiveResonanceEngine(data.positiveResonanceEngine);
    if (data.feedbackTopology !== undefined) this.setFeedbackTopology(data.feedbackTopology);
    if (data.feedbackCore !== undefined) this.setFeedbackCore(data.feedbackCore);
    if (data.localLoopTuning !== undefined) this.setLocalLoopTuning(data.localLoopTuning);
    if (data.feedbackTap !== undefined) this.setFeedbackTap(data.feedbackTap);
    if (data.wetModel !== undefined) this.setWetModel(data.wetModel);
    if (data.commonBusSaturationMode !== undefined) this.setCommonBusSaturationMode(data.commonBusSaturationMode);
    if (data.commonBusDrive !== undefined) this.setCommonBusDrive(data.commonBusDrive, true);
    if (data.commonBusCeiling !== undefined) this.setCommonBusCeiling(data.commonBusCeiling, true);
    if (data.feedbackAllEngine !== undefined) this.setFeedbackAllEngine(data.feedbackAllEngine);
    if (data.feedbackAllSource !== undefined) this.setFeedbackAllSource(data.feedbackAllSource);
    if (data.postGainFeedbackWeight !== undefined) this.setPostGainFeedbackWeight(data.postGainFeedbackWeight);
    if (data.feedbackAllLevel !== undefined) this.setFeedbackAllLevel(data.feedbackAllLevel);
    if (data.feedbackAllResonanceCurve !== undefined) this.setFeedbackAllResonanceCurve(data.feedbackAllResonanceCurve);
    if (data.feedbackAllSaturationReturn !== undefined) this.setFeedbackAllSaturationReturn(data.feedbackAllSaturationReturn);
    this.initializeResonatorMagnitudes();
  }

  handleMessage(data) {
    if (!data || this.disposed) return;
    if (data.type === 'set-band-base-gain') {
      this.setBandControl(data.channel, data.index, data.value);
      return;
    }
    if (data.type === 'set-band-feedback') {
      this.setBandFeedback(data.channel, data.index, data.enabled);
      return;
    }
    if (data.type === 'set-feedback-all') {
      this.setFeedbackAll(data.channel, data.enabled);
      return;
    }
    if (data.type === 'set-resonance') {
      this.setResonance(data.value);
      return;
    }
    if (data.type === 'set-positive-resonance-audition-gain') {
      this.setPositiveResonanceAuditionGain(data.value);
      return;
    }
    if (data.type === 'set-positive-resonance-drive') {
      this.setPositiveResonanceDrive(data.value);
      return;
    }
    if (data.type === 'set-positive-resonance-damping-floor') {
      this.setPositiveResonanceDampingFloor(data.value);
      return;
    }
    if (data.type === 'set-positive-resonance-output-mode') {
      this.setPositiveResonanceOutputMode(data.value);
      return;
    }
    if (data.type === 'set-positive-resonance-latency-mode') {
      this.setPositiveResonanceLatencyMode(data.value);
      return;
    }
    if (data.type === 'set-positive-resonance-curve') {
      this.setPositiveResonanceCurve(data.value);
      return;
    }
    if (data.type === 'set-reference-level') { this.setReferenceLevel(data.value); return; }
    if (data.type === 'set-band-boost-db') { this.setBandBoostDb(data.value); return; }
    if (data.type === 'set-band-cut-db') { this.setBandCutDb(data.value); return; }
    if (data.type === 'set-positive-resonance-engine') { this.setPositiveResonanceEngine(data.value); return; }
    if (data.type === 'set-feedback-topology') { this.setFeedbackTopology(data.value); return; }
    if (data.type === 'set-feedback-core') { this.setFeedbackCore(data.value); return; }
    if (data.type === 'set-local-loop-tuning') { this.setLocalLoopTuning(data.value); return; }
    if (data.type === 'set-feedback-tap') { this.setFeedbackTap(data.value); return; }
    if (data.type === 'set-wet-model') { this.setWetModel(data.value); return; }
    if (data.type === 'set-common-bus-saturation-mode') { this.setCommonBusSaturationMode(data.value); return; }
    if (data.type === 'set-common-bus-drive') { this.setCommonBusDrive(data.value); return; }
    if (data.type === 'set-common-bus-ceiling') { this.setCommonBusCeiling(data.value); return; }
    if (data.type === 'set-feedback-all-engine') { this.setFeedbackAllEngine(data.value); return; }
    if (data.type === 'set-feedback-all-source') { this.setFeedbackAllSource(data.value); return; }
    if (data.type === 'set-post-gain-feedback-weight') { this.setPostGainFeedbackWeight(data.value); return; }
    if (data.type === 'set-feedback-all-level') { this.setFeedbackAllLevel(data.value); return; }
    if (data.type === 'set-feedback-all-resonance-curve') { this.setFeedbackAllResonanceCurve(data.value); return; }
    if (data.type === 'set-feedback-all-saturation-return') { this.setFeedbackAllSaturationReturn(data.value); return; }
    if (data.type === 'panic') { this.panic(); return; }
    if (data.type === 'apply-state') {
      this.applyState(data);
      return;
    }
    if (data.type === 'dispose') {
      this.disposed = true;
      this.port.onmessage = null;
    }
  }

  processChannelFrame(input, channel) {
    const baseFilters = this.baseFilters[channel];
    const resonatorFilters = this.resonatorFilters[channel];
    const nonlinearResonatorFilters = this.nonlinearResonatorFilters?.[channel];
    const deltaGains = this.deltaGains[channel];
    const deltaTargets = this.deltaTargets[channel];
    const feedbackGates = this.feedbackGates[channel];
    const feedbackGateTargets = this.feedbackGateTargets[channel];
    const feedbackReturns = this.feedbackReturns[channel];
    const bandOutputs = this.bandOutputs[channel];
    const resonatorBandOutputs = this.resonatorBandOutputs[channel];
    const resonanceResiduals = this.resonanceResiduals[channel];
    const resonatorMagnitudes = this.resonatorMagnitudes[channel];
    const resonatorAuditionGates = this.resonatorAuditionGates[channel];
    const source = Number.isFinite(input) ? input : 0;
    const zdfActive = this.feedbackCore === 'zdf' && this.feedbackTopology !== 'isolated-tpt';
    const feedbackAllGate = this.feedbackAllGateTargets[channel] + this.feedbackGateSmoothingCoefficient * (this.feedbackAllGates[channel] - this.feedbackAllGateTargets[channel]);
    this.feedbackAllGates[channel] = feedbackAllGate;
    // A positive common-bus loop follows the already smoothed resonance
    // state on its way to zero. A negative target still leaves the positive
    // topology immediately, preserving the legacy negative-path handoff.
    const commonBusActive = this.feedbackTopology === 'common-bus'
      && (zdfActive ? Math.abs(this.resonance) > COMMON_BUS_RESONANCE_EPSILON
        : this.resonanceTarget >= 0 && this.resonance > COMMON_BUS_RESONANCE_EPSILON);
    const localLoopActive = this.feedbackTopology === 'local-loop-exp'
      && (zdfActive ? Math.abs(this.resonance) > COMMON_BUS_RESONANCE_EPSILON
        : this.resonanceTarget >= 0 && this.resonance > COMMON_BUS_RESONANCE_EPSILON);
    const usesCommonBusMainEngine = this.feedbackTopology !== 'isolated-tpt'
      && this.feedbackAllEngine === 'common-bus'
      && this.resonanceTarget >= 0;
    const mainCommonBusActive = (commonBusActive || localLoopActive)
      && (zdfActive || usesCommonBusMainEngine)
      && feedbackAllGate > COMMON_BUS_RESONANCE_EPSILON;
    const localCommonReturn = commonBusActive && Number.isFinite(this.commonFeedbackReturns[channel])
      ? this.commonFeedbackReturns[channel]
      : 0;
    const mainCommonReturn = mainCommonBusActive && Number.isFinite(this.mainCommonFeedbackReturns[channel])
      ? this.mainCommonFeedbackReturns[channel]
      : 0;
    let mainOutput = this.wetModel === 'reference-delta' ? source * this.referenceLevel : 0;
    let filterbankSum = 0;
    let commonTapSum = 0;
    let mainTapSum = 0;
    let globalTapSum = 0;
    const zdfReturn = zdfActive ? this.solveZdfReturn(source, channel, feedbackAllGate) : 0;
    const usesLegacyLocalResonance = !zdfActive && ((this.resonanceTarget < 0 && this.resonance < 0)
      || (this.feedbackTopology === 'isolated-tpt' && this.positiveResonanceEngine === 'phase2' && this.resonanceTarget > 0 && this.resonance > 0));
    const usesLegacyFeedbackAll = !zdfActive && feedbackAllGate > 1e-12 && !usesCommonBusMainEngine;
    let hasActiveLegacyFeedbackGate = usesLegacyFeedbackAll;

    for (let band = 0; band < this.bandCount; band += 1) {
      const localGate = zdfActive ? feedbackGates[band]
        : feedbackGateTargets[band] + this.feedbackGateSmoothingCoefficient * (feedbackGates[band] - feedbackGateTargets[band]);
      feedbackGates[band] = localGate;
      if (usesLegacyLocalResonance && localGate > 1e-12) hasActiveLegacyFeedbackGate = true;
      const resonatorMagnitudeTarget = this.getResonatorMagnitudeTarget(localGate);
      const resonatorMagnitude = resonatorMagnitudeTarget + this.resonanceSmoothingCoefficient * (
        resonatorMagnitudes[band] - resonatorMagnitudeTarget
      );
      resonatorMagnitudes[band] = resonatorMagnitude;
      const resonatorDampingScale = this.getResonatorDampingScale(resonatorMagnitude);
      resonatorFilters[band].setDampingScale(this.getLinearResonatorDampingScale(resonatorMagnitude));
      const resonatorAuditionTarget = this.feedbackTopology === 'isolated-tpt' && this.positiveResonanceEngine === 'tpt' && this.resonanceTarget > 0 && localGate > 1e-12 ? 1 : 0;
      const resonatorAuditionGate = resonatorAuditionTarget + this.resonanceSmoothingCoefficient * (
        resonatorAuditionGates[band] - resonatorAuditionTarget
      );
      resonatorAuditionGates[band] = resonatorAuditionGate;
      const previousReturn = Number.isFinite(feedbackReturns[band]) ? feedbackReturns[band] : 0;
      if (!Number.isFinite(feedbackReturns[band])) feedbackReturns[band] = 0;
      const localLoopReturn = localLoopActive && Number.isFinite(this.localFeedbackReturns[channel][band])
        ? this.localFeedbackReturns[channel][band]
        : 0;
      const bandInput = zdfActive ? source + zdfReturn
        : source + previousReturn + localCommonReturn + mainCommonReturn + localLoopReturn;
      const bandOutput = this.processBandpass(baseFilters[band], bandInput);
      const resonatorBandOutput = this.processBandpass(resonatorFilters[band], source);
      const resonanceResidual = resonatorBandOutput - bandOutput;
      let nonlinearResonatorBandOutput = 0;
      let nonlinearResidual = 0;
      let nonlinearBaseResidual = 0;
      const useAudibleNonlinearResidual = this.feedbackTopology === 'isolated-tpt' && this.positiveResonanceEngine === 'tpt' && this.enableNonlinearPositiveResonator
        && (resonatorMagnitude > 1e-12 || resonatorAuditionGate > 1e-12);
      if (nonlinearResonatorFilters && (this.collectResonatorDiagnostics || resonatorMagnitude > 1e-12 || resonatorAuditionGate > 1e-12)) {
        const nonlinearFilter = nonlinearResonatorFilters[band];
        nonlinearResonatorBandOutput = nonlinearFilter.process(
          source,
          resonatorDampingScale,
          this.positiveResonanceDrive,
          resonatorMagnitude > 1e-12
        );
        nonlinearResidual = nonlinearFilter.residual;
        nonlinearBaseResidual = nonlinearResonatorBandOutput - nonlinearFilter.baseBand;
      }
      bandOutputs[band] = bandOutput;
      resonatorBandOutputs[band] = resonatorBandOutput;
      resonanceResiduals[band] = Number.isFinite(resonanceResidual) ? resonanceResidual : 0;
      // CURRENT and NONLINEAR-BASE each subtract two signals which traversed
      // the same 2x FIR chain. FULL keeps the resonant bandpass energy. In
      // MATCHED mode FULL is reconstructed as native base BP plus the
      // latency-matched nonlinear delta; this avoids delaying the global wet
      // path while preserving a directly comparable band contribution.
      const currentResidual = useAudibleNonlinearResidual ? nonlinearResidual : resonanceResiduals[band];
      const baseResidual = useAudibleNonlinearResidual ? nonlinearBaseResidual : resonanceResiduals[band];
      const fullCurrent = useAudibleNonlinearResidual ? nonlinearResonatorBandOutput : resonatorBandOutput;
      const fullMatched = useAudibleNonlinearResidual
        ? bandOutput + nonlinearBaseResidual
        : resonatorBandOutput;
      const fullOutput = this.positiveResonanceLatencyWeights[0] * fullCurrent
        + this.positiveResonanceLatencyWeights[1] * fullMatched;
      const audibleResidual = this.positiveResonanceOutputWeights[0] * currentResidual
        + this.positiveResonanceOutputWeights[1] * baseResidual
        + this.positiveResonanceOutputWeights[2] * fullOutput;
      if (localGate > 1e-12 && this.resonance > 0 && this.feedbackTopology === 'isolated-tpt') {
        mainOutput += resonatorAuditionGate * this.positiveResonanceAuditionGain * audibleResidual;
      }
      if (this.collectResonatorDiagnostics) {
        const diagnostics = this.resonatorDiagnostics[channel];
        const maximumState = Math.max(
          Math.abs(resonatorFilters[band].ic1eq),
          Math.abs(resonatorFilters[band].ic2eq)
        );
        diagnostics.maximumResidual = Math.max(diagnostics.maximumResidual, Math.abs(resonanceResiduals[band]));
        diagnostics.maximumState = Math.max(diagnostics.maximumState, maximumState);
        diagnostics.baseBandPeak[band] = Math.max(diagnostics.baseBandPeak[band], Math.abs(bandOutput));
        diagnostics.baseBandEnergy[band] += bandOutput * bandOutput;
        diagnostics.bandPeak[band] = Math.max(diagnostics.bandPeak[band], Math.abs(resonatorBandOutput));
        diagnostics.bandEnergy[band] += resonatorBandOutput * resonatorBandOutput;
        diagnostics.residualPeak[band] = Math.max(diagnostics.residualPeak[band], Math.abs(resonanceResiduals[band]));
        diagnostics.residualEnergy[band] += resonanceResiduals[band] * resonanceResiduals[band];
        diagnostics.localGates[band] = localGate;
        diagnostics.resonatorMagnitudes[band] = resonatorMagnitude;
        diagnostics.resonatorDampingScales[band] = resonatorDampingScale;
        diagnostics.resonatorAuditionGates[band] = resonatorAuditionGate;
        if (nonlinearResonatorFilters) {
          const nonlinearFilter = nonlinearResonatorFilters[band];
          const nonlinearStatePeak = Math.max(
            nonlinearFilter.statePeak,
            0
          );
          diagnostics.nonlinearBandPeak[band] = Math.max(
            diagnostics.nonlinearBandPeak[band], Math.abs(nonlinearResonatorBandOutput)
          );
          diagnostics.nonlinearBandEnergy[band] += nonlinearResonatorBandOutput * nonlinearResonatorBandOutput;
          diagnostics.nonlinearResidualPeak[band] = Math.max(
            diagnostics.nonlinearResidualPeak[band], Math.abs(nonlinearResidual)
          );
          diagnostics.nonlinearResidualEnergy[band] += nonlinearResidual * nonlinearResidual;
          diagnostics.nonlinearStatePeak[band] = Math.max(diagnostics.nonlinearStatePeak[band], nonlinearStatePeak);
          diagnostics.nonlinearSolverCalls[band] = nonlinearFilter.nonlinearSolverCallCount;
          diagnostics.nonlinearSolverIterationTotal[band] = nonlinearFilter.nonlinearSolverIterationTotal;
          diagnostics.nonlinearSolverIterationMaximum[band] = Math.max(
            diagnostics.nonlinearSolverIterationMaximum[band], nonlinearFilter.nonlinearSolverIterationMaximum
          );
          diagnostics.nonlinearConvergenceErrorMaximum[band] = Math.max(
            diagnostics.nonlinearConvergenceErrorMaximum[band], nonlinearFilter.lastNonlinearConvergenceError
          );
          diagnostics.nonlinearFallbackCounts[band] = nonlinearFilter.nonlinearFallbackCount;
          diagnostics.nonlinearNonFiniteStateResets[band] = nonlinearFilter.nonlinearNonFiniteResetCount;
          diagnostics.finite = diagnostics.finite
            && Number.isFinite(nonlinearResonatorBandOutput)
            && Number.isFinite(nonlinearResidual)
            && Number.isFinite(nonlinearStatePeak);
        }
        diagnostics.sampleCount += 1;
        diagnostics.finite = diagnostics.finite
          && Number.isFinite(bandOutput)
          && Number.isFinite(resonatorBandOutput)
          && Number.isFinite(maximumState);
      }
      globalTapSum += bandOutput;
      if (!zdfActive) deltaGains[band] = deltaTargets[band] + this.bandGainSmoothingCoefficient * (deltaGains[band] - deltaTargets[band]);
      const audibleGain = 1 + deltaGains[band];
      const mainPostGainWeight = this.mainPostGainFeedbackWeight(audibleGain);
      if (this.collectResonatorDiagnostics) {
        this.resonatorDiagnostics[channel].mainPostGainFeedbackWeightDb[band] = 20 * Math.log10(mainPostGainWeight);
      }
      if (this.wetModel === 'reference-delta') mainOutput += deltaGains[band] * bandOutput;
      else filterbankSum += audibleGain * bandOutput;
      if (commonBusActive && localGate > 1e-12) {
        commonTapSum += localGate * (this.feedbackTap === 'post-gain' ? audibleGain * bandOutput : bandOutput);
      }
      if (mainCommonBusActive) {
        mainTapSum += feedbackAllGate * (this.feedbackAllSource === 'post-gain-sum'
          ? mainPostGainWeight * bandOutput
          : bandOutput);
      }
    }

    if (this.wetModel === 'filterbank-sum') mainOutput += filterbankSum;

    const resonanceMagnitudeSquared = this.resonance * this.resonance;
    if (!zdfActive) {
      if (hasActiveLegacyFeedbackGate && resonanceMagnitudeSquared > 0) {
        const globalTap = Number.isFinite(globalTapSum) ? globalTapSum * this.feedbackAllNormalization : 0;
        const feedbackGain = Math.sign(this.resonance) * this.maxFeedbackGain * resonanceMagnitudeSquared;
        const auditionGain = this.maxAuditionGain * resonanceMagnitudeSquared;
        for (let band = 0; band < this.bandCount; band += 1) {
          const legacyLocalGate = usesLegacyLocalResonance ? feedbackGates[band] : 0;
          const rawFeedback = legacyLocalGate * bandOutputs[band]
            + (usesLegacyFeedbackAll ? feedbackAllGate * globalTap : 0);
          const feedbackDrive = feedbackGain * rawFeedback;
          const feedbackReturn = Number.isFinite(feedbackDrive) ? Math.tanh(feedbackDrive) : 0;
          feedbackReturns[band] = Number.isFinite(feedbackReturn) ? feedbackReturn : 0;
          const legacyAuditionGate = Math.max(legacyLocalGate, usesLegacyFeedbackAll ? feedbackAllGate : 0);
          mainOutput += legacyAuditionGate * auditionGain * bandOutputs[band];
        }
      } else {
        for (let band = 0; band < this.bandCount; band += 1) {
          feedbackReturns[band] = 0;
        }
      }
    }

    if (!zdfActive && commonBusActive && resonanceMagnitudeSquared > 0) {
      const feedbackGain = this.maxFeedbackGain * resonanceMagnitudeSquared;
      const drive = feedbackGain * commonTapSum;
      const feedbackReturn = this.applyCommonBusSaturation(drive);
      this.commonFeedbackReturns[channel] = feedbackReturn === null ? 0 : feedbackReturn;
    } else if (!zdfActive) {
      this.commonFeedbackReturns[channel] = 0;
    }

    if (!zdfActive && localLoopActive && resonanceMagnitudeSquared > 0) {
      const feedbackGain = this.maxFeedbackGain * resonanceMagnitudeSquared;
      for (let band = 0; band < this.bandCount; band += 1) {
        const feedbackDrive = feedbackGain * feedbackGates[band] * bandOutputs[band];
        const feedbackReturn = Number.isFinite(feedbackDrive) ? Math.tanh(feedbackDrive) : 0;
        this.localFeedbackReturns[channel][band] = Number.isFinite(feedbackReturn) ? feedbackReturn : 0;
      }
    } else if (!zdfActive) {
      this.localFeedbackReturns[channel].fill(0);
    }

    if (!zdfActive && mainCommonBusActive && resonanceMagnitudeSquared > 0) {
      const feedbackGain = this.mainCommonBusFeedbackGain(resonanceMagnitudeSquared);
      const mainTapSumScaled = mainTapSum * this.feedbackAllLevelScale();
      const drive = feedbackGain * mainTapSumScaled;
      const saturation = this.applyMainCommonBusSaturation(drive);
      if (saturation === null) {
        this.mainCommonFeedbackReturns[channel] = 0;
        this.mainCommonSaturationOutputs[channel] = 0;
        this.mainCommonNonFiniteResetCounts[channel] += 1;
      } else {
        this.mainCommonFeedbackReturns[channel] = saturation.feedbackReturn;
        this.mainCommonSaturationOutputs[channel] = saturation.saturationOutput;
      }
    } else if (!zdfActive) {
      this.mainCommonFeedbackReturns[channel] = 0;
      this.mainCommonSaturationOutputs[channel] = 0;
    }

    const wetOutput = Number.isFinite(mainOutput) ? mainOutput : source;
    if (this.collectResonatorDiagnostics) {
      const diagnostics = this.resonatorDiagnostics[channel];
      const commonFeedbackReturn = zdfActive ? this.zdfLocalReturn[channel] : this.commonFeedbackReturns[channel];
      const mainCommonFeedbackReturn = zdfActive ? this.zdfMainReturn[channel] : this.mainCommonFeedbackReturns[channel];
      const specialZdfMainReturn = this.feedbackAllSaturationReturn === 'drive-4-return-0.2'
        && this.feedbackTopology === 'common-bus' && this.commonBusSaturationMode === 'current';
      const mainSaturationOutput = zdfActive
        ? (specialZdfMainReturn ? this.zdfMainReturn[channel] / 0.2 : this.zdfMainReturn[channel])
        : this.mainCommonSaturationOutputs[channel];
      diagnostics.frameCount += 1;
      diagnostics.sourcePeak = Math.max(diagnostics.sourcePeak, Math.abs(source));
      diagnostics.sourceEnergy += source * source;
      diagnostics.wetPeak = Math.max(diagnostics.wetPeak, Math.abs(wetOutput));
      diagnostics.wetEnergy += wetOutput * wetOutput;
      diagnostics.wetDcSum += wetOutput;
      diagnostics.positiveResonanceAuditionGain = this.positiveResonanceAuditionGain;
      diagnostics.positiveResonanceAuditionGainTarget = this.positiveResonanceAuditionGainTarget;
      diagnostics.nonlinearDrive = this.positiveResonanceDrive;
      diagnostics.nonlinearDriveTarget = this.positiveResonanceDriveTarget;
      diagnostics.resonatorDampingFloor = this.resonatorDampingFloor;
      diagnostics.resonatorDampingFloorTarget = this.resonatorDampingFloorTarget;
      diagnostics.referenceLevel = this.referenceLevel;
      diagnostics.maxBandBoostDb = this.maxBandBoostDb;
      diagnostics.maxBandCutDb = this.maxBandCutDb;
      diagnostics.positiveResonanceEngine = this.positiveResonanceEngine;
      diagnostics.feedbackTopology = this.feedbackTopology;
      diagnostics.localLoopTuning = this.localLoopTuning;
      diagnostics.baseFilterFrequencies = baseFilters.map(filter => filter.frequency);
      diagnostics.feedbackTap = this.feedbackTap;
      diagnostics.wetModel = this.wetModel;
      diagnostics.commonBusSaturationMode = this.commonBusSaturationMode;
      diagnostics.commonBusDrive = this.commonBusDrive;
      diagnostics.commonBusCeiling = this.commonBusCeiling;
      diagnostics.positiveResonanceOutputMode = this.positiveResonanceOutputMode;
      diagnostics.positiveResonanceLatencyMode = this.positiveResonanceLatencyMode;
      diagnostics.positiveResonanceCurve = this.positiveResonanceCurve;
      diagnostics.commonFeedbackReturn = commonFeedbackReturn;
      diagnostics.commonTapSum = commonTapSum;
      diagnostics.commonTapSumPeak = Math.max(diagnostics.commonTapSumPeak, Math.abs(commonTapSum));
      diagnostics.commonSaturationInput = zdfActive
        ? this.maxFeedbackGain * Math.sign(this.resonance) * resonanceMagnitudeSquared * this.zdfLocalBus[channel]
        : commonBusActive && resonanceMagnitudeSquared > 0
          ? this.maxFeedbackGain * resonanceMagnitudeSquared * commonTapSum : 0;
      diagnostics.commonSaturationOutput = commonFeedbackReturn;
      diagnostics.commonFeedbackReturnPeak = Math.max(
        diagnostics.commonFeedbackReturnPeak,
        Math.abs(commonFeedbackReturn)
      );
      for (let band = 0; band < this.bandCount; band += 1) {
        diagnostics.localFeedbackReturnPeak[band] = Math.max(
          diagnostics.localFeedbackReturnPeak[band],
          zdfActive ? 0 : Math.abs(this.localFeedbackReturns[channel][band])
        );
      }
      diagnostics.mainCommonFeedbackReturn = mainCommonFeedbackReturn;
      diagnostics.mainTapSum = mainTapSum;
      diagnostics.mainTapSumScaled = mainTapSum * this.feedbackAllLevelScale();
      diagnostics.mainPostGainFeedbackWeightMode = this.postGainFeedbackWeight;
      diagnostics.mainSaturationInput = zdfActive
        ? Math.sign(this.resonance) * this.maxFeedbackGain
          * (this.feedbackAllResonanceCurve === 'soft-knee' && this.feedbackTopology === 'common-bus'
            ? this.feedbackAllSoftKneeGain(Math.abs(this.resonance)) : resonanceMagnitudeSquared)
          * this.zdfMainBus[channel]
        : mainCommonBusActive && resonanceMagnitudeSquared > 0
          ? this.mainCommonBusFeedbackGain(resonanceMagnitudeSquared) * diagnostics.mainTapSumScaled : 0;
      diagnostics.mainSaturationOutput = mainSaturationOutput;
      diagnostics.mainSaturationReturnMode = this.feedbackAllSaturationReturn;
      const localSatDelta = Math.abs(diagnostics.commonSaturationInput - diagnostics.commonSaturationOutput);
      const mainSatDelta = Math.abs(diagnostics.mainSaturationInput - diagnostics.mainSaturationOutput);
      const localSatReference = Math.max(1e-6, Math.abs(diagnostics.commonSaturationInput) * 0.001);
      const mainSatReference = Math.max(1e-6, Math.abs(diagnostics.mainSaturationInput) * 0.001);
      if (localSatDelta > localSatReference || mainSatDelta > mainSatReference) diagnostics.saturationActiveFrames += 1;
      diagnostics.mainCommonFeedbackReturnPeak = Math.max(
        diagnostics.mainCommonFeedbackReturnPeak,
        Math.abs(mainCommonFeedbackReturn)
      );
      diagnostics.mainTapSumPeak = Math.max(diagnostics.mainTapSumPeak, Math.abs(mainTapSum));
      const mainTapSumScaled = mainTapSum * this.feedbackAllLevelScale();
      diagnostics.mainTapSumScaledPeak = Math.max(diagnostics.mainTapSumScaledPeak, Math.abs(mainTapSumScaled));
      diagnostics.mainFeedbackLevelScale = this.feedbackAllLevelScale();
      diagnostics.mainFeedbackGain = zdfActive
        ? Math.sign(this.resonance) * this.maxFeedbackGain
          * (this.feedbackAllResonanceCurve === 'soft-knee' && this.feedbackTopology === 'common-bus'
            ? this.feedbackAllSoftKneeGain(Math.abs(this.resonance)) : resonanceMagnitudeSquared)
        : mainCommonBusActive && resonanceMagnitudeSquared > 0
          ? this.mainCommonBusFeedbackGain(resonanceMagnitudeSquared) : 0;
      if (diagnostics.firstMainTapSum === null && Math.abs(mainTapSum) > 0) {
        diagnostics.firstMainTapSum = mainTapSum;
        diagnostics.firstMainTapSumScaled = mainTapSumScaled;
      }
      diagnostics.mainCommonNonFiniteResets = this.mainCommonNonFiniteResetCounts[channel];
      diagnostics.resonanceTarget = this.resonanceTarget;
      diagnostics.smoothedResonance = this.resonance;
      diagnostics.feedbackCore = this.feedbackCore;
      diagnostics.feedbackCoreEffective = zdfActive ? 'zdf' : 'current';
      diagnostics.zdfLocalBus = this.zdfLocalBus[channel];
      diagnostics.zdfMainBus = this.zdfMainBus[channel];
      diagnostics.zdfLocalBusPeak = Math.max(diagnostics.zdfLocalBusPeak, Math.abs(this.zdfLocalBus[channel]));
      diagnostics.zdfMainBusPeak = Math.max(diagnostics.zdfMainBusPeak, Math.abs(this.zdfMainBus[channel]));
      diagnostics.zdfTotalReturn = this.zdfReturn[channel];
      diagnostics.zdfSolverIterations += zdfActive ? this.zdfSolverIterations[channel] : 0;
      diagnostics.zdfSolverMaxIterations = Math.max(diagnostics.zdfSolverMaxIterations, zdfActive ? this.zdfSolverIterations[channel] : 0);
      diagnostics.zdfSolverResidual = Math.max(diagnostics.zdfSolverResidual, zdfActive ? this.zdfSolverResidual[channel] : 0);
      diagnostics.zdfSolverLastResidual = zdfActive ? this.zdfSolverResidual[channel] : 0;
      diagnostics.zdfSolverFallbackCount = this.zdfSolverFallbackCount[channel];
      diagnostics.zdfNonFiniteResetCount = this.zdfNonFiniteResetCount[channel];
      let dominantEnergy = 0;
      for (let band = 0; band < this.bandCount; band += 1) {
        if (diagnostics.baseBandEnergy[band] > dominantEnergy) {
          dominantEnergy = diagnostics.baseBandEnergy[band];
          diagnostics.dominantBaseBand = band;
        }
      }
      diagnostics.finite = diagnostics.finite
        && Number.isFinite(source)
        && Number.isFinite(wetOutput);
    }

    return wetOutput;
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0] || [];
    const outputChannels = outputs[0] || [];
    const leftOutput = outputChannels[0];
    const rightOutput = outputChannels[1];
    const frameCount = Math.max(leftOutput?.length || 0, rightOutput?.length || 0);
    for (let frame = 0; frame < frameCount; frame += 1) {
      this.resonance = this.resonanceTarget + this.resonanceSmoothingCoefficient * (this.resonance - this.resonanceTarget);
      this.positiveResonanceAuditionGain = this.positiveResonanceAuditionGainTarget
        + this.positiveResonanceAuditionGainSmoothingCoefficient * (
          this.positiveResonanceAuditionGain - this.positiveResonanceAuditionGainTarget
        );
      this.positiveResonanceDrive = this.positiveResonanceDriveTarget
        + this.positiveResonanceDriveSmoothingCoefficient * (
          this.positiveResonanceDrive - this.positiveResonanceDriveTarget
        );
      this.resonatorDampingFloor = this.resonatorDampingFloorTarget
        + this.resonatorDampingFloorSmoothingCoefficient * (
          this.resonatorDampingFloor - this.resonatorDampingFloorTarget
        );
      this.referenceLevel = this.referenceLevelTarget + this.referenceLevelSmoothingCoefficient * (
        this.referenceLevel - this.referenceLevelTarget
      );
      this.commonBusDrive = this.commonBusDriveTarget + this.commonBusSmoothingCoefficient * (this.commonBusDrive - this.commonBusDriveTarget);
      this.commonBusCeiling = this.commonBusCeilingTarget + this.commonBusSmoothingCoefficient * (this.commonBusCeiling - this.commonBusCeilingTarget);
      for (let index = 0; index < 3; index += 1) {
        this.positiveResonanceOutputWeights[index] = this.positiveResonanceOutputTargets[index]
          + this.devModeSmoothingCoefficient * (
            this.positiveResonanceOutputWeights[index] - this.positiveResonanceOutputTargets[index]
          );
      }
      for (let index = 0; index < 2; index += 1) {
        this.positiveResonanceLatencyWeights[index] = this.positiveResonanceLatencyTargets[index]
          + this.devModeSmoothingCoefficient * (
            this.positiveResonanceLatencyWeights[index] - this.positiveResonanceLatencyTargets[index]
          );
      }
      if (this.positiveResonanceOutputWeights[this.outputModeIndex(this.positiveResonanceOutputModeTarget)] > 0.999999) {
        this.positiveResonanceOutputMode = this.positiveResonanceOutputModeTarget;
      }
      if (this.positiveResonanceLatencyWeights[this.latencyModeIndex(this.positiveResonanceLatencyModeTarget)] > 0.999999) {
        this.positiveResonanceLatencyMode = this.positiveResonanceLatencyModeTarget;
      }
      if (leftOutput) leftOutput[frame] = this.processChannelFrame(inputChannels[0]?.[frame], 'left');
      if (rightOutput) rightOutput[frame] = this.processChannelFrame(inputChannels[1]?.[frame], 'right');
    }
    if (this.collectResonatorDiagnostics) {
      this.diagnosticsFrameCounter += frameCount;
      if (this.diagnosticsFrameCounter >= this.diagnosticsFramesUntilPublish) {
        this.diagnosticsFrameCounter %= this.diagnosticsFramesUntilPublish;
        this.publishResonatorDiagnostics();
      }
    }
    return !this.disposed;
  }
}

registerProcessor('da-filta-processor', DaFiltaProcessor);
