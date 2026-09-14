class ResonantInputPreampProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const initial = options?.processorOptions || {};
    this.inputGainDb = this.normalizeGainDb(initial.inputGainDb);
    this.targetInputGainDb = this.inputGainDb;
    this.stage = this.normalizeStage(initial.stage);
    const profile = this.getStageProfile(this.stage);
    this.stageMix = profile.mix;
    this.targetStageMix = profile.mix;
    this.stageDrive = profile.drive;
    this.targetStageDrive = profile.drive;
    this.smoothingCoefficient = Math.exp(-1 / Math.max(1, sampleRate * 0.015));
    this.port.onmessage = event => this.handleMessage(event.data);
  }

  normalizeGainDb(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(24, numeric)) : 0;
  }

  normalizeStage(value) {
    return Object.prototype.hasOwnProperty.call(ResonantInputPreampProcessor.STAGE_PROFILES, value) ? value : 'linear';
  }

  getStageProfile(stage) {
    return ResonantInputPreampProcessor.STAGE_PROFILES[this.normalizeStage(stage)];
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'set-input-gain-db') this.targetInputGainDb = this.normalizeGainDb(message.value);
    if (message.type === 'set-input-stage') {
      this.stage = this.normalizeStage(message.value);
      const profile = this.getStageProfile(this.stage);
      this.targetStageMix = profile.mix;
      this.targetStageDrive = profile.drive;
    }
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
      this.stageDrive = this.targetStageDrive + this.smoothingCoefficient * (this.stageDrive - this.targetStageDrive);
      for (let channel = 0; channel < channels; channel += 1) {
        const source = input[channel] || input[0];
        const destination = output[channel];
        const sample = source ? source[frame] : 0;
        const saturated = 1.5 * Math.tanh((this.stageDrive * sample) / 1.5);
        destination[frame] = sample + this.stageMix * (saturated - sample);
      }
    }
    return true;
  }
}

ResonantInputPreampProcessor.STAGE_PROFILES = Object.freeze({
  // Fixed anchors from the former gain-morphed curve at 6, 12, 18, and 24 dB.
  linear: Object.freeze({ mix: 0, drive: 1 }),
  clean: Object.freeze({ mix: 0.15625, drive: 1.4375 }),
  warm: Object.freeze({ mix: 0.5, drive: 2.75 }),
  crunch: Object.freeze({ mix: 0.84375, drive: 4.9375 }),
  aggressive: Object.freeze({ mix: 1, drive: 8 })
});

registerProcessor('resonant-input-preamp-processor', ResonantInputPreampProcessor);
