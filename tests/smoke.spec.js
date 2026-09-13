const { test, expect } = require('playwright/test');

test('local webapp loads in Chromium without browser errors', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  const response = await page.goto('/', { waitUntil: 'networkidle' });

  expect(response).not.toBeNull();
  expect(response.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/Resonant Filterbank/);
  await expect(page.locator('main.console')).toBeVisible();
  await page.screenshot({ path: 'tests/artifacts/smoke-full-page.png', fullPage: true });

  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('theme selector switches all themes and persists without resetting UI state', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const themeSelect = page.locator('[data-theme-select]');
  const fader = page.locator('.band-fader').nth(0);
  const fb = page.locator('[data-feedback-band]').nth(0);
  const mod = page.locator('[data-mod-band]').nth(0);
  const themes = ['current', 'clean-modern', 'dark-studio', 'analog-inspired', 'minimal-dark', 'soft-neutral', 'pro-console'];

  await expect(themeSelect.locator('option')).toHaveCount(7);
  await expect(themeSelect).toHaveValue('current');
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'current');
  await fader.fill('40');
  await fb.click();
  await mod.click();

  for (const theme of themes) {
    await themeSelect.selectOption(theme);
    await expect(page.locator('body')).toHaveAttribute('data-theme', theme);
    await expect(themeSelect).toHaveValue(theme);
    await expect(fader).toHaveValue('40');
    await expect(fb).toHaveClass(/active/);
    await expect(mod).toHaveClass(/active/);
  }

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'pro-console');
  await expect(page.locator('[data-theme-select]')).toHaveValue('pro-console');

  await page.evaluate(() => window.localStorage.setItem('resonant-filterbank-theme', 'invalid-theme'));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'current');
  await expect(page.locator('[data-theme-select]')).toHaveValue('current');

  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    themePickerHeight: document.querySelector('.theme-picker').getBoundingClientRect().height,
    headerHeight: document.querySelector('.masthead').getBoundingClientRect().height
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.themePickerHeight).toBeLessThanOrEqual(layout.headerHeight);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('central state and neutral filterbank module keep L/R base values separate', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const domain = window.ResonantState;
    const state = domain.createInitialState();
    domain.setBandBaseGain(state, 'left', 2, 40);
    domain.setBandBaseGain(state, 'right', 2, -20);
    const connections = [];
    const createNode = name => ({ name, connect: target => connections.push(`${name}->${target.name}`), disconnect() {} });
    const context = { createGain: () => createNode(`node-${connections.length}`) };
    const filterbank = new window.Filterbank(context);
    filterbank.applyState(state);
    filterbank.setBandBaseGain('right', 2, 60);
    const snapshot = { left: filterbank.bandGainLeft[2], right: filterbank.bandGainRight[2], connections: connections.length };
    filterbank.dispose();
    return {
      bandCount: domain.BAND_COUNT,
      firstBand: domain.BAND_DEFINITIONS[0],
      defaults: [state.bandGainLeft[0], state.bandGainRight[0]],
      stateValues: [state.bandGainLeft[2], state.bandGainRight[2]],
      filterbankValues: [snapshot.left, snapshot.right],
      passThroughConnectionCount: snapshot.connections
    };
  });

  expect(result.bandCount).toBe(10);
  expect(result.firstBand).toEqual({ frequency: 29, label: '29 Hz' });
  expect(result.defaults).toEqual([0, 0]);
  expect(result.stateValues).toEqual([40, -20]);
  expect(result.filterbankValues).toEqual([40, 60]);
  expect(result.passThroughConnectionCount).toBe(1);
});

