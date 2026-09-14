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
    this.enableNonlinearResonatorDiagnostics = processorOptions.enableNonlinearResonatorDiagnostics === true;
    this.nonlinearResonatorDrive = this.readDiagnosticDrive(processorOptions.nonlinearResonatorDrive);
    this.positiveResonanceAuditionGain = this.readPositiveOption(processorOptions.positiveResonanceAuditionGain, 0.1);
    this.positiveResonanceAuditionGainTarget = this.positiveResonanceAuditionGain;
    this.feedbackAllNormalization = this.readPositiveOption(processorOptions.feedbackAllNormalization, 1 / Math.sqrt(this.bandCount));
    this.bandGainSmoothingCoefficient = this.smoothingCoefficient(processorOptions.smoothingTime, 0.015);
    this.feedbackGateSmoothingCoefficient = this.smoothingCoefficient(processorOptions.feedbackGateSmoothingTime, 0.008);
    this.resonanceSmoothingCoefficient = this.smoothingCoefficient(processorOptions.resonanceSmoothingTime, 0.015);
    this.positiveResonanceAuditionGainSmoothingCoefficient = this.smoothingCoefficient(
      processorOptions.positiveResonanceAuditionGainSmoothingTime,
      0.015
    );
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
    this.nonlinearResonatorFilters = this.enableNonlinearResonatorDiagnostics ? {
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
    if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > 1) return 0.1;
    return numericValue;
  }

  readDiagnosticDrive(value) {
    const numericValue = Number(value);
    return numericValue === 1 || numericValue === 2 || numericValue === 4 || numericValue === 8
      ? numericValue
      : 4;
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
    return Math.min(1, localGate * this.resonanceTarget);
  }

  getResonatorDampingScale(magnitude) {
    const normalizedMagnitude = Math.min(1, Math.max(0, magnitude));
    return 1 - (1 - this.resonatorDampingFloor) * normalizedMagnitude;
  }

  initializeResonatorMagnitudes() {
    for (const channel of ['left', 'right']) {
      for (let band = 0; band < this.bandCount; band += 1) {
        const magnitude = this.getResonatorMagnitudeTarget(this.feedbackGates[channel][band]);
        this.resonatorMagnitudes[channel][band] = magnitude;
        this.resonatorAuditionGates[channel][band] = magnitude > 1e-12 ? 1 : 0;
        this.resonatorFilters[channel][band].setDampingScale(this.getResonatorDampingScale(magnitude));
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
      nonlinearEnabled: this.enableNonlinearResonatorDiagnostics,
      nonlinearDrive: this.nonlinearResonatorDrive,
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
      resonatorFilters[band].setDampingScale(resonatorDampingScale);
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
      if (nonlinearResonatorFilters) {
        const nonlinearFilter = nonlinearResonatorFilters[band];
        nonlinearResonatorBandOutput = nonlinearFilter.process(
          source,
          resonatorDampingScale,
          this.nonlinearResonatorDrive,
          resonatorMagnitude > 1e-12
        );
        nonlinearResidual = nonlinearFilter.residual;
      }
      bandOutputs[band] = bandOutput;
      resonatorBandOutputs[band] = resonatorBandOutput;
      resonanceResiduals[band] = Number.isFinite(resonanceResidual) ? resonanceResidual : 0;
      mainOutput += resonatorAuditionGate * this.positiveResonanceAuditionGain * resonanceResiduals[band];
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
      if (leftOutput) leftOutput[frame] = this.processChannelFrame(inputChannels[0]?.[frame], 'left');
      if (rightOutput) rightOutput[frame] = this.processChannelFrame(inputChannels[1]?.[frame], 'right');
    }
    if (this.collectResonatorDiagnostics) this.publishResonatorDiagnostics();
    return !this.disposed;
  }
}

registerProcessor('resonant-filterbank-processor', ResonantFilterbankProcessor);
