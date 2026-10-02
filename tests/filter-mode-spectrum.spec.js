const { test, expect } = require('playwright/test');

test('FILTER graph toggles real pre/post filterbank FFT overlays without changing DSP state', async ({ page }) => {
  await page.addInitScript(() => {
    window.__filterGraph = { records: [], analysers: [], splitters: [] };
    const record = name => ({ name, connections: [], connect(target, output) { this.connections.push({ target, output }); }, disconnect() {} });
    const devices = navigator.mediaDevices || {};
    devices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'in' }, { kind: 'audiooutput', deviceId: 'out' }];
    devices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    devices.addEventListener ||= () => {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
    class MockAudioWorkletNode {
      constructor(context, name) { Object.assign(this, record(name), { port: { postMessage() {}, close() {} } }); window.__filterGraph.records.push(this); }
    }
    class MockAudioContext {
      constructor() { this.currentTime = 0; this.sampleRate = 48000; this.audioWorklet = { addModule: async () => {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return record('source'); }
      createGain() { const gain = { ...record('gain'), gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } } }; window.__filterGraph.records.push(gain); return gain; }
      createMediaStreamDestination() { return { ...record('destination'), stream: new MediaStream() }; }
      createChannelSplitter() { const splitter = record('splitter'); window.__filterGraph.splitters.push(splitter); return splitter; }
      createAnalyser() {
        const isInput = window.__filterGraph.analysers.length >= 2;
        const analyser = { ...record('analyser'), context: this, frequencyBinCount: 1024, fftSize: 2048,
          getFloatFrequencyData(data) { data.fill(isInput ? -24 : -58); } };
        window.__filterGraph.analysers.push(analyser);
        return analyser;
      }
    }
    window.AudioContext = MockAudioContext;
    window.AudioWorkletNode = MockAudioWorkletNode;
    HTMLMediaElement.prototype.setSinkId = async function () {};
    HTMLMediaElement.prototype.play = async function () {};
    HTMLMediaElement.prototype.pause = function () {};
  });

  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-mode="filter"]').click();
  const canvas = page.locator('canvas.filter-response-spectrum');
  await expect(canvas).toBeVisible();
  for (const viewport of [{ width: 1914, height: 907 }, { width: 1440, height: 900 }, { width: 1914, height: 768 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const header = document.querySelector('.filter-response > header');
      const title = header.querySelector('strong').getBoundingClientRect();
      const controls = header.querySelector('.filter-response-header-right').getBoundingClientRect();
      const chart = document.querySelector('.filter-response-chart').getBoundingClientRect();
      const svg = document.querySelector('.filter-response-chart > svg').getBoundingClientRect();
      const canvas = document.querySelector('canvas.filter-response-spectrum').getBoundingClientRect();
      return { titleRight: title.right, controlsLeft: controls.left, controlsRight: controls.right, headerRight: header.getBoundingClientRect().right,
        graphWidth: chart.width, canvasLeft: canvas.left, svgLeft: svg.left, canvasWidth: canvas.width, svgWidth: svg.width,
        documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
    });
    expect(layout.titleRight).toBeLessThanOrEqual(layout.controlsLeft + 1);
    expect(layout.controlsRight).toBeLessThanOrEqual(layout.headerRight + 1);
    expect(layout.graphWidth).toBeGreaterThan(200);
    expect(layout.canvasLeft).toBeCloseTo(layout.svgLeft, 0);
    expect(layout.canvasWidth).toBeCloseTo(layout.svgWidth, 0);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  }
  for (const layer of ['input', 'output', 'filter']) await expect(page.locator(`[data-filter-view="${layer}"]`)).toHaveAttribute('aria-pressed', 'true');

  const before = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return { enabled: engine.filterEnabled, shape: [...engine.filterModeBandGainsDb], state: window.FilterMode.getState() };
  });
  await page.locator('[data-filter-view="input"]').click();
  await page.locator('[data-filter-view="filter"]').click();
  await expect(page.locator('[data-filter-view="input"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-filter-view="filter"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return { enabled: engine.filterEnabled, shape: [...engine.filterModeBandGainsDb], state: window.FilterMode.getState() };
  })).toEqual(before);

  await page.locator('[data-filter-view="input"]').click();
  await page.locator('[data-filter-view="filter"]').click();
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');
  await expect.poll(() => canvas.evaluate(node => {
    const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) return true;
    return false;
  })).toBe(true);
  const graph = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.filter-response-spectrum');
    const context = canvas.getContext('2d');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let drawn = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) drawn += 1;
    const { splitters, analysers, records } = window.__filterGraph;
    return {
      drawn,
      analyzers: analysers.length,
      inputTapConnected: records.some(node => node.name === 'resonant-input-preamp-processor' && node.connections.some(item => item.target === splitters[1])),
      outputTapConnected: records.some(node => node.connections.some(item => item.target === splitters[0])),
      splitterTargets: splitters.map(splitter => splitter.connections.map(item => item.target.name)),
      shapePath: document.querySelector('[data-filter-response-path]').getAttribute('d'),
      axisLabels: [...document.querySelectorAll('.filter-response-labels span')].map(node => node.textContent.trim())
    };
  });
  expect(graph.drawn).toBeGreaterThan(0);
  expect(graph.analyzers).toBe(4);
  expect(graph.inputTapConnected).toBeTruthy();
  expect(graph.outputTapConnected).toBeTruthy();
  expect(graph.splitterTargets).toEqual([['analyser', 'analyser'], ['analyser', 'analyser']]);
  expect(graph.axisLabels).toEqual(['29', '61', '115', '218', '411', '777', '1.5k', '2.8k', '5.2k', '11k']);
  await expect(page.locator('[data-filter-signal-axis]')).toBeVisible();
  await expect(page.locator('[data-filter-response-ceiling]')).toBeVisible();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');
  await page.locator('[data-filter-view="input"]').click();
  const renderedPixelCount = () => canvas.evaluate(node => {
    const alpha = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    let count = 0; for (let i = 3; i < alpha.length; i += 4) if (alpha[i]) count += 1;
    return count;
  });
  await expect.poll(renderedPixelCount).toBeGreaterThan(0);
  await page.locator('[data-filter-view="output"]').click();
  await expect(page.locator('[data-filter-signal-axis]')).toBeHidden();
  await expect.poll(renderedPixelCount).toBe(0);
  await page.locator('[data-filter-view="input"]').click();
  await page.locator('[data-filter-view="output"]').click();
  for (const theme of ['dark-studio', 'clean-modern']) {
    await page.locator('[data-theme-select]').selectOption(theme);
    await expect.poll(renderedPixelCount).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});
