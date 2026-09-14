import { LinearTptSvf, OversampledPositiveTptResonator } from './tpt-svf.js';

class ResonantFilterbankProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const processorOptions = options?.processorOptions || {};
    this.bandFrequencies = this.readBandDefinition(processorOptions.bandFrequencies, 'Frequenzen');
    this.bandQs = this.readBandDefinition(processorOptions.bandQs, 'Q-Werte');
    this.bandCount = this.bandFrequencies.length;
    this.maxBandGainDb = this.readPositiveOption(processorOptions.maxBandGainDb, 12);
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
    this.baseFilters = {
      left: this.createFilters(),
      right: this.createFilters()
    };
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
    const gainDb = this.maxBandGainDb * (this.clampControl(control) / 100);
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
      sampleCount: 0
    };
  }

  publishResonatorDiagnostics() {
    this.port.postMessage({
      type: 'resonator-diagnostics',
      left: { ...this.resonatorDiagnostics.left },
      right: { ...this.resonatorDiagnostics.right }
    });
  }

  processBandpass(filter, input) {
    return filter.process(input);
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
    const feedbackAllGate = this.feedbackAllGateTargets[channel] + this.feedbackGateSmoothingCoefficient * (this.feedbackAllGates[channel] - this.feedbackAllGateTargets[channel]);
    this.feedbackAllGates[channel] = feedbackAllGate;
    let mainOutput = source;
    let globalTapSum = 0;
    const usesLegacyLocalResonance = this.resonanceTarget < 0 && this.resonance < 0;
    let hasActiveLegacyFeedbackGate = feedbackAllGate > 1e-12;

    for (let band = 0; band < this.bandCount; band += 1) {
      const localGate = feedbackGateTargets[band] + this.feedbackGateSmoothingCoefficient * (feedbackGates[band] - feedbackGateTargets[band]);
      feedbackGates[band] = localGate;
      if (usesLegacyLocalResonance && localGate > 1e-12) hasActiveLegacyFeedbackGate = true;
      const resonatorMagnitudeTarget = this.getResonatorMagnitudeTarget(localGate);
      const resonatorMagnitude = resonatorMagnitudeTarget + this.resonanceSmoothingCoefficient * (
        resonatorMagnitudes[band] - resonatorMagnitudeTarget
      );
      resonatorMagnitudes[band] = resonatorMagnitude;
      const resonatorDampingScale = this.getResonatorDampingScale(resonatorMagnitude);
      resonatorFilters[band].setDampingScale(this.getLinearResonatorDampingScale(resonatorMagnitude));
      const resonatorAuditionTarget = this.resonanceTarget > 0 && localGate > 1e-12 ? 1 : 0;
      const resonatorAuditionGate = resonatorAuditionTarget + this.resonanceSmoothingCoefficient * (
        resonatorAuditionGates[band] - resonatorAuditionTarget
      );
      resonatorAuditionGates[band] = resonatorAuditionGate;
      const previousReturn = Number.isFinite(feedbackReturns[band]) ? feedbackReturns[band] : 0;
      if (!Number.isFinite(feedbackReturns[band])) feedbackReturns[band] = 0;
      const bandInput = source + previousReturn;
      const bandOutput = this.processBandpass(baseFilters[band], bandInput);
      const resonatorBandOutput = this.processBandpass(resonatorFilters[band], source);
      const resonanceResidual = resonatorBandOutput - bandOutput;
      let nonlinearResonatorBandOutput = 0;
      let nonlinearResidual = 0;
      let nonlinearBaseResidual = 0;
      const useAudibleNonlinearResidual = this.enableNonlinearPositiveResonator
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
      mainOutput += resonatorAuditionGate * this.positiveResonanceAuditionGain * audibleResidual;
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
      deltaGains[band] = deltaTargets[band] + this.bandGainSmoothingCoefficient * (deltaGains[band] - deltaTargets[band]);
      mainOutput += deltaGains[band] * bandOutput;
    }

    const resonanceMagnitudeSquared = this.resonance * this.resonance;
    if (hasActiveLegacyFeedbackGate && resonanceMagnitudeSquared > 0) {
      const globalTap = Number.isFinite(globalTapSum) ? globalTapSum * this.feedbackAllNormalization : 0;
      const feedbackGain = Math.sign(this.resonance) * this.maxFeedbackGain * resonanceMagnitudeSquared;
      const auditionGain = this.maxAuditionGain * resonanceMagnitudeSquared;
      for (let band = 0; band < this.bandCount; band += 1) {
        const legacyLocalGate = usesLegacyLocalResonance ? feedbackGates[band] : 0;
        const rawFeedback = legacyLocalGate * bandOutputs[band] + feedbackAllGate * globalTap;
        const feedbackDrive = feedbackGain * rawFeedback;
        const feedbackReturn = Number.isFinite(feedbackDrive) ? Math.tanh(feedbackDrive) : 0;
        feedbackReturns[band] = Number.isFinite(feedbackReturn) ? feedbackReturn : 0;
        const legacyAuditionGate = Math.max(legacyLocalGate, feedbackAllGate);
        mainOutput += legacyAuditionGate * auditionGain * bandOutputs[band];
      }
    } else {
      for (let band = 0; band < this.bandCount; band += 1) {
        feedbackReturns[band] = 0;
      }
    }

    const wetOutput = Number.isFinite(mainOutput) ? mainOutput : source;
    if (this.collectResonatorDiagnostics) {
      const diagnostics = this.resonatorDiagnostics[channel];
      diagnostics.frameCount += 1;
      diagnostics.sourcePeak = Math.max(diagnostics.sourcePeak, Math.abs(source));
      diagnostics.sourceEnergy += source * source;
      diagnostics.wetPeak = Math.max(diagnostics.wetPeak, Math.abs(wetOutput));
      diagnostics.wetEnergy += wetOutput * wetOutput;
      diagnostics.positiveResonanceAuditionGain = this.positiveResonanceAuditionGain;
      diagnostics.positiveResonanceAuditionGainTarget = this.positiveResonanceAuditionGainTarget;
      diagnostics.nonlinearDrive = this.positiveResonanceDrive;
      diagnostics.nonlinearDriveTarget = this.positiveResonanceDriveTarget;
      diagnostics.resonatorDampingFloor = this.resonatorDampingFloor;
      diagnostics.resonatorDampingFloorTarget = this.resonatorDampingFloorTarget;
      diagnostics.positiveResonanceOutputMode = this.positiveResonanceOutputMode;
      diagnostics.positiveResonanceLatencyMode = this.positiveResonanceLatencyMode;
      diagnostics.positiveResonanceCurve = this.positiveResonanceCurve;
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
    if (this.collectResonatorDiagnostics) this.publishResonatorDiagnostics();
    return !this.disposed;
  }
}

registerProcessor('resonant-filterbank-processor', ResonantFilterbankProcessor);
