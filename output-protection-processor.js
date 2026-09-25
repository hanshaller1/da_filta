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
    this.telemetryEnabled = initial.telemetryEnabled === true;
    this.telemetryPublishFrames = Math.max(1, Math.round(sampleRate / 15));
    this.telemetryFrameCount = 0;
    this.resetTelemetryWindow();
    this.port.onmessage = event => {
      const message = event.data;
      if (message?.type === 'set-enabled') this.enabledTarget = message.value ? 1 : 0;
      if (message?.type === 'set-threshold') this.thresholdTarget = this.clamp(message.value, 0.5, 0.95, this.thresholdTarget);
      if (message?.type === 'set-softness') this.softnessTarget = this.clamp(message.value, 0, 1, this.softnessTarget);
      if (message?.type === 'set-telemetry-enabled') {
        this.telemetryEnabled = Boolean(message.value);
        this.telemetryFrameCount = 0;
        this.resetTelemetryWindow();
      }
      if (message?.type === 'reset-telemetry') {
        this.telemetryFrameCount = 0;
        this.resetTelemetryWindow();
      }
    };
  }

  clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  resetTelemetryWindow() {
    this.maxPrePeakLeft = 0;
    this.maxPrePeakRight = 0;
    this.maxPostPeakLeft = 0;
    this.maxPostPeakRight = 0;
    this.maxGainReductionRatio = 1;
    this.activeSampleCount = 0;
    this.processedSampleCount = 0;
  }

  publishTelemetry() {
    const activePercent = this.processedSampleCount > 0
      ? (100 * this.activeSampleCount) / this.processedSampleCount
      : 0;
    this.port.postMessage({
      type: 'output-protection-telemetry',
      prePeakLeft: this.maxPrePeakLeft,
      prePeakRight: this.maxPrePeakRight,
      postPeakLeft: this.maxPostPeakLeft,
      postPeakRight: this.maxPostPeakRight,
      gainReductionDb: this.maxGainReductionRatio > 1 ? 20 * Math.log10(this.maxGainReductionRatio) : 0,
      activePercent,
      enabledMix: this.enabledMix,
      threshold: this.threshold,
      softness: this.softness
    });
    this.resetTelemetryWindow();
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
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] || input[0];
        const target = output[channel];
        const sample = source?.[frame] ?? 0;
        if (!Number.isFinite(sample)) {
          target[frame] = 0;
        } else {
          const magnitude = Math.abs(sample);
          let protectedSample = sample;
          if (magnitude <= this.threshold || this.enabledMix <= 1e-9) {
            target[frame] = protectedSample;
          } else {
            const normalized = (magnitude - this.threshold) / span;
            // The bounded tanh curve is monotonic and never exceeds its input:
            // tanh(k*z) <= k*z <= z for z >= 0 and 0 < k <= 1.
            const curveStrength = 1 - 0.5 * this.softness;
            const protectedMagnitude = this.threshold + span * Math.tanh(curveStrength * normalized);
            protectedSample = Math.sign(sample) * protectedMagnitude;
            target[frame] = sample + this.enabledMix * (protectedSample - sample);
          }
        }
        if (this.telemetryEnabled) {
          const sampleMagnitude = Number.isFinite(sample) ? Math.abs(sample) : 0;
          const outputSample = target[frame];
          const outputMagnitude = Math.abs(outputSample);
          if (channel === 0) {
            this.maxPrePeakLeft = Math.max(this.maxPrePeakLeft, sampleMagnitude);
            this.maxPostPeakLeft = Math.max(this.maxPostPeakLeft, outputMagnitude);
          } else {
            this.maxPrePeakRight = Math.max(this.maxPrePeakRight, sampleMagnitude);
            this.maxPostPeakRight = Math.max(this.maxPostPeakRight, outputMagnitude);
          }
          if (Math.abs(outputSample - sample) > 1e-7) this.activeSampleCount += 1;
          if (sampleMagnitude > 0 && outputMagnitude > 0 && outputMagnitude < sampleMagnitude) {
            this.maxGainReductionRatio = Math.max(this.maxGainReductionRatio, sampleMagnitude / outputMagnitude);
          }
          this.processedSampleCount += 1;
        }
      }
      if (this.telemetryEnabled) {
        this.telemetryFrameCount += 1;
        if (this.telemetryFrameCount >= this.telemetryPublishFrames) {
          this.telemetryFrameCount -= this.telemetryPublishFrames;
          this.publishTelemetry();
        }
      }
    }
    return true;
  }
}

registerProcessor('da-filta-output-protection', DaFiltaOutputProtectionProcessor);
