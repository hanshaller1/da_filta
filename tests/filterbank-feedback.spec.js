const { test, expect } = require('playwright/test');

test('AudioWorklet feedback, FB ALL and resonance remain finite, stereo-isolated and additive', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/', { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const neutral = () => Array(10).fill(0);
    const gates = () => Array(10).fill(false);
    const oneGate = index => Array.from({ length: 10 }, (_, i) => i === index);
    const allGates = () => Array(10).fill(true);
    const oneBand = (index, value) => Array.from({ length: 10 }, (_, i) => i === index ? value : 0);
    // Explicit AudioEngine production contract. The old implicit wrapper defaults
    // selected isolated TPT/reference-delta/legacy MAIN, not the CURRENT bus.
    const defaults = new window.AudioEngine({}).getFilterbankState();
    const render = async ({ sampleRate = 48000, duration = .75, frequency = 411, resonance = 0,
      bandGainLeft = neutral(), bandGainRight = neutral(), feedbackBandLeft = gates(), feedbackBandRight = gates(),
      feedbackAllLeft = false, feedbackAllRight = false } = {}) => {
      const context = new OfflineAudioContext(2, Math.round(sampleRate * duration), sampleRate);
      const buffer = context.createBuffer(2, context.length, sampleRate);
      // A band-centred burst exercises sustained feedback energy. The old cold
      // impulse mostly measured the tiny nonlinear-minus-linear TPT residual,
      // including its FIR startup, rather than a production common-bus tail.
      for (let frame = Math.round(sampleRate * .08); frame < Math.round(sampleRate * .28); frame++) {
        const phase = 2 * Math.PI * frequency * frame / sampleRate;
        buffer.getChannelData(0)[frame] = .025 * Math.sin(phase);
        buffer.getChannelData(1)[frame] = .02 * Math.sin(phase + .29);
      }
      const filterbank = await window.Filterbank.create(context, { ...defaults, modulationState: null,
        bandGainLeft, bandGainRight, feedbackBandLeft, feedbackBandRight, feedbackAllLeft, feedbackAllRight, resonance });
      const source = context.createBufferSource(); source.buffer = buffer;
      source.connect(filterbank.input); filterbank.output.connect(context.destination); source.start();
      const output = await context.startRendering(); filterbank.dispose(); return output;
    };
    const compare = (first, second, startSeconds = 0, endSeconds = first.duration) => {
      const start = Math.round(first.sampleRate * startSeconds), end = Math.min(first.length, Math.round(first.sampleRate * endSeconds));
      const result = {};
      for (const [channel, name] of [[0, 'left'], [1, 'right']]) {
        const a = first.getChannelData(channel), b = second.getChannelData(channel);
        let max = 0, energy = 0;
        for (let i = start; i < end; i++) { const d = a[i] - b[i]; max = Math.max(max, Math.abs(d)); energy += d * d; }
        result[`${name}Max`] = max; result[`${name}Rms`] = Math.sqrt(energy / (end - start));
      }
      return result;
    };
    const metrics = output => {
      let peak = 0, finite = true;
      for (let channel = 0; channel < 2; channel++) for (const value of output.getChannelData(channel)) { finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value)); }
      // Follow actual post-excitation energy across time, independently of the
      // 15 Hz diagnostics. Common-bus positive feedback may sustain oscillation;
      // signed negative feedback need not have monotonically increasing tails.
      const windows = [[.28, .30], [.30, .34], [.34, .42], [.42, .60]].map(([start, end]) => {
        const values = output.getChannelData(0); let energy = 0, peak = 0;
        for (let i = Math.round(start * output.sampleRate); i < Math.round(end * output.sampleRate); i++) { energy += values[i] ** 2; peak = Math.max(peak, Math.abs(values[i])); }
        return { start, end, peak, rms: Math.sqrt(energy / (Math.round(end * output.sampleRate) - Math.round(start * output.sampleRate))) };
      });
      return { peak, finite, windows };
    };
    const nonNeutral = { sampleRate: 44100, bandGainLeft: oneBand(4, 50), bandGainRight: oneBand(4, -50) };
    const reference = await render(nonNeutral);
    const noFeedbackDifference = compare(await render({ ...nonNeutral, resonance: 1 }), reference);
    const localAtZeroDifference = compare(await render({ ...nonNeutral, feedbackBandLeft: oneGate(4), feedbackBandRight: oneGate(4) }), reference);
    const allAtZeroDifference = compare(await render({ ...nonNeutral, feedbackAllLeft: true, feedbackAllRight: true }), reference);
    const perBand = [];
    for (const index of [0, 4, 9]) {
      const config = { sampleRate: index === 9 ? 48000 : 44100, frequency: window.Filterbank.BAND_FREQUENCIES[index], feedbackBandLeft: oneGate(index) };
      const zero = await render(config);
      const positive = await render({ ...config, resonance: 1 });
      const negative = await render({ ...config, resonance: -1 });
      const cases = [];
      for (const resonance of [.25, .5, 1, -.25, -.5, -1]) {
        const output = resonance === 1 ? positive : resonance === -1 ? negative : await render({ ...config, resonance });
        cases.push({ resonance, ...metrics(output), difference: compare(output, zero), tailDifference: compare(output, zero, .28, .42), rightDifference: compare(output, zero).rightMax });
      }
      perBand.push({ index, sampleRate: config.sampleRate, zero: metrics(zero), cases, signedDifference: compare(positive, negative) });
    }
    const fbAll = [];
    for (const sampleRate of [44100, 48000]) {
      const config = { sampleRate, feedbackAllLeft: true };
      const zero = await render(config);
      const positive = await render({ ...config, resonance: 1 });
      const negative = await render({ ...config, resonance: -1 });
      const cases = [];
      for (const resonance of [.25, .5, 1, -.25, -.5, -1]) {
        const output = resonance === 1 ? positive : resonance === -1 ? negative : await render({ ...config, resonance });
        cases.push({ resonance, ...metrics(output), difference: compare(output, zero), tailDifference: compare(output, zero, .28, .42) });
      }
      fbAll.push({ sampleRate, zero: metrics(zero), cases, signedDifference: compare(positive, negative) });
    }
    const localOnly = await render({ feedbackBandLeft: oneGate(4), resonance: .75 });
    const allOnly = await render({ feedbackAllLeft: true, resonance: .75 });
    const localAndAll = await render({ feedbackBandLeft: oneGate(4), feedbackAllLeft: true, resonance: .75 });
    const leftOnly = await render({ sampleRate: 44100, feedbackBandLeft: oneGate(6), resonance: 1 });
    const rightOnly = await render({ sampleRate: 48000, feedbackBandRight: oneGate(6), resonance: 1 });
    const long = [];
    for (const [sampleRate, resonance, stereo] of [[48000, 1, false], [48000, -1, false], [44100, 1, true]]) {
      long.push(metrics(await render({ sampleRate, resonance, duration: 2, feedbackBandLeft: allGates(), feedbackBandRight: stereo ? allGates() : gates(), feedbackAllLeft: true, feedbackAllRight: stereo })));
    }
    return { noFeedbackDifference, localAtZeroDifference, allAtZeroDifference, perBand, fbAll,
      localOnly: metrics(localOnly), allOnly: metrics(allOnly), localAndAll: metrics(localAndAll),
      localContribution: compare(localAndAll, allOnly), mainContribution: compare(localAndAll, localOnly),
      localTailContribution: compare(localAndAll, allOnly, .28, .42),
      leftOnly: metrics(leftOnly), rightOnly: metrics(rightOnly),
      untouchedRight: compare(leftOnly, await render({ sampleRate: 44100 })).rightMax,
      untouchedLeft: compare(rightOnly, await render({ sampleRate: 48000 })).leftMax, long,
      constants: { normalization: window.Filterbank.FEEDBACK_ALL_NORMALIZATION, maxFeedbackGain: window.Filterbank.MAX_FEEDBACK_GAIN,
        maxAuditionGain: window.Filterbank.MAX_AUDITION_GAIN, gateSmoothing: window.Filterbank.FEEDBACK_GATE_SMOOTHING_SECONDS, resonanceSmoothing: window.Filterbank.RESONANCE_SMOOTHING_SECONDS } };
  });
  await testInfo.attach('feedback-tail-energy', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  for (const difference of [result.noFeedbackDifference, result.localAtZeroDifference, result.allAtZeroDifference]) {
    expect(difference.leftMax).toBe(0); expect(difference.rightMax).toBe(0);
  }
  for (const group of [...result.perBand, ...result.fbAll]) {
    const label = JSON.stringify({ index: group.index, sampleRate: group.sampleRate });
    for (const item of group.cases) {
      expect(item.finite, label).toBe(true); expect(item.peak, label).toBeLessThan(100);
      expect(item.difference.leftMax, label).toBeGreaterThan(1e-8);
      expect(item.difference.leftRms, label).toBeGreaterThan(1e-9);
      expect(item.tailDifference.leftMax, label).toBeGreaterThan(1e-9);
      expect(item.tailDifference.leftRms, label).toBeGreaterThan(1e-9);
      expect(item.difference.rightMax, label).toBe(0);
      expect(item.windows).toHaveLength(4);
      for (const window of item.windows) { expect(Number.isFinite(window.rms), label).toBe(true); expect(Number.isFinite(window.peak), label).toBe(true); }
    }
    expect(group.signedDifference.leftMax, label).toBeGreaterThan(1e-8);
    expect(group.signedDifference.leftRms, label).toBeGreaterThan(1e-9);
  }
  for (const difference of [result.localContribution, result.mainContribution, result.localTailContribution]) {
    expect(difference.leftMax).toBeGreaterThan(1e-8); expect(difference.rightMax).toBe(0);
  }
  expect(result.untouchedRight).toBe(0); expect(result.untouchedLeft).toBe(0);
  for (const item of [result.localOnly, result.allOnly, result.localAndAll, result.leftOnly, result.rightOnly, ...result.long]) {
    expect(item.finite).toBe(true); expect(item.peak).toBeLessThan(100);
  }
  expect(result.constants.normalization).toBeCloseTo(1 / Math.sqrt(10), 12);
  expect(result.constants.maxFeedbackGain).toBe(1.25); expect(result.constants.maxAuditionGain).toBe(.25);
  expect(result.constants.gateSmoothing).toBe(.008); expect(result.constants.resonanceSmoothing).toBe(.015);
  expect(errors).toEqual([]);
});
