const { test, expect } = require('playwright/test');

test('PANIC resets feedback safely while audio stays on and German-layout shortcuts use fixed steps', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__panicTestState = { nodes: [] };
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
        this.name = name; this.options = options; this.messages = [];
        this.port = { postMessage: message => this.messages.push(message), close() {} };
        window.__panicTestState.nodes.push(this);
      }
      connect() {}
      disconnect() {}
    }
    class MockAudioContext {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.audioWorklet = { addModule: async () => {} }; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() { return { gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime(value, time, constant) { this.value = value; this.time = time; this.constant = constant; } }, connect() {}, disconnect() {} }; }
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
  const key = code => page.evaluate(eventCode => document.dispatchEvent(new KeyboardEvent('keydown', { code: eventCode, bubbles: true, cancelable: true })), code);
  const inputGain = page.locator('[data-control="inputGain"]');
  const resonance = page.locator('[data-control="resonance"]');
  const dryWet = page.locator('[data-control="dryWet"]');
  const volume = page.locator('[data-control="volume"]');

  await key('Equal'); await expect(inputGain).toHaveValue('0.5');
  await key('Equal'); await expect(inputGain).toHaveValue('1');
  await key('Minus'); await expect(inputGain).toHaveValue('0.5');
  await key('BracketRight'); await expect(resonance).toHaveValue('0.02');
  await key('BracketRight'); await expect(resonance).toHaveValue('0.04');
  await key('BracketLeft'); await expect(resonance).toHaveValue('0.02');
  await key('Backslash'); await expect(volume).toHaveValue('-5.5');
  await key('Backslash'); await expect(volume).toHaveValue('-5');
  await key('Quote'); await expect(volume).toHaveValue('-5.5');
  await inputGain.focus();
  await key('Equal');
  await expect(inputGain).toHaveValue('1');

  await page.locator('[data-audio-panic]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('OFF');
  await expect(inputGain).toHaveValue('0');
  await expect(dryWet).toHaveValue('0');

  await page.locator('[data-audio-input]').selectOption('input-1');
  await page.locator('[data-audio-output]').selectOption('output-1');
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');

  const arm = async (feedbackAllEngine = 'common-bus') => {
    await inputGain.fill('12');
    await dryWet.fill('80');
    await resonance.fill('0.8');
    await page.locator('[data-input-preamp-stage]').selectOption('tube');
    await page.locator('[data-feedback-topology]').selectOption('common-bus');
    await page.locator('[data-feedback-all-engine]').selectOption(feedbackAllEngine);
    await page.locator('[data-feedback-band="0"]').click();
    await page.locator('[data-feedback-band="3"]').click();
    await page.locator('.fb-all-toggle').click();
  };
  const expectSafe = async () => {
    await expect(page.locator('[data-audio-status]')).toHaveText('ON');
    await expect(inputGain).toHaveValue('0');
    await expect(dryWet).toHaveValue('0');
    await expect(resonance).toHaveValue('0');
    await expect(page.locator('[data-feedback-band].active')).toHaveCount(0);
  await expect(page.locator('.fb-all-toggle')).toHaveText('FB ALL');
    await expect(page.locator('.fb-all-toggle')).not.toHaveClass(/active/);
    await expect(page.locator('[data-input-preamp-stage]')).toHaveValue('tube');
  };

  const preserved = await page.evaluate(() => ({
    bands: [...document.querySelectorAll('.band-fader')].map(slider => slider.value),
    spread: document.querySelector('[data-control="spread"]').value,
    volume: document.querySelector('[data-control="volume"]').value
  }));
  await arm();
  await page.locator('[data-input-preamp-stage]').evaluate(element => {
    element.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }));
  });
  await expect(inputGain).toHaveValue('12');
  await page.locator('[data-audio-panic]').click();
  await expectSafe();
  const panicMessage = await page.evaluate(() => [...window.__panicTestState.nodes
    .find(node => node.name === window.Filterbank.PROCESSOR_NAME).messages]
    .reverse().find(message => message.type === 'panic'));
  expect(panicMessage).toEqual({ type: 'panic' });
  expect(await page.evaluate(() => ({
    bands: [...document.querySelectorAll('.band-fader')].map(slider => slider.value),
    spread: document.querySelector('[data-control="spread"]').value,
    volume: document.querySelector('[data-control="volume"]').value
  }))).toEqual(preserved);

  await arm(); await key('Space'); await expectSafe();
  await arm('legacy'); await key('Enter'); await expectSafe();
  await key('Space'); await expectSafe();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
