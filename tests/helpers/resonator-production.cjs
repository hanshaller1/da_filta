const p = require('./dsp-performance.cjs');
const { execFileSync } = require('node:child_process');

async function loadProbe(page) {
  await page.goto('/');
  const code = p.processorBundle(new URL(page.url()).origin);
  const stripImports = value => value.replace(/^import .*;\r?\n/gm, '');
  const before = execFileSync('git', ['show', '25211b8:filterbank-processor.js'], { encoding: 'utf8', maxBuffer: 4e6 });
  const beforeCode = code.replace(stripImports(p.source('filterbank-processor.js')), stripImports(before));
  if (beforeCode === code) throw new Error('Frozen resonator baseline was not installed');
  await page.evaluate(async ({ code, beforeCode }) => {
    const module = await import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const baseline = await import(URL.createObjectURL(new Blob([beforeCode], { type: 'text/javascript' })));
    window.resonatorClasses = module.classesFor;
    window.resonatorBeforeClasses = baseline.classesFor;
    window.resonatorOptions = (config = {}) => ({
      bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
      bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
      feedbackBandLeft: Array.from({ length: 10 }, (_, i) => (config.active || []).includes(i)),
      feedbackBandRight: Array(10).fill(false), feedbackAllLeft: Boolean(config.main), feedbackAllRight: false,
      resonance: config.resonance ?? .7, feedbackCore: config.core || 'zdf-per-band',
      feedbackTopology: 'common-bus', feedbackTap: 'post-gain', wetModel: 'filterbank-sum',
      feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum', feedbackAllLevel: 'sqrt10',
      ...config.options
    });
    window.resonatorProbe = (rate, config = {}) => {
      const Class = (config.baseline ? window.resonatorBeforeClasses : window.resonatorClasses)(rate)['da-filta-processor'];
      const bank = new Class({ processorOptions: window.resonatorOptions(config) });
      const length = Math.round(rate * (config.duration || .35));
      const input = [new Float32Array(128), new Float32Array(128)];
      const output = [new Float32Array(128), new Float32Array(128)];
      const audio = new Float32Array(length), bandAudio = Array.from({ length: 10 }, () => new Float64Array(length));
      const returnPeak = Array(10).fill(0), inputs = Array(10).fill(0);
      let mainPeak = 0, inputError = 0, finite = true, iterations = 0, solves = 0, maxIterations = 0, residual = 0;
      bank.baseFilters.left.forEach((filter, i) => {
        const original = filter.process;
        filter.process = function (sample) { inputs[i] = sample; return original.call(this, sample); };
      });
      // Per-frame reads expose actual committed inputs, not sparse diagnostic packets.
      const original = bank.processChannelFrame;
      let frame = 0;
      bank.processChannelFrame = function (source, channel) {
        const value = original.call(this, source, channel);
        if (channel !== 'left' || frame >= length) return value;
        for (let i = 0; i < 10; i++) {
          bandAudio[i][frame] = this.bandOutputs.left[i];
          const local = this.zdfPerBandLocalReturns.left[i], main = this.zdfPerBandMainReturns.left;
          returnPeak[i] = Math.max(returnPeak[i], Math.abs(local)); mainPeak = Math.max(mainPeak, Math.abs(main));
          if (this.feedbackCore === 'zdf-per-band') inputError = Math.max(inputError, Math.abs(inputs[i] - ((source + local) + main)));
          finite &&= Number.isFinite(inputs[i]) && Number.isFinite(this.baseFilters.left[i].ic1eq) && Number.isFinite(this.baseFilters.left[i].ic2eq);
          if (!config.main && (config.active || []).includes(i)) {
            const n = this.zdfPerBandSolverIterations.left[i]; iterations += n; solves++; maxIterations = Math.max(maxIterations, n);
            residual = Math.max(residual, this.zdfPerBandSolverResiduals.left[i]);
          }
        }
        if (config.main) { const n = this.zdfPerBandCoupledIterations.left; iterations += n; solves++; maxIterations = Math.max(maxIterations, n); residual = Math.max(residual, this.zdfPerBandCoupledResiduals.left); }
        frame++;
        return value;
      };
      for (let start = 0; start < length; start += 128) {
        for (let i = 0; i < 128; i++) {
          const t = (start + i) / rate;
          input[0][i] = config.performanceSignal
            ? .15 * Math.sin(2 * Math.PI * 173 * t) + .03 * Math.cos(2 * Math.PI * 2203 * t)
            : t < .04 ? .02 * Math.sin(2 * Math.PI * (config.frequency || 411) * t) : 0;
        }
        bank.process([input], [output]);
        audio.set(output[0].subarray(0, Math.min(128, length - start)), start);
      }
      const energy = values => values.reduce((sum, value) => sum + value * value, 0);
      const fallbacks = config.main ? bank.zdfPerBandCoupledFallbackCounts.left
        : bank.zdfPerBandSolverFallbackCounts.left.reduce((sum, n) => sum + n, 0);
      return { audio: [...audio], bands: bandAudio.map(values => [...values]), returnPeak, mainPeak, inputError,
        finite: finite && audio.every(Number.isFinite), energy: energy(audio),
        rightPeak: Math.max(...bank.zdfPerBandLocalReturns.right.map(Math.abs), Math.abs(bank.zdfPerBandMainReturns.right)),
        solver: { avg: iterations / Math.max(1, solves), max: maxIterations, residual, fallbacks,
          fallbackRate: fallbacks / Math.max(1, solves), resets: bank.zdfNonFiniteResetCount.left + bank.zdfPerBandCoupledNonFiniteCounts.left } };
    };
  }, { code, beforeCode });
}
module.exports = { loadProbe };
