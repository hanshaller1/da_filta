// Stereo-linked output dynamics after master and before the final safety stage.
// No lookahead or connection back into the filterbank feedback paths.
class DaFiltaOutputGuardProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const initial = options?.processorOptions || {};
    this.enabledTarget = initial.enabled === false ? 0 : 1;
    this.enabledMix = this.enabledTarget;
    this.threshold = this.clamp(initial.threshold, 0.25, 0.95, 0.8);
    this.attackMs = this.clamp(initial.attackMs, 0.1, 50, 2);
    this.releaseMs = this.clamp(initial.releaseMs, 20, 2000, 250);
    this.attackCoefficient = this.coefficient(this.attackMs);
    this.releaseCoefficient = this.coefficient(this.releaseMs);
    this.enableCoefficient = this.coefficient(2);
    this.guardGain = 1;
    this.telemetryEnabled = initial.telemetryEnabled === true;
    this.telemetryPublishFrames = Math.max(1, Math.round(sampleRate / 15));
    this.telemetryFrameCount = 0;
    this.resetTelemetryWindow();
    this.port.onmessage = event => {
      const message = event.data;
      if (message?.type === 'set-enabled') this.enabledTarget = message.value ? 1 : 0;
      if (message?.type === 'set-threshold') this.threshold = this.clamp(message.value, 0.25, 0.95, this.threshold);
      if (message?.type === 'set-attack-ms') {
        this.attackMs = this.clamp(message.value, 0.1, 50, this.attackMs);
        this.attackCoefficient = this.coefficient(this.attackMs);
      }
      if (message?.type === 'set-release-ms') {
        this.releaseMs = this.clamp(message.value, 20, 2000, this.releaseMs);
        this.releaseCoefficient = this.coefficient(this.releaseMs);
      }
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

  coefficient(milliseconds) {
    return Math.exp(-1 / (sampleRate * milliseconds / 1000));
  }

  resetTelemetryWindow() {
    this.maxInPeakLeft = 0;
    this.maxInPeakRight = 0;
    this.maxOutPeakLeft = 0;
    this.maxOutPeakRight = 0;
    this.maxGainReductionRatio = 1;
    this.activeFrameCount = 0;
    this.processedFrameCount = 0;
  }

  publishTelemetry() {
    this.port.postMessage({
      type: 'output-guard-telemetry',
      inPeakLeft: this.maxInPeakLeft,
      inPeakRight: this.maxInPeakRight,
      outPeakLeft: this.maxOutPeakLeft,
      outPeakRight: this.maxOutPeakRight,
      gainReductionDb: this.maxGainReductionRatio > 1 ? 20 * Math.log10(this.maxGainReductionRatio) : 0,
      activePercent: this.processedFrameCount ? 100 * this.activeFrameCount / this.processedFrameCount : 0,
      guardGain: 1 + this.enabledMix * (this.guardGain - 1),
      enabledMix: this.enabledMix,
      threshold: this.threshold,
      attackMs: this.attackMs,
      releaseMs: this.releaseMs
    });
    this.resetTelemetryWindow();
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const leftOutput = output[0];
    const rightOutput = output[1];
    const frames = leftOutput?.length || 0;
    const leftInput = input[0];
    const rightInput = input[1] || leftInput;
    for (let frame = 0; frame < frames; frame += 1) {
      const rawLeft = leftInput?.[frame] ?? 0;
      const rawRight = rightInput?.[frame] ?? 0;
      const left = Number.isFinite(rawLeft) ? rawLeft : 0;
      const right = Number.isFinite(rawRight) ? rawRight : 0;
      const leftMagnitude = Math.abs(left);
      const rightMagnitude = Math.abs(right);
      const peak = Math.max(leftMagnitude, rightMagnitude);
      const targetGain = peak > this.threshold ? this.threshold / peak : 1;
      const coefficient = targetGain < this.guardGain ? this.attackCoefficient : this.releaseCoefficient;
      this.guardGain = targetGain + coefficient * (this.guardGain - targetGain);
      if (!Number.isFinite(this.guardGain)) this.guardGain = 1;
      this.guardGain = Math.min(1, Math.max(0, this.guardGain));
      this.enabledMix = this.enabledTarget + this.enableCoefficient * (this.enabledMix - this.enabledTarget);
      if (!Number.isFinite(this.enabledMix)) this.enabledMix = this.enabledTarget;
      const appliedGain = 1 + this.enabledMix * (this.guardGain - 1);
      const guardedLeft = left * appliedGain;
      const guardedRight = right * appliedGain;
      leftOutput[frame] = guardedLeft;
      if (rightOutput) rightOutput[frame] = guardedRight;
      if (this.telemetryEnabled) {
        this.maxInPeakLeft = Math.max(this.maxInPeakLeft, leftMagnitude);
        this.maxInPeakRight = Math.max(this.maxInPeakRight, rightMagnitude);
        this.maxOutPeakLeft = Math.max(this.maxOutPeakLeft, Math.abs(guardedLeft));
        this.maxOutPeakRight = Math.max(this.maxOutPeakRight, Math.abs(guardedRight));
        if (appliedGain < 1 - 1e-7) {
          this.maxGainReductionRatio = Math.max(this.maxGainReductionRatio, 1 / appliedGain);
          this.activeFrameCount += 1;
        }
        this.processedFrameCount += 1;
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

registerProcessor('da-filta-output-guard', DaFiltaOutputGuardProcessor);
