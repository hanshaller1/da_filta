(() => {
  /**
   * Linear topology-preserving-transform state-variable filter.
   *
   * The unit-bandpass output is mathematically equivalent to the current
   * Web-Audio bandpass Biquad coefficient model when `k = 1 / Q`. The core is
   * intentionally standalone: it has no DOM, AudioContext, or app-state
   * dependency and is not connected to the production signal path yet.
   */
  class LinearTptSvf {
    constructor(sampleRate, frequency, q) {
      this.sampleRate = 0;
      this.frequency = 0;
      this.q = 0;
      this.g = 0;
      this.k = 0;
      this.baseK = 0;
      this.a1 = 0;
      this.a2 = 0;
      this.a3 = 0;
      this.reset();
      this.configure(sampleRate, frequency, q);
    }

    configure(sampleRate, frequency, q) {
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
        throw new RangeError('TPT SVF requires a positive sample rate.');
      }

      if (!Number.isFinite(frequency) || frequency <= 0 || frequency >= sampleRate / 2) {
        throw new RangeError('TPT SVF frequency must be above 0 Hz and below Nyquist.');
      }

      if (!Number.isFinite(q) || q <= 0) {
        throw new RangeError('TPT SVF requires a positive Q value.');
      }

      this.sampleRate = sampleRate;
      this.frequency = frequency;
      this.q = q;
      this.g = Math.tan(Math.PI * frequency / sampleRate);
      this.baseK = 1 / q;
      this.k = this.baseK;
      this.a1 = 1 / (1 + this.g * (this.g + this.k));
      this.a2 = this.g * this.a1;
      this.a3 = this.g * this.a2;
      this.reset();

      return this;
    }

    reset() {
      this.ic1eq = 0;
      this.ic2eq = 0;
      this.low = 0;
      this.band = 0;
      this.high = 0;
      this.unitBand = 0;
      this.notch = 0;
      this.peak = 0;

      return this;
    }

    process(input) {
      const sample = Number.isFinite(input) ? input : 0;
      const v3 = sample - this.ic2eq;
      const band = this.a1 * this.ic1eq + this.a2 * v3;
      const low = this.ic2eq + this.a2 * this.ic1eq + this.a3 * v3;
      const high = sample - this.k * band - low;
      const nextIc1eq = 2 * band - this.ic1eq;
      const nextIc2eq = 2 * low - this.ic2eq;

      if (!Number.isFinite(low + band + high + nextIc1eq + nextIc2eq)) {
        this.reset();
        return 0;
      }

      this.ic1eq = nextIc1eq;
      this.ic2eq = nextIc2eq;
      this.low = low;
      this.band = band;
      this.high = high;
      this.unitBand = this.baseK * band;
      this.notch = low + high;
      this.peak = low - high;

      return this.unitBand;
    }
  }

  globalThis.LinearTptSvf = LinearTptSvf;
})();
