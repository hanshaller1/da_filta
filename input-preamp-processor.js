class ResonantInputPreampProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const initial = options?.processorOptions || {};
    this.inputGainDb = this.normalizeGainDb(initial.inputGainDb);
    this.targetInputGainDb = this.inputGainDb;
    this.stage = this.normalizeStage(initial.stage);
    this.previousStage = this.stage;
    this.stageCrossfade = 1;
    this.targetStageCrossfade = 1;
    this.characterAmount = this.normalizeCharacterAmount(initial.characterAmount);
    this.targetCharacterAmount = this.characterAmount;
    this.smoothingCoefficient = Math.exp(-1 / Math.max(1, sampleRate * 0.015));
    this.tubePreviousInput = new Float64Array(2);
    this.tubePreviousOutput = new Float64Array(2);
    this.port.onmessage = event => this.handleMessage(event.data);
  }

  normalizeGainDb(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(24, numeric)) : 0;
  }

  normalizeCharacterAmount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.5;
  }

  normalizeStage(value) {
    return Object.prototype.hasOwnProperty.call(ResonantInputPreampProcessor.STAGES, value) ? value : 'linear';
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'set-input-gain-db') this.targetInputGainDb = this.normalizeGainDb(message.value);
    if (message.type === 'set-character-amount') this.targetCharacterAmount = this.normalizeCharacterAmount(message.value);
    if (message.type === 'set-input-stage') {
      const nextStage = this.normalizeStage(message.value);
      if (nextStage !== this.stage) {
        this.previousStage = this.stage;
        this.stage = nextStage;
        this.stageCrossfade = 0;
        this.targetStageCrossfade = 1;
      }
    }
  }

  clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  shapeTube(sample, channel) {
    // Bias creates even harmonics. A 10 Hz DC blocker removes waveform DC afterwards.
    const bias = 0.18;
    const biasedZero = Math.tanh(1.3 * bias);
    const biased = (Math.tanh(1.3 * (sample + bias)) - biasedZero) / 1.3;
    const previousInput = this.tubePreviousInput[channel] || 0;
    const previousOutput = this.tubePreviousOutput[channel] || 0;
    const dcBlocked = biased - previousInput + 0.9987 * previousOutput;
    this.tubePreviousInput[channel] = biased;
    this.tubePreviousOutput[channel] = dcBlocked;
    return dcBlocked;
  }

  shape(stage, sample, channel) {
    const limited = this.clamp(sample, -12, 12);
    switch (stage) {
      case 'silk':
        // Long, symmetric and nearly transparent peak rounding.
        return limited / Math.sqrt(1 + 0.16 * limited * limited);
      case 'tape':
        // Broad atan compression gives a soft, glue-like curve.
        return Math.atan(1.45 * limited) / 1.45;
      case 'tube':
        return this.shapeTube(limited, channel);
      case 'console':
        // Firmer rational knee, weighted toward odd harmonics.
        return limited / (1 + 0.48 * Math.abs(limited));
      case 'crunch': {
        const magnitude = Math.abs(limited);
        const sign = limited < 0 ? -1 : 1;
        // Linear core, then a distinctly harder exponential shoulder.
        return magnitude <= 0.48
          ? limited
          : sign * (0.48 + 0.52 * (1 - Math.exp(-3.3 * (magnitude - 0.48))));
      }
      case 'destroy': {
        const clipped = this.clamp(limited, -0.62, 0.62);
        // Hard clipping plus bounded fold-like harmonic deformation.
        return 0.58 * clipped + 0.42 * 0.82 * Math.sin(2.85 * limited);
      }
      default:
        return sample;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output) return true;
    const channels = output.length;
    const frames = output[0]?.length || 0;
    for (let frame = 0; frame < frames; frame += 1) {
      // Metadata only: InputGainNode is the sole linear gain stage.
      this.inputGainDb = this.targetInputGainDb + this.smoothingCoefficient * (this.inputGainDb - this.targetInputGainDb);
      this.characterAmount = this.targetCharacterAmount + this.smoothingCoefficient * (this.characterAmount - this.targetCharacterAmount);
      this.stageCrossfade = this.targetStageCrossfade + this.smoothingCoefficient * (this.stageCrossfade - this.targetStageCrossfade);
      if (this.stageCrossfade > 0.9999) {
        this.previousStage = this.stage;
        this.stageCrossfade = 1;
      }
      for (let channel = 0; channel < channels; channel += 1) {
        const source = input[channel] || input[0];
        const destination = output[channel];
        const sample = source ? source[frame] : 0;
        const oldShaped = this.shape(this.previousStage, sample, channel);
        const newShaped = this.previousStage === this.stage
          ? oldShaped
          : this.shape(this.stage, sample, channel);
        const shaped = oldShaped + this.stageCrossfade * (newShaped - oldShaped);
        destination[frame] = sample + this.characterAmount * (shaped - sample);
      }
    }
    return true;
  }
}

ResonantInputPreampProcessor.STAGES = Object.freeze({
  linear: true,
  silk: true,
  tape: true,
  tube: true,
  console: true,
  crunch: true,
  destroy: true
});

registerProcessor('resonant-input-preamp-processor', ResonantInputPreampProcessor);
