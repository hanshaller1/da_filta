const { test, expect } = require('playwright/test');

test('FB ALL changes the rendered COMMON BUS wet signal audibly at 44.1, 48 and 96 kHz', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/', { waitUntil: 'networkidle' });

  const reports = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const render = async (sampleRate, feedbackAll) => {
      const length = Math.round(1.2 * sampleRate);
      const context = new OfflineAudioContext(2, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href).href);
      const input = context.createBuffer(2, length, sampleRate);
      const left = input.getChannelData(0);
      for (let frame = 0; frame < Math.round(.3 * sampleRate); frame += 1) {
        const time = frame / sampleRate;
        left[frame] = .025 * Math.min(1, time / .005)
          * (Math.sin(2 * Math.PI * 411 * time) + .8 * Math.sin(2 * Math.PI * 777 * time));
      }
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
        channelCountMode: 'explicit', channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs,
          bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
          feedbackBandLeft: Array(10).fill(false), feedbackBandRight: Array(10).fill(false),
          feedbackAllLeft: feedbackAll, feedbackAllRight: false,
          resonance: .9, maxBandGainDb: 12, maxBandBoostDb: 12, maxBandCutDb: 12,
          smoothingTime: .015, feedbackGateSmoothingTime: .008, resonanceSmoothingTime: .015,
          feedbackAllNormalization: 1 / Math.sqrt(10), maxFeedbackGain: 1.25,
          feedbackCore: 'current', feedbackTopology: 'common-bus', feedbackTap: 'post-gain',
          wetModel: 'filterbank-sum', commonBusSaturationMode: 'current', commonBusDrive: 1,
          commonBusCeiling: 1, feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum',
          postGainFeedbackWeight: 'current', feedbackAllLevel: 'sqrt10', feedbackAllAmount: 100,
          feedbackAllResonanceCurve: 'current', feedbackAllSaturationReturn: 'current',
          spectralCoreRequired: true, dynamicEqEnabled: false
        }
      });
      const source = context.createBufferSource();
      source.buffer = input;
      source.connect(node).connect(context.destination);
      source.start();
      return (await context.startRendering()).getChannelData(0);
    };
    const reports = [];
    for (const sampleRate of [44100, 48000, 96000]) {
      const off = await render(sampleRate, false);
      const on = await render(sampleRate, true);
      let offEnergy = 0, onEnergy = 0, differenceEnergy = 0, onPeak = 0;
      for (let frame = 0; frame < off.length; frame += 1) {
        offEnergy += off[frame] ** 2;
        onEnergy += on[frame] ** 2;
        differenceEnergy += (on[frame] - off[frame]) ** 2;
        onPeak = Math.max(onPeak, Math.abs(on[frame]));
      }
      reports.push({ sampleRate, rmsRatio: Math.sqrt(onEnergy / offEnergy),
        rmsDifference: Math.sqrt(differenceEnergy / off.length), onPeak });
    }
    return reports;
  });

  // The frozen 4be8ba8 baseline measured rmsDifference >= .01445 and
  // on/off RMS ratio >= 1.868 at these rates with this exact signal.
  for (const report of reports) {
    expect(report.rmsDifference, `${report.sampleRate} Hz audible sample difference`).toBeGreaterThan(.012);
    expect(report.rmsRatio, `${report.sampleRate} Hz FB ALL level effect`).toBeGreaterThan(1.7);
    expect(Number.isFinite(report.onPeak)).toBeTruthy();
  }
});
