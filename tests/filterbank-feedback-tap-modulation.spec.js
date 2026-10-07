const { test, expect } = require('playwright/test');

// Band modulation must act on the post-gain feedback tap like the fader does.
// Probe: product Per-Band ZDF, LOCAL on band 5 (411 Hz), resonance 0.97 which
// self-oscillates at 0 dB. A -12 dB cut from the fader or from a macro route
// must both stop that oscillation; the legacy FADER ONLY tap keeps it ringing.
const renderProbe = (page, cases) => page.evaluate(async cases => {
  const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
  const qs = [...window.Filterbank.BAND_QS];
  const render = async ({ core = 'zdf-per-band', fader = 0, macro = false, tapModulation, feedbackAll = false, sampleRate = 48000 }) => {
    const length = Math.round(sampleRate * 0.8);
    const context = new OfflineAudioContext(2, length, sampleRate);
    await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
    const input = context.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = input.getChannelData(channel);
      for (let index = 0; index < Math.round(sampleRate * 0.06); index += 1) samples[index] = 0.02 * Math.sin(2 * Math.PI * frequencies[4] * index / sampleRate);
    }
    const gains = Array(10).fill(0); gains[4] = fader;
    const gates = Array.from({ length: 10 }, (_, index) => index === 4);
    const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: {
        bandFrequencies: frequencies, bandQs: qs,
        bandGainLeft: gains, bandGainRight: gains,
        feedbackBandLeft: gates, feedbackBandRight: gates,
        feedbackAllLeft: feedbackAll, feedbackAllRight: feedbackAll,
        resonance: 0.97, feedbackCore: core, feedbackTopology: 'common-bus', feedbackTap: 'post-gain',
        feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum', feedbackAllLevel: 'sqrt10',
        wetModel: 'filterbank-sum', ...(tapModulation ? { feedbackTapModulation: tapModulation } : {}),
        modulationState: macro ? {
          macroSources: [{ id: 'macro.1', value: 100, assignments: [{ targetId: 'filterbank.band.4.gainDb', amount: -100 }] }]
        } : {}
      }
    });
    const source = context.createBufferSource(); source.buffer = input;
    source.connect(node).connect(context.destination); source.start();
    const rendered = await context.startRendering();
    const left = rendered.getChannelData(0);
    const rms = (from, to) => {
      let sum = 0;
      for (let index = Math.round(from * sampleRate); index < Math.round(to * sampleRate); index += 1) sum += left[index] * left[index];
      return Math.sqrt(sum / Math.round((to - from) * sampleRate));
    };
    let finite = true;
    for (const value of left) finite &&= Number.isFinite(value);
    return { early: rms(0.1, 0.2), late: rms(0.6, 0.7), finite, samples: Array.from(left) };
  };
  const results = {};
  for (const [name, options] of Object.entries(cases)) results[name] = await render(options);
  return results;
}, cases);

const decayDb = result => 20 * Math.log10(Math.max(1e-30, result.late) / Math.max(1e-30, result.early));
const maxDifference = (a, b) => a.samples.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - b.samples[index])), 0);

test('band modulation acts on the ZDF post-gain feedback tap like the fader; FADER ONLY keeps the legacy tap', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await renderProbe(page, {
    neutral: {},
    fader: { fader: -100 },
    macroDefault: { macro: true },
    macroInclude: { macro: true, tapModulation: 'include' },
    macroExclude: { macro: true, tapModulation: 'exclude' },
    neutralExclude: { tapModulation: 'exclude' },
    unifiedMacro: { core: 'zdf', macro: true },
    unifiedFader: { core: 'zdf', fader: -100 },
    coupledMacro: { macro: true, feedbackAll: true },
    coupledFader: { fader: -100, feedbackAll: true }
  });

  for (const result of Object.values(report)) expect(result.finite).toBe(true);
  // Reference: unmodulated band oscillates, a -12 dB fader stops it.
  expect(decayDb(report.neutral)).toBeGreaterThan(-1);
  expect(decayDb(report.fader)).toBeLessThan(-40);
  // Product default equals INCLUDE and behaves like the fader.
  expect(maxDifference(report.macroDefault, report.macroInclude)).toBe(0);
  expect(decayDb(report.macroInclude)).toBeLessThan(-40);
  expect(Math.abs(report.macroInclude.early - report.fader.early)).toBeLessThan(report.fader.early * 0.05 + 1e-9);
  // Unified ZDF and the coupled LOCAL+MAIN solver follow the same contract.
  expect(decayDb(report.unifiedFader)).toBeLessThan(-40);
  expect(decayDb(report.unifiedMacro)).toBeLessThan(-40);
  expect(decayDb(report.coupledMacro)).toBeLessThan(decayDb(report.coupledFader) + 6);
  // Legacy FADER ONLY: modulation only scales the audible band; the loop still rings.
  expect(decayDb(report.macroExclude)).toBeGreaterThan(-1);
  // Without band modulation both settings are sample-identical.
  expect(maxDifference(report.neutral, report.neutralExclude)).toBe(0);
  expect(errors).toEqual([]);
});
