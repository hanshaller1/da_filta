const { test, expect } = require('playwright/test');

test('DEV FB ALL LEVEL and POST GAIN FB WEIGHT survive the UI, AudioEngine, Filterbank, and Worklet handoff', async ({ page }) => {
  await page.addInitScript(() => {
    window.__feedbackAllLevelTestState = { nodes: [] };
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
        window.__feedbackAllLevelTestState.nodes.push(this);
      }
      connect() {}
      disconnect() {}
    }
    class MockAudioContext {
      constructor() {
        this.state = 'suspended';
        this.currentTime = 0;
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
  await page.locator('[data-audio-input]').selectOption('input-1');
  await page.locator('[data-audio-output]').selectOption('output-1');
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');

  const expectedLevels = [
    ['raw', 1],
    ['sqrt2', 1 / Math.sqrt(2)],
    ['half', 0.5],
    ['sqrt10', 1 / Math.sqrt(10)],
    ['tenth', 0.1],
    ['twentieth', 0.05],
    ['fortieth', 0.025],
    ['eightieth', 0.0125]
  ];
  const initialLevel = await page.evaluate(() => window.__feedbackAllLevelTestState.nodes
    .find(node => node.name === window.Filterbank.PROCESSOR_NAME)
    .options.processorOptions.feedbackAllLevel);
  expect(initialLevel).toBe('raw');

  const initialWeight = await page.evaluate(() => window.__feedbackAllLevelTestState.nodes
    .find(node => node.name === window.Filterbank.PROCESSOR_NAME)
    .options.processorOptions.postGainFeedbackWeight);
  expect(initialWeight).toBe('current');
  for (const value of ['current', 'soft-knee']) {
    await page.locator('[data-post-gain-feedback-weight]').selectOption(value);
    const received = await page.evaluate(() => {
      const node = window.__feedbackAllLevelTestState.nodes.find(candidate => candidate.name === window.Filterbank.PROCESSOR_NAME);
      return [...node.messages].reverse().find(message => message.type === 'set-post-gain-feedback-weight')?.value;
    });
    expect(received).toBe(value);
  }

  for (const [value] of expectedLevels) {
    await page.locator('[data-feedback-all-level]').selectOption(value);
    const received = await page.evaluate(() => {
      const node = window.__feedbackAllLevelTestState.nodes.find(candidate => candidate.name === window.Filterbank.PROCESSOR_NAME);
      return [...node.messages].reverse().find(message => message.type === 'set-feedback-all-level')?.value;
    });
    expect(received).toBe(value);
  }

  const fallback = await page.evaluate(() => {
    const audioEngine = new window.AudioEngine({});
    let audioEngineForwarded;
    let audioEngineWeightForwarded;
    audioEngine.filterbank = { setFeedbackAllLevel: value => { audioEngineForwarded = value; }, setPostGainFeedbackWeight: value => { audioEngineWeightForwarded = value; } };
    const context = new AudioContext();
    const filterbank = new window.Filterbank(context, { feedbackAllLevel: 'invalid-value', postGainFeedbackWeight: 'invalid-value' });
    const constructorValue = filterbank.feedbackAllLevel;
    const constructorWeight = filterbank.postGainFeedbackWeight;
    const setterValue = filterbank.setFeedbackAllLevel('invalid-value');
    const setterWeight = filterbank.setPostGainFeedbackWeight('invalid-value');
    return {
      audioEngineWeightValue: audioEngine.setPostGainFeedbackWeight('invalid-value'),
      audioEngineWeightForwarded,
      constructorWeight,
      setterWeight,
      audioEngineValue: audioEngine.setFeedbackAllLevel('invalid-value'),
      audioEngineForwarded,
      constructorValue,
      setterValue,
      workletValue: filterbank.workletNode.messages.at(-2).value,
      workletWeightValue: filterbank.workletNode.messages.at(-1).value
    };
  });
  expect(fallback).toEqual({
    audioEngineValue: 'raw', audioEngineForwarded: 'raw', constructorValue: 'raw', setterValue: 'raw', workletValue: 'raw',
    audioEngineWeightValue: 'current', audioEngineWeightForwarded: 'current', constructorWeight: 'current', setterWeight: 'current', workletWeightValue: 'current'
  });

});
