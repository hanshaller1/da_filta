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

test('central state and the filterbank wrapper keep L/R base values separate', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const domain = window.ResonantState;
    const state = domain.createInitialState();
    domain.setBandBaseGain(state, 'left', 2, 40);
    domain.setBandBaseGain(state, 'right', 2, -20);
    return {
      bandCount: domain.BAND_COUNT,
      firstBand: domain.BAND_DEFINITIONS[0],
      defaults: [state.bandGainLeft[0], state.bandGainRight[0]],
      stateValues: [state.bandGainLeft[2], state.bandGainRight[2]],
      qValues: window.Filterbank.BAND_QS,
      deltaMapping: [window.Filterbank.controlToDeltaGain(40), window.Filterbank.controlToDeltaGain(-20)],
      processorName: window.Filterbank.PROCESSOR_NAME,
      smoothingSeconds: window.Filterbank.PARAMETER_SMOOTHING_SECONDS
    };
  });

  expect(result.bandCount).toBe(10);
  expect(result.firstBand).toEqual({ frequency: 29, label: '29 Hz' });
  expect(result.defaults).toEqual([0, 0]);
  expect(result.stateValues).toEqual([40, -20]);
  expect(result.deltaMapping[0]).toBeCloseTo(10 ** ((12 * 0.4) / 20) - 1, 10);
  expect(result.deltaMapping[1]).toBeCloseTo(10 ** ((12 * -0.2) / 20) - 1, 10);
  expect(result.qValues).toHaveLength(10);
  expect(result.qValues.every(value => Number.isFinite(value) && value > 0)).toBeTruthy();
  expect(result.processorName).toBe('resonant-filterbank-processor');
  expect(result.smoothingSeconds).toBe(0.015);
});

