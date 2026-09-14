/**
 * Linear topology-preserving-transform state-variable filter.
 *
 * The unit-bandpass output is mathematically equivalent to the current
 * Web-Audio bandpass Biquad coefficient model when `k = 1 / Q`. The core is
 * intentionally standalone: it has no DOM, AudioContext, or app-state
 * dependency.
 */
export class LinearTptSvf {
    constructor(sampleRate, frequency, q) {
      this.sampleRate = 0;
      this.frequency = 0;
      this.q = 0;
      this.g = 0;
      this.k = 0;
      this.baseK = 0;
      this.dampingScale = 1;
      this.a1 = 0;
      this.a2 = 0;
      this.a3 = 0;
      this.lastNonlinearSolverIterations = 0;
      this.lastNonlinearConvergenceError = 0;
      this.lastNonlinearUsedFallback = false;
      this.nonlinearSolverCallCount = 0;
      this.nonlinearSolverIterationTotal = 0;
      this.nonlinearSolverIterationMaximum = 0;
      this.nonlinearFallbackCount = 0;
      this.nonlinearNonFiniteResetCount = 0;
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
      // Recompute the coefficient set even when a reconfiguration keeps the
      // linear damping value. The constructor starts at that same value.
      this.dampingScale = 0;
      this.setDampingScale(1);
      this.reset();

      return this;
    }

    setDampingScale(value) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError('TPT SVF requires a positive damping scale.');
      }

      if (value === this.dampingScale) return this;

      this.dampingScale = value;
      this.k = this.baseK * this.dampingScale;
      this.a1 = 1 / (1 + this.g * (this.g + this.k));
      this.a2 = this.g * this.a1;
      this.a3 = this.g * this.a2;

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

    /**
     * Diagnostic positive-resonance variant of the TPT/ZDF SVF.
     *
     * The linear base damping k0 remains in the implicit equation. Only the
     * positive state-feedback share rho is soft-limited, preserving the
     * current reduced-damping response around zero while bounding that share
     * at higher state amplitudes.
     */
    processPositiveStateFeedback(input, dampingScale, drive) {
      const sample = Number.isFinite(input) ? input : 0;
      const normalizedDamping = Number.isFinite(dampingScale) && dampingScale > 0
        ? dampingScale
        : 1;
      const normalizedDrive = Number.isFinite(drive) && drive > 0 ? drive : 0;
      const rho = this.baseK * (1 - normalizedDamping);

      this.lastNonlinearSolverIterations = 0;
      this.lastNonlinearConvergenceError = 0;
      this.lastNonlinearUsedFallback = false;
      this.setDampingScale(normalizedDamping);

      // With no positive state-feedback share (or no drive), keep the exact
      // established linear TPT path. This is also the Gate-OFF / Resonance-0
      // diagnostic baseline.
      if (rho <= 1e-14 || normalizedDrive <= 1e-14) return this.process(sample);

      const rhs = this.ic1eq + this.g * (sample - this.ic2eq);
      const linearDenominator = 1 + this.g * (this.g + this.baseK - rho);
      let band = rhs / linearDenominator;
      let convergenceError = Infinity;
      let converged = false;
      let shapedBand = 0;

      this.nonlinearSolverCallCount += 1;
      for (let iteration = 0; iteration < 4; iteration += 1) {
        const drivenBand = normalizedDrive * band;
        const tanhBand = Math.tanh(drivenBand);
        shapedBand = tanhBand / normalizedDrive;
        const equation = (1 + this.g * this.g + this.g * this.baseK) * band
          - this.g * rho * shapedBand
          - rhs;
        const derivative = 1 + this.g * this.g + this.g * this.baseK
          - this.g * rho * (1 - tanhBand * tanhBand);

        this.lastNonlinearSolverIterations = iteration + 1;
        if (!Number.isFinite(equation) || !Number.isFinite(derivative) || Math.abs(derivative) <= 1e-14) break;

        const correction = equation / derivative;
        if (!Number.isFinite(correction)) break;
        band -= correction;
        convergenceError = Math.abs(correction);
        if (convergenceError <= 1e-8 * Math.max(1, Math.abs(band))) {
          converged = true;
          break;
        }
      }

      this.lastNonlinearConvergenceError = convergenceError;
      this.nonlinearSolverIterationTotal += this.lastNonlinearSolverIterations;
      this.nonlinearSolverIterationMaximum = Math.max(
        this.nonlinearSolverIterationMaximum,
        this.lastNonlinearSolverIterations
      );
      if (!converged || !Number.isFinite(band)) {
        this.lastNonlinearUsedFallback = true;
        this.nonlinearFallbackCount += 1;
        return this.process(sample);
      }

      const tanhBand = Math.tanh(normalizedDrive * band);
      shapedBand = tanhBand / normalizedDrive;
      const low = this.ic2eq + this.g * band;
      const high = sample - this.baseK * band - low + rho * shapedBand;
      const nextIc1eq = 2 * band - this.ic1eq;
      const nextIc2eq = 2 * low - this.ic2eq;

      if (!Number.isFinite(low + band + high + nextIc1eq + nextIc2eq)) {
        this.nonlinearNonFiniteResetCount += 1;
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
