const { test, expect } = require('playwright/test');

test('DEV INPUT STAGE survives the UI, AudioEngine, and input-preamp Worklet handoff', async ({ page }) => {
  await page.addInitScript(() => {
    window.__inputStageTestState = { nodes: [] };
    const mediaDevices = navigator.mediaDevices || {};
    mediaDevices.enumerateDevices = async () => [
      { kind: 'audioinput', deviceId: 'input-1', label: 'Mock Input', groupId: 'group-1' },
      { kind: 'audiooutput', deviceId: 'output-1', label: 'Mock Output', groupId: 'group-1' }
    ];
    mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    if (!mediaDevices.addEventListener) mediaDevices.addEventListener = () => {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    class MockAudioWorkletNode {
      constructor(context, name, options) {
        this.name = name;
        this.options = options;
        this.messages = [];
        this.port = { postMessage: message => this.messages.push(message), close() {} };
        window.__inputStageTestState.nodes.push(this);
      }
      connect() {}
      disconnect() {}
    }
    class MockAudioContext {
      constructor() {
        this.state = 'suspended'; this.currentTime = 0;
        this.audioWorklet = { addModule: async () => {} };
      }
      resume() { this.state = 'running'; return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() { return { gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } }, connect() {}, disconnect() {} }; }
      createMediaStreamDestination() { return { stream: new MediaStream() }; }
      close() { this.state = 'closed'; return Promise.resolve(); }
    }
    window.AudioContext = MockAudioContext;
    window.AudioWorkletNode = MockAudioWorkletNode;
    HTMLMediaElement.prototype.setSinkId = async function () {};
    HTMLMediaElement.prototype.play = async function () {};
    HTMLMediaElement.prototype.pause = function () {};
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  const selector = page.locator('[data-input-preamp-stage]');
  await expect(selector.locator('option')).toHaveText(['LINEAR', 'CLEAN', 'WARM', 'CRUNCH', 'AGGRESSIVE']);
  await expect(selector).toHaveValue('linear');
  await page.locator('[data-audio-input]').selectOption('input-1');
  await page.locator('[data-audio-output]').selectOption('output-1');
  await page.locator('[data-audio-start]').click();
  const initialStage = await page.evaluate(() => window.__inputStageTestState.nodes
    .find(node => node.name === 'resonant-input-preamp-processor').options.processorOptions.stage);
  expect(initialStage).toBe('linear');
  for (const value of ['clean', 'warm', 'crunch', 'aggressive']) {
    await selector.selectOption(value);
    const received = await page.evaluate(() => {
      const node = window.__inputStageTestState.nodes.find(candidate => candidate.name === 'resonant-input-preamp-processor');
      return [...node.messages].reverse().find(message => message.type === 'set-input-stage')?.value;
    });
    expect(received).toBe(value);
  }
  for (const value of ['warm', 'crunch']) {
    await selector.selectOption(value);
    await page.locator('[data-control="inputGain"]').fill('24');
    const received = await page.evaluate(() => {
      const node = window.__inputStageTestState.nodes.find(candidate => candidate.name === 'resonant-input-preamp-processor');
      return [...node.messages].reverse().find(message => message.type === 'set-input-stage')?.value;
    });
    expect(received).toBe(value);
  }
  const fallbacks = await page.evaluate(() => {
    const engine = new window.AudioEngine({});
    return [engine.setInputPreampStage('preamp'), engine.setInputPreampStage('invalid-value')];
  });
  expect(fallbacks).toEqual(['linear', 'linear']);
});