test('10-band filterbank DSP is neutral, bipolar and stereo-isolated', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const renderCase = async (sampleRate, frequency, leftControls, rightControls) => {
      const frameCount = sampleRate;
      const context = new OfflineAudioContext(2, frameCount, sampleRate);
      const input = context.createBuffer(2, frameCount, sampleRate);
      const leftInput = input.getChannelData(0);
      const rightInput = input.getChannelData(1);
      for (let frame = 0; frame < frameCount; frame += 1) {
        const phase = 2 * Math.PI * frequency * frame / sampleRate;
        leftInput[frame] = 0.05 * Math.sin(phase);
        rightInput[frame] = 0.04 * Math.sin(phase + 0.37);
      }

      const source = context.createBufferSource();
      source.buffer = input;
      const filterbank = await window.Filterbank.create(context, { bandGainLeft: leftControls, bandGainRight: rightControls });
      filterbank.applyState({ bandGainLeft: leftControls, bandGainRight: rightControls });
      source.connect(filterbank.input);
      filterbank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      const leftOutput = output.getChannelData(0);
      const rightOutput = output.getChannelData(1);
      const start = Math.floor(frameCount * 0.25);
      const metrics = { leftMaxError: 0, rightMaxError: 0, leftRms: 0, rightRms: 0, finite: true };
      for (let frame = 0; frame < frameCount; frame += 1) {
        if (!Number.isFinite(leftOutput[frame]) || !Number.isFinite(rightOutput[frame])) metrics.finite = false;
        metrics.leftMaxError = Math.max(metrics.leftMaxError, Math.abs(leftOutput[frame] - leftInput[frame]));
        metrics.rightMaxError = Math.max(metrics.rightMaxError, Math.abs(rightOutput[frame] - rightInput[frame]));
        if (frame >= start) {
          metrics.leftRms += leftOutput[frame] ** 2;
          metrics.rightRms += rightOutput[frame] ** 2;
        }
      }
      const measuredFrames = frameCount - start;
      metrics.leftRms = Math.sqrt(metrics.leftRms / measuredFrames);
      metrics.rightRms = Math.sqrt(metrics.rightRms / measuredFrames);
      filterbank.dispose();
      return metrics;
    };

    const neutral = () => Array(10).fill(0);
    const controls = value => Array.from({ length: 10 }, (_, index) => index === value.index ? value.control : 0);
    const baseline44100 = await renderCase(44100, 777, neutral(), neutral());
    const baseline48000 = await renderCase(48000, 777, neutral(), neutral());
    const centerFrequencies = window.Filterbank.BAND_FREQUENCIES;
    const centerResponses = [];
    for (let index = 0; index < centerFrequencies.length; index += 1) {
      const response = await renderCase(44100, centerFrequencies[index], controls({ index, control: 50 }), neutral());
      centerResponses.push({ index, rms: response.leftRms });
    }
    const band1Positive = await renderCase(44100, 29, controls({ index: 0, control: 50 }), neutral());
    const band1PositiveMax = await renderCase(44100, 29, controls({ index: 0, control: 100 }), neutral());
    const band5Positive = await renderCase(44100, 411, controls({ index: 4, control: 100 }), neutral());
    const band5PositiveMid = await renderCase(44100, 411, controls({ index: 4, control: 50 }), neutral());
    const band10Positive = await renderCase(48000, 11000, controls({ index: 9, control: 50 }), neutral());
    const band10PositiveMax = await renderCase(48000, 11000, controls({ index: 9, control: 100 }), neutral());
    const band1Negative = await renderCase(44100, 29, controls({ index: 0, control: -50 }), neutral());
    const band1NegativeMax = await renderCase(44100, 29, controls({ index: 0, control: -100 }), neutral());
    const band5Negative = await renderCase(48000, 411, controls({ index: 4, control: -100 }), neutral());
    const band5NegativeMid = await renderCase(48000, 411, controls({ index: 4, control: -50 }), neutral());
    const band10Negative = await renderCase(48000, 11000, controls({ index: 9, control: -50 }), neutral());
    const band10NegativeMax = await renderCase(48000, 11000, controls({ index: 9, control: -100 }), neutral());
    const leftOnly = await renderCase(48000, 1500, controls({ index: 6, control: 50 }), neutral());
    const rightOnly = await renderCase(48000, 1500, neutral(), controls({ index: 6, control: 50 }));
    const mixed = await renderCase(44100, 777, [100, -50, 40, 0, 80, -30, 20, 0, -70, 50], [-80, 30, 0, 60, -20, 45, 0, -40, 70, -10]);
    return {
      baseline44100,
      baseline48000,
      centerResponses,
      band1Positive,
      band1PositiveMax,
      band5Positive,
      band5PositiveMid,
      band10Positive,
      band10PositiveMax,
      band1Negative,
      band1NegativeMax,
      band5Negative,
      band5NegativeMid,
      band10Negative,
      band10NegativeMax,
      leftOnly,
      rightOnly,
      mixed,
      qValues: window.Filterbank.BAND_QS,
      mapping: {
        neutral: window.Filterbank.controlToDeltaGain(0),
        positive: window.Filterbank.controlToDeltaGain(100),
        negative: window.Filterbank.controlToDeltaGain(-100)
      }
    };
  });

  for (const baseline of [result.baseline44100, result.baseline48000]) {
    expect(baseline.leftMaxError).toBeLessThanOrEqual(1e-6);
    expect(baseline.rightMaxError).toBeLessThanOrEqual(1e-6);
    expect(baseline.finite).toBeTruthy();
  }
  expect(result.mapping.neutral).toBe(0);
  expect(result.mapping.positive).toBeCloseTo(10 ** (12 / 20) - 1, 10);
  expect(result.mapping.negative).toBeCloseTo(10 ** (-12 / 20) - 1, 10);
  expect(result.band1Positive.leftRms).toBeGreaterThan(result.baseline44100.leftRms * 1.2);
  expect(result.band1PositiveMax.leftRms).toBeGreaterThan(result.baseline44100.leftRms * 1.2);
  expect(result.band5Positive.leftRms).toBeGreaterThan(result.baseline44100.leftRms * 1.2);
  expect(result.band5PositiveMid.leftRms).toBeGreaterThan(result.baseline48000.leftRms * 1.2);
  expect(result.band10Positive.leftRms).toBeGreaterThan(result.baseline48000.leftRms * 1.2);
  expect(result.band10PositiveMax.leftRms).toBeGreaterThan(result.baseline48000.leftRms * 1.2);
  expect(result.band1Negative.leftRms).toBeLessThan(result.baseline44100.leftRms * 0.9);
  expect(result.band1Negative.leftRms).toBeGreaterThan(0);
  expect(result.band1NegativeMax.leftRms).toBeLessThan(result.baseline44100.leftRms * 0.9);
  expect(result.band1NegativeMax.leftRms).toBeGreaterThan(0);
  expect(result.band5Negative.leftRms).toBeLessThan(result.baseline48000.leftRms * 0.9);
  expect(result.band5Negative.leftRms).toBeGreaterThan(0);
  expect(result.band5NegativeMid.leftRms).toBeLessThan(result.baseline48000.leftRms * 0.9);
  expect(result.band5NegativeMid.leftRms).toBeGreaterThan(0);
  expect(result.band10Negative.leftRms).toBeLessThan(result.baseline48000.leftRms * 0.9);
  expect(result.band10Negative.leftRms).toBeGreaterThan(0);
  expect(result.band10NegativeMax.leftRms).toBeLessThan(result.baseline48000.leftRms * 0.9);
  expect(result.band10NegativeMax.leftRms).toBeGreaterThan(0);
  for (const response of result.centerResponses) expect(response.rms).toBeGreaterThan(result.baseline44100.leftRms * 1.05);
  expect(result.leftOnly.rightMaxError).toBeLessThan(1e-6);
  expect(result.rightOnly.leftMaxError).toBeLessThan(1e-6);
  expect(result.mixed.finite).toBeTruthy();
  for (const q of result.qValues) {
    expect(Number.isFinite(q)).toBeTruthy();
    expect(q).toBeGreaterThan(0);
  }
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
  const graphVisuals = await page.locator('.chart-grid').evaluate(graph => {
    const pair = graph.querySelector('.bar-pair');
    const bars = pair.querySelectorAll('i');
    return {
      backgroundImage: getComputedStyle(graph).backgroundImage,
      zeroLine: getComputedStyle(graph, '::after').backgroundColor,
      pairWidth: pair.getBoundingClientRect().width,
      barWidths: [...bars].map(bar => bar.getBoundingClientRect().width),
      barCenters: [...bars].map(bar => { const rect = bar.getBoundingClientRect(); return rect.left + rect.width / 2; })
    };
  });
  expect(graphVisuals.backgroundImage).toBe('none');
  expect(graphVisuals.zeroLine).not.toBe('rgba(0, 0, 0, 0)');
  expect(graphVisuals.barWidths[0]).toBeLessThan(graphVisuals.pairWidth / 2);
  expect(graphVisuals.barWidths[1]).toBeLessThan(graphVisuals.pairWidth / 2);
  expect(graphVisuals.barCenters[1] - graphVisuals.barCenters[0]).toBeGreaterThan(graphVisuals.barWidths[0]);
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
    const testState = {
      constraints: null,
      sinkId: null,
      stopped: false,
      gains: [],
      workletModules: [],
      workletNodes: [],
      workletMessages: [],
      closedWorkletPorts: 0,
      nativeFilters: 0
    };
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
    class MockAudioWorkletNode {
      constructor(context, name, options) {
        this.name = name;
        this.options = options;
        this.port = {
          onmessage: null,
          postMessage: message => testState.workletMessages.push(message),
          close: () => { testState.closedWorkletPorts += 1; }
        };
        testState.workletNodes.push(this);
      }
      connect() {}
      disconnect() {}
    }
    class MockAudioContext {
      constructor() {
        this.state = 'suspended';
        this.currentTime = 0;
        this.audioWorklet = { addModule: async url => { testState.workletModules.push(url); } };
      }
      resume() { this.state = 'running'; return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() {
        const parameter = { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } };
        testState.gains.push(parameter);
        return { gain: parameter, connect() {}, disconnect() {} };
      }
      createChannelSplitter() { return { connect() {}, disconnect() {} }; }
      createChannelMerger() { return { connect() {}, disconnect() {} }; }
      createBiquadFilter() {
        testState.nativeFilters += 1;
        return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {}, disconnect() {} };
      }
      createMediaStreamDestination() { return { stream: new MediaStream() }; }
      close() { this.state = 'closed'; return Promise.resolve(); }
    }
    window.AudioContext = MockAudioContext;
    window.AudioWorkletNode = MockAudioWorkletNode;
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
  await page.locator('[data-control="resonance"]').fill('0.5');
  await page.locator('[data-control="dryWet"]').fill('0');
  await page.locator('[data-control="volume"]').fill('-12');
  await page.locator('.band-fader').nth(0).fill('40');
  await page.locator('[data-feedback-band]').nth(2).click();
  await page.locator('.fb-all-toggle').click();
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
  expect(await page.evaluate(() => window.__audioTestState.workletModules.length)).toBe(1);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes.length)).toBe(1);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].name)).toBe('resonant-filterbank-processor');
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.outputChannelCount)).toEqual([2]);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.bandGainLeft[0])).toBe(40);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.bandGainRight[0])).toBe(40);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.smoothingTime)).toBe(0.015);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.resonance)).toBe(0.5);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.feedbackBandLeft[2])).toBe(true);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.feedbackBandRight[2])).toBe(true);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.feedbackAllLeft)).toBe(true);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.feedbackAllRight)).toBe(true);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.feedbackGateSmoothingTime)).toBe(0.008);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.resonanceSmoothingTime)).toBe(0.015);
  await expect(page.locator('[data-positive-resonance-audition] option')).toHaveCount(4);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.positiveResonanceAuditionGain)).toBe(0.1);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.positiveResonanceAuditionGainSmoothingTime)).toBe(0.015);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[0].options.processorOptions.feedbackAllNormalization)).toBeCloseTo(1 / Math.sqrt(10), 12);
  expect(await page.evaluate(() => window.__audioTestState.nativeFilters)).toBe(0);
  await page.locator('[data-positive-resonance-audition]').selectOption('0.40');
  expect(await page.evaluate(() => window.__audioTestState.workletMessages.filter(message => message.type === 'set-positive-resonance-audition-gain'))).toEqual([
    { type: 'set-positive-resonance-audition-gain', value: 0.4 }
  ]);
  await page.locator('[data-feedback-band]').nth(2).click();
  await page.locator('.fb-all-toggle').click();
  await page.locator('[data-control="resonance"]').fill('-0.5');
  expect(await page.evaluate(() => window.__audioTestState.workletMessages.filter(message => message.type === 'set-band-feedback'))).toEqual([
    { type: 'set-band-feedback', channel: 'left', index: 2, enabled: false },
    { type: 'set-band-feedback', channel: 'right', index: 2, enabled: false }
  ]);
  expect(await page.evaluate(() => window.__audioTestState.workletMessages.filter(message => message.type === 'set-feedback-all'))).toEqual([
    { type: 'set-feedback-all', channel: 'left', enabled: false },
    { type: 'set-feedback-all', channel: 'right', enabled: false }
  ]);
  expect(await page.evaluate(() => window.__audioTestState.workletMessages.filter(message => message.type === 'set-resonance'))).toEqual([
    { type: 'set-resonance', value: -0.5 }
  ]);
  await page.locator('.band-fader').nth(4).fill('-25');
  expect(await page.evaluate(() => window.__audioTestState.workletMessages.filter(message => message.type === 'set-band-base-gain'))).toEqual([
    { type: 'set-band-base-gain', channel: 'left', index: 4, value: -25 },
    { type: 'set-band-base-gain', channel: 'right', index: 4, value: -25 }
  ]);
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
  expect(await page.evaluate(() => window.__audioTestState.closedWorkletPorts)).toBe(1);
  expect(await page.evaluate(() => window.__audioTestState.workletMessages.some(message => message.type === 'dispose'))).toBeTruthy();
  await expect(page.locator('[data-control="inputGain"]')).toHaveValue('6');
  await expect(page.locator('[data-control="dryWet"]')).toHaveValue('50');
  await expect(page.locator('[data-control="volume"]')).toHaveValue('-12');
  const restartGainOffset = await page.evaluate(() => window.__audioTestState.gains.length);
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');
  expect(await page.evaluate(offset => window.__audioTestState.gains[offset].value, restartGainOffset)).toBeCloseTo(10 ** (6 / 20), 5);
  expect(await page.evaluate(offset => window.__audioTestState.gains[offset + 1].value, restartGainOffset)).toBe(0.5);
  expect(await page.evaluate(offset => window.__audioTestState.gains[offset + 2].value, restartGainOffset)).toBe(0.5);
  expect(await page.evaluate(offset => window.__audioTestState.gains[offset + 4].value, restartGainOffset)).toBeCloseTo(10 ** (-12 / 20), 5);
  expect(await page.evaluate(() => window.__audioTestState.workletModules.length)).toBe(2);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes.length)).toBe(2);
  expect(await page.evaluate(() => window.__audioTestState.workletNodes[1].options.processorOptions.positiveResonanceAuditionGain)).toBe(0.4);
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

test('audio I/O reports an AudioWorklet load error as ERROR', async ({ page }) => {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices || {};
    mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'input-1', label: 'Mock Input', groupId: 'group-1' }];
    mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    if (!mediaDevices.addEventListener) mediaDevices.addEventListener = () => {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    const node = () => ({ connect() {}, disconnect() {} });
    class MockAudioContext {
      constructor() {
        this.audioWorklet = { addModule: async () => { throw new Error('Worklet module unavailable'); } };
      }
      resume() { return Promise.resolve(); }
      createMediaStreamSource() { return node(); }
      createGain() { return { ...node(), gain: { value: 0 } }; }
      createMediaStreamDestination() { return { stream: new MediaStream() }; }
      close() { return Promise.resolve(); }
    }
    window.AudioContext = MockAudioContext;
  });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ERROR');
  await expect(page.locator('[data-audio-message]')).toContainText('Filterbank-AudioWorklet konnte nicht geladen werden');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
