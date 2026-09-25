// Final output safety stage. Values below the knee pass through exactly.
// This is a zero-lookahead soft clipper, outside every feedback loop.
class DaFiltaOutputProtectionProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const initial = options?.processorOptions || {};
    this.enabledTarget = initial.enabled === false ? 0 : 1;
    this.enabledMix = this.enabledTarget;
    this.thresholdTarget = this.clamp(initial.threshold, 0.5, 0.95, 0.8);
    this.threshold = this.thresholdTarget;
    this.softnessTarget = this.clamp(initial.softness, 0, 1, 1);
    this.softness = this.softnessTarget;
    this.smoothing = Math.exp(-1 / (sampleRate * 0.01));
    this.port.onmessage = event => {
      const message = event.data;
      if (message?.type === 'set-enabled') this.enabledTarget = message.value ? 1 : 0;
      if (message?.type === 'set-threshold') this.thresholdTarget = this.clamp(message.value, 0.5, 0.95, this.thresholdTarget);
      if (message?.type === 'set-softness') this.softnessTarget = this.clamp(message.value, 0, 1, this.softnessTarget);
    };
  }

  clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const frames = output[0]?.length || 0;
    for (let frame = 0; frame < frames; frame += 1) {
      this.enabledMix = this.enabledTarget + this.smoothing * (this.enabledMix - this.enabledTarget);
      this.threshold = this.thresholdTarget + this.smoothing * (this.threshold - this.thresholdTarget);
      this.softness = this.softnessTarget + this.smoothing * (this.softness - this.softnessTarget);
      const span = 0.99 - this.threshold;
      const hardness = 4 * (1 - this.softness);
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] || input[0];
        const target = output[channel];
        const sample = source?.[frame] ?? 0;
        if (!Number.isFinite(sample)) {
          target[frame] = 0;
        } else {
          const magnitude = Math.abs(sample);
          if (magnitude <= this.threshold || this.enabledMix <= 1e-9) {
            target[frame] = sample;
          } else {
            const normalized = (magnitude - this.threshold) / span;
            const protectedMagnitude = this.threshold + span * Math.tanh(normalized + hardness * normalized * normalized);
            const protectedSample = Math.sign(sample) * protectedMagnitude;
            target[frame] = sample + this.enabledMix * (protectedSample - sample);
          }
        }
      }
    }
    return true;
  }
}

registerProcessor('da-filta-output-protection', DaFiltaOutputProtectionProcessor);
