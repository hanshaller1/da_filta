import { LinearTptSvf } from './tpt-svf.js';

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
    this.feedbackAllNormalization = this.readPositiveOption(processorOptions.feedbackAllNormalization, 1 / Math.sqrt(this.bandCount));
    this.bandGainSmoothingCoefficient = this.smoothingCoefficient(processorOptions.smoothingTime, 0.015);
    this.feedbackGateSmoothingCoefficient = this.smoothingCoefficient(processorOptions.feedbackGateSmoothingTime, 0.008);
    this.resonanceSmoothingCoefficient = this.smoothingCoefficient(processorOptions.resonanceSmoothingTime, 0.015);
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
    this.collectResonatorDiagnostics = processorOptions.collectResonatorDiagnostics === true;
    this.resonatorDiagnostics = {
      left: { maximumResidual: 0, finite: true },
      right: { maximumResidual: 0, finite: true }
    };

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

  createFilters() {
    const filters = new Array(this.bandCount);
    for (let index = 0; index < this.bandCount; index += 1) {
      filters[index] = new LinearTptSvf(sampleRate, this.bandFrequencies[index], this.bandQs[index]);
    }
    return filters;
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
    const deltaGains = this.deltaGains[channel];
    const deltaTargets = this.deltaTargets[channel];
    const feedbackGates = this.feedbackGates[channel];
    const feedbackGateTargets = this.feedbackGateTargets[channel];
    const feedbackReturns = this.feedbackReturns[channel];
    const bandOutputs = this.bandOutputs[channel];
    const resonatorBandOutputs = this.resonatorBandOutputs[channel];
    const resonanceResiduals = this.resonanceResiduals[channel];
    const source = Number.isFinite(input) ? input : 0;
    const feedbackAllGate = this.feedbackAllGateTargets[channel] + this.feedbackGateSmoothingCoefficient * (this.feedbackAllGates[channel] - this.feedbackAllGateTargets[channel]);
    this.feedbackAllGates[channel] = feedbackAllGate;
    let mainOutput = source;
    let globalTapSum = 0;
    let hasActiveFeedbackGate = feedbackAllGate > 1e-12;

    for (let band = 0; band < this.bandCount; band += 1) {
      const localGate = feedbackGateTargets[band] + this.feedbackGateSmoothingCoefficient * (feedbackGates[band] - feedbackGateTargets[band]);
      feedbackGates[band] = localGate;
      if (localGate > 1e-12) hasActiveFeedbackGate = true;
      const previousReturn = Number.isFinite(feedbackReturns[band]) ? feedbackReturns[band] : 0;
      if (!Number.isFinite(feedbackReturns[band])) feedbackReturns[band] = 0;
      const bandInput = source + previousReturn;
      const bandOutput = this.processBandpass(baseFilters[band], bandInput);
      const resonatorBandOutput = this.processBandpass(resonatorFilters[band], source);
      const resonanceResidual = resonatorBandOutput - bandOutput;
      bandOutputs[band] = bandOutput;
      resonatorBandOutputs[band] = resonatorBandOutput;
      resonanceResiduals[band] = Number.isFinite(resonanceResidual) ? resonanceResidual : 0;
      if (this.collectResonatorDiagnostics) {
        const diagnostics = this.resonatorDiagnostics[channel];
        diagnostics.maximumResidual = Math.max(diagnostics.maximumResidual, Math.abs(resonanceResiduals[band]));
        diagnostics.finite = diagnostics.finite && Number.isFinite(bandOutput) && Number.isFinite(resonatorBandOutput);
      }
      globalTapSum += bandOutput;
      deltaGains[band] = deltaTargets[band] + this.bandGainSmoothingCoefficient * (deltaGains[band] - deltaTargets[band]);
      mainOutput += deltaGains[band] * bandOutput;
    }

    const resonanceMagnitudeSquared = this.resonance * this.resonance;
    if (hasActiveFeedbackGate && resonanceMagnitudeSquared > 0) {
      const globalTap = Number.isFinite(globalTapSum) ? globalTapSum * this.feedbackAllNormalization : 0;
      const feedbackGain = Math.sign(this.resonance) * this.maxFeedbackGain * resonanceMagnitudeSquared;
      const auditionGain = this.maxAuditionGain * resonanceMagnitudeSquared;
      for (let band = 0; band < this.bandCount; band += 1) {
        const rawFeedback = feedbackGates[band] * bandOutputs[band] + feedbackAllGate * globalTap;
        const feedbackDrive = feedbackGain * rawFeedback;
        const feedbackReturn = Number.isFinite(feedbackDrive) ? Math.tanh(feedbackDrive) : 0;
        feedbackReturns[band] = Number.isFinite(feedbackReturn) ? feedbackReturn : 0;
        const activeFeedbackGate = Math.max(feedbackGates[band], feedbackAllGate);
        mainOutput += activeFeedbackGate * auditionGain * bandOutputs[band];
      }
    } else {
      for (let band = 0; band < this.bandCount; band += 1) {
        feedbackReturns[band] = 0;
      }
    }

    return Number.isFinite(mainOutput) ? mainOutput : source;
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0] || [];
    const outputChannels = outputs[0] || [];
    const leftOutput = outputChannels[0];
    const rightOutput = outputChannels[1];
    const frameCount = Math.max(leftOutput?.length || 0, rightOutput?.length || 0);
    for (let frame = 0; frame < frameCount; frame += 1) {
      this.resonance = this.resonanceTarget + this.resonanceSmoothingCoefficient * (this.resonance - this.resonanceTarget);
      if (leftOutput) leftOutput[frame] = this.processChannelFrame(inputChannels[0]?.[frame], 'left');
      if (rightOutput) rightOutput[frame] = this.processChannelFrame(inputChannels[1]?.[frame], 'right');
    }
    if (this.collectResonatorDiagnostics) this.publishResonatorDiagnostics();
    return !this.disposed;
  }
}

registerProcessor('resonant-filterbank-processor', ResonantFilterbankProcessor);
