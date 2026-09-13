const { test, expect } = require('playwright/test');

test('the production TPT worklet preserves the Biquad base path and the hybrid feedback migration behaviour', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const { LinearTptSvf } = await import('/tpt-svf.js');
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const bandCount = frequencies.length;
    const neutral = () => Array(bandCount).fill(0);
    const gates = () => Array(bandCount).fill(false);
    const oneBand = (index, value) => Array.from({ length: bandCount }, (_, currentIndex) => (
      currentIndex === index ? value : 0
    ));
    const oneGate = index => Array.from({ length: bandCount }, (_, currentIndex) => currentIndex === index);
    const allGates = () => Array(bandCount).fill(true);

    const createBiquad = (frequency, q, sampleRate) => {
      const omega = (2 * Math.PI * frequency) / sampleRate;
      const alpha = Math.sin(omega) / (2 * q);
      const a0 = 1 + alpha;
      return {
        b0: alpha / a0,
        b1: 0,
        b2: -alpha / a0,
        a1: (-2 * Math.cos(omega)) / a0,
        a2: (1 - alpha) / a0,
        z1: 0,
        z2: 0
      };
    };

    const processBiquad = (filter, input) => {
      const sample = Number.isFinite(input) ? input : 0;
      const output = filter.b0 * sample + filter.z1;
      const nextZ1 = filter.b1 * sample - filter.a1 * output + filter.z2;
      const nextZ2 = filter.b2 * sample - filter.a2 * output;
      if (!Number.isFinite(output) || !Number.isFinite(nextZ1) || !Number.isFinite(nextZ2)) {
        filter.z1 = 0;
        filter.z2 = 0;
        return 0;
      }
      filter.z1 = nextZ1;
      filter.z2 = nextZ2;
      return output;
    };

    const createInput = (context, signal, frequency) => {
      const input = context.createBuffer(2, context.length, context.sampleRate);
      const left = input.getChannelData(0);
      const right = input.getChannelData(1);
      for (let frame = 0; frame < input.length; frame += 1) {
        if (signal === 'impulse') {
          left[frame] = frame === 0 ? 0.05 : 0;
          right[frame] = frame === 0 ? -0.04 : 0;
          continue;
        }
        const phase = (2 * Math.PI * frequency * frame) / context.sampleRate;
        left[frame] = 0.04 * Math.sin(phase);
        right[frame] = 0.035 * Math.sin(phase + 0.37);
      }
      return input;
    };

    const renderWorklet = async ({
      sampleRate,
      duration = 0.5,
      signal = 'impulse',
      frequency = 411,
      bandGainLeft = neutral(),
      bandGainRight = neutral(),
      feedbackBandLeft = gates(),
      feedbackBandRight = gates(),
      feedbackAllLeft = false,
      feedbackAllRight = false,
      resonance = 0
    }) => {
      const context = new OfflineAudioContext(2, Math.round(sampleRate * duration), sampleRate);
      const source = context.createBufferSource();
      source.buffer = createInput(context, signal, frequency);
      const filterbank = await window.Filterbank.create(context, {
        bandGainLeft,
        bandGainRight,
        feedbackBandLeft,
        feedbackBandRight,
        feedbackAllLeft,
        feedbackAllRight,
        resonance
      });
      source.connect(filterbank.input);
      filterbank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      filterbank.dispose();
      return { input: source.buffer, output };
    };

    const renderBiquadReference = ({
      input,
      bandGainLeft = neutral(),
      bandGainRight = neutral(),
      feedbackBandLeft = gates(),
      feedbackBandRight = gates(),
      feedbackAllLeft = false,
      feedbackAllRight = false,
      resonance = 0
    }) => {
      const channels = {
        left: input.getChannelData(0),
        right: input.getChannelData(1)
      };
      const output = {
        left: new Float32Array(input.length),
        right: new Float32Array(input.length)
      };
      const controls = { left: bandGainLeft, right: bandGainRight };
      const localGates = { left: feedbackBandLeft, right: feedbackBandRight };
      const allGates = { left: feedbackAllLeft ? 1 : 0, right: feedbackAllRight ? 1 : 0 };
      const filters = {
        left: frequencies.map((frequency, index) => createBiquad(frequency, qs[index], input.sampleRate)),
        right: frequencies.map((frequency, index) => createBiquad(frequency, qs[index], input.sampleRate))
      };
      const resonatorFilters = {
        left: frequencies.map((frequency, index) => new LinearTptSvf(input.sampleRate, frequency, qs[index])),
        right: frequencies.map((frequency, index) => new LinearTptSvf(input.sampleRate, frequency, qs[index]))
      };
      const returns = { left: Array(bandCount).fill(0), right: Array(bandCount).fill(0) };
      const resonanceMagnitudeSquared = resonance * resonance;
      const feedbackGain = Math.sign(resonance) * window.Filterbank.MAX_FEEDBACK_GAIN * resonanceMagnitudeSquared;
      const auditionGain = window.Filterbank.MAX_AUDITION_GAIN * resonanceMagnitudeSquared;
      const positiveAuditionGain = window.Filterbank.POSITIVE_RESONANCE_AUDITION_GAIN;

      for (const channel of ['left', 'right']) {
        const deltas = controls[channel].map(control => window.Filterbank.controlToDeltaGain(control));
        const positiveResonatorMagnitudes = localGates[channel].map(gate => (
          gate && resonance > 0 ? resonance : 0
        ));
        for (let band = 0; band < bandCount; band += 1) {
          const dampingScale = 1 - (1 - window.Filterbank.RESONATOR_DAMPING_FLOOR) * positiveResonatorMagnitudes[band];
          resonatorFilters[channel][band].setDampingScale(dampingScale);
        }
        const hasActiveLegacyFeedback = allGates[channel] > 0 || (resonance < 0 && localGates[channel].some(Boolean));
        for (let frame = 0; frame < input.length; frame += 1) {
          const source = channels[channel][frame];
          let mainOutput = source;
          let globalTapSum = 0;
          const bandOutputs = new Array(bandCount);

          for (let band = 0; band < bandCount; band += 1) {
            const bandOutput = processBiquad(filters[channel][band], source + returns[channel][band]);
            const resonatorBandOutput = resonatorFilters[channel][band].process(source);
            bandOutputs[band] = bandOutput;
            globalTapSum += bandOutput;
            mainOutput += deltas[band] * bandOutput;
            if (positiveResonatorMagnitudes[band] > 0) {
              mainOutput += positiveAuditionGain * (resonatorBandOutput - bandOutput);
            }
          }

          if (hasActiveLegacyFeedback && resonanceMagnitudeSquared > 0) {
            const globalTap = globalTapSum * window.Filterbank.FEEDBACK_ALL_NORMALIZATION;
            for (let band = 0; band < bandCount; band += 1) {
              const legacyLocalGate = resonance < 0 && localGates[channel][band] ? 1 : 0;
              const rawFeedback = legacyLocalGate * bandOutputs[band] + allGates[channel] * globalTap;
              const feedbackReturn = Math.tanh(feedbackGain * rawFeedback);
              returns[channel][band] = Number.isFinite(feedbackReturn) ? feedbackReturn : 0;
              const legacyAuditionGate = Math.max(legacyLocalGate, allGates[channel]);
              mainOutput += legacyAuditionGate * auditionGain * bandOutputs[band];
            }
          } else {
            for (let band = 0; band < bandCount; band += 1) returns[channel][band] = 0;
          }

          output[channel][frame] = Number.isFinite(mainOutput) ? mainOutput : source;
        }
      }

      return output;
    };

    const compare = (actual, reference) => {
      const metrics = { leftMaxError: 0, rightMaxError: 0, finite: true };
      for (const channel of ['left', 'right']) {
        const actualData = actual.output.getChannelData(channel === 'left' ? 0 : 1);
        const referenceData = reference[channel];
        for (let frame = 0; frame < actualData.length; frame += 1) {
          const error = Math.abs(actualData[frame] - referenceData[frame]);
          if (channel === 'left') metrics.leftMaxError = Math.max(metrics.leftMaxError, error);
          else metrics.rightMaxError = Math.max(metrics.rightMaxError, error);
          metrics.finite = metrics.finite && Number.isFinite(actualData[frame]) && Number.isFinite(referenceData[frame]);
        }
      }
      return metrics;
    };

    const compareCase = async options => {
      const actual = await renderWorklet(options);
      return compare(actual, renderBiquadReference({ ...options, input: actual.input }));
    };

    const base = {};
    for (const sampleRate of [44100, 48000]) {
      base[sampleRate] = { bands: [], mixed: null };
      for (let index = 0; index < bandCount; index += 1) {
        base[sampleRate].bands.push(await compareCase({
          sampleRate,
          signal: 'sine',
          frequency: frequencies[index],
          bandGainLeft: oneBand(index, index % 2 === 0 ? 50 : -50),
          bandGainRight: oneBand(index, index % 2 === 0 ? -50 : 50)
        }));
      }
      base[sampleRate].mixed = await compareCase({
        sampleRate,
        signal: 'sine',
        frequency: 777,
        bandGainLeft: [100, -50, 40, 0, 80, -30, 20, 0, -70, 50],
        bandGainRight: [-80, 30, 0, 60, -20, 45, 0, -40, 70, -10]
      });
    }

    const boostCut = {};
    for (const index of [0, 4, 9]) {
      boostCut[index] = {};
      for (const control of [100, -100]) {
        boostCut[index][control] = await compareCase({
          sampleRate: index === 9 ? 48000 : 44100,
          signal: 'sine',
          frequency: frequencies[index],
          bandGainLeft: oneBand(index, control),
          bandGainRight: oneBand(index, control)
        });
      }
    }

    const local = {};
    for (const index of [0, 4, 9]) {
      local[index] = {};
      for (const resonance of [0.25, 0.5, 0.75, 1, -0.5]) {
        local[index][resonance] = await compareCase({
          sampleRate: index === 9 ? 48000 : 44100,
          signal: 'impulse',
          frequency: frequencies[index],
          feedbackBandLeft: oneGate(index),
          resonance
        });
      }
    }

    const feedbackAll = {};
    for (const resonance of [0.25, 0.5, 0.75, 1, -0.5]) {
      feedbackAll[resonance] = await compareCase({
        sampleRate: resonance > 0.5 ? 48000 : 44100,
        signal: 'impulse',
        feedbackAllLeft: true,
        resonance
      });
    }

    const localAndAll = await compareCase({
      sampleRate: 48000,
      signal: 'impulse',
      feedbackBandLeft: oneGate(4),
      feedbackAllLeft: true,
      resonance: 0.75
    });
    const leftOnly = await compareCase({
      sampleRate: 44100,
      signal: 'impulse',
      feedbackBandLeft: oneGate(6),
      resonance: 1
    });
    const rightOnly = await compareCase({
      sampleRate: 48000,
      signal: 'impulse',
      feedbackBandRight: oneGate(6),
      resonance: 1
    });

    const renderDryWet = async ({ dryWet, bandGainLeft = neutral() }) => {
      const sampleRate = 48000;
      const context = new OfflineAudioContext(2, Math.round(sampleRate * 0.45), sampleRate);
      const source = context.createBufferSource();
      source.buffer = createInput(context, 'sine', 411);
      const dryGain = context.createGain();
      const wetGain = context.createGain();
      const filterbank = await window.Filterbank.create(context, { bandGainLeft, bandGainRight: neutral() });
      dryGain.gain.value = 1 - dryWet / 100;
      wetGain.gain.value = dryWet / 100;
      source.connect(dryGain);
      source.connect(filterbank.input);
      filterbank.output.connect(wetGain);
      dryGain.connect(context.destination);
      wetGain.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      filterbank.dispose();
      let leftInputError = 0;
      let leftRms = 0;
      const input = source.buffer.getChannelData(0);
      const left = output.getChannelData(0);
      for (let frame = 0; frame < left.length; frame += 1) {
        leftInputError = Math.max(leftInputError, Math.abs(left[frame] - input[frame]));
        if (frame >= left.length / 2) leftRms += left[frame] ** 2;
      }
      return { leftInputError, leftRms: Math.sqrt(leftRms / (left.length / 2)) };
    };

    const neutralMix = {};
    for (const dryWet of [0, 25, 50, 75, 100]) neutralMix[dryWet] = await renderDryWet({ dryWet });
    const boostedDry = await renderDryWet({ dryWet: 0, bandGainLeft: oneBand(4, 100) });
    const boostedWet = await renderDryWet({ dryWet: 100, bandGainLeft: oneBand(4, 100) });

    return { base, boostCut, local, feedbackAll, localAndAll, leftOnly, rightOnly, neutralMix, boostedDry, boostedWet };
  });

  const allMetrics = [
    ...Object.values(result.base).flatMap(values => [...values.bands, values.mixed]),
    ...Object.values(result.boostCut).flatMap(values => Object.values(values)),
    ...Object.values(result.local).flatMap(values => Object.values(values)),
    ...Object.values(result.feedbackAll),
    result.localAndAll,
    result.leftOnly,
    result.rightOnly
  ];
  for (const metrics of allMetrics) {
    expect(metrics.finite).toBeTruthy();
    expect(metrics.leftMaxError).toBeLessThanOrEqual(2e-6);
    expect(metrics.rightMaxError).toBeLessThanOrEqual(2e-6);
  }
  for (const metrics of Object.values(result.neutralMix)) {
    expect(metrics.leftInputError).toBeLessThanOrEqual(1e-6);
  }
  expect(result.boostedWet.leftRms).toBeGreaterThan(result.boostedDry.leftRms * 1.2);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);

  const maximumError = allMetrics.reduce((maximum, metrics) => Math.max(
    maximum,
    metrics.leftMaxError,
    metrics.rightMaxError
  ), 0);
  console.log(`TPT_PRODUCTION_PARITY maxAbsError=${maximumError}`);
});
