const { test, expect } = require('playwright/test');

test('negative DEV modes stay finite, route LOCAL/MAIN independently, and leave positive audio bit-identical', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const frequencies = window.Filterbank.BAND_FREQUENCIES;
    const qs = window.Filterbank.BAND_QS;
    const render = async ({ resonance, core = 'current', mode = 'signed', amount = 100, local = true, main = true, phase = 90, rate = 48000 } = {}) => {
      const length = Math.round(rate * .35); const context = new OfflineAudioContext(1, length, rate);
      await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
      const input = context.createBuffer(1, length, rate); const data = input.getChannelData(0);
      for (let i = 0; i < rate * .04; i += 1) data[i] = .03 * Math.sin(2 * Math.PI * 5200 * i / rate);
      const packets = [];
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: {
        bandFrequencies: frequencies, bandQs: qs, bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
        feedbackBandLeft: Array.from({ length: 10 }, (_, i) => i === 7), feedbackBandRight: Array(10).fill(false), feedbackAllLeft: true, feedbackAllRight: false,
        resonance, feedbackTopology: 'common-bus', feedbackCore: core, feedbackAllEngine: 'common-bus', feedbackAllSource: 'pre-gain-sum', feedbackAllLevel: 'raw', feedbackAllAmount: 100,
        negativeResonanceMode: mode, negativeResonanceCurve: 'squared', negativeResonanceAmount: amount, negativeResonanceLocal: local, negativeResonanceMain: main, negativeResonancePhase: phase, collectResonatorDiagnostics: true
      }});
      node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') packets.push(event.data.left); };
      const source = context.createBufferSource(); source.buffer = input; source.connect(node).connect(context.destination); source.start();
      const output = (await context.startRendering()).getChannelData(0); await new Promise(resolve => setTimeout(resolve, 0));
      return { output: [...output], finite: output.every(Number.isFinite), latest: packets.at(-1) };
    };
    const positiveBase = await render({ resonance: .8 });
    const positiveExperiment = await render({ resonance: .8, mode: 'phase', amount: 200, local: false, main: false, phase: 180 });
    const modes = await Promise.all(['signed', 'damping', 'anti-resonance', 'phase'].map(mode => render({ resonance: -.8, mode })));
    const amounts = await Promise.all([0, 25, 50, 100, 200].map(amount => render({ resonance: -.8, amount })));
    const switches = await Promise.all([[false, false], [true, false], [false, true], [true, true]].map(([local, main]) => render({ resonance: -.8, local, main })));
    const rates = await Promise.all([44100, 48000, 96000].map(rate => render({ resonance: -.8, core: 'zdf-per-band', rate })));
    return { positiveDifference: positiveBase.output.reduce((m, v, i) => Math.max(m, Math.abs(v - positiveExperiment.output[i])), 0), modes, amounts, switches, rates };
  });
  expect(report.positiveDifference).toBe(0);
  for (const item of [...report.modes, ...report.amounts, ...report.switches, ...report.rates]) expect(item.finite).toBe(true);
  expect(report.amounts[0].latest.mainCommonFeedbackReturnPeak).toBe(0);
  expect(report.switches[0].latest.commonFeedbackReturnPeak).toBe(0);
  expect(report.switches[0].latest.mainCommonFeedbackReturnPeak).toBe(0);
  expect(report.switches[1].latest.commonFeedbackReturnPeak).toBeGreaterThan(0);
  expect(report.switches[2].latest.mainCommonFeedbackReturnPeak).toBeGreaterThan(0);
});
