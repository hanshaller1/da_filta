const { test, expect } = require('playwright/test');

// DEV core SHARED BUS · BAND SAT after the hardware block diagram: enabled
// bands return to the one input sum that feeds all bands, and every band
// limits in its own gain stage. Two listening results on the hardware define
// the contract: foreign faders shape an oscillating band's timbre (shared
// return), and two oscillating bands stay stable side by side (per-band limit).
const renderProbe = (page, cases) => page.evaluate(async cases => {
  const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
  const qs = [...window.Filterbank.BAND_QS];
  const sampleRate = 48000;
  const render = async ({ core, bands = [], resonance = 1, fader = 100, others = 0, feedbackAll = false, noise = 0 }) => {
    const length = Math.round(sampleRate * 1.5);
    const context = new OfflineAudioContext(2, length, sampleRate);
    await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
    const input = context.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = input.getChannelData(channel);
      let seed = 777;
      const count = noise ? length : Math.round(sampleRate * 0.05);
      for (let index = 0; index < count; index += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        samples[index] = (seed / 2 ** 32 - 0.5) * (noise || 0.1);
      }
    }
    const gains = Array(10).fill(others);
    for (const band of bands) gains[band] = fader;
    const gates = Array.from({ length: 10 }, (_, index) => bands.includes(index));
    const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: {
        bandFrequencies: frequencies, bandQs: qs, bandGainLeft: gains, bandGainRight: gains,
        feedbackBandLeft: gates, feedbackBandRight: gates,
        feedbackAllLeft: feedbackAll, feedbackAllRight: feedbackAll,
        resonance, feedbackCore: core
      }
    });
    const source = context.createBufferSource(); source.buffer = input;
    source.connect(node).connect(context.destination); source.start();
    const left = (await context.startRendering()).getChannelData(0);
    const span = Math.round(sampleRate * 0.5);
    const from = length - span;
    let energy = 0; let peak = 0; let finite = true;
    for (const value of left) finite &&= Number.isFinite(value);
    for (let index = from; index < length; index += 1) { energy += left[index] * left[index]; peak = Math.max(peak, Math.abs(left[index])); }
    const amplitude = frequency => {
      let real = 0; let imaginary = 0;
      for (let index = 0; index < span; index += 1) {
        const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / span);
        const phase = 2 * Math.PI * frequency * index / sampleRate;
        real += hann * left[from + index] * Math.cos(phase); imaginary += hann * left[from + index] * Math.sin(phase);
      }
      return 4 * Math.hypot(real, imaginary) / span;
    };
    const toneNear = frequency => {
      let best = 0;
      for (let probe = frequency * 0.88; probe <= frequency * 1.06; probe += frequency * 0.002) best = Math.max(best, amplitude(probe));
      return best;
    };
    return { finite, rms: Math.sqrt(energy / span), peak, tones: bands.map(band => toneNear(frequencies[band])), samples: Array.from(left) };
  };
  const results = {};
  for (const [name, options] of Object.entries(cases)) results[name] = await render(options);
  return results;
}, cases);

const SHARED = 'zdf-shared-band-sat';

test('SHARED BUS · BAND SAT: two oscillating bands coexist and foreign faders shape the oscillation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await renderProbe(page, {
    sharedTwo: { core: SHARED, bands: [3, 6] },
    unifiedTwo: { core: 'zdf', bands: [3, 6] },
    sharedNeutral: { core: SHARED, bands: [4] },
    sharedOthersCut: { core: SHARED, bands: [4], others: -100 },
    sharedOthersBoost: { core: SHARED, bands: [4], others: 100 },
    perBandNeutral: { core: 'zdf-per-band', bands: [4] },
    perBandOthersCut: { core: 'zdf-per-band', bands: [4], others: -100 }
  });
  for (const result of Object.values(report)) expect(result.finite).toBe(true);
  // Both bands keep oscillating; the shared-limiter Unified core lets one win.
  expect(report.sharedTwo.tones[0]).toBeGreaterThan(0.5);
  expect(report.sharedTwo.tones[1]).toBeGreaterThan(0.5);
  expect(report.unifiedTwo.tones[0]).toBeLessThan(1e-3);
  // The shared return passes through the foreign bands, so their faders
  // change the oscillating sound; private PER-BAND loops are unaffected.
  expect(report.sharedOthersCut.rms).toBeLessThan(report.sharedNeutral.rms * 0.85);
  expect(report.sharedOthersBoost.rms).toBeGreaterThan(report.sharedNeutral.rms * 1.15);
  expect(report.perBandOthersCut.rms).toBeCloseTo(report.perBandNeutral.rms, 6);
  // Every band stage limits at full scale: one band plus nine neutral ones.
  expect(report.sharedNeutral.peak).toBeLessThan(10);
  expect(errors).toEqual([]);
});

test('SHARED BUS · BAND SAT: onset with a boosted band, inverted resonance, MAIN and small-signal neutrality', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await renderProbe(page, {
    below: { core: SHARED, bands: [4], resonance: 0.4 },
    above: { core: SHARED, bands: [4], resonance: 0.5 },
    inverted: { core: SHARED, bands: [4], resonance: -1 },
    mainOnly: { core: SHARED, feedbackAll: true, others: 100 },
    quietShared: { core: SHARED, resonance: 0, noise: 0.002 },
    quietProduct: { core: 'zdf-per-band', resonance: 0, noise: 0.002 },
    loudShared: { core: SHARED, resonance: 0, others: 100, noise: 2 },
    loudProduct: { core: 'zdf-per-band', resonance: 0, others: 100, noise: 2 }
  });
  for (const result of Object.values(report)) expect(result.finite).toBe(true);
  // A +12 dB band starts to self-oscillate between resonance 0.4 and 0.5.
  expect(report.below.rms).toBeLessThan(1e-6);
  expect(report.above.rms).toBeGreaterThan(0.1);
  // Inverted feedback only damps.
  expect(report.inverted.rms).toBeLessThan(1e-6);
  // MAIN returns every band to the same sum and stays bounded by the stages.
  expect(report.mainOnly.rms).toBeGreaterThan(0.1);
  expect(report.mainOnly.peak).toBeLessThan(10);
  // Without feedback a quiet signal matches the linear product bank closely;
  // a hot boosted signal is limited by the band stages.
  const difference = report.quietShared.samples.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - report.quietProduct.samples[index])), 0);
  expect(difference).toBeLessThan(1e-6);
  expect(report.loudShared.peak).toBeLessThan(report.loudProduct.peak * 0.8);
});

test('SHARED BUS · BAND SAT is selectable in DEV LAB and the product default stays PER-BAND ZDF', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const select = page.locator('[data-feedback-core]');
  await expect(select).toHaveValue('zdf-per-band');
  await select.selectOption(SHARED);
  await expect(select).toHaveValue(SHARED);
  await expect(page.locator('[data-feedback-tap]')).toBeDisabled();
  await expect(page.locator('[data-feedback-tap-modulation]')).toBeDisabled();
  await select.selectOption('zdf-per-band');
  await expect(page.locator('[data-feedback-tap]')).toBeEnabled();
  expect(errors).toEqual([]);
});