test('double-click resets every slider through its default update path', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const globalDefaults = {
    inputGain: '0', resonance: '0', dryWet: '50', spread: '0', volume: '-6'
  };
  for (const [name, defaultValue] of Object.entries(globalDefaults)) {
    const slider = page.locator(`[data-control="${name}"]`);
    await slider.fill(name === 'dryWet' ? '20' : name === 'volume' ? '-24' : name === 'inputGain' ? '12' : '0.5');
    await slider.dblclick();
    await expect(slider).toHaveValue(defaultValue);
  }

  const bandFaders = page.locator('.band-fader');
  const bandBars = index => page.locator(`[data-analyzer-band="${index}"] i`);
  await bandFaders.nth(0).fill('40');
  await expect(bandBars(0).first()).toHaveAttribute('style', /height: 20%/);
  await bandFaders.nth(0).dblclick();
  await expect(bandFaders.nth(0)).toHaveValue('0');
  await expect(bandBars(0).first()).toHaveAttribute('style', /height: 0%/);
  await bandFaders.nth(9).fill('-40');
  await bandFaders.nth(9).dblclick();
  await expect(bandFaders.nth(9)).toHaveValue('0');
  await expect(bandBars(9).first()).toHaveAttribute('style', /height: 0%/);

  await bandFaders.nth(0).fill('40');
  await expect(bandFaders.nth(0)).toHaveValue('40');
  await page.keyboard.press('KeyQ');
  await expect(bandFaders.nth(0)).toHaveValue('50');
  await bandFaders.nth(0).dblclick();
  await expect(bandFaders.nth(0)).toHaveValue('0');

  const volumeOutput = page.locator('[data-output="volume"]');
  await page.locator('[data-control="volume"]').fill('-6');
  const singleDigitBox = await volumeOutput.boundingBox();
  await page.locator('[data-control="volume"]').fill('-12');
  const doubleDigitBox = await volumeOutput.boundingBox();
  expect(doubleDigitBox.width).toBe(singleDigitBox.width);
  await expect(volumeOutput).toHaveText('-12.0 dB');

  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('FB, MOD and band keyboard controls share state with the analyzer', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const fb = page.locator('[data-feedback-band]');
  const mod = page.locator('[data-mod-band]');
  const faders = page.locator('.band-fader');
  const analyzerBar = index => page.locator(`[data-analyzer-band="${index}"] i`).first();

  await page.keyboard.press('Digit1');
  await expect(fb.nth(0)).toHaveClass(/active/);
  await page.keyboard.press('Digit1');
  await expect(fb.nth(0)).not.toHaveClass(/active/);
  await page.keyboard.press('Digit0');
  await expect(fb.nth(9)).toHaveClass(/active/);
  await page.keyboard.press('Shift+Digit1');
  await expect(mod.nth(0)).toHaveClass(/active/);
  await expect(fb.nth(0)).not.toHaveClass(/active/);
  await page.keyboard.press('Shift+Digit0');
  await expect(mod.nth(9)).toHaveClass(/active/);

  const initialBar = await analyzerBar(0).getAttribute('style');
  await page.keyboard.press('KeyQ');
  await expect(faders.nth(0)).toHaveValue('10');
  await expect(analyzerBar(0)).not.toHaveAttribute('style', initialBar);
  await expect(faders.nth(9)).toHaveValue('0');
  await page.keyboard.press('KeyP');
  await expect(faders.nth(9)).toHaveValue('10');
  await page.keyboard.press('KeyA');
  await expect(faders.nth(0)).toHaveValue('0');
  await page.keyboard.press('Semicolon');
  await expect(faders.nth(9)).toHaveValue('0');

  for (let i = 0; i < 25; i++) await page.keyboard.press('KeyQ');
  await expect(faders.nth(0)).toHaveValue('100');
  for (let i = 0; i < 25; i++) await page.keyboard.press('KeyA');
  await expect(faders.nth(0)).toHaveValue('-100');
  await faders.nth(0).fill('100');
  await expect(analyzerBar(0)).toHaveAttribute('style', /50%/);
  await faders.nth(0).fill('40');
  await faders.nth(0).evaluate(slider => { slider.value = '-100'; });
  await page.keyboard.press('KeyQ');
  await expect(faders.nth(0)).toHaveValue('50');

  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('FILTERBANK RESPONSE uses a bipolar zero-centered graph', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const faders = page.locator('.band-fader');
  const bandBars = index => page.locator(`[data-analyzer-band="${index}"] i`);
  const left = index => bandBars(index).nth(0);
  const right = index => bandBars(index).nth(1);
  const expectBars = async (index, height, isNegative) => {
    for (const bar of [left(index), right(index)]) {
      await expect(bar).toHaveAttribute('style', new RegExp(`height: ${height}%`));
      if (isNegative) await expect(bar).toHaveClass(/negative/);
      else await expect(bar).not.toHaveClass(/negative/);
    }
  };

  await expectBars(0, 0, false);
  await page.keyboard.press('KeyQ');
  await expectBars(0, 5, false);
  await page.keyboard.press('KeyZ');
  await expectBars(0, 0, false);
  await page.keyboard.press('KeyA');
  await expectBars(0, 5, true);
  await page.keyboard.press('KeyZ');
  await expectBars(0, 0, false);

  await page.keyboard.press('KeyP');
  await expectBars(9, 5, false);
  await page.keyboard.press('Slash');
  await expectBars(9, 0, false);
  await page.keyboard.press('Semicolon');
  await expectBars(9, 5, true);
  await page.keyboard.press('Slash');
  await expectBars(9, 0, false);

  await faders.nth(0).fill('100');
  await expectBars(0, 50, false);
  await faders.nth(0).fill('-100');
  await expectBars(0, 50, true);
  await faders.nth(0).fill('0');
  await expectBars(0, 0, false);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('keyboard shortcuts remain active after focusing a band range with the mouse', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const fader = page.locator('.band-fader').nth(0);
  const fb = page.locator('[data-feedback-band]').nth(0);
  const mod = page.locator('[data-mod-band]').nth(0);

  await fader.click();
  await expect(fader).toBeFocused();
  await page.keyboard.press('KeyQ');
  await expect(fader).toHaveValue('10');
  await page.keyboard.press('KeyA');
  await expect(fader).toHaveValue('0');
  await page.keyboard.press('Digit1');
  await expect(fb).toHaveClass(/active/);
  await page.keyboard.press('Shift+Digit1');
  await expect(mod).toHaveClass(/active/);

  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('latest FB UI rules keep neutral keys and inactive modes correct', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const faders = page.locator('.band-fader');
  const modeButtons = page.locator('.mode-button');
  const fb = page.locator('[data-feedback-band]');
  const mod = page.locator('[data-mod-band]');

  await page.keyboard.press('KeyQ');
  await expect(faders.nth(0)).toHaveValue('10');
  await page.keyboard.press('KeyZ');
  await expect(faders.nth(0)).toHaveValue('0');
  await page.keyboard.press('KeyA');
  await expect(faders.nth(0)).toHaveValue('-10');
  await page.keyboard.press('KeyZ');
  await expect(faders.nth(0)).toHaveValue('0');

  await page.keyboard.press('KeyP');
  await expect(faders.nth(9)).toHaveValue('10');
  await page.keyboard.press('Slash');
  await expect(faders.nth(9)).toHaveValue('0');
  await page.keyboard.press('Semicolon');
  await expect(faders.nth(9)).toHaveValue('-10');
  await page.keyboard.press('Slash');
  await expect(faders.nth(9)).toHaveValue('0');

  await faders.nth(0).click();
  await expect(faders.nth(0)).toBeFocused();
  await page.keyboard.press('KeyQ');
  await expect(faders.nth(0)).toHaveValue('10');
  await page.keyboard.press('KeyZ');
  await expect(faders.nth(0)).toHaveValue('0');
  await page.keyboard.press('Digit1');
  await expect(fb.nth(0)).toHaveClass(/active/);
  await page.keyboard.press('Shift+Digit1');
  await expect(mod.nth(0)).toHaveClass(/active/);

  await expect(modeButtons).toHaveCount(10);
  for (let i = 1; i < 10; i++) await expect(modeButtons.nth(i)).not.toHaveClass(/active/);
  await expect(modeButtons.nth(0)).not.toContainText(/[0-9]/);
  for (let i = 1; i < 10; i++) await expect(modeButtons.nth(i)).toBeDisabled();
  for (let i = 1; i < 10; i++) await expect(modeButtons.nth(i)).not.toHaveClass(/active/);

  const inputGain = page.locator('[data-control="inputGain"]');
  await expect(inputGain).toHaveAttribute('min', '0');
  await expect(inputGain).toHaveAttribute('max', '24');
  const bandText = (await page.locator('.band-card').allTextContents()).join('');
  expect(bandText).not.toContain('+12');
  expect(bandText).not.toContain('-12');
  await expect(page.locator('.axis-y')).not.toContainText('+12');
  await expect(page.locator('.axis-y')).not.toContainText('-12');

  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('audio I/O controls build and stop a mocked stereo pass-through', async ({ page }) => {
  await page.addInitScript(() => {
    const testState = { constraints: null, sinkId: null, stopped: false, gains: [] };
    window.__audioTestState = testState;
    const devices = [
      { kind: 'audioinput', deviceId: 'input-1', label: 'Mock Input', groupId: 'group-1' },
      { kind: 'audiooutput', deviceId: 'output-1', label: 'Mock Output', groupId: 'group-2' }
    ];
    const mediaDevices = navigator.mediaDevices || {};
    mediaDevices.enumerateDevices = async () => devices;
    mediaDevices.getUserMedia = async constraints => {
      testState.constraints = constraints;
      return { getTracks: () => [{ stop: () => { testState.stopped = true; } }] };
    };
    if (!mediaDevices.addEventListener) mediaDevices.addEventListener = () => {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    class MockAudioContext {
      constructor() { this.state = 'suspended'; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() {
        const parameter = { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } };
        testState.gains.push(parameter);
        return { gain: parameter, connect() {}, disconnect() {} };
      }
      createMediaStreamDestination() { return { stream: new MediaStream() }; }
      close() { this.state = 'closed'; return Promise.resolve(); }
    }
    window.AudioContext = MockAudioContext;
    HTMLMediaElement.prototype.setSinkId = async function (id) { testState.sinkId = id; };
    HTMLMediaElement.prototype.play = async function () {};
    HTMLMediaElement.prototype.pause = function () {};
  });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  await expect(page.locator('[data-audio-input]')).toHaveCount(1);
  await expect(page.locator('[data-audio-output]')).toHaveCount(1);
  await expect(page.locator('[data-audio-start]')).toBeVisible();
  await expect(page.locator('[data-audio-stop]')).toBeVisible();
  await expect(page.locator('[data-audio-status]')).toHaveText('OFF');
  await page.locator('[data-audio-input]').selectOption('input-1');
  await page.locator('[data-audio-output]').selectOption('output-1');
  await page.locator('[data-control="inputGain"]').fill('6');
  await page.locator('[data-control="dryWet"]').fill('0');
  await page.locator('[data-control="volume"]').fill('-12');
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');
  await expect(page.locator('audio')).toHaveCount(1);
  for (const theme of ['clean-modern', 'analog-inspired', 'pro-console', 'current']) {
    await page.locator('[data-theme-select]').selectOption(theme);
    await expect(page.locator('body')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('[data-audio-status]')).toHaveText('ON');
    await expect(page.locator('audio')).toHaveCount(1);
  }
  expect(await page.evaluate(() => window.__audioTestState.constraints.audio.echoCancellation)).toBe(false);
  expect(await page.evaluate(() => window.__audioTestState.constraints.audio.noiseSuppression)).toBe(false);
  expect(await page.evaluate(() => window.__audioTestState.constraints.audio.autoGainControl)).toBe(false);
  expect(await page.evaluate(() => window.__audioTestState.sinkId)).toBe('output-1');
  expect(await page.evaluate(() => window.__audioTestState.gains[0].value)).toBeCloseTo(10 ** (6 / 20), 5);
  expect(await page.evaluate(() => window.__audioTestState.gains[1].value)).toBe(1);
  expect(await page.evaluate(() => window.__audioTestState.gains[2].value)).toBe(0);
  expect(await page.evaluate(() => window.__audioTestState.gains[4].value)).toBeCloseTo(10 ** (-12 / 20), 5);
  await page.locator('[data-control="dryWet"]').fill('100');
  expect(await page.evaluate(() => window.__audioTestState.gains[1].value)).toBe(0);
  expect(await page.evaluate(() => window.__audioTestState.gains[2].value)).toBe(1);
  await page.locator('[data-control="dryWet"]').fill('50');
  expect(await page.evaluate(() => window.__audioTestState.gains[1].value)).toBe(0.5);
  expect(await page.evaluate(() => window.__audioTestState.gains[2].value)).toBe(0.5);
  await page.locator('[data-control="inputGain"]').dblclick();
  await expect(page.locator('[data-control="inputGain"]')).toHaveValue('0');
  expect(await page.evaluate(() => window.__audioTestState.gains[0].value)).toBe(1);
  await page.locator('[data-control="inputGain"]').fill('6');
  await page.locator('[data-audio-stop]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('OFF');
  await expect(page.locator('audio')).toHaveCount(0);
  expect(await page.evaluate(() => window.__audioTestState.stopped)).toBe(true);
  await expect(page.locator('[data-control="inputGain"]')).toHaveValue('6');
  await expect(page.locator('[data-control="dryWet"]')).toHaveValue('50');
  await expect(page.locator('[data-control="volume"]')).toHaveValue('-12');
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');
  expect(await page.evaluate(() => window.__audioTestState.gains[7].value)).toBeCloseTo(10 ** (6 / 20), 5);
  expect(await page.evaluate(() => window.__audioTestState.gains[8].value)).toBe(0.5);
  expect(await page.evaluate(() => window.__audioTestState.gains[9].value)).toBe(0.5);
  expect(await page.evaluate(() => window.__audioTestState.gains[11].value)).toBeCloseTo(10 ** (-12 / 20), 5);
  await page.locator('[data-audio-stop]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('OFF');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('audio I/O reports a denied permission as ERROR', async ({ page }) => {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices || {};
    mediaDevices.enumerateDevices = async () => [];
    mediaDevices.getUserMedia = async () => { const error = new Error('Permission denied'); error.name = 'NotAllowedError'; throw error; };
    if (!mediaDevices.addEventListener) mediaDevices.addEventListener = () => {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    class MockAudioContext { resume() { return Promise.resolve(); } close() { return Promise.resolve(); } }
    window.AudioContext = MockAudioContext;
  });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ERROR');
  await expect(page.locator('[data-audio-message]')).toContainText('verweigert');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
