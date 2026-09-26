const { test, expect } = require('playwright/test');

test('NORMAL response keeps bars and stereo spectrum together while its foreground toggle only changes layering', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');

  const chart = page.locator('.fb-workspace .chart-grid');
  const bars = chart.locator('.bars');
  const canvas = chart.locator('canvas.filterbank-spectrum');
  const [barsButton, spectrumButton] = await page.locator('.spectrum-foreground-control button').all();
  await expect(canvas).toBeVisible();
  await expect(bars).toBeVisible();
  await expect(barsButton).toHaveAttribute('aria-pressed', 'true');
  await expect(spectrumButton).toHaveAttribute('aria-pressed', 'false');
  await expect(barsButton).toHaveAttribute('aria-label', 'Filterbank-Balken in den Vordergrund');
  await expect(spectrumButton).toHaveAttribute('aria-label', 'Spectrum in den Vordergrund');

  await spectrumButton.click();
  await expect(chart).toHaveClass(/spectrum-foreground/);
  await expect(bars).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(spectrumButton).toHaveAttribute('aria-pressed', 'true');

  const mapping = await page.evaluate(() => ({
    low: window.FilterbankSpectrum.frequencyToX(20, 1000),
    mid: window.FilterbankSpectrum.frequencyToX(1000, 1000),
    high: window.FilterbankSpectrum.frequencyToX(20000, 1000),
    top: window.FilterbankSpectrum.decibelsToY(0, 200),
    bottom: window.FilterbankSpectrum.decibelsToY(-90, 200)
  }));
  expect(mapping).toMatchObject({ low: 0, high: 1000, top: 0, bottom: 200 });
  expect(mapping.mid).toBeGreaterThan(400);
  expect(mapping.mid).toBeLessThan(700);

  await page.locator('[data-response-mode="dev-lab"]').click();
  await expect(page.locator('.spectrum-foreground-control')).toBeHidden();
  await page.locator('[data-response-mode="normal"]').click();
  await expect(page.locator('.spectrum-foreground-control')).toBeVisible();
  await expect(spectrumButton).toHaveAttribute('aria-pressed', 'true');

  await expect(spectrumButton).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('AudioEngine creates an isolated, separately channelled analyser sidechain from filterbank wet output', async ({ page }) => {
  await page.addInitScript(() => {
    window.__spectrumGraph = { nodes: [], records: [], analysers: [], splitters: [] };
    const node = name => { const value = { name, connections: [], connect(target, output) { this.connections.push({ target, output }); }, disconnect() {} }; window.__spectrumGraph.records.push(value); return value; };
    const devices = navigator.mediaDevices || {};
    devices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'in' }, { kind: 'audiooutput', deviceId: 'out' }];
    devices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    devices.addEventListener ||= () => {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
    class MockAudioWorkletNode {
      constructor(context, name) { Object.assign(this, node(name), { port: { postMessage() {}, close() {} } }); window.__spectrumGraph.nodes.push(this); }
    }
    class MockAudioContext {
      constructor() { this.currentTime = 0; this.sampleRate = 48000; this.audioWorklet = { addModule: async () => {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return node('source'); }
      createGain() { return { ...node('gain'), gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } } }; }
      createMediaStreamDestination() { return { ...node('destination'), stream: new MediaStream() }; }
      createChannelSplitter() { const splitter = node('splitter'); window.__spectrumGraph.splitters.push(splitter); return splitter; }
      createAnalyser() { const level = window.__spectrumGraph.analysers.length === 0 ? -20 : -70; const analyser = { ...node('analyser'), context: this, frequencyBinCount: 1024, getFloatFrequencyData(data) { data.fill(level); } }; window.__spectrumGraph.analysers.push(analyser); return analyser; }
    }
    window.AudioContext = MockAudioContext;
    window.AudioWorkletNode = MockAudioWorkletNode;
    HTMLMediaElement.prototype.setSinkId = async function () {};
    HTMLMediaElement.prototype.play = async function () {};
    HTMLMediaElement.prototype.pause = function () {};
  });
  await page.goto('/');
  await page.locator('[data-audio-input]').selectOption('in');
  await page.locator('[data-audio-output]').selectOption('out');
  await page.locator('[data-audio-start]').click();
  const graph = await page.evaluate(() => {
    const { records, analysers, splitters } = window.__spectrumGraph;
    const splitter = splitters[0];
    return {
      analyserCount: analysers.length,
      distinct: analysers[0] !== analysers[1],
      settings: analysers.map(({ fftSize, smoothingTimeConstant, minDecibels, maxDecibels }) => ({ fftSize, smoothingTimeConstant, minDecibels, maxDecibels })),
      filterbankFeedsSplitter: records.some(node => node.connections.some(connection => connection.target === splitter)),
      splitterOutputs: splitter.connections.map(connection => ({ output: connection.output, analyser: analysers.indexOf(connection.target) })),
      analyserOutputCounts: analysers.map(analyser => analyser.connections.length)
    };
  });
  expect(graph.analyserCount).toBe(2);
  expect(graph.distinct).toBeTruthy();
  expect(graph.settings).toEqual([{ fftSize: 2048, smoothingTimeConstant: .75, minDecibels: -90, maxDecibels: 0 }, { fftSize: 2048, smoothingTimeConstant: .75, minDecibels: -90, maxDecibels: 0 }]);
  expect(graph.filterbankFeedsSplitter).toBeTruthy();
  expect(graph.splitterOutputs).toEqual([{ output: 0, analyser: 0 }, { output: 1, analyser: 1 }]);
  expect(graph.analyserOutputCounts).toEqual([0, 0]);
  await page.waitForTimeout(80);
  const stereoPixels = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.filterbank-spectrum');
    const context = canvas.getContext('2d'); const ratio = canvas.width / canvas.getBoundingClientRect().width;
    const x = Math.round(window.FilterbankSpectrum.frequencyToX(1000, canvas.getBoundingClientRect().width) * ratio);
    const yFor = db => Math.round(window.FilterbankSpectrum.decibelsToY(db, canvas.getBoundingClientRect().height) * ratio);
    const alphaNear = y => {
      let alpha = 0;
      for (let row = y - 3; row <= y + 3; row += 1) for (let column = x - 3; column <= x + 3; column += 1) alpha = Math.max(alpha, context.getImageData(column, row, 1, 1).data[3]);
      return alpha;
    };
    return { left: alphaNear(yFor(-20)), right: alphaNear(yFor(-70)) };
  });
  expect(stereoPixels.left).toBeGreaterThan(0);
  expect(stereoPixels.right).toBeGreaterThan(0);
  await page.locator('[data-audio-stop]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('OFF');
  await page.locator('[data-audio-start]').click();
  expect(await page.evaluate(() => window.__spectrumGraph.analysers.length)).toBe(4);
});
