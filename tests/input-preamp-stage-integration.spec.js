const { test, expect } = require('playwright/test');

test('DEV input stage and character amount survive UI, runtime restart, and PANIC handoff', async ({ page }) => {
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
  const inputGroupToggle = page.locator('[data-dev-lab-group="input"] .dev-lab-collapse-toggle');
  if (await inputGroupToggle.getAttribute('aria-expanded') === 'false') await inputGroupToggle.click();
  const selector = page.locator('[data-input-preamp-stage]');
  const character = page.locator('[data-input-character-amount]');
  await expect(selector.locator('option')).toHaveText(['LINEAR', 'SILK', 'TAPE', 'TUBE', 'CONSOLE', 'CRUNCH', 'DESTROY']);
  await expect(selector).toHaveValue('linear');
  await expect(character).toHaveValue('50');
  await expect(character).toHaveAttribute('aria-disabled', 'true');
  await page.locator('[data-audio-input]').selectOption('input-1');
  await page.locator('[data-audio-output]').selectOption('output-1');
  await page.locator('[data-audio-start]').click();
  const initialStage = await page.evaluate(() => window.__inputStageTestState.nodes
    .find(node => node.name === 'resonant-input-preamp-processor').options.processorOptions.stage);
  expect(initialStage).toBe('linear');
  for (const value of ['silk', 'tape', 'tube', 'console', 'crunch', 'destroy']) {
    await selector.selectOption(value);
    const received = await page.evaluate(() => {
      const node = window.__inputStageTestState.nodes.find(candidate => candidate.name === 'resonant-input-preamp-processor');
      return [...node.messages].reverse().find(message => message.type === 'set-input-stage')?.value;
    });
    expect(received).toBe(value);
  }
  await expect(character).toHaveAttribute('aria-disabled', 'false');
  await character.fill('20');
  const characterMessage = await page.evaluate(() => {
    const node = window.__inputStageTestState.nodes.find(candidate => candidate.name === 'resonant-input-preamp-processor');
    return [...node.messages].reverse().find(message => message.type === 'set-character-amount');
  });
  expect(characterMessage).toEqual({ type: 'set-character-amount', value: 0.2 });
  for (const value of ['tube', 'crunch']) {
    await selector.selectOption(value);
    await page.locator('[data-control="inputGain"]').fill('24');
    const received = await page.evaluate(() => {
      const node = window.__inputStageTestState.nodes.find(candidate => candidate.name === 'resonant-input-preamp-processor');
      return [...node.messages].reverse().find(message => message.type === 'set-input-stage')?.value;
    });
    expect(received).toBe(value);
  }
  await page.locator('[data-audio-stop]').click();
  await page.locator('[data-audio-start]').click();
  const restarted = await page.evaluate(() => window.__inputStageTestState.nodes
    .filter(node => node.name === 'resonant-input-preamp-processor').at(-1).options.processorOptions);
  expect(restarted).toMatchObject({ stage: 'crunch', characterAmount: 0.2, inputGainDb: 24 });
  await page.locator('[data-audio-panic]').click();
  const afterPanic = await page.evaluate(() => {
    const node = window.__inputStageTestState.nodes.filter(candidate => candidate.name === 'resonant-input-preamp-processor').at(-1);
    return { messages: node.messages, stage: node.options.processorOptions.stage, characterAmount: node.options.processorOptions.characterAmount };
  });
  expect([...afterPanic.messages].reverse().find(message => message.type === 'set-input-gain-db')?.value).toBe(0);
  expect(afterPanic.stage).toBe('crunch');
  expect(afterPanic.characterAmount).toBe(0.2);
  await expect(selector).toHaveValue('crunch');
  await expect(character).toHaveValue('20');
  const fallbacks = await page.evaluate(() => {
    const engine = new window.AudioEngine({});
    return [engine.setInputPreampStage('preamp'), engine.setInputPreampStage('invalid-value')];
  });
  expect(fallbacks).toEqual(['linear', 'linear']);
});
