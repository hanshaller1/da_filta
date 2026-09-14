class ResonantInputPreampProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const initial = options?.processorOptions || {};
    this.inputGainDb = this.normalizeGainDb(initial.inputGainDb);
    this.targetInputGainDb = this.inputGainDb;
    this.stageMix = initial.stage === 'preamp' ? 1 : 0;
    this.targetStageMix = this.stageMix;
    this.smoothingCoefficient = Math.exp(-1 / Math.max(1, sampleRate * 0.015));
    this.port.onmessage = event => this.handleMessage(event.data);
  }

  normalizeGainDb(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(24, numeric)) : 0;
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'set-input-gain-db') this.targetInputGainDb = this.normalizeGainDb(message.value);
    if (message.type === 'set-input-stage') this.targetStageMix = message.value === 'preamp' ? 1 : 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output) return true;
    const channels = output.length;
    const frames = output[0]?.length || 0;
    for (let frame = 0; frame < frames; frame += 1) {
      this.inputGainDb = this.targetInputGainDb + this.smoothingCoefficient * (this.inputGainDb - this.targetInputGainDb);
      this.stageMix = this.targetStageMix + this.smoothingCoefficient * (this.stageMix - this.targetStageMix);
      const progress = this.inputGainDb / 24;
      const character = progress * progress * (3 - 2 * progress);
      const drive = 1 + 7 * progress * progress;
      for (let channel = 0; channel < channels; channel += 1) {
        const source = input[channel] || input[0];
        const destination = output[channel];
        const sample = source ? source[frame] : 0;
        const saturated = 1.5 * Math.tanh((drive * sample) / 1.5);
        destination[frame] = sample + this.stageMix * character * (saturated - sample);
      }
    }
    return true;
  }
}

registerProcessor('resonant-input-preamp-processor', ResonantInputPreampProcessor);
