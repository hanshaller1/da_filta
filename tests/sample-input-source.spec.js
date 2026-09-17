const { test, expect } = require('playwright/test');

test('the INPUT combobox switches between one device source and one integrated loop without adding a row', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    window.__sampleGraph = { sources: [], decodeCalls: 0, deviceCalls: 0 };
    const node = () => ({ connect() {}, disconnect() {} });
    const devices = navigator.mediaDevices || {};
    devices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'input-1', label: 'Elektron Mock' }, { kind: 'audiooutput', deviceId: 'output-1', label: 'Mock Output' }];
    devices.getUserMedia = async () => { window.__sampleGraph.deviceCalls += 1; return { getTracks: () => [{ stop() {} }] }; };
    devices.addEventListener ||= () => {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
    class MockAudioWorkletNode { constructor() { Object.assign(this, node(), { port: { postMessage() {}, close() {} } }); } }
    class MockAudioContext {
      constructor() { this.currentTime = 10; this.sampleRate = 48000; this.audioWorklet = { addModule: async () => {} }; }
      resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
      decodeAudioData() { window.__sampleGraph.decodeCalls += 1; return Promise.resolve({ numberOfChannels: 2, sampleRate: 44100, duration: 6.62068 }); }
      createMediaStreamSource() { return node(); }
      createBufferSource() { const source = { ...node(), loop: false, startTimes: [], stopTimes: [], start(time) { this.startTimes.push(time); }, stop(time) { this.stopTimes.push(time); } }; window.__sampleGraph.sources.push(source); return source; }
      createGain() { return { ...node(), gain: { value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; } } }; }
      createMediaStreamDestination() { return { ...node(), stream: new MediaStream() }; } createChannelSplitter() { return node(); }
      createAnalyser() { return { ...node(), frequencyBinCount: 1024, getFloatFrequencyData(data) { data.fill(-80); } }; }
    }
    window.AudioContext = MockAudioContext; window.AudioWorkletNode = MockAudioWorkletNode;
    window.fetch = async url => { window.__sampleGraph.lastFetch = url; return { ok: true, arrayBuffer: async () => new ArrayBuffer(32) }; };
    HTMLMediaElement.prototype.setSinkId = async function () {}; HTMLMediaElement.prototype.play = async function () {}; HTMLMediaElement.prototype.pause = function () {};
  });
  await page.goto('/', { waitUntil: 'networkidle' });

  const inputRow = page.locator('.audio-input-source');
  const inputSelect = page.locator('[data-audio-input]');
  const initialHeight = await inputRow.evaluate(element => element.getBoundingClientRect().height);
  await expect(page.locator('[data-audio-source="device"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(inputSelect).toHaveValue('input-1');
  await expect(page.locator('[data-sample-slots], [data-sample-slot], [data-sample-enabled]')).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  await page.locator('[data-audio-source="sample"]').click();
  await expect(inputSelect).toHaveValue('full-drums-145');
  await expect(inputSelect.locator('option')).toHaveText(['Full Drums 145 BPM']);
  expect(await inputRow.evaluate(element => element.getBoundingClientRect().height)).toBe(initialHeight);
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');
  let graph = await page.evaluate(() => ({ ...window.__sampleGraph, source: window.__sampleGraph.sources.at(-1) && { loop: window.__sampleGraph.sources.at(-1).loop, starts: window.__sampleGraph.sources.at(-1).startTimes, stops: window.__sampleGraph.sources.at(-1).stopTimes, channels: window.__sampleGraph.sources.at(-1).buffer.numberOfChannels } }));
  expect(graph.deviceCalls).toBe(0);
  expect(graph.decodeCalls).toBe(1);
  expect(graph.lastFetch).toContain('assets/samples/145_LOOP.wav');
  expect(graph.source).toEqual({ loop: true, starts: [10.02], stops: [], channels: 2 });

  await page.locator('[data-audio-panic]').click();
  expect(await page.evaluate(() => window.__sampleGraph.sources.at(-1).stopTimes.length)).toBe(0);
  await page.locator('[data-audio-stop]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('OFF');
  expect(await page.evaluate(() => window.__sampleGraph.sources.at(-1).stopTimes.length)).toBe(1);
  await page.locator('[data-audio-start]').click();
  expect(await page.evaluate(() => window.__sampleGraph.sources.length)).toBe(2);
  expect(await page.evaluate(() => window.__sampleGraph.decodeCalls)).toBe(1);

  await page.locator('[data-audio-source="device"]').click();
  await expect(inputSelect).toHaveValue('input-1');
  expect(await page.evaluate(() => window.__sampleGraph.deviceCalls)).toBe(1);
  await page.locator('[data-audio-source="sample"]').click();
  expect(await page.evaluate(() => window.__sampleGraph.sources.at(-1).loop)).toBeTruthy();
  expect(consoleErrors).toEqual([]);
});
