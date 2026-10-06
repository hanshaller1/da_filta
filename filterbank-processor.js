import { LinearTptSvf, OversampledPositiveTptResonator } from './tpt-svf.js';
import { normalizeDynamicEq, targetGainDb, smoothGain, timeCoefficient } from './dynamic-eq-core.mjs';
import { FilterShape } from './filter-shape-core.mjs';
import { ModulationCore, normalizeMacroState } from './modulation-core.mjs';
import { LfoOscillator, normalizeModulationState } from './lfo-core.mjs';
import { EnvelopeFollower, normalizeEnvelopeSources } from './envelope-core.mjs';
import { ClockCore } from './clock-core.mjs';
import { ClockModCore } from './clock-mod-core.mjs';

const COMMON_BUS_RESONANCE_EPSILON = 1e-12;
const DIAGNOSTICS_UPDATE_HZ = 15;
const MODULATION_CONTROL_INTERVAL = 32;
const LFO_TELEMETRY_HZ = 30;
const CLOCK_MOD_TELEMETRY_HZ = 15;
const LEARNED_REFERENCE_ADAPTATION_SECONDS = 30;
const dynamicEqLocalReferenceDb = (levels, band, precomputedWeights) => {
  let weightedLevel = 0;
  let totalWeight = 0;
  for (let neighbor = Math.max(0, band - 2); neighbor <= Math.min(levels.length - 1, band + 2); neighbor += 1) {
    if (neighbor === band) continue;
    const weight = precomputedWeights[band][neighbor];
    weightedLevel += levels[neighbor] * weight;
    totalWeight += weight;
  }
  return totalWeight ? weightedLevel / totalWeight : levels[band];
};
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
    this.modulationCore = new ModulationCore();
    // Direct band contributions join Clock Mod/FILTER/spread before the
    // existing final band-gain clamp. No intermediate saturation of routes.
    this.deferModulationBandClamp = true;
    this.lfoModuleEnabled = false;
    this.envelopeModuleEnabled = false;
    this.lfoSources = [new LfoOscillator()];
    this.lfo = this.lfoSources[0];
    this.envelopeSources = normalizeEnvelopeSources().map(source => new EnvelopeFollower(source));
    this.clockCore = new ClockCore();
    this.clockMod = null;
    this.dryWet = 50;
    this.effectiveDryWetTarget = 50;
    this.effectiveDryWet = 50;
    this.baseSpread = 0;
    this.spreadMaxOffsetDb = 6;
    this.effectiveSpreadDeltaDb = 0;
    this.spreadMode = 'CLASSIC';
    this.perChannelBands = false;
    this.dynamicEqEffectiveSettings = {};
    this.modulationTelemetryCounter = 0;
    this.modulationTelemetryInterval = Math.max(1, Math.round(sampleRate / LFO_TELEMETRY_HZ));
    this.modulationTelemetryDirty = false;
    this.clockModTelemetryCounter = 0;
    this.clockModTelemetryInterval = Math.max(1, Math.round(sampleRate / CLOCK_MOD_TELEMETRY_HZ));
    this.clockModTelemetryDirty = false;
    this.bandFrequencies = this.readBandDefinition(processorOptions.bandFrequencies, 'Frequenzen');
    this.bandQs = this.readBandDefinition(processorOptions.bandQs, 'Q-Werte');
    this.bandCount = this.bandFrequencies.length;
    this.spectralCoreRequired = processorOptions.spectralCoreRequired !== false;
    this.spectralCoreMix = this.spectralCoreRequired ? 1 : 0;
    this.spectralCoreMixTarget = this.spectralCoreMix;
    this.spectralCoreMixCoefficient = this.smoothingCoefficient(0.003, 0.003);
    this.dynamicEqPeakByChannel = { left: new Float64Array(this.bandCount), right: new Float64Array(this.bandCount) };
    this.dynamicEqEnergyByChannel = { left: new Float64Array(this.bandCount), right: new Float64Array(this.bandCount) };
    this.dynamicEqGainByChannel = { left: new Float64Array(this.bandCount), right: new Float64Array(this.bandCount) };
    this.dynamicEqSmoothedByChannel = { left: new Float64Array(this.bandCount), right: new Float64Array(this.bandCount) };
    this.dynamicEqTargetByChannel = { left: new Float64Array(this.bandCount), right: new Float64Array(this.bandCount) };
    this.learnAccumulator = new Float64Array(this.bandCount);
    this.dynamicEqLevelByChannel = { left: new Float64Array(this.bandCount).fill(-120), right: new Float64Array(this.bandCount).fill(-120) };
    this.learnFrames = 0;
    this.learnCompleted = false;
    this.dynamicEqTelemetryDirty = false;
    this.learnDurationFrames = Math.round(sampleRate * 3);
    this.learnedReferenceAdaptationCoefficient = 1 - Math.exp(-1 / (sampleRate * LEARNED_REFERENCE_ADAPTATION_SECONDS));
    this.dynamicEqRelativeWeights = Array.from({ length: this.bandCount }, (_, band) => {
      const weights = new Float64Array(this.bandCount);
      for (let neighbor = Math.max(0, band - 2); neighbor <= Math.min(this.bandCount - 1, band + 2); neighbor += 1) {
        if (neighbor !== band) weights[neighbor] = 1 / Math.max(0.01,
          Math.abs(Math.log(this.bandFrequencies[neighbor] / this.bandFrequencies[band])));
      }
      return weights;
    });
    this.initializingDynamicEq = true;
    this.setDynamicEq(processorOptions);
    this.initializingDynamicEq = false;
    // Dedicated source-only filters keep detection before gain and feedback.
    this.dynamicEqDetectorFilters = { left: this.createFilters(), right: this.createFilters() };
    this.dynamicEqPeak = new Float64Array(this.bandCount);
    this.dynamicEqEnergy = new Float64Array(this.bandCount);
    this.dynamicEqLevelDb = new Float64Array(this.bandCount).fill(-120);
    this.dynamicEqGainDb = new Float64Array(this.bandCount);
    this.dynamicEqSmoothedDb = new Float64Array(this.bandCount);
    this.dynamicEqTargetDb = new Float64Array(this.bandCount);
    this.preDynamicGainDb = {
      left: Float64Array.from(processorOptions.preDynamicGainDbLeft || Array(this.bandCount).fill(0)),
      right: Float64Array.from(processorOptions.preDynamicGainDbRight || Array(this.bandCount).fill(0))
    };
    this.preDynamicSmoothedDb = {
      left: Float64Array.from(this.preDynamicGainDb.left),
      right: Float64Array.from(this.preDynamicGainDb.right)
    };
    // Telemetry shadow of the exact per-channel multiplier used by the output path.
    this.appliedBandGain = {
      left: new Float64Array(this.bandCount),
      right: new Float64Array(this.bandCount)
    };
    this.dynamicEqTelemetryCounter = 0;
    this.dynamicEqTelemetryInterval = Math.max(1, Math.round(sampleRate / 15));
    this.maxBandGainDb = this.readPositiveOption(processorOptions.maxBandGainDb, 12);
    this.maxBandBoostDb = this.readBandBoostDb(processorOptions.maxBandBoostDb ?? this.maxBandGainDb);
    this.maxBandCutDb = this.readBandCutDb(processorOptions.maxBandCutDb ?? this.maxBandGainDb);
    this.referenceLevel = this.readReferenceLevel(processorOptions.referenceLevel);
    this.referenceLevelTarget = this.referenceLevel;
    this.positiveResonanceEngine = this.readPositiveResonanceEngine(processorOptions.positiveResonanceEngine);
    this.feedbackTopology = (processorOptions.feedbackTopology ?? 'common-bus') === 'common-bus'
      ? 'common-bus'
      : processorOptions.feedbackTopology === 'local-loop-exp' ? 'local-loop-exp' : 'isolated-tpt';
    this.feedbackCore = this.readFeedbackCore(processorOptions.feedbackCore ?? 'zdf-per-band');
    this.localLoopTuning = this.readLocalLoopTuning(processorOptions.localLoopTuning);
    this.feedbackTap = (processorOptions.feedbackTap ?? 'post-gain') === 'post-gain' ? 'post-gain' : 'pre-gain';
    this.wetModel = (processorOptions.wetModel ?? 'filterbank-sum') === 'filterbank-sum' ? 'filterbank-sum' : 'reference-delta';
    this.commonBusSaturationMode = processorOptions.commonBusSaturationMode === 'constant-ceiling' ? 'constant-ceiling' : 'current';
    this.commonBusDrive = this.readCommonBusDrive(processorOptions.commonBusDrive);
    this.commonBusDriveTarget = this.commonBusDrive;
    this.commonBusCeiling = this.readCommonBusCeiling(processorOptions.commonBusCeiling);
    this.commonBusCeilingTarget = this.commonBusCeiling;
    this.feedbackAllEngine = this.readFeedbackAllEngine(processorOptions.feedbackAllEngine ?? 'common-bus');
    this.feedbackAllSource = this.readFeedbackAllSource(processorOptions.feedbackAllSource);
    this.postGainFeedbackWeight = this.readPostGainFeedbackWeight(processorOptions.postGainFeedbackWeight);
    this.feedbackAllLevel = this.readFeedbackAllLevel(processorOptions.feedbackAllLevel ?? 'sqrt10');
    this.feedbackAllAmount = this.readFeedbackAllAmount(processorOptions.feedbackAllAmount);
    this.feedbackAllAmountTarget = this.feedbackAllAmount;
    this.baseFeedbackAllAmount = this.feedbackAllAmount;
    this.effectiveFeedbackAllAmountTarget = this.feedbackAllAmount;
    this.feedbackAllResonanceCurve = this.readFeedbackAllResonanceCurve(processorOptions.feedbackAllResonanceCurve);
    this.feedbackAllSaturationReturn = this.readFeedbackAllSaturationReturn(processorOptions.feedbackAllSaturationReturn);
    this.negativeResonanceMode = this.readNegativeResonanceMode(processorOptions.negativeResonanceMode);
    this.negativeResonanceCurve = this.readNegativeResonanceCurve(processorOptions.negativeResonanceCurve);
    this.negativeResonanceAmount = this.readNegativeResonanceAmount(processorOptions.negativeResonanceAmount);
    this.negativeResonanceLocal = processorOptions.negativeResonanceLocal !== false;
    this.negativeResonanceMain = processorOptions.negativeResonanceMain !== false;
    this.negativeResonancePhase = this.readNegativeResonancePhase(processorOptions.negativeResonancePhase);
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
    const initialModulationState = processorOptions.modulationState || {};
    this.filterEnabled = initialModulationState.filterEnabled === true;
    this.filterbankEnabled = initialModulationState.filterbankEnabled !== false;
    this.baseResonance = this.clampResonance(initialModulationState.baseResonance ?? processorOptions.resonance);
    this.filterShapeParams = {};
    this.effectiveFilterShapeParams = {};
    this.baseFilterShapeGainsDb = new Float64Array(this.bandCount);
    this.effectiveFilterShapeGainsDb = new Float64Array(this.bandCount);
    this.modulationDirectBandOffsetsDb = new Float64Array(this.bandCount);
    this.modulationBandOffsetsDb = new Float64Array(this.bandCount);
    this.modulationDirectBandOffsetsByChannel = {
      left: new Float64Array(this.bandCount), right: new Float64Array(this.bandCount)
    };
    this.modulationNativeBandOffsetsByChannel = {
      left: new Float64Array(this.bandCount), right: new Float64Array(this.bandCount)
    };
    this.modulationBandOffsetsByChannel = {
      left: new Float64Array(this.bandCount), right: new Float64Array(this.bandCount)
    };
    this.modulationBandOffsetsDbSmoothed = {
      left: new Float64Array(this.bandCount),
      right: new Float64Array(this.bandCount)
    };
    this.modulationBandGainTargets = { left: new Float64Array(this.bandCount).fill(1), right: new Float64Array(this.bandCount).fill(1) };
    this.modulationBandGains = { left: new Float64Array(this.bandCount).fill(1), right: new Float64Array(this.bandCount).fill(1) };
    this.modulationControlCounter = 0;
    this.modulationGainSmoothingCoefficient = this.smoothingCoefficient(0.004, 0.004);
    this.clockMod = new ClockModCore(initialModulationState.clockMod || {}, {
      maxBandBoostDb: this.maxBandBoostDb, maxBandCutDb: this.maxBandCutDb
    });
    this.setModulationState(initialModulationState);
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
    this.mainSaturationOutput = 0;
    this.mainCommonSaturationOutputs = { left: 0, right: 0 };
    this.mainCommonNonFiniteResetCounts = { left: 0, right: 0 };
    this.zdfReturn = { left: 0, right: 0 };
    this.zdfLocalReturn = { left: 0, right: 0 };
    this.zdfMainReturn = { left: 0, right: 0 };
    this.zdfLocalBus = { left: 0, right: 0 };
    this.zdfMainBus = { left: 0, right: 0 };
    // Kept entirely separate from the Unified ZDF return history so switching
    // cores never turns into an implicit feedback reset.
    this.zdfPerBandLocalReturns = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.zdfPerBandLocalBuses = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.zdfPerBandSolverIterations = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.zdfPerBandSolverResiduals = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    this.zdfPerBandSolverFallbackCounts = {
      left: Array(this.bandCount).fill(0),
      right: Array(this.bandCount).fill(0)
    };
    // Phase 2 keeps the Per-Band LOCAL histories private, and adds a
    // completely separate shared MAIN history per channel. None of these
    // buffers is shared with Unified ZDF or the delayed CURRENT main bus.
    this.zdfPerBandMainReturns = { left: 0, right: 0 };
    this.zdfPerBandMainBuses = { left: 0, right: 0 };
    this.zdfPerBandMainSaturationOutputs = { left: 0, right: 0 };
    this.zdfPerBandCoupledIterations = { left: 0, right: 0 };
    this.zdfPerBandCoupledResiduals = { left: 0, right: 0 };
    this.zdfPerBandCoupledMaxIterations = { left: 0, right: 0 };
    this.zdfPerBandCoupledFallbackCounts = { left: 0, right: 0 };
    this.zdfPerBandCoupledNonFiniteCounts = { left: 0, right: 0 };
    this.zdfPerBandWorkspaces = {
      left: this.createZdfPerBandWorkspace(),
      right: this.createZdfPerBandWorkspace()
    };
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
    this.collectNonlinearResonatorDiagnostics = this.collectResonatorDiagnostics
      && processorOptions.collectNonlinearResonatorDiagnostics !== false;
    this.diagnosticsFramesUntilPublish = Math.max(1, Math.round(sampleRate / DIAGNOSTICS_UPDATE_HZ));
    this.diagnosticsFrameCounter = 0;
    this.resonatorDiagnostics = {
      left: this.createResonatorDiagnostics(),
      right: this.createResonatorDiagnostics()
    };
    this.initializeResonatorMagnitudes();

    this.port.onmessage = event => this.handleMessage(event.data);
    this.port.start?.();
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
  readFeedbackCore(value) {
    return value === 'zdf-per-band' ? 'zdf-per-band' : value === 'zdf' ? 'zdf' : 'current';
  }
  isUnifiedZdfCore() { return this.feedbackCore === 'zdf'; }
  isPerBandZdfCore() { return this.feedbackCore === 'zdf-per-band'; }
  isAnyZdfCore() { return this.isUnifiedZdfCore() || this.isPerBandZdfCore(); }
  readLocalLoopTuning(value) { return value === 'compensated' ? 'compensated' : 'current'; }
  readFeedbackAllEngine(value) { return value === 'common-bus' ? 'common-bus' : 'legacy'; }
  readFeedbackAllSource(value) { return value === 'pre-gain-sum' ? 'pre-gain-sum' : 'post-gain-sum'; }
  readPostGainFeedbackWeight(value) { return value === 'soft-knee' ? 'soft-knee' : 'current'; }
  readFeedbackAllLevel(value) {
    return ['sqrt2', 'half', 'sqrt10', 'tenth', 'twentieth', 'fortieth', 'eightieth'].includes(value) ? value : 'raw';
  }
  readFeedbackAllAmount(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.min(100, Math.max(0, numericValue)) : 100;
  }
  readFeedbackAllResonanceCurve(value) { return value === 'soft-knee' ? 'soft-knee' : 'current'; }
  readFeedbackAllSaturationReturn(value) { return value === 'drive-4-return-0.2' ? 'drive-4-return-0.2' : 'current'; }
  readNegativeResonanceMode(value) { return ['damping', 'anti-resonance', 'phase'].includes(value) ? value : 'signed'; }
  readNegativeResonanceCurve(value) { return ['linear', 'squared', 'soft-knee'].includes(value) ? value : 'same-as-positive'; }
  readNegativeResonanceAmount(value) { const amount = Number(value); return Number.isFinite(amount) ? Math.min(200, Math.max(0, amount)) : 100; }
  readNegativeResonancePhase(value) { const phase = Number(value); return Number.isFinite(phase) ? Math.min(180, Math.max(0, phase)) : 90; }
  negativeResonanceMagnitude() {
    const u = Math.min(1, Math.max(0, -this.resonance));
    const curve = this.negativeResonanceCurve;
    const base = curve === 'linear' ? u : curve === 'soft-knee' ? this.feedbackAllSoftKneeGain(u) : u * u;
    return base * (this.negativeResonanceAmount / 100);
  }
  negativeFeedbackGain(scope) {
    if (this.resonance >= 0 || (scope === 'local' ? !this.negativeResonanceLocal : !this.negativeResonanceMain)) return 0;
    const modeScale = this.negativeResonanceMode === 'damping' ? 0.5
      : this.negativeResonanceMode === 'anti-resonance' ? 1.5 : 1;
    // PHASE remains a negative loop; the phase control changes its stable
    // blend strength without touching positive processing.
    const phaseScale = this.negativeResonanceMode === 'phase'
      ? Math.cos(this.negativeResonancePhase * Math.PI / 360) : 1;
    return -this.maxFeedbackGain * this.negativeResonanceMagnitude() * modeScale * phaseScale;
  }
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

  controlToGainDb(control) {
    const normalizedControl = this.clampControl(control) / 100;
    return normalizedControl >= 0
      ? this.maxBandBoostDb * normalizedControl
      : this.maxBandCutDb * normalizedControl;
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

  setDynamicEq(source) {
    const settings = normalizeDynamicEq(source, this.bandCount);
    if (!source.restoreReference && this.learnedReferenceFrozen && settings.learnedReferenceFrozen && this.learnedReferenceValid) {
      settings.learnedReferenceDb = [...this.learnedReferenceDb];
      settings.learnedReferenceValid = true;
    }
    if (settings.learnedReferenceFrozen && this.learnActive && this.learnedReferenceValid) {
      this.learnActive = false;
      this.learnFrames = 0;
      this.learnAccumulator.fill(0);
    }
    if (settings.learnedReferenceFrozen !== this.learnedReferenceFrozen
      || settings.learnedReferenceValid !== this.learnedReferenceValid
      || settings.learnedReferenceDb.some((value, index) => value !== this.learnedReferenceDb?.[index])) {
      if (!this.initializingDynamicEq) this.dynamicEqTelemetryDirty = true;
    }
    Object.assign(this, settings);
    Object.assign(this.dynamicEqEffectiveSettings, settings);
    this.dynamicEqCutRangeDb = settings.dynamicEqCutRangeDb;
    this.dynamicEqBoostRangeDb = settings.dynamicEqBoostRangeDb;
    this.dynamicEqAttackCoefficient = timeCoefficient(this.dynamicEqAttackMs, sampleRate);
    this.dynamicEqReleaseCoefficient = timeCoefficient(this.dynamicEqReleaseMs, sampleRate);
    this.dynamicEqPeakCoefficient = timeCoefficient(15, sampleRate);
    this.dynamicEqRmsCoefficient = timeCoefficient(50, sampleRate);
    if (!this.dynamicEqEnabled && this.dynamicEqGainDb) {
      this.dynamicEqGainDb.fill(0);
      this.dynamicEqSmoothedDb.fill(0);
      this.dynamicEqGainByChannel.left.fill(0); this.dynamicEqGainByChannel.right.fill(0);
      this.dynamicEqSmoothedByChannel.left.fill(0); this.dynamicEqSmoothedByChannel.right.fill(0);
    }
  }

  setSpectralCoreRequired(required) {
    this.spectralCoreRequired = Boolean(required);
    this.spectralCoreMixTarget = this.spectralCoreRequired ? 1 : 0;
  }

  setResonatorDiagnosticsEnabled(enabled, nonlinearDetails = enabled) {
    const nextValue = Boolean(enabled);
    const nextDetails = nextValue && Boolean(nonlinearDetails);
    if (nextValue === this.collectResonatorDiagnostics
      && nextDetails === this.collectNonlinearResonatorDiagnostics) return;
    this.collectResonatorDiagnostics = nextValue;
    this.collectNonlinearResonatorDiagnostics = nextDetails;
    this.diagnosticsFrameCounter = 0;
    this.resonatorDiagnostics.left = this.createResonatorDiagnostics();
    this.resonatorDiagnostics.right = this.createResonatorDiagnostics();
  }

  updateDynamicEq(left, right) {
    for (let band = 0; band < this.bandCount; band += 1) {
      const leftBand = this.processBandpass(this.dynamicEqDetectorFilters.left[band], Number.isFinite(left) ? left : 0);
      const rightBand = this.processBandpass(this.dynamicEqDetectorFilters.right[band], Number.isFinite(right) ? right : 0);
      const channels = this.stereoDetectorMode === 'DUAL' ? 2 : 1;
      const linkedMagnitude = Math.max(Math.abs(leftBand), Math.abs(rightBand));
      const leftMagnitude = channels === 2 ? Math.abs(leftBand) : linkedMagnitude;
      const rightMagnitude = channels === 2 ? Math.abs(rightBand) : linkedMagnitude;
      const leftLevel = this.dynamicEqDetectorMode === 'peak'
        ? Math.max(leftMagnitude, this.dynamicEqPeakByChannel.left[band] * this.dynamicEqPeakCoefficient)
        : 20 * Math.log10(Math.max(1e-6, Math.sqrt(this.dynamicEqEnergyByChannel.left[band] = leftMagnitude ** 2 * (1 - this.dynamicEqRmsCoefficient) + this.dynamicEqEnergyByChannel.left[band] * this.dynamicEqRmsCoefficient)));
      const rightLevel = this.dynamicEqDetectorMode === 'peak'
        ? Math.max(rightMagnitude, this.dynamicEqPeakByChannel.right[band] * this.dynamicEqPeakCoefficient)
        : 20 * Math.log10(Math.max(1e-6, Math.sqrt(this.dynamicEqEnergyByChannel.right[band] = rightMagnitude ** 2 * (1 - this.dynamicEqRmsCoefficient) + this.dynamicEqEnergyByChannel.right[band] * this.dynamicEqRmsCoefficient)));
      this.dynamicEqPeakByChannel.left[band] = Math.max(leftMagnitude, this.dynamicEqPeakByChannel.left[band] * this.dynamicEqPeakCoefficient);
      this.dynamicEqPeakByChannel.right[band] = Math.max(rightMagnitude, this.dynamicEqPeakByChannel.right[band] * this.dynamicEqPeakCoefficient);
      const leftDb = Math.max(-120, this.dynamicEqDetectorMode === 'peak' ? 20 * Math.log10(Math.max(1e-6, leftLevel)) : leftLevel);
      const rightDb = Math.max(-120, this.dynamicEqDetectorMode === 'peak' ? 20 * Math.log10(Math.max(1e-6, rightLevel)) : rightLevel);
      const levelDb = channels === 2 ? Math.max(leftDb, rightDb) : leftDb;
      this.dynamicEqLevelDb[band] = levelDb;
      this.dynamicEqLevelByChannel.left[band] = leftDb;
      this.dynamicEqLevelByChannel.right[band] = rightDb;
      const sensitivity = this.dynamicEqBandSensitivity[band] / 100;
      const leftTarget = this.dynamicEqEnabled ? targetGainDb(leftDb, this.dynamicEqEffectiveSettings, 100, band,
        this.stereoDetectorMode === 'DUAL' ? this.dynamicEqLevelByChannel.left : this.dynamicEqLevelDb,
        this.bandFrequencies, this.dynamicEqRelativeWeights) : 0;
      this.dynamicEqTargetByChannel.left[band] = leftTarget;
      this.dynamicEqSmoothedByChannel.left[band] = smoothGain(this.dynamicEqSmoothedByChannel.left[band], leftTarget, this.dynamicEqAttackCoefficient, this.dynamicEqReleaseCoefficient);
      this.dynamicEqGainByChannel.left[band] = sensitivity === 0 ? 0 : this.dynamicEqSmoothedByChannel.left[band] * sensitivity;
      if (channels === 2) {
        const rightTarget = this.dynamicEqEnabled ? targetGainDb(rightDb, this.dynamicEqEffectiveSettings, 100, band,
          this.dynamicEqLevelByChannel.right, this.bandFrequencies, this.dynamicEqRelativeWeights) : 0;
        this.dynamicEqTargetByChannel.right[band] = rightTarget;
        this.dynamicEqSmoothedByChannel.right[band] = smoothGain(this.dynamicEqSmoothedByChannel.right[band], rightTarget, this.dynamicEqAttackCoefficient, this.dynamicEqReleaseCoefficient);
        this.dynamicEqGainByChannel.right[band] = sensitivity === 0 ? 0 : this.dynamicEqSmoothedByChannel.right[band] * sensitivity;
      }
      else {
        this.dynamicEqTargetByChannel.right[band] = this.dynamicEqTargetByChannel.left[band];
        this.dynamicEqSmoothedByChannel.right[band] = this.dynamicEqSmoothedByChannel.left[band];
        this.dynamicEqGainByChannel.right[band] = this.dynamicEqGainByChannel.left[band];
      }
      this.dynamicEqTargetDb[band] = sensitivity === 0 ? 0 : this.dynamicEqTargetByChannel.left[band] * sensitivity;
      this.dynamicEqSmoothedDb[band] = this.dynamicEqSmoothedByChannel.left[band];
      this.dynamicEqGainDb[band] = this.dynamicEqGainByChannel.left[band];
      if (this.learnActive && this.learnFrames < this.learnDurationFrames) {
        this.learnAccumulator[band] += levelDb;
      }
      else if (this.learnedReferenceValid && !this.learnedReferenceFrozen) {
        const boundedLevelDb = Math.max(-120, Math.min(12, levelDb));
        const adapted = this.learnedReferenceDb[band] + this.learnedReferenceAdaptationCoefficient * (boundedLevelDb - this.learnedReferenceDb[band]);
        this.learnedReferenceDb[band] = Math.max(-120, Math.min(12, adapted));
      }
    }
    if (this.learnFrames < this.learnDurationFrames && this.learnActive) {
      this.learnFrames += 1;
      if (this.learnFrames >= this.learnDurationFrames) {
        for (let band = 0; band < this.bandCount; band += 1) this.learnedReferenceDb[band] = this.learnAccumulator[band] / this.learnFrames;
        this.learnedReferenceValid = true; this.learnedReferenceFrozen = false; this.learnActive = false;
        this.learnCompleted = true;
      }
    }
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
    const useCompensatedFrequencies = this.feedbackCore === 'current' && this.feedbackTopology === 'local-loop-exp'
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
      feedbackAllAmount: this.feedbackAllAmount,
      feedbackAllAmountTarget: this.feedbackAllAmountTarget,
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
      zdfPerBandLocalReturn: Array(this.bandCount).fill(0),
      zdfPerBandLocalReturnPeak: Array(this.bandCount).fill(0),
      zdfPerBandLocalBus: Array(this.bandCount).fill(0),
      zdfPerBandSolverIterations: Array(this.bandCount).fill(0),
      zdfPerBandSolverResidual: Array(this.bandCount).fill(0),
      zdfPerBandSolverFallbackCount: Array(this.bandCount).fill(0),
      zdfPerBandMainReturn: 0,
      zdfPerBandMainReturnPeak: 0,
      zdfPerBandMainBus: 0,
      zdfPerBandMainBusPeak: 0,
      zdfPerBandCoupledSolverIterations: 0,
      zdfPerBandCoupledSolverMaxIterations: 0,
      zdfPerBandCoupledSolverResidual: 0,
      zdfPerBandCoupledSolverLastResidual: 0,
      zdfPerBandCoupledFallbackCount: 0,
      zdfPerBandCoupledNonFiniteResetCount: 0,
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
    const localGain = this.resonance < 0 ? this.negativeFeedbackGain('local') : this.maxFeedbackGain * signedResonance;
    if ((localGain === 0 && (this.resonance >= 0 || this.negativeFeedbackGain('main') === 0)) || (localA === 0 && mainA === 0)) {
      this.zdfReturn[channel] = 0;
      this.zdfLocalReturn[channel] = 0;
      this.zdfMainReturn[channel] = 0;
      this.zdfLocalBus[channel] = localB;
      this.zdfMainBus[channel] = mainB;
      this.zdfSolverIterations[channel] = 0;
      this.zdfSolverResidual[channel] = 0;
      return 0;
    }
    const mainCurveGain = this.feedbackAllResonanceCurve === 'soft-knee' && this.feedbackTopology === 'common-bus'
      ? this.feedbackAllSoftKneeGain(Math.abs(this.resonance)) : this.resonance * this.resonance;
    // FB ALL AMOUNT is intentionally inside the implicit MAIN loop, before
    // its saturation. LOCAL gain and all LOCAL equations remain untouched.
    const mainGain = this.resonance < 0 ? this.negativeFeedbackGain('main') * (this.feedbackAllAmount / 100)
      : Math.sign(this.resonance) * this.maxFeedbackGain * mainCurveGain * (this.feedbackAllAmount / 100);
    const localConstantCeiling = this.feedbackTopology === 'common-bus'
      && this.commonBusSaturationMode === 'constant-ceiling';
    const localCeiling = localConstantCeiling ? this.commonBusCeiling : 1;
    const specialMain = this.resonance >= 0
      && this.feedbackAllSaturationReturn === 'drive-4-return-0.2'
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

  // Phase 1: every active LOCAL band has its own scalar, zero-delay loop.
  // No MAIN contribution is accepted here; it is intentionally deferred to
  // the later coupled LOCAL + MAIN design.
  solveZdfPerBandLocalReturns(source, channel) {
    const filters = this.baseFilters[channel];
    const gates = this.feedbackGates[channel];
    const gateTargets = this.feedbackGateTargets[channel];
    const gains = this.deltaGains[channel];
    const gainTargets = this.deltaTargets[channel];
    const returns = this.zdfPerBandLocalReturns[channel];
    const buses = this.zdfPerBandLocalBuses[channel];
    const iterationsByBand = this.zdfPerBandSolverIterations[channel];
    const residualsByBand = this.zdfPerBandSolverResiduals[channel];
    const fallbacksByBand = this.zdfPerBandSolverFallbackCounts[channel];
    const signedResonance = Math.sign(this.resonance) * this.resonance * this.resonance;
    const feedbackGain = this.resonance < 0 ? this.negativeFeedbackGain('local') : this.maxFeedbackGain * signedResonance;
    const constantCeiling = this.feedbackTopology === 'common-bus'
      && this.commonBusSaturationMode === 'constant-ceiling';
    const ceiling = constantCeiling ? this.commonBusCeiling : 1;
    const scale = constantCeiling ? this.commonBusDrive / ceiling : 1;

    for (let band = 0; band < this.bandCount; band += 1) {
      // Keep the established smoother cadence: exactly once per band/sample,
      // before either the implicit solve or the audible gain use.
      gates[band] = gateTargets[band] + this.feedbackGateSmoothingCoefficient * (gates[band] - gateTargets[band]);
      gains[band] = gainTargets[band] + this.bandGainSmoothingCoefficient * (gains[band] - gainTargets[band]);

      const gate = gates[band];
      const audibleGain = 1 + gains[band];
      const weight = gate * (this.feedbackTap === 'post-gain' ? audibleGain : 1);
      if (Math.abs(feedbackGain) <= COMMON_BUS_RESONANCE_EPSILON || weight <= COMMON_BUS_RESONANCE_EPSILON) {
        returns[band] = 0;
        buses[band] = 0;
        iterationsByBand[band] = 0;
        residualsByBand[band] = 0;
        continue;
      }

      const filter = filters[band];
      if (!Number.isFinite(filter.ic1eq) || !Number.isFinite(filter.ic2eq)) {
        filter.reset();
        this.zdfNonFiniteResetCount[channel] += 1;
      }
      // Pure affine read from the old TPT states. Do not call filter.process
      // here: the one and only state commit happens in the band loop below.
      const p = filter.baseK * (filter.a1 * filter.ic1eq + filter.a2 * (source - filter.ic2eq));
      const d = filter.baseK * filter.a2;
      const coefficient = scale * feedbackGain * weight;
      if (!Number.isFinite(p) || !Number.isFinite(d) || !Number.isFinite(coefficient)) {
        returns[band] = 0;
        buses[band] = 0;
        iterationsByBand[band] = 0;
        residualsByBand[band] = 0;
        this.zdfNonFiniteResetCount[channel] += 1;
        continue;
      }

      let lower = -ceiling;
      let upper = ceiling;
      let value = Math.max(lower, Math.min(upper, Number.isFinite(returns[band]) ? returns[band] : 0));
      let residual = Infinity;
      let iterations = 0;
      let fallback = false;
      for (; iterations < 6; iterations += 1) {
        const tanhValue = Math.tanh(coefficient * (p + d * value));
        const error = value - ceiling * tanhValue;
        residual = Math.abs(error);
        if (!Number.isFinite(error)) { fallback = true; break; }
        if (error > 0) upper = value;
        else lower = value;
        if (residual < 1e-8) { iterations += 1; break; }
        const derivative = 1 - ceiling * coefficient * d * (1 - tanhValue * tanhValue);
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
          const tanhValue = Math.tanh(coefficient * (p + d * value));
          const error = value - ceiling * tanhValue;
          if (!Number.isFinite(error)) break;
          residual = Math.abs(error);
          if (residual < 1e-8) break;
          if (error > 0) upper = value;
          else lower = value;
        }
      }
      if (!Number.isFinite(value) || !Number.isFinite(residual)) {
        value = 0;
        residual = 0;
        this.zdfNonFiniteResetCount[channel] += 1;
      }
      const bus = weight * (p + d * value);
      returns[band] = value;
      buses[band] = Number.isFinite(bus) ? bus : 0;
      iterationsByBand[band] = iterations;
      residualsByBand[band] = residual;
      if (fallback) fallbacksByBand[band] += 1;
      this.zdfSolverMaxIterations[channel] = Math.max(this.zdfSolverMaxIterations[channel], iterations);
    }
    return returns;
  }

  createZdfPerBandWorkspace() {
    const length = this.bandCount;
    return {
      p: new Float64Array(length), d: new Float64Array(length),
      localWeights: new Float64Array(length), mainWeights: new Float64Array(length),
      locals: new Float64Array(length), warmLocals: new Float64Array(length),
      candidateLocals: new Float64Array(length), trialLocals: new Float64Array(length),
      bestLocals: new Float64Array(length), deltas: new Float64Array(length),
      residuals: new Float64Array(length), diagonal: new Float64Array(length),
      localToMain: new Float64Array(length), mainToLocal: new Float64Array(length),
      active: new Int32Array(length), y: new Float64Array(length),
      activeCount: 0, main: 0, warmMain: 0, bestMain: 0,
      mainResidual: 0, mainDiagonal: 1, mainBus: 0, mainReturn: 0,
      mainSaturationOutput: 0, residual: 0, bestResidual: Infinity,
      scalarResidual: Infinity, scalarIterations: 0, scalarFallback: false
    };
  }

  clampZdfPerBandReturn(value, ceiling) {
    const finite = Number.isFinite(value) ? value : 0;
    return Math.max(-ceiling, Math.min(ceiling, finite));
  }

  // Scalar safeguarded Newton/Bisection used only by the Phase-2 fallback.
  // It deliberately mirrors the Phase-1 numerical constants, but operates on
  // already-prepared affine coefficients so it cannot advance any smoother.
  solveZdfPerBandPreparedScalar(p, d, coefficient, ceiling, initial, workspace) {
    let lower = -ceiling;
    let upper = ceiling;
    let value = this.clampZdfPerBandReturn(initial, ceiling);
    let residual = Infinity;
    let iterations = 0;
    let fallback = false;
    for (; iterations < 6; iterations += 1) {
      const tanhValue = Math.tanh(coefficient * (p + d * value));
      const error = value - ceiling * tanhValue;
      residual = Math.abs(error);
      if (!Number.isFinite(error)) { fallback = true; break; }
      if (error > 0) upper = value;
      else lower = value;
      if (residual < 1e-8) { iterations += 1; break; }
      const derivative = 1 - ceiling * coefficient * d * (1 - tanhValue * tanhValue);
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
        const tanhValue = Math.tanh(coefficient * (p + d * value));
        const error = value - ceiling * tanhValue;
        if (!Number.isFinite(error)) break;
        residual = Math.abs(error);
        if (residual < 1e-8) break;
        if (error > 0) upper = value;
        else lower = value;
      }
    }
    workspace.scalarResidual = residual;
    workspace.scalarIterations = iterations;
    workspace.scalarFallback = fallback;
    return Number.isFinite(value) && Number.isFinite(residual) ? value : NaN;
  }

  evaluateZdfPerBandCoupled(workspace, locals, main, localGain, mainGain, feedbackAllGate, level,
    localCeiling, localScale, mainCeiling, mainScale, withJacobian = false) {
    let mainSum = 0;
    let maximum = 0;
    for (let band = 0; band < this.bandCount; band += 1) {
      const y = workspace.p[band] + workspace.d[band] * (locals[band] + main);
      workspace.y[band] = y;
      mainSum += workspace.mainWeights[band] * y;
      if (!Number.isFinite(y)) return Infinity;
    }
    const mainBus = feedbackAllGate * level * mainSum;
    const mainTanh = Math.tanh(mainScale * mainGain * mainBus);
    const mainReturn = mainCeiling * mainTanh;
    const mainError = main - mainReturn;
    if (!Number.isFinite(mainBus) || !Number.isFinite(mainError)) return Infinity;
    workspace.mainBus = mainBus;
    workspace.mainReturn = mainReturn;
    workspace.mainSaturationOutput = mainTanh;
    workspace.mainResidual = mainError;
    maximum = Math.abs(mainError);
    for (let activeIndex = 0; activeIndex < workspace.activeCount; activeIndex += 1) {
      const band = workspace.active[activeIndex];
      const localTanh = Math.tanh(localScale * localGain * workspace.localWeights[band] * workspace.y[band]);
      const error = locals[band] - localCeiling * localTanh;
      if (!Number.isFinite(error)) return Infinity;
      workspace.residuals[band] = error;
      maximum = Math.max(maximum, Math.abs(error));
      if (withJacobian) {
        const alpha = localCeiling * localScale * (1 - localTanh * localTanh)
          * localGain * workspace.localWeights[band] * workspace.d[band];
        workspace.diagonal[band] = 1 - alpha;
        workspace.localToMain[band] = -alpha;
      }
    }
    if (withJacobian) {
      const mainSlope = mainCeiling * mainScale * (1 - mainTanh * mainTanh)
        * mainGain * feedbackAllGate * level;
      let mainDiagonal = 1;
      for (let band = 0; band < this.bandCount; band += 1) {
        const beta = mainSlope * workspace.mainWeights[band] * workspace.d[band];
        mainDiagonal -= beta;
        workspace.mainToLocal[band] = -beta;
      }
      workspace.mainDiagonal = mainDiagonal;
    }
    return maximum;
  }

  copyZdfPerBandLocals(source, target) {
    for (let band = 0; band < this.bandCount; band += 1) target[band] = source[band];
  }

  considerZdfPerBandCoupledBest(workspace, locals, main, residual) {
    if (!Number.isFinite(residual) || residual >= workspace.bestResidual) return;
    workspace.bestResidual = residual;
    workspace.bestMain = main;
    this.copyZdfPerBandLocals(locals, workspace.bestLocals);
  }

  // Evaluates a fixed-M branch for the nested fallback. LOCAL roots are
  // always seeded from the previous sample, making its branch selection
  // deterministic and continuous whenever the system permits it.
  evaluateZdfPerBandNestedMain(workspace, main, localGain, mainGain, feedbackAllGate, level,
    localCeiling, localScale, mainCeiling, mainScale) {
    for (let band = 0; band < this.bandCount; band += 1) workspace.trialLocals[band] = 0;
    for (let activeIndex = 0; activeIndex < workspace.activeCount; activeIndex += 1) {
      const band = workspace.active[activeIndex];
      const coefficient = localScale * localGain * workspace.localWeights[band];
      const local = this.solveZdfPerBandPreparedScalar(
        workspace.p[band] + workspace.d[band] * main,
        workspace.d[band], coefficient, localCeiling, workspace.warmLocals[band], workspace
      );
      if (!Number.isFinite(local)) return Infinity;
      workspace.trialLocals[band] = local;
    }
    return this.evaluateZdfPerBandCoupled(
      workspace, workspace.trialLocals, main, localGain, mainGain, feedbackAllGate, level,
      localCeiling, localScale, mainCeiling, mainScale, true
    );
  }

  solveZdfPerBandCoupledReturns(source, channel, feedbackAllGate) {
    const filters = this.baseFilters[channel];
    const gates = this.feedbackGates[channel];
    const gateTargets = this.feedbackGateTargets[channel];
    const gains = this.deltaGains[channel];
    const gainTargets = this.deltaTargets[channel];
    const returns = this.zdfPerBandLocalReturns[channel];
    const buses = this.zdfPerBandLocalBuses[channel];
    const workspace = this.zdfPerBandWorkspaces[channel];
    const signedResonance = Math.sign(this.resonance) * this.resonance * this.resonance;
    const localGain = this.resonance < 0 ? this.negativeFeedbackGain('local') : this.maxFeedbackGain * signedResonance;
    const mainCurveGain = this.feedbackAllResonanceCurve === 'soft-knee' && this.feedbackTopology === 'common-bus'
      ? this.feedbackAllSoftKneeGain(Math.abs(this.resonance)) : this.resonance * this.resonance;
    // Keep FB ALL AMOUNT inside the actual coupled equation: it scales the
    // MAIN loop gain before the shared nonlinear return, never LOCAL.
    const mainGain = this.resonance < 0 ? this.negativeFeedbackGain('main') * (this.feedbackAllAmount / 100)
      : Math.sign(this.resonance) * this.maxFeedbackGain * mainCurveGain * (this.feedbackAllAmount / 100);
    const localConstantCeiling = this.feedbackTopology === 'common-bus'
      && this.commonBusSaturationMode === 'constant-ceiling';
    const localCeiling = localConstantCeiling ? this.commonBusCeiling : 1;
    const localScale = localConstantCeiling ? this.commonBusDrive / localCeiling : 1;
    const specialMain = this.resonance >= 0
      && this.feedbackAllSaturationReturn === 'drive-4-return-0.2'
      && this.feedbackTopology === 'common-bus' && this.commonBusSaturationMode === 'current';
    const mainCeiling = specialMain ? 0.2
      : this.commonBusSaturationMode === 'constant-ceiling' ? this.commonBusCeiling : 1;
    const mainScale = specialMain ? 4
      : this.commonBusSaturationMode === 'constant-ceiling' ? this.commonBusDrive / mainCeiling : 1;
    const level = this.feedbackAllLevelScale();
    workspace.activeCount = 0;

    for (let band = 0; band < this.bandCount; band += 1) {
      gates[band] = gateTargets[band] + this.feedbackGateSmoothingCoefficient * (gates[band] - gateTargets[band]);
      gains[band] = gainTargets[band] + this.bandGainSmoothingCoefficient * (gains[band] - gainTargets[band]);
      const filter = filters[band];
      if (!Number.isFinite(filter.ic1eq) || !Number.isFinite(filter.ic2eq)) {
        filter.reset();
        this.zdfNonFiniteResetCount[channel] += 1;
      }
      const p = filter.baseK * (filter.a1 * filter.ic1eq + filter.a2 * (source - filter.ic2eq));
      const d = filter.baseK * filter.a2;
      const audibleGain = 1 + gains[band];
      const localWeight = gates[band] * (this.feedbackTap === 'post-gain' ? audibleGain : 1);
      const mainWeight = this.feedbackAllSource === 'post-gain-sum'
        ? this.mainPostGainFeedbackWeight(audibleGain) : 1;
      workspace.p[band] = p;
      workspace.d[band] = d;
      workspace.localWeights[band] = localWeight;
      workspace.mainWeights[band] = mainWeight;
      workspace.locals[band] = 0;
      workspace.warmLocals[band] = 0;
      if (!Number.isFinite(p) || !Number.isFinite(d) || !Number.isFinite(localWeight) || !Number.isFinite(mainWeight)) {
        this.zdfPerBandCoupledNonFiniteCounts[channel] += 1;
        continue;
      }
      if (localWeight > COMMON_BUS_RESONANCE_EPSILON) {
        workspace.active[workspace.activeCount] = band;
        workspace.activeCount += 1;
        const warm = this.clampZdfPerBandReturn(returns[band], localCeiling);
        workspace.locals[band] = warm;
        workspace.warmLocals[band] = warm;
      }
    }

    const warmMain = this.clampZdfPerBandReturn(this.zdfPerBandMainReturns[channel], mainCeiling);
    workspace.main = warmMain;
    workspace.warmMain = warmMain;
    workspace.bestResidual = Infinity;
    let residual = this.evaluateZdfPerBandCoupled(
      workspace, workspace.locals, workspace.main, localGain, mainGain, feedbackAllGate, level,
      localCeiling, localScale, mainCeiling, mainScale, true
    );
    this.considerZdfPerBandCoupledBest(workspace, workspace.locals, workspace.main, residual);
    let iterations = 0;
    let converged = residual < 1e-8;
    let fallback = false;

    for (; !converged && iterations < 6; iterations += 1) {
      if (!Number.isFinite(residual)) { fallback = true; break; }
      let schur = workspace.mainDiagonal;
      let numerator = -workspace.mainResidual;
      let valid = Number.isFinite(schur);
      for (let activeIndex = 0; activeIndex < workspace.activeCount; activeIndex += 1) {
        const band = workspace.active[activeIndex];
        const diagonal = workspace.diagonal[band];
        if (!Number.isFinite(diagonal) || Math.abs(diagonal) <= 1e-9) { valid = false; break; }
        const mainToLocal = workspace.mainToLocal[band];
        schur -= mainToLocal * workspace.localToMain[band] / diagonal;
        numerator += mainToLocal * workspace.residuals[band] / diagonal;
      }
      if (!valid || !Number.isFinite(schur) || Math.abs(schur) <= 1e-9) { fallback = true; break; }
      const deltaMain = numerator / schur;
      if (!Number.isFinite(deltaMain)) { fallback = true; break; }
      for (let activeIndex = 0; activeIndex < workspace.activeCount; activeIndex += 1) {
        const band = workspace.active[activeIndex];
        workspace.deltas[band] = (-workspace.residuals[band] - workspace.localToMain[band] * deltaMain)
          / workspace.diagonal[band];
        if (!Number.isFinite(workspace.deltas[band])) { valid = false; break; }
      }
      if (!valid) { fallback = true; break; }
      let accepted = false;
      let lambda = 1;
      for (let backtrack = 0; backtrack < 4; backtrack += 1) {
        for (let band = 0; band < this.bandCount; band += 1) workspace.candidateLocals[band] = 0;
        for (let activeIndex = 0; activeIndex < workspace.activeCount; activeIndex += 1) {
          const band = workspace.active[activeIndex];
          workspace.candidateLocals[band] = this.clampZdfPerBandReturn(
            workspace.locals[band] + lambda * workspace.deltas[band], localCeiling
          );
        }
        const candidateMain = this.clampZdfPerBandReturn(workspace.main + lambda * deltaMain, mainCeiling);
        const candidateResidual = this.evaluateZdfPerBandCoupled(
          workspace, workspace.candidateLocals, candidateMain, localGain, mainGain, feedbackAllGate, level,
          // The next Schur/Newton step needs the Jacobian at the accepted
          // iterate. Reusing the initial Jacobian turns nonlinear trajectories
          // into a chord iteration and unnecessarily exhausts the six steps.
          localCeiling, localScale, mainCeiling, mainScale, true
        );
        this.considerZdfPerBandCoupledBest(workspace, workspace.candidateLocals, candidateMain, candidateResidual);
        if (Number.isFinite(candidateResidual) && candidateResidual < residual) {
          this.copyZdfPerBandLocals(workspace.candidateLocals, workspace.locals);
          workspace.main = candidateMain;
          residual = candidateResidual;
          accepted = true;
          if (residual < 1e-8) converged = true;
          break;
        }
        lambda *= 0.5;
      }
      if (!accepted) { fallback = true; break; }
    }
    if (converged) iterations += 1;

    if (!converged) {
      fallback = true;
      let lower = -mainCeiling;
      let upper = mainCeiling;
      let value = warmMain;
      let nestedResidual = this.evaluateZdfPerBandNestedMain(
        workspace, value, localGain, mainGain, feedbackAllGate, level,
        localCeiling, localScale, mainCeiling, mainScale
      );
      this.considerZdfPerBandCoupledBest(workspace, workspace.trialLocals, value, nestedResidual);
      let signedError = workspace.mainResidual;
      for (let step = 0; step < 6 && nestedResidual >= 1e-8; step += 1) {
        let schur = workspace.mainDiagonal;
        for (let activeIndex = 0; activeIndex < workspace.activeCount; activeIndex += 1) {
          const band = workspace.active[activeIndex];
          const diagonal = workspace.diagonal[band];
          if (!Number.isFinite(diagonal) || Math.abs(diagonal) <= 1e-9) { schur = NaN; break; }
          schur -= workspace.mainToLocal[band] * workspace.localToMain[band] / diagonal;
        }
        const candidate = Number.isFinite(schur) && Math.abs(schur) > 1e-9
          ? value - signedError / schur : NaN;
        const next = Number.isFinite(candidate) && candidate > lower && candidate < upper
          ? candidate : 0.5 * (lower + upper);
        nestedResidual = this.evaluateZdfPerBandNestedMain(
          workspace, next, localGain, mainGain, feedbackAllGate, level,
          localCeiling, localScale, mainCeiling, mainScale
        );
        this.considerZdfPerBandCoupledBest(workspace, workspace.trialLocals, next, nestedResidual);
        signedError = workspace.mainResidual;
        if (!Number.isFinite(signedError)) break;
        if (signedError > 0) upper = next;
        else lower = next;
        value = next;
      }
      for (let step = 0; step < 20 && nestedResidual >= 1e-8; step += 1) {
        value = 0.5 * (lower + upper);
        nestedResidual = this.evaluateZdfPerBandNestedMain(
          workspace, value, localGain, mainGain, feedbackAllGate, level,
          localCeiling, localScale, mainCeiling, mainScale
        );
        this.considerZdfPerBandCoupledBest(workspace, workspace.trialLocals, value, nestedResidual);
        signedError = workspace.mainResidual;
        if (!Number.isFinite(signedError)) break;
        if (signedError > 0) upper = value;
        else lower = value;
      }
      if (workspace.bestResidual < Infinity) {
        this.copyZdfPerBandLocals(workspace.bestLocals, workspace.locals);
        workspace.main = workspace.bestMain;
        residual = this.evaluateZdfPerBandCoupled(
          workspace, workspace.locals, workspace.main, localGain, mainGain, feedbackAllGate, level,
          localCeiling, localScale, mainCeiling, mainScale, false
        );
      }
    }

    if (!Number.isFinite(residual)) {
      // A failed MAIN solve must not reset any TPT state. Keep the private
      // Phase-1-style LOCAL roots as the last safe degradation.
      workspace.main = 0;
      for (let band = 0; band < this.bandCount; band += 1) workspace.locals[band] = 0;
      for (let activeIndex = 0; activeIndex < workspace.activeCount; activeIndex += 1) {
        const band = workspace.active[activeIndex];
        const local = this.solveZdfPerBandPreparedScalar(
          workspace.p[band], workspace.d[band], localScale * localGain * workspace.localWeights[band],
          localCeiling, workspace.warmLocals[band], workspace
        );
        workspace.locals[band] = Number.isFinite(local) ? local : 0;
      }
      residual = this.evaluateZdfPerBandCoupled(
        workspace, workspace.locals, workspace.main, localGain, mainGain, feedbackAllGate, level,
        localCeiling, localScale, mainCeiling, mainScale, false
      );
      this.zdfPerBandCoupledNonFiniteCounts[channel] += 1;
    }

    for (let band = 0; band < this.bandCount; band += 1) {
      const local = workspace.locals[band];
      returns[band] = Number.isFinite(local) ? local : 0;
      const bus = workspace.localWeights[band] * (workspace.p[band] + workspace.d[band] * (returns[band] + workspace.main));
      buses[band] = Number.isFinite(bus) ? bus : 0;
      const active = workspace.localWeights[band] > COMMON_BUS_RESONANCE_EPSILON;
      this.zdfPerBandSolverIterations[channel][band] = active ? iterations : 0;
      this.zdfPerBandSolverResiduals[channel][band] = active && Number.isFinite(workspace.residuals[band])
        ? Math.abs(workspace.residuals[band]) : 0;
      if (active && fallback) this.zdfPerBandSolverFallbackCounts[channel][band] += 1;
    }
    this.zdfPerBandMainReturns[channel] = Number.isFinite(workspace.main) ? workspace.main : 0;
    this.zdfPerBandMainBuses[channel] = Number.isFinite(workspace.mainBus) ? workspace.mainBus : 0;
    this.zdfPerBandMainSaturationOutputs[channel] = Number.isFinite(workspace.mainSaturationOutput)
      ? (specialMain ? workspace.mainSaturationOutput : this.zdfPerBandMainReturns[channel]) : 0;
    this.zdfPerBandCoupledIterations[channel] = iterations;
    this.zdfPerBandCoupledMaxIterations[channel] = Math.max(this.zdfPerBandCoupledMaxIterations[channel], iterations);
    this.zdfPerBandCoupledResiduals[channel] = Number.isFinite(residual) ? residual : 0;
    if (fallback) this.zdfPerBandCoupledFallbackCounts[channel] += 1;
    return returns;
  }

  setBandControl(channel, index, value, immediate = false) {
    if ((channel !== 'left' && channel !== 'right') || !Number.isInteger(index) || index < 0 || index >= this.bandCount) return;
    const control = this.clampControl(value);
    const deltaGain = this.controlToDeltaGain(control);
    this.bandControls[channel][index] = control;
    this.deltaTargets[channel][index] = deltaGain;
    if (immediate) this.deltaGains[channel][index] = deltaGain;
    if (this.hasFilterbankBandModulation) {
      this.updateModulationTargets(this.lfo.enabled ? this.lfo.readSample() : 0);
    }
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

  setBaseResonance(value, immediate = false) {
    this.baseResonance = this.clampResonance(value);
    this.updateModulationTargets(this.lfo?.enabled ? this.lfo.readSample() : 0);
    if (immediate && !this.modulationCore.assignments.some(item => item.targetId === 'global.resonance')) {
      this.setEffectiveResonance(this.baseResonance, true);
    }
  }

  setEffectiveResonance(value, immediate = false) {
    this.setResonance(this.filterbankEnabled ? value : 0, immediate);
  }

  getModulationBandBaseDb(index, channel = 'left') {
    if (!Number.isInteger(index) || index < 0 || index >= this.bandCount) return 0;
    const normalizedChannel = channel === 'right' ? 'right' : 'left';
    return this.controlToGainDb(this.bandControls[normalizedChannel][index]);
  }

  setModulationBandOffset(index, channel, value, nativeOffset = 0) {
    if (!Number.isInteger(index) || index < 0 || index >= this.bandCount
      || (channel !== 'left' && channel !== 'right')) return;
    this.modulationDirectBandOffsetsByChannel[channel][index] = Number.isFinite(value) ? value : 0;
    this.modulationNativeBandOffsetsByChannel[channel][index] = Number.isFinite(nativeOffset) ? nativeOffset : 0;
  }

  setEffectiveDryWet(value) {
    this.effectiveDryWetTarget = Math.min(100, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : this.dryWet));
  }

  setEffectiveSpread(value, base) {
    this.effectiveSpreadDeltaDb = this.perChannelBands || this.spreadMode === 'FB_CH_SELECT'
      ? 0
      : Math.max(-this.spreadMaxOffsetDb, Math.min(this.spreadMaxOffsetDb, Number(value) - Number(base)));
  }

  setEffectiveFeedbackAllAmount(value) {
    this.effectiveFeedbackAllAmountTarget = Math.min(100, Math.max(0, Number(value) || 0));
  }

  setEffectiveDynamicEqTimes(attackMs, releaseMs) {
    this.dynamicEqAttackCoefficient = timeCoefficient(attackMs, sampleRate);
    this.dynamicEqReleaseCoefficient = timeCoefficient(releaseMs, sampleRate);
  }

  updateModulationTargets(_unused, evaluateMeta = true) {
    for (let index = 0; index < this.lfoSources.length; index += 1) {
      const oscillator = this.lfoSources[index];
      const active = this.lfoModuleEnabled && oscillator.enabled;
      this.modulationCore.setSourceValue(oscillator.sourceId, active ? oscillator.sampleValue * (oscillator.effectiveOutputAmount / 100) : 0, oscillator.polarity, active);
    }
    for (let index = 0; index < this.envelopeSources.length; index += 1) {
      const follower = this.envelopeSources[index];
      const active = this.envelopeModuleEnabled && follower.enabled;
      this.modulationCore.setSourceValue(follower.sourceId, active ? follower.value * (follower.effectiveOutputAmount / 100) : 0, 'unipolar', active);
    }
    this.publishClockModSources();
    if (evaluateMeta && this.modulationCore.hasMetaAssignments) {
      for (let index = 0; index < this.modulationNodes.length; index += 1) {
        const node = this.modulationNodes[index];
        this.modulationCore.evaluateRecords(node.targets, this);
        if (node.type !== 2) this.publishModulatorNode(node);
      }
    }
    this.modulationCore.evaluate(this);
    if (this.hasFilterParameterModulation) {
      FilterShape.writeFilterShape(this.filterShapeParams, this.bandFrequencies, this.baseFilterShapeGainsDb);
      FilterShape.writeFilterShape(this.effectiveFilterShapeParams, this.bandFrequencies, this.effectiveFilterShapeGainsDb);
    }
    for (let index = 0; index < this.bandCount; index += 1) {
      this.refreshBandModulationOffsets(index);
    }
  }

  refreshBandModulationOffsets(index) {
    const filterOffset = this.hasFilterParameterModulation
      ? this.effectiveFilterShapeGainsDb[index] - this.baseFilterShapeGainsDb[index] : 0;
    const clockModLeftDb = this.modulationNativeBandOffsetsByChannel.left[index];
    const clockModRightDb = this.modulationNativeBandOffsetsByChannel.right[index];
    const spreadOffset = this.effectiveSpreadDeltaDb;
    this.modulationDirectBandOffsetsDb[index] = (this.modulationDirectBandOffsetsByChannel.left[index]
      + this.modulationDirectBandOffsetsByChannel.right[index]) / 2;
    this.modulationBandOffsetsByChannel.left[index] = filterOffset
      + this.modulationDirectBandOffsetsByChannel.left[index] + clockModLeftDb - spreadOffset;
    this.modulationBandOffsetsByChannel.right[index] = filterOffset
      + this.modulationDirectBandOffsetsByChannel.right[index] + clockModRightDb + spreadOffset;
    this.modulationBandOffsetsDb[index] = (this.modulationBandOffsetsByChannel.left[index]
      + this.modulationBandOffsetsByChannel.right[index]) / 2;
    this.setModulationBandGainTarget(index);
  }

  setModulationBandGainTarget(index) {
    for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
      const channel = channelIndex === 0 ? 'left' : 'right';
      const baseDb = this.controlToGainDb(this.bandControls[channel][index]);
      const offsetDb = this.modulationBandOffsetsByChannel[channel][index];
      const effectiveDb = Math.min(this.maxBandBoostDb, Math.max(-this.maxBandCutDb, baseDb + offsetDb));
      this.modulationBandGainTargets[channel][index] = 10 ** ((effectiveDb - baseDb) / 20);
    }
  }

  setModulationState(source = {}) {
    const modulationState = normalizeModulationState(source);
    const envelopeSources = normalizeEnvelopeSources(source);
    const { macroSources } = normalizeMacroState(source);
    for (const macro of macroSources) this.modulationCore.setSourceValue(macro.id, macro.value / 100, 'unipolar', true);
    const wasEnvelopeModuleEnabled = this.envelopeModuleEnabled;
    if (source.filterShapeParams && typeof source.filterShapeParams === 'object') {
      Object.assign(this.filterShapeParams, source.filterShapeParams);
      Object.assign(this.effectiveFilterShapeParams, source.filterShapeParams);
    }
    this.filterShapeParams.maxBandBoostDb = this.maxBandBoostDb;
    this.filterShapeParams.maxBandCutDb = this.maxBandCutDb;
    this.effectiveFilterShapeParams.maxBandBoostDb = this.maxBandBoostDb;
    this.effectiveFilterShapeParams.maxBandCutDb = this.maxBandCutDb;
    if (typeof source.filterEnabled === 'boolean') this.filterEnabled = source.filterEnabled;
    if (typeof source.filterbankEnabled === 'boolean') this.filterbankEnabled = source.filterbankEnabled;
    if (Number.isFinite(Number(source.baseResonance))) this.baseResonance = this.clampResonance(source.baseResonance);
    this.lfoModuleEnabled = modulationState.lfoModuleEnabled;
    this.envelopeModuleEnabled = source.envelopeModuleEnabled === true;
    if (source.clock && typeof source.clock === 'object') this.clockCore.configure(source.clock);
    this.clockMod.configure(source.clockMod || {}, this.clockCore);
    this.dryWet = Number.isFinite(Number(source.dryWet)) ? Math.min(100, Math.max(0, Number(source.dryWet))) : this.dryWet;
    this.baseSpread = Number.isFinite(Number(source.baseSpread ?? source.spread)) ? Number(source.baseSpread ?? source.spread) : this.baseSpread;
    this.spreadMaxOffsetDb = Number.isFinite(Number(source.spreadMaxOffsetDb)) ? Math.abs(Number(source.spreadMaxOffsetDb)) : 6;
    this.baseFeedbackAllAmount = Number.isFinite(Number(source.feedbackAllAmount))
      ? Math.min(100, Math.max(0, Number(source.feedbackAllAmount))) : this.baseFeedbackAllAmount;
    this.perChannelBands = source.perChannelBands === true;
    this.spreadMode = source.spreadMode === 'FB_CH_SELECT' ? 'FB_CH_SELECT' : 'CLASSIC';
    const wasRunning = this.lfoModuleEnabled;
    this.lfoSources = modulationState.lfoSources.map(sourceState => {
      const oscillator = this.lfoSources.find(item => item.sourceId === sourceState.id) || new LfoOscillator();
      oscillator.sourceId = sourceState.id;
      oscillator.configure({ ...sourceState, moduleEnabled: this.lfoModuleEnabled });
      this.modulationCore.setSourceValue(sourceState.id, 0, sourceState.polarity, false);
      return oscillator;
    });
    this.lfo = this.lfoSources[0] || new LfoOscillator();
    this.envelopeSources = envelopeSources.map(sourceState => {
      const follower = this.envelopeSources.find(item => item.sourceId === sourceState.id) || new EnvelopeFollower();
      follower.configure(sourceState);
      follower.updateTimeConstants(sampleRate);
      this.modulationCore.setSourceValue(sourceState.id, 0, 'unipolar', false);
      return follower;
    });
    if (wasEnvelopeModuleEnabled && !this.envelopeModuleEnabled) {
      for (const follower of this.envelopeSources) follower.reset();
    }
    for (const sourceId of [...this.modulationCore.sources.keys()]) {
      const lfoSource = /^lfo\.(\d+)$/.exec(sourceId);
      const envelopeSource = /^envelope\.(\d+)$/.exec(sourceId);
      if ((lfoSource && Number(lfoSource[1]) > this.lfoSources.length)
        || (envelopeSource && Number(envelopeSource[1]) > this.envelopeSources.length)) this.modulationCore.removeSource(sourceId);
    }
    const assignments = Array.isArray(source.assignments) ? source.assignments : [
      ...modulationState.lfoSources.flatMap(item => item.assignments.filter(assignment => assignment.targetId)),
      ...envelopeSources.flatMap(item => item.assignments.filter(assignment => assignment.targetId)),
      ...macroSources.flatMap(item => item.assignments.filter(assignment => assignment.targetId))
    ];
    const clockAssignments = this.clockMod.config.enabled ? this.clockMod.config.assignments.filter(item => item.targetId) : [];
    this.modulationCore.setAssignments(assignments.concat(assignments.some(item => item.sourceId.startsWith('clockMod.1')) ? [] : clockAssignments));
    this.prepareModulationRuntime();
    this.hasFilterParameterModulation = this.modulationCore.assignments.some(item => item.targetId.startsWith('filter.'));
    this.hasFilterbankBandModulation = this.modulationCore.assignments.some(item => item.targetId.startsWith('filterbank.band.'));
    this.updateModulationTargets();
    this.modulationControlCounter = 0;
    this.modulationTelemetryDirty = true;
    this.clockModTelemetryDirty = true;
    if (!wasRunning && this.lfoModuleEnabled) this.modulationTelemetryCounter = this.modulationTelemetryInterval;
  }

  setModulationBaseValues(source) {
    // The caller has already validated/normalized a production preset. Discrete
    // configuration is applied separately, once on a structural boundary.
    if (!this.modulationCore.setAssignmentAmounts(source.assignments)) { this.setModulationState(source); return; }
    Object.assign(this.filterShapeParams, source.filterShapeParams);
    Object.assign(this.effectiveFilterShapeParams, source.filterShapeParams);
    this.baseResonance = this.clampResonance(source.baseResonance);
    this.dryWet = source.dryWet;
    this.baseSpread = source.baseSpread;
    this.baseFeedbackAllAmount = source.feedbackAllAmount;
    if (source.clock) this.clockCore.configure(source.clock);
    this.clockMod.configure(source.clockMod, this.clockCore);
    for (let index = 0; index < this.lfoSources.length; index += 1) {
      this.lfoSources[index].configure({ ...source.lfoSources[index], moduleEnabled: this.lfoModuleEnabled });
      this.envelopeSources[index].configure(source.envelopeSources[index]);
    }
    for (const macro of source.macroSources) {
      const sample = this.modulationCore.sources.get(macro.id);
      sample.value = macro.value / 100; sample.rightValue = sample.value;
    }
    this.updateModulationTargets();
    this.modulationTelemetryDirty = true;
  }

  prepareModulationRuntime() {
    const nodes = new Map();
    for (const [type, sources] of [[0, this.lfoSources], [1, this.envelopeSources]]) for (const processor of sources) {
      nodes.set(processor.sourceId, { type, processor, sample: this.modulationCore.sources.get(processor.sourceId),
        targets: this.modulationCore.modulatorTargets.get(processor.sourceId) || [] });
    }
    nodes.set('clockMod.1', { type: 2, targets: [] });
    this.modulationNodes = this.modulationCore.graph.order.map(id => nodes.get(id)).filter(Boolean);
    this.clockModSourceSamples = [];
    for (let band = -1; band < this.bandCount; band += 1) {
      const id = band < 0 ? 'clockMod.1' : `clockMod.1.band.${band}`;
      // Source registration is configuration work, never a sample-loop lookup.
      if (!this.modulationCore.sources.has(id)) this.modulationCore.setSourceValue(id, 0, 'bipolar', false);
      const sample = this.modulationCore.sources.get(id);
      sample.nativeUnit = band < 0 ? null : 'dB';
      sample.clockBand = band;
      this.clockModSourceSamples.push(sample);
    }
    // Registering new taps may recompile links. Bind the final records once.
    for (const node of this.modulationNodes) if (node.type !== 2) node.targets = (this.modulationCore.modulatorTargets.get(node.processor.sourceId) || []).filter(record => record.links.length);
    this.clockModTargetRecords = this.modulationCore.compiledTargets.filter(record => record.links.some(link => link.source.clockBand !== undefined));
    for (const record of this.clockModTargetRecords) {
      record.clockMask = 0;
      for (const link of record.links) if (link.source.clockBand !== undefined) record.clockMask |= link.source.clockBand < 0 ? 1023 : 1 << link.source.clockBand;
      const band = /^filterbank\.band\.(\d+)\.gainDb$/.exec(record.target.id);
      record.bandIndex = band ? Number(band[1]) : -1;
    }
    this.clockModHasFilterTargets = this.clockModTargetRecords.some(record => record.target.id.startsWith('filter.'));
  }

  publishModulatorNode(node) {
    const processor = node.processor;
    const active = processor.enabled && (node.type === 0 ? this.lfoModuleEnabled : this.envelopeModuleEnabled);
    const value = active ? (node.type === 0 ? processor.sampleValue : processor.value) * (processor.effectiveOutputAmount / 100) : 0;
    node.sample.value = value;
    node.sample.rightValue = value;
    node.sample.enabled = active;
  }

  publishClockModSources() {
    for (let index = 0; index < this.clockModSourceSamples.length; index += 1) {
      const sample = this.clockModSourceSamples[index];
      const band = sample.clockBand < 0 ? this.clockMod.lastTriggeredBand : sample.clockBand;
      const active = this.clockMod.config.enabled && band >= 0;
      const locked = active && this.clockMod.config.lockedBands[band];
      sample.enabled = sample.clockBand >= 0 ? this.clockMod.config.enabled : active;
      sample.value = active && !locked ? this.clockMod.heldOutputLeft[band] : 0;
      sample.rightValue = active && !locked ? this.clockMod.heldOutputRight[band] : 0;
      sample.nativeValue = sample.enabled ? this.clockMod.valueDb('left', band) : 0;
      sample.nativeRightValue = sample.enabled ? this.clockMod.valueDb('right', band) : 0;
    }
  }

  advanceClockModRouting() {
    const mask = this.clockMod.advance(sampleRate, this.clockCore);
    if (!mask) return;
    this.publishClockModSources();
    for (let index = 0; index < this.clockModTargetRecords.length; index += 1) {
      const record = this.clockModTargetRecords[index];
      if (!(record.clockMask & mask)) continue;
      this.modulationCore.evaluateRecord(record, this);
      if (record.bandIndex >= 0) this.refreshBandModulationOffsets(record.bandIndex);
    }
    if (this.clockModHasFilterTargets) {
      FilterShape.writeFilterShape(this.effectiveFilterShapeParams, this.bandFrequencies, this.effectiveFilterShapeGainsDb);
      for (let index = 0; index < this.bandCount; index += 1) this.refreshBandModulationOffsets(index);
    }
  }

  advanceModulationFrame(left = 0, right = 0) {
    const clockBeat = this.clockCore.advance(sampleRate);
    const controlTick = this.modulationControlCounter + 1 >= MODULATION_CONTROL_INTERVAL;
    if (this.modulationCore.hasMetaAssignments) {
      for (let index = 0; index < this.modulationNodes.length; index += 1) {
        const node = this.modulationNodes[index];
        if (node.type === 2) { this.advanceClockModRouting(); continue; }
        if (controlTick) this.modulationCore.evaluateRecords(node.targets, this);
        if (node.type === 0) node.processor.advance(sampleRate, clockBeat, this.clockCore.state.running);
        else if (this.envelopeModuleEnabled && node.processor.enabled) node.processor.process(left, right, sampleRate);
        if (controlTick) this.publishModulatorNode(node);
      }
    } else {
      for (const follower of this.envelopeSources) if (this.envelopeModuleEnabled && follower.enabled) follower.process(left, right, sampleRate);
      for (const oscillator of this.lfoSources) oscillator.advance(sampleRate, clockBeat, this.clockCore.state.running);
      this.advanceClockModRouting();
    }
    this.modulationControlCounter += 1;
    if (this.modulationControlCounter >= MODULATION_CONTROL_INTERVAL) {
      this.modulationControlCounter = 0;
      // Static bases are applied by state/parameter messages. With no
      // assignments there is no sample-varying registry contribution;
      // clocks, sources and held Clock Mod updates still advance above.
      if (this.modulationCore.assignments.length) this.updateModulationTargets(undefined, false);
    }
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
    this.clockMod?.setBandLimits(this.maxBandBoostDb, this.maxBandCutDb);
    this.refreshDeltaTargets(immediate);
    if (this.clockMod) this.updateModulationTargets();
  }

  setBandCutDb(value, immediate = false) {
    this.maxBandCutDb = this.readBandCutDb(value);
    this.clockMod?.setBandLimits(this.maxBandBoostDb, this.maxBandCutDb);
    this.refreshDeltaTargets(immediate);
    if (this.clockMod) this.updateModulationTargets();
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
    this.clearZdfPerBandReturns();
    if (this.isAnyZdfCore()) {
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
    const experimentActive = this.resonance >= 0
      && this.feedbackAllSaturationReturn === 'drive-4-return-0.2'
      && this.feedbackTopology === 'common-bus'
      && this.feedbackAllEngine === 'common-bus'
      && this.commonBusSaturationMode === 'current';
    if (!experimentActive) {
      const feedbackReturn = this.applyCommonBusSaturation(drive);
      this.mainSaturationOutput = feedbackReturn === null ? 0 : feedbackReturn;
      return feedbackReturn;
    }
    const saturationOutput = Math.tanh(4 * drive);
    this.mainSaturationOutput = saturationOutput;
    return 0.2 * saturationOutput;
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
    if (this.isUnifiedZdfCore() && nextTopology !== this.feedbackTopology) this.clearZdfReturns();
    if (this.isPerBandZdfCore() && nextTopology !== this.feedbackTopology) this.clearZdfPerBandReturns();
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
  clearZdfPerBandReturns() {
    for (const channel of ['left', 'right']) {
      this.zdfPerBandLocalReturns[channel].fill(0);
      this.zdfPerBandLocalBuses[channel].fill(0);
      this.zdfPerBandSolverIterations[channel].fill(0);
      this.zdfPerBandSolverResiduals[channel].fill(0);
      this.zdfPerBandSolverFallbackCounts[channel].fill(0);
      this.zdfPerBandMainReturns[channel] = 0;
      this.zdfPerBandMainBuses[channel] = 0;
      this.zdfPerBandMainSaturationOutputs[channel] = 0;
      this.zdfPerBandCoupledIterations[channel] = 0;
      this.zdfPerBandCoupledResiduals[channel] = 0;
      this.zdfPerBandCoupledMaxIterations[channel] = 0;
      this.zdfPerBandCoupledFallbackCounts[channel] = 0;
      this.zdfPerBandCoupledNonFiniteCounts[channel] = 0;
      const workspace = this.zdfPerBandWorkspaces[channel];
      workspace.locals.fill(0);
      workspace.warmLocals.fill(0);
      workspace.candidateLocals.fill(0);
      workspace.trialLocals.fill(0);
      workspace.bestLocals.fill(0);
      workspace.main = 0;
      workspace.warmMain = 0;
      workspace.bestMain = 0;
      workspace.bestResidual = Infinity;
    }
  }
  setFeedbackCore(value) {
    const nextCore = this.readFeedbackCore(value);
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
  setFeedbackAllAmount(value, immediate = false) {
    this.feedbackAllAmountTarget = this.readFeedbackAllAmount(value);
    this.baseFeedbackAllAmount = this.feedbackAllAmountTarget;
    if (!this.modulationCore.assignments.some(item => item.targetId === 'filterbank.feedbackAllAmount')) {
      this.effectiveFeedbackAllAmountTarget = this.feedbackAllAmountTarget;
    }
    if (immediate) this.feedbackAllAmount = this.effectiveFeedbackAllAmountTarget;
    this.updateModulationTargets();
  }
  setFeedbackAllResonanceCurve(value) { this.feedbackAllResonanceCurve = this.readFeedbackAllResonanceCurve(value); }
  setFeedbackAllSaturationReturn(value) { this.feedbackAllSaturationReturn = this.readFeedbackAllSaturationReturn(value); }
  setNegativeResonanceMode(value) { this.negativeResonanceMode = this.readNegativeResonanceMode(value); }
  setNegativeResonanceCurve(value) { this.negativeResonanceCurve = this.readNegativeResonanceCurve(value); }
  setNegativeResonanceAmount(value) { this.negativeResonanceAmount = this.readNegativeResonanceAmount(value); }
  setNegativeResonanceLocal(value) { this.negativeResonanceLocal = Boolean(value); }
  setNegativeResonanceMain(value) { this.negativeResonanceMain = Boolean(value); }
  setNegativeResonancePhase(value) { this.negativeResonancePhase = this.readNegativeResonancePhase(value); }

  applyState(data) {
    this.setDynamicEq(data);
    if (data.spectralCoreRequired !== undefined) this.setSpectralCoreRequired(data.spectralCoreRequired);
    if (data.collectResonatorDiagnostics !== undefined || data.collectNonlinearResonatorDiagnostics !== undefined) {
      const enabled = data.collectResonatorDiagnostics ?? this.collectResonatorDiagnostics;
      this.setResonatorDiagnosticsEnabled(enabled, data.collectNonlinearResonatorDiagnostics ?? enabled);
    }
    if (data.preDynamicGainDbLeft && data.preDynamicGainDbRight) {
      for (let i = 0; i < this.bandCount; i += 1) {
        this.preDynamicGainDb.left[i] = Number.isFinite(data.preDynamicGainDbLeft[i]) ? data.preDynamicGainDbLeft[i] : 0;
        this.preDynamicGainDb.right[i] = Number.isFinite(data.preDynamicGainDbRight[i]) ? data.preDynamicGainDbRight[i] : 0;
        this.preDynamicSmoothedDb.left[i] = this.preDynamicGainDb.left[i];
        this.preDynamicSmoothedDb.right[i] = this.preDynamicGainDb.right[i];
      }
    }
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
    if (data.feedbackAllAmount !== undefined) this.setFeedbackAllAmount(data.feedbackAllAmount, true);
    if (data.feedbackAllResonanceCurve !== undefined) this.setFeedbackAllResonanceCurve(data.feedbackAllResonanceCurve);
    if (data.feedbackAllSaturationReturn !== undefined) this.setFeedbackAllSaturationReturn(data.feedbackAllSaturationReturn);
    if (data.negativeResonanceMode !== undefined) this.setNegativeResonanceMode(data.negativeResonanceMode);
    if (data.negativeResonanceCurve !== undefined) this.setNegativeResonanceCurve(data.negativeResonanceCurve);
    if (data.negativeResonanceAmount !== undefined) this.setNegativeResonanceAmount(data.negativeResonanceAmount);
    if (data.negativeResonanceLocal !== undefined) this.setNegativeResonanceLocal(data.negativeResonanceLocal);
    if (data.negativeResonanceMain !== undefined) this.setNegativeResonanceMain(data.negativeResonanceMain);
    if (data.negativeResonancePhase !== undefined) this.setNegativeResonancePhase(data.negativeResonancePhase);
    if (data.modulationState) this.setModulationState(data.modulationState);
    else if (Number.isFinite(Number(data.resonance))) this.setBaseResonance(data.resonance, true);
    this.initializeResonatorMagnitudes();
  }

  handleMessage(data) {
    if (!data || this.disposed) return;
    if (data.type === 'set-spectral-core-required') { this.setSpectralCoreRequired(data.required); return; }
    if (data.type === 'set-resonator-diagnostics-enabled') {
      this.setResonatorDiagnosticsEnabled(data.enabled, data.nonlinearDetails ?? data.enabled);
      return;
    }
    if (data.type === 'set-dynamic-eq') { this.setDynamicEq(data); return; }
    if (data.type === 'set-modulation-state') { this.setModulationState(data); return; }
    if (data.type === 'set-modulation-base-values') { this.setModulationBaseValues(data); return; }
    if (data.type === 'set-macro-value') {
      const sample = this.modulationCore.sources.get(data.sourceId);
      if (sample && /^macro\.[1-8]$/.test(data.sourceId) && Number.isFinite(Number(data.value))) {
        sample.value = Math.min(100, Math.max(0, Number(data.value))) / 100;
        sample.rightValue = sample.value;
      }
      return;
    }
    if (data.type === 'set-clock-state') { this.clockCore.configure(data.clock || data); return; }
    if (data.type === 'midi-clock-start') {
      if (this.clockCore.state.source === 'midi') {
        this.clockCore.start(true);
        for (const oscillator of this.lfoSources) {
          if (oscillator.rateMode === 'sync') oscillator.reset(0);
        }
      } else this.clockCore.startMidi(true);
      if (this.clockMod.config.clockSource === 'midi') {
        this.clockMod.resetMidiProgression(this.clockCore);
      }
      this.updateModulationTargets();
      this.modulationTelemetryDirty = true;
      this.clockModTelemetryDirty = true;
      return;
    }
    if (data.type === 'midi-clock-continue') {
      if (this.clockCore.state.source === 'midi') this.clockCore.continue();
      else this.clockCore.continueMidi();
      return;
    }
    if (data.type === 'midi-clock-stop') {
      if (this.clockCore.state.source === 'midi') this.clockCore.stop();
      else this.clockCore.stopMidi();
      return;
    }
    if (data.type === 'reset-clockmod-progression') {
      this.clockMod.resetProgression();
      this.clockModTelemetryDirty = true;
      return;
    }
    if (data.type === 'midi-clock-pulse') {
      if (Number.isFinite(Number(data.bpm))) this.clockCore.setMidiTempo(Number(data.bpm));
      this.clockCore.midiPulse();
      return;
    }
    if (data.type === 'reset-lfo-phase') {
      const selected = this.lfoSources.find(item => item.sourceId === data.sourceId);
      const affected = selected ? [selected] : this.lfoSources;
      for (const oscillator of affected) oscillator.reset(this.clockCore.beatPosition);
      this.updateModulationTargets();
      this.modulationTelemetryDirty = true;
      return;
    }
    if (data.type === 'dynamic-eq-learn') {
      this.learnAccumulator.fill(0); this.learnFrames = 0; this.learnActive = true;
      this.learnedReferenceFrozen = false; this.dynamicEqTelemetryDirty = true; return;
    }
    if (data.type === 'set-pre-dynamic-gain-db') {
      if (Number.isInteger(data.index) && data.index >= 0 && data.index < this.bandCount) {
        this.preDynamicGainDb.left[data.index] = Number.isFinite(data.left) ? data.left : 0;
        this.preDynamicGainDb.right[data.index] = Number.isFinite(data.right) ? data.right : 0;
      }
      return;
    }
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
      this.setBaseResonance(data.value);
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
    if (data.type === 'set-feedback-all-amount') { this.setFeedbackAllAmount(data.value); return; }
    if (data.type === 'set-feedback-all-resonance-curve') { this.setFeedbackAllResonanceCurve(data.value); return; }
    if (data.type === 'set-feedback-all-saturation-return') { this.setFeedbackAllSaturationReturn(data.value); return; }
    if (data.type === 'set-negative-resonance-mode') { this.setNegativeResonanceMode(data.value); return; }
    if (data.type === 'set-negative-resonance-curve') { this.setNegativeResonanceCurve(data.value); return; }
    if (data.type === 'set-negative-resonance-amount') { this.setNegativeResonanceAmount(data.value); return; }
    if (data.type === 'set-negative-resonance-local') { this.setNegativeResonanceLocal(data.value); return; }
    if (data.type === 'set-negative-resonance-main') { this.setNegativeResonanceMain(data.value); return; }
    if (data.type === 'set-negative-resonance-phase') { this.setNegativeResonancePhase(data.value); return; }
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
    const unifiedZdfActive = this.isUnifiedZdfCore() && this.feedbackTopology !== 'isolated-tpt';
    const perBandZdfSelected = this.isPerBandZdfCore();
    const perBandZdfActive = perBandZdfSelected && this.feedbackTopology !== 'isolated-tpt';
    // Unlike the retained Unified core, the product Per-Band core must
    // never fall through to a CURRENT feedback architecture when its topology
    // is inactive. It simply supplies no LOCAL return in that situation.
    const zdfActive = unifiedZdfActive || perBandZdfSelected;
    const feedbackAllGate = this.feedbackAllGateTargets[channel] + this.feedbackGateSmoothingCoefficient * (this.feedbackAllGates[channel] - this.feedbackAllGateTargets[channel]);
    this.feedbackAllGates[channel] = feedbackAllGate;
    // A positive common-bus loop follows the already smoothed resonance
    // state on its way to zero. A negative target still leaves the positive
    // topology immediately, preserving the legacy negative-path handoff.
    const negativeLocalActive = this.resonanceTarget < 0 && this.negativeResonanceLocal;
    const negativeMainActive = this.resonanceTarget < 0 && this.negativeResonanceMain;
    const commonBusActive = !perBandZdfActive && this.feedbackTopology === 'common-bus'
      && (zdfActive ? Math.abs(this.resonance) > COMMON_BUS_RESONANCE_EPSILON
        : (this.resonanceTarget >= 0 && this.resonance > COMMON_BUS_RESONANCE_EPSILON) || negativeLocalActive);
    const localLoopActive = !perBandZdfActive && this.feedbackTopology === 'local-loop-exp'
      && (zdfActive ? Math.abs(this.resonance) > COMMON_BUS_RESONANCE_EPSILON
        : (this.resonanceTarget >= 0 && this.resonance > COMMON_BUS_RESONANCE_EPSILON) || negativeLocalActive);
    const usesCommonBusMainEngine = !perBandZdfActive && this.feedbackTopology !== 'isolated-tpt'
      && this.feedbackAllEngine === 'common-bus'
      && (this.resonanceTarget >= 0 || negativeMainActive);
    const mainCommonBusActive = !perBandZdfActive && (commonBusActive || localLoopActive
      || (!zdfActive && negativeMainActive && this.feedbackTopology !== 'isolated-tpt'))
      && (zdfActive || usesCommonBusMainEngine)
      && feedbackAllGate > COMMON_BUS_RESONANCE_EPSILON;
    // Per-Band Phase 2 has a separate implicit MAIN path. `feedbackAllEngine`
    // deliberately cannot select the delayed legacy return in either ZDF core.
    const perBandCoupledMainActive = perBandZdfActive
      && Math.abs(this.resonance) > COMMON_BUS_RESONANCE_EPSILON
      && feedbackAllGate > COMMON_BUS_RESONANCE_EPSILON
      && this.feedbackAllAmount > COMMON_BUS_RESONANCE_EPSILON;
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
    const zdfReturn = unifiedZdfActive ? this.solveZdfReturn(source, channel, feedbackAllGate) : 0;
    let zdfPerBandReturns = null;
    let zdfPerBandMainReturn = 0;
    if (perBandZdfActive) {
      if (perBandCoupledMainActive) {
        zdfPerBandReturns = this.solveZdfPerBandCoupledReturns(source, channel, feedbackAllGate);
        zdfPerBandMainReturn = this.zdfPerBandMainReturns[channel];
      } else {
        // This is intentionally the original Phase-1 call, untouched.
        this.zdfPerBandMainReturns[channel] = 0;
        this.zdfPerBandMainBuses[channel] = 0;
        this.zdfPerBandMainSaturationOutputs[channel] = 0;
        zdfPerBandReturns = this.solveZdfPerBandLocalReturns(source, channel);
      }
    }
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
      const resonatorAuditionTarget = !perBandZdfSelected && this.feedbackTopology === 'isolated-tpt' && this.positiveResonanceEngine === 'tpt' && this.resonanceTarget > 0 && localGate > 1e-12 ? 1 : 0;
      const resonatorAuditionGate = resonatorAuditionTarget + this.resonanceSmoothingCoefficient * (
        resonatorAuditionGates[band] - resonatorAuditionTarget
      );
      resonatorAuditionGates[band] = resonatorAuditionGate;
      const audibleResonatorRequired = !perBandZdfSelected && this.feedbackTopology === 'isolated-tpt'
        && this.positiveResonanceEngine === 'tpt'
        && (resonatorMagnitude > 1e-12 || resonatorAuditionGate > 1e-12);
      const resonatorRequired = this.collectResonatorDiagnostics || audibleResonatorRequired;
      // Generic telemetry needs the linear bands; only audible output or explicit
      // nonlinear detail telemetry needs the oversampled processor.
      const nonlinearResonatorRequired = audibleResonatorRequired || this.collectNonlinearResonatorDiagnostics;
      if (resonatorRequired) resonatorFilters[band].setDampingScale(this.getLinearResonatorDampingScale(resonatorMagnitude));
      const previousReturn = Number.isFinite(feedbackReturns[band]) ? feedbackReturns[band] : 0;
      if (!Number.isFinite(feedbackReturns[band])) feedbackReturns[band] = 0;
      const localLoopReturn = localLoopActive && Number.isFinite(this.localFeedbackReturns[channel][band])
        ? this.localFeedbackReturns[channel][band]
        : 0;
      const bandInput = unifiedZdfActive ? source + zdfReturn
        : perBandZdfActive ? perBandCoupledMainActive
          ? (source + zdfPerBandReturns[band]) + zdfPerBandMainReturn
          : source + zdfPerBandReturns[band]
          : perBandZdfSelected ? source
        : source + previousReturn + localCommonReturn + mainCommonReturn + localLoopReturn;
      const bandOutput = this.processBandpass(baseFilters[band], bandInput);
      const resonatorBandOutput = resonatorRequired ? this.processBandpass(resonatorFilters[band], source) : 0;
      const resonanceResidual = resonatorBandOutput - bandOutput;
      let nonlinearResonatorBandOutput = 0;
      let nonlinearResidual = 0;
      let nonlinearBaseResidual = 0;
      const useAudibleNonlinearResidual = audibleResonatorRequired && this.enableNonlinearPositiveResonator;
      if (nonlinearResonatorFilters && nonlinearResonatorRequired) {
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
      if (!perBandZdfSelected && localGate > 1e-12 && this.resonance > 0 && this.feedbackTopology === 'isolated-tpt') {
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
        if (nonlinearResonatorFilters && nonlinearResonatorRequired) {
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
      const staticGain = 1 + deltaGains[band];
      const modulationTarget = this.modulationBandGainTargets[channel][band];
      const modulationGain = modulationTarget + this.modulationGainSmoothingCoefficient
        * (this.modulationBandGains[channel][band] - modulationTarget);
      this.modulationBandGains[channel][band] = modulationGain;
      const modulationOffsetTargetDb = this.modulationBandOffsetsByChannel[channel][band];
      const modulationOffsetDb = modulationOffsetTargetDb + this.modulationGainSmoothingCoefficient
        * (this.modulationBandOffsetsDbSmoothed[channel][band] - modulationOffsetTargetDb);
      this.modulationBandOffsetsDbSmoothed[channel][band] = modulationOffsetDb;
      const effectiveStaticGain = staticGain * modulationGain;
      const dynamicDb = this.stereoDetectorMode === 'DUAL' ? this.dynamicEqGainByChannel[channel][band] : this.dynamicEqGainDb[band];
      let audibleGain = effectiveStaticGain;
      if (dynamicDb !== 0) {
        const preDynamicTarget = this.preDynamicGainDb[channel][band];
        const preDynamicDb = preDynamicTarget + this.bandGainSmoothingCoefficient
          * (this.preDynamicSmoothedDb[channel][band] - preDynamicTarget);
        this.preDynamicSmoothedDb[channel][band] = preDynamicDb;
        audibleGain = Math.pow(10, Math.max(-this.maxBandCutDb, Math.min(this.maxBandBoostDb,
          preDynamicDb + dynamicDb + modulationOffsetDb)) / 20);
      } else this.preDynamicSmoothedDb[channel][band] = this.preDynamicGainDb[channel][band];
      this.appliedBandGain[channel][band] = audibleGain;
      const mainPostGainWeight = this.mainPostGainFeedbackWeight(effectiveStaticGain);
      if (this.collectResonatorDiagnostics) {
        this.resonatorDiagnostics[channel].mainPostGainFeedbackWeightDb[band] = 20 * Math.log10(mainPostGainWeight);
      }
      if (this.wetModel === 'reference-delta') mainOutput += (audibleGain - 1) * bandOutput;
      else filterbankSum += audibleGain * bandOutput;
      if (commonBusActive && localGate > 1e-12) {
        commonTapSum += localGate * (this.feedbackTap === 'post-gain' ? effectiveStaticGain * bandOutput : bandOutput);
      }
      if (mainCommonBusActive || perBandCoupledMainActive) {
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
        const feedbackGain = this.resonance < 0 ? this.negativeFeedbackGain('local')
          : Math.sign(this.resonance) * this.maxFeedbackGain * resonanceMagnitudeSquared;
        const auditionGain = this.maxAuditionGain * resonanceMagnitudeSquared;
        for (let band = 0; band < this.bandCount; band += 1) {
          const legacyLocalGate = usesLegacyLocalResonance ? feedbackGates[band] : 0;
          const rawFeedback = (this.negativeResonanceLocal ? legacyLocalGate * bandOutputs[band] : 0)
            + (usesLegacyFeedbackAll && (this.resonance >= 0 || this.negativeResonanceMain)
              ? (this.feedbackAllAmount / 100) * feedbackAllGate * globalTap : 0);
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
      const feedbackGain = this.resonance < 0 ? this.negativeFeedbackGain('local')
        : this.maxFeedbackGain * resonanceMagnitudeSquared;
      const drive = feedbackGain * commonTapSum;
      const feedbackReturn = this.applyCommonBusSaturation(drive);
      this.commonFeedbackReturns[channel] = feedbackReturn === null ? 0 : feedbackReturn;
    } else if (!zdfActive) {
      this.commonFeedbackReturns[channel] = 0;
    }

    if (!zdfActive && localLoopActive && resonanceMagnitudeSquared > 0) {
      const feedbackGain = this.resonance < 0 ? this.negativeFeedbackGain('local')
        : this.maxFeedbackGain * resonanceMagnitudeSquared;
      for (let band = 0; band < this.bandCount; band += 1) {
        const feedbackDrive = feedbackGain * feedbackGates[band] * bandOutputs[band];
        const feedbackReturn = Number.isFinite(feedbackDrive) ? Math.tanh(feedbackDrive) : 0;
        this.localFeedbackReturns[channel][band] = Number.isFinite(feedbackReturn) ? feedbackReturn : 0;
      }
    } else if (!zdfActive) {
      this.localFeedbackReturns[channel].fill(0);
    }

    if (!zdfActive && mainCommonBusActive && resonanceMagnitudeSquared > 0) {
      // The amount belongs to the recursive MAIN gain, ahead of the MAIN
      // saturation.  It must not touch the concurrent LOCAL loop.
      const feedbackGain = (this.resonance < 0 ? this.negativeFeedbackGain('main')
        : this.mainCommonBusFeedbackGain(resonanceMagnitudeSquared)) * (this.feedbackAllAmount / 100);
      const mainTapSumScaled = mainTapSum * this.feedbackAllLevelScale();
      const drive = feedbackGain * mainTapSumScaled;
      const saturation = this.applyMainCommonBusSaturation(drive);
      if (saturation === null) {
        this.mainCommonFeedbackReturns[channel] = 0;
        this.mainCommonSaturationOutputs[channel] = 0;
        this.mainCommonNonFiniteResetCounts[channel] += 1;
      } else {
        this.mainCommonFeedbackReturns[channel] = saturation;
        this.mainCommonSaturationOutputs[channel] = this.mainSaturationOutput;
      }
    } else if (!zdfActive) {
      this.mainCommonFeedbackReturns[channel] = 0;
      this.mainCommonSaturationOutputs[channel] = 0;
    }

    const wetOutput = Number.isFinite(mainOutput) ? mainOutput : source;
    if (this.collectResonatorDiagnostics) {
      const diagnostics = this.resonatorDiagnostics[channel];
      const commonFeedbackReturn = unifiedZdfActive ? this.zdfLocalReturn[channel]
        : perBandZdfSelected ? 0 : this.commonFeedbackReturns[channel];
      const mainCommonFeedbackReturn = unifiedZdfActive ? this.zdfMainReturn[channel]
        : perBandZdfSelected ? this.zdfPerBandMainReturns[channel] : this.mainCommonFeedbackReturns[channel];
      const specialZdfMainReturn = this.resonance >= 0
        && this.feedbackAllSaturationReturn === 'drive-4-return-0.2'
        && this.feedbackTopology === 'common-bus' && this.commonBusSaturationMode === 'current';
      const mainSaturationOutput = unifiedZdfActive
        ? (specialZdfMainReturn ? this.zdfMainReturn[channel] / 0.2 : this.zdfMainReturn[channel])
        : perBandZdfSelected ? this.zdfPerBandMainSaturationOutputs[channel] : this.mainCommonSaturationOutputs[channel];
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
      diagnostics.commonSaturationInput = unifiedZdfActive
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
          perBandZdfActive ? Math.abs(this.zdfPerBandLocalReturns[channel][band])
            : unifiedZdfActive ? 0 : Math.abs(this.localFeedbackReturns[channel][band])
        );
        if (perBandZdfActive) {
          diagnostics.zdfPerBandLocalReturn[band] = this.zdfPerBandLocalReturns[channel][band];
          diagnostics.zdfPerBandLocalReturnPeak[band] = Math.max(
            diagnostics.zdfPerBandLocalReturnPeak[band],
            Math.abs(this.zdfPerBandLocalReturns[channel][band])
          );
          diagnostics.zdfPerBandLocalBus[band] = this.zdfPerBandLocalBuses[channel][band];
          diagnostics.zdfPerBandSolverIterations[band] = this.zdfPerBandSolverIterations[channel][band];
          diagnostics.zdfPerBandSolverResidual[band] = this.zdfPerBandSolverResiduals[channel][band];
          diagnostics.zdfPerBandSolverFallbackCount[band] = this.zdfPerBandSolverFallbackCounts[channel][band];
        }
      }
      if (perBandZdfActive) {
        diagnostics.zdfPerBandMainReturn = this.zdfPerBandMainReturns[channel];
        diagnostics.zdfPerBandMainReturnPeak = Math.max(
          diagnostics.zdfPerBandMainReturnPeak, Math.abs(this.zdfPerBandMainReturns[channel])
        );
        diagnostics.zdfPerBandMainBus = this.zdfPerBandMainBuses[channel];
        diagnostics.zdfPerBandMainBusPeak = Math.max(
          diagnostics.zdfPerBandMainBusPeak, Math.abs(this.zdfPerBandMainBuses[channel])
        );
        diagnostics.zdfPerBandCoupledSolverIterations += perBandCoupledMainActive
          ? this.zdfPerBandCoupledIterations[channel] : 0;
        diagnostics.zdfPerBandCoupledSolverMaxIterations = Math.max(
          diagnostics.zdfPerBandCoupledSolverMaxIterations,
          perBandCoupledMainActive ? this.zdfPerBandCoupledIterations[channel] : 0
        );
        diagnostics.zdfPerBandCoupledSolverResidual = Math.max(
          diagnostics.zdfPerBandCoupledSolverResidual,
          perBandCoupledMainActive ? this.zdfPerBandCoupledResiduals[channel] : 0
        );
        diagnostics.zdfPerBandCoupledSolverLastResidual = perBandCoupledMainActive
          ? this.zdfPerBandCoupledResiduals[channel] : 0;
        diagnostics.zdfPerBandCoupledFallbackCount = this.zdfPerBandCoupledFallbackCounts[channel];
        diagnostics.zdfPerBandCoupledNonFiniteResetCount = this.zdfPerBandCoupledNonFiniteCounts[channel];
      }
      diagnostics.mainCommonFeedbackReturn = mainCommonFeedbackReturn;
      diagnostics.mainTapSum = mainTapSum;
      diagnostics.mainTapSumScaled = mainTapSum * this.feedbackAllLevelScale();
      diagnostics.feedbackAllAmount = this.feedbackAllAmount;
      diagnostics.feedbackAllAmountTarget = this.feedbackAllAmountTarget;
      diagnostics.negativeResonanceMode = this.negativeResonanceMode;
      diagnostics.negativeResonanceCurve = this.negativeResonanceCurve;
      diagnostics.negativeResonanceAmount = this.negativeResonanceAmount;
      diagnostics.negativeResonanceLocal = this.negativeResonanceLocal;
      diagnostics.negativeResonanceMain = this.negativeResonanceMain;
      diagnostics.negativeResonancePhase = this.negativeResonancePhase;
      diagnostics.mainPostGainFeedbackWeightMode = this.postGainFeedbackWeight;
      diagnostics.mainSaturationInput = unifiedZdfActive
        ? Math.sign(this.resonance) * this.maxFeedbackGain
          * (this.feedbackAllResonanceCurve === 'soft-knee' && this.feedbackTopology === 'common-bus'
            ? this.feedbackAllSoftKneeGain(Math.abs(this.resonance)) : resonanceMagnitudeSquared)
          * (this.feedbackAllAmount / 100)
          * this.zdfMainBus[channel]
        : perBandCoupledMainActive
          ? Math.sign(this.resonance) * this.maxFeedbackGain
            * (this.feedbackAllResonanceCurve === 'soft-knee' && this.feedbackTopology === 'common-bus'
              ? this.feedbackAllSoftKneeGain(Math.abs(this.resonance)) : resonanceMagnitudeSquared)
            * (this.feedbackAllAmount / 100)
            * this.zdfPerBandMainBuses[channel]
          : mainCommonBusActive && resonanceMagnitudeSquared > 0
          ? this.mainCommonBusFeedbackGain(resonanceMagnitudeSquared)
            * (this.feedbackAllAmount / 100) * diagnostics.mainTapSumScaled : 0;
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
      diagnostics.mainFeedbackGain = unifiedZdfActive
        ? Math.sign(this.resonance) * this.maxFeedbackGain
          * (this.feedbackAllResonanceCurve === 'soft-knee' && this.feedbackTopology === 'common-bus'
            ? this.feedbackAllSoftKneeGain(Math.abs(this.resonance)) : resonanceMagnitudeSquared)
          * (this.feedbackAllAmount / 100)
        : perBandCoupledMainActive
          ? Math.sign(this.resonance) * this.maxFeedbackGain
            * (this.feedbackAllResonanceCurve === 'soft-knee' && this.feedbackTopology === 'common-bus'
              ? this.feedbackAllSoftKneeGain(Math.abs(this.resonance)) : resonanceMagnitudeSquared)
            * (this.feedbackAllAmount / 100)
          : mainCommonBusActive && resonanceMagnitudeSquared > 0
          ? this.mainCommonBusFeedbackGain(resonanceMagnitudeSquared)
            * (this.feedbackAllAmount / 100) : 0;
      if (diagnostics.firstMainTapSum === null && Math.abs(mainTapSum) > 0) {
        diagnostics.firstMainTapSum = mainTapSum;
        diagnostics.firstMainTapSumScaled = mainTapSumScaled;
      }
      diagnostics.mainCommonNonFiniteResets = perBandZdfSelected
        ? this.zdfPerBandCoupledNonFiniteCounts[channel]
        : this.mainCommonNonFiniteResetCounts[channel];
      diagnostics.resonanceTarget = this.resonanceTarget;
      diagnostics.smoothedResonance = this.resonance;
      diagnostics.feedbackCore = this.feedbackCore;
      diagnostics.feedbackCoreEffective = perBandZdfActive ? 'zdf-per-band' : unifiedZdfActive ? 'zdf' : 'current';
      diagnostics.zdfLocalBus = unifiedZdfActive ? this.zdfLocalBus[channel] : 0;
      diagnostics.zdfMainBus = unifiedZdfActive ? this.zdfMainBus[channel] : 0;
      diagnostics.zdfLocalBusPeak = Math.max(diagnostics.zdfLocalBusPeak, Math.abs(diagnostics.zdfLocalBus));
      diagnostics.zdfMainBusPeak = Math.max(diagnostics.zdfMainBusPeak, Math.abs(diagnostics.zdfMainBus));
      diagnostics.zdfTotalReturn = unifiedZdfActive ? this.zdfReturn[channel] : 0;
      diagnostics.zdfSolverIterations += unifiedZdfActive ? this.zdfSolverIterations[channel] : 0;
      diagnostics.zdfSolverMaxIterations = Math.max(diagnostics.zdfSolverMaxIterations, unifiedZdfActive ? this.zdfSolverIterations[channel] : 0);
      diagnostics.zdfSolverResidual = Math.max(diagnostics.zdfSolverResidual, unifiedZdfActive ? this.zdfSolverResidual[channel] : 0);
      diagnostics.zdfSolverLastResidual = unifiedZdfActive ? this.zdfSolverResidual[channel] : 0;
      diagnostics.zdfSolverFallbackCount = unifiedZdfActive ? this.zdfSolverFallbackCount[channel] : 0;
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
    const modulationOutputChannels = outputs[1] || [];
    const modulationOutput = modulationOutputChannels[0];
    const leftOutput = outputChannels[0];
    const rightOutput = outputChannels[1];
    const frameCount = Math.max(leftOutput?.length || 0, rightOutput?.length || 0, modulationOutput?.length || 0);
    for (let frame = 0; frame < frameCount; frame += 1) {
      this.advanceModulationFrame(inputChannels[0]?.[frame], inputChannels[1]?.[frame]);
      this.effectiveDryWet = this.effectiveDryWetTarget + this.modulationGainSmoothingCoefficient
        * (this.effectiveDryWet - this.effectiveDryWetTarget);
      if (modulationOutput) modulationOutput[frame] = Math.max(-1, Math.min(1,
        (this.effectiveDryWet - this.dryWet) / 100));
      const mixTarget = this.spectralCoreMixTarget;
      const nextMix = mixTarget + this.spectralCoreMixCoefficient * (this.spectralCoreMix - mixTarget);
      this.spectralCoreMix = Math.abs(nextMix - mixTarget) < 1e-6 ? mixTarget : nextMix;
      if (this.dynamicEqEnabled || this.learnActive) this.updateDynamicEq(inputChannels[0]?.[frame], inputChannels[1]?.[frame]);
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
      this.feedbackAllAmount = this.effectiveFeedbackAllAmountTarget + this.feedbackGateSmoothingCoefficient * (
        this.feedbackAllAmount - this.effectiveFeedbackAllAmountTarget
      );
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
      if (leftOutput) {
        const source = Number.isFinite(inputChannels[0]?.[frame]) ? inputChannels[0][frame] : 0;
        const wet = this.spectralCoreMix > 0 || this.collectResonatorDiagnostics
          ? this.processChannelFrame(source, 'left') : source;
        leftOutput[frame] = this.spectralCoreMix === 1 ? wet
          : this.spectralCoreMix === 0 ? source : source + this.spectralCoreMix * (wet - source);
      }
      if (rightOutput) {
        const source = Number.isFinite(inputChannels[1]?.[frame]) ? inputChannels[1][frame] : 0;
        const wet = this.spectralCoreMix > 0 || this.collectResonatorDiagnostics
          ? this.processChannelFrame(source, 'right') : source;
        rightOutput[frame] = this.spectralCoreMix === 1 ? wet
          : this.spectralCoreMix === 0 ? source : source + this.spectralCoreMix * (wet - source);
      }
    }
    if ((this.lfoModuleEnabled && this.lfoSources.some(oscillator => oscillator.enabled))
      || (this.envelopeModuleEnabled && this.envelopeSources.some(follower => follower.enabled)) || this.modulationTelemetryDirty) {
      this.modulationTelemetryCounter += frameCount;
      if (this.modulationTelemetryCounter >= this.modulationTelemetryInterval || this.modulationTelemetryDirty) {
        this.modulationTelemetryCounter %= this.modulationTelemetryInterval;
        for (const oscillator of this.lfoSources) {
          const packet = { type: 'lfo-telemetry', sourceId: oscillator.sourceId,
            enabled: this.lfoModuleEnabled && oscillator.enabled, waveform: oscillator.waveform,
            polarity: oscillator.polarity, invert: oscillator.invert, rateHz: oscillator.effectiveRateHz,
            rateMode: oscillator.rateMode, phase: oscillator.phase, value: oscillator.sampleValue * (oscillator.effectiveOutputAmount / 100) };
          if (this.modulationCore.hasMetaAssignments) Object.assign(packet, { baseRateHz: oscillator.rateHz, outputAmount: oscillator.effectiveOutputAmount });
          this.port.postMessage(packet);
        }
        for (const follower of this.envelopeSources) {
          const packet = { type: 'envelope-telemetry', sourceId: follower.sourceId,
            enabled: this.envelopeModuleEnabled && follower.enabled, detectorMode: follower.detectorMode,
            rawLevel: follower.rawLevel, value: follower.value * (follower.effectiveOutputAmount / 100), thresholdLevel: follower.thresholdLevel };
          if (this.modulationCore.hasMetaAssignments) Object.assign(packet, { attack: follower.effectiveAttack,
            release: follower.effectiveRelease, outputAmount: follower.effectiveOutputAmount });
          this.port.postMessage(packet);
        }
        this.modulationTelemetryDirty = false;
      }
    }
    if (this.clockMod.config.enabled || this.clockModTelemetryDirty) {
      this.clockModTelemetryCounter += frameCount;
      if (this.clockModTelemetryCounter >= this.clockModTelemetryInterval || this.clockModTelemetryDirty) {
        this.clockModTelemetryCounter %= this.clockModTelemetryInterval;
        this.port.postMessage({ type: 'clock-mod-telemetry', enabled: this.clockMod.config.enabled,
          currentBand: this.clockMod.nextBandIndex, runtimeCurrentBand: this.clockMod.currentBand,
          lastTriggeredBand: this.clockMod.lastTriggeredBand,
          oscillatorPhase: this.clockMod.oscillatorPhase, sourceFrequencyHz: this.clockMod.config.sourceFrequencyHz,
          internalBpm: this.clockMod.config.internalBpm, clockSource: this.clockMod.config.clockSource,
          midiBpm: this.clockCore.state.midiBpm, midiRunning: this.clockCore.midiTransportRunning,
          midpointDb: this.clockMod.config.midpointDb, heldLeft: Array.from(this.clockMod.heldLeft),
          heldRight: Array.from(this.clockMod.heldRight), lockedBands: [...this.clockMod.config.lockedBands] });
        this.clockModTelemetryDirty = false;
      }
    }
    if (this.dynamicEqEnabled || this.learnActive || this.learnCompleted || this.dynamicEqTelemetryDirty) {
      this.dynamicEqTelemetryCounter += frameCount;
      if (this.dynamicEqTelemetryCounter >= this.dynamicEqTelemetryInterval || this.dynamicEqTelemetryDirty) {
        this.dynamicEqTelemetryCounter %= this.dynamicEqTelemetryInterval;
        const leftRelativeReferences = Array.from({ length: this.bandCount }, (_, band) =>
          dynamicEqLocalReferenceDb(this.dynamicEqLevelByChannel.left, band, this.dynamicEqRelativeWeights));
        const rightRelativeReferences = Array.from({ length: this.bandCount }, (_, band) =>
          dynamicEqLocalReferenceDb(this.dynamicEqLevelByChannel.right, band, this.dynamicEqRelativeWeights));
        this.port.postMessage({ type: 'dynamic-eq-telemetry', levels: Array.from(this.dynamicEqLevelDb),
          leftLevels: Array.from(this.dynamicEqLevelByChannel.left), rightLevels: Array.from(this.dynamicEqLevelByChannel.right),
          relativeReferences: this.stereoDetectorMode === 'DUAL' ? null : leftRelativeReferences,
          leftRelativeReferences, rightRelativeReferences,
          targets: Array.from(this.dynamicEqTargetDb), gains: Array.from(this.dynamicEqGainDb),
          learnedReferenceDb: Array.from(this.learnedReferenceDb), learnedReferenceValid: this.learnedReferenceValid,
          learnedReferenceFrozen: this.learnedReferenceFrozen, learnProgress: this.learnActive ? this.learnFrames / this.learnDurationFrames : 0,
          leftGains: Array.from(this.dynamicEqGainByChannel.left), rightGains: Array.from(this.dynamicEqGainByChannel.right),
          leftAppliedBandGainDb: Array.from(this.appliedBandGain.left, gain => 20 * Math.log10(Math.max(1e-12, gain))),
          rightAppliedBandGainDb: Array.from(this.appliedBandGain.right, gain => 20 * Math.log10(Math.max(1e-12, gain))) });
        this.dynamicEqTelemetryDirty = false;
        this.learnCompleted = false;
      }
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
