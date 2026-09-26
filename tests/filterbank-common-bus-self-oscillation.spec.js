const { test, expect } = require('playwright/test');

test('COMMON BUS follows smoothed resonance through zero without seeding a digital null state', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/', { waitUntil: 'networkidle' });

  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const bandCount = frequencies.length;
    const moduleUrl = new URL('/filterbank-processor.js', location.href).href;
    const zeros = () => Array(bandCount).fill(0);
    const gate411 = () => Array.from({ length: bandCount }, (_, index) => index === 4);
    const metric = (samples, sampleRate, from, to) => {
      const first = Math.floor(from * sampleRate);
      const last = Math.min(samples.length, Math.floor(to * sampleRate));
      let energy = 0; let peak = 0; let finite = true;
      for (let index = first; index < last; index += 1) {
        const sample = samples[index];
        energy += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
        finite = finite && Number.isFinite(sample);
      }
      return { rms: Math.sqrt(energy / Math.max(1, last - first)), peak, finite };
    };
    const render = async ({ events = [], duration = 1.4, seeded = true } = {}) => {
      const sampleRate = 48000;
      const length = Math.round(sampleRate * duration);
      const context = new OfflineAudioContext(2, length, sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const input = context.createBuffer(2, length, sampleRate);
      if (seeded) {
        const samples = input.getChannelData(0);
        for (let frame = 0; frame < Math.round(sampleRate * 0.05); frame += 1) {
          samples[frame] = 0.02 * Math.sin((2 * Math.PI * 411 * frame) / sampleRate);
        }
      }
      const diagnostics = [];
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
        channelCountMode: 'explicit', channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs,
          bandGainLeft: zeros(), bandGainRight: zeros(),
          feedbackBandLeft: gate411(), feedbackBandRight: zeros(),
          feedbackAllLeft: false, feedbackAllRight: false,
          resonance: 1, maxBandGainDb: 12, maxBandBoostDb: 12, maxBandCutDb: 12,
          smoothingTime: 0.015, feedbackGateSmoothingTime: 0.008, resonanceSmoothingTime: 0.015,
          feedbackAllNormalization: 1 / Math.sqrt(bandCount), maxFeedbackGain: 1.25,
          feedbackTopology: 'common-bus', feedbackTap: 'pre-gain', wetModel: 'filterbank-sum',
          commonBusSaturationMode: 'current', commonBusDrive: 1, commonBusCeiling: 1,
          collectResonatorDiagnostics: true
        }
      });
      node.port.onmessage = event => {
        if (event.data?.type === 'resonator-diagnostics') diagnostics.push(event.data.left);
      };
      const source = context.createBufferSource();
      source.buffer = input;
      source.connect(node).connect(context.destination);
      source.start();
      const tasks = events.map(event => context.suspend(event.time).then(async () => {
        node.port.postMessage({ type: 'set-resonance', value: event.value });
        await context.resume();
      }));
      const rendering = context.startRendering();
      await Promise.all(tasks);
      const rendered = await rendering;
      // Diagnostics publish at 15 Hz; wait for a real packet instead of
      // assuming an OfflineAudioContext message is delivered with rendering.
      const publishDeadline = performance.now() + 1000;
      while (diagnostics.length === 0 && performance.now() < publishDeadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const samples = rendered.getChannelData(0);
      return {
        early: metric(samples, sampleRate, 0.25, 0.40),
        shortTail: metric(samples, sampleRate, 0.46, 0.52),
        late: metric(samples, sampleRate, duration - 0.20, duration),
        diagnostics
      };
    };

    const zeroStart = await render({ seeded: false, duration: 0.6 });
    const sustained = await render({ duration: 0.8 });
    const shortDrop = await render({
      duration: 1.1,
      events: [{ time: 0.35, value: 0 }, { time: 0.42, value: 1 }]
    });
    const longDrop = await render({
      duration: 1.9,
      events: [{ time: 0.40, value: 0 }, { time: 1.45, value: 1 }]
    });
    const postTargetZero = shortDrop.diagnostics.filter(item => item.resonanceTarget === 0 && item.smoothedResonance > 1e-4);
    return {
      zeroStart, sustained, shortDrop, longDrop,
      postTargetZero: postTargetZero.map(item => ({
        resonance: item.smoothedResonance,
        commonReturn: item.commonFeedbackReturnPeak,
        finite: item.finite
      }))
    };
  });

  expect(report.zeroStart.early.peak).toBe(0);
  expect(report.zeroStart.late.peak).toBe(0);
  expect(report.sustained.late.rms).toBeGreaterThan(0.1);
  expect(report.postTargetZero.length).toBeGreaterThan(0);
  expect(report.postTargetZero.some(item => Math.abs(item.commonReturn) > 1e-6)).toBeTruthy();
  expect(report.postTargetZero.every(item => item.finite)).toBeTruthy();
  expect(report.shortDrop.late.rms).toBeGreaterThan(0.1);
  expect(report.longDrop.late.rms).toBeLessThan(1e-9);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
