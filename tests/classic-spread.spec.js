const { test, expect } = require('playwright/test');

test('CLASSIC SPREAD derives symmetric, clamped L/R gains from non-destructive base faders', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const api = window.ResonantState;
    const state = api.createInitialState();
    [50, 100 / 12, 200 / 3].forEach((control, index) => {
      api.setBandBaseGain(state, 'left', index, control);
      api.setBandBaseGain(state, 'right', index, control);
    });

    const gains = (index, overrides = {}) => api.getEffectiveBandGains(state, index, {
      maxBandBoostDb: 24,
      maxBandCutDb: 24,
      ...overrides
    });
    const neutral = gains(0, { spread: 0, spreadCurve: 'linear', spreadMaxOffsetDb: 6 });
    const zeroSpreadControls = [0, 1, 2].map(index => gains(index, { spread: 0, spreadCurve: 'smoothstep', spreadMaxOffsetDb: 12 }));
    const left = gains(0, { spread: -0.5, spreadCurve: 'linear', spreadMaxOffsetDb: 6 });
    const right = gains(0, { spread: 0.5, spreadCurve: 'linear', spreadMaxOffsetDb: 6 });
    const differentBases = [0, 1, 2].map(index => gains(index, { spread: -0.5, spreadCurve: 'linear', spreadMaxOffsetDb: 6 }));
    const curves = ['linear', 'quadratic', 'smoothstep'].map(spreadCurve => gains(0, { spread: -0.5, spreadCurve, spreadMaxOffsetDb: 12 }).offsetDb);
    const maxOffsets = [3, 6, 9, 12].map(spreadMaxOffsetDb => gains(0, { spread: -1, spreadCurve: 'linear', spreadMaxOffsetDb }).offsetDb);
    api.setBandBaseGain(state, 'left', 3, 100);
    api.setBandBaseGain(state, 'right', 3, 100);
    const clamped = gains(3, { spread: -1, spreadCurve: 'linear', spreadMaxOffsetDb: 12 });
    const channelSelect = gains(0, { spread: -1, spreadMode: 'FB_CH_SELECT', spreadCurve: 'linear', spreadMaxOffsetDb: 12 });
    const filterMode = gains(0, { spread: -1, activeMode: 'FILTER', spreadCurve: 'linear', spreadMaxOffsetDb: 12 });
    return {
      bases: [state.bandGainLeft.slice(0, 4), state.bandGainRight.slice(0, 4)],
      neutral, zeroSpreadControls, left, right, differentBases, curves, maxOffsets, clamped, channelSelect, filterMode
    };
  });

  expect(result.neutral.leftDb).toBeCloseTo(12, 12);
  expect(result.neutral.rightDb).toBeCloseTo(12, 12);
  expect(result.zeroSpreadControls.map(gain => [gain.leftControl, gain.rightControl])).toEqual([
    [50, 50], [100 / 12, 100 / 12], [200 / 3, 200 / 3]
  ]);
  expect(result.left.offsetDb).toBeCloseTo(3, 12);
  expect(result.left.leftDb).toBeCloseTo(15, 12);
  expect(result.left.rightDb).toBeCloseTo(9, 12);
  expect(result.right.leftDb).toBeCloseTo(9, 12);
  expect(result.right.rightDb).toBeCloseTo(15, 12);
  expect(result.left.leftDb - result.neutral.leftDb).toBeCloseTo(-(result.left.rightDb - result.neutral.rightDb), 12);
  expect(result.differentBases.map(gain => [gain.leftDb, gain.rightDb])).toEqual([[15, 9], [5, -1], [19, 13]]);
  expect(result.curves).toEqual([6, 3, 6]);
  expect(result.maxOffsets).toEqual([3, 6, 9, 12]);
  expect(result.clamped.leftDb).toBe(24);
  expect(result.clamped.rightDb).toBe(12);
  expect(result.channelSelect.offsetDb).toBe(0);
  expect(result.channelSelect.leftDb).toBeCloseTo(12, 12);
  expect(result.channelSelect.rightDb).toBeCloseTo(12, 12);
  expect(result.filterMode.offsetDb).toBe(0);
  expect(result.bases).toEqual([[50, 100 / 12, 200 / 3, 100], [50, 100 / 12, 200 / 3, 100]]);
});

test('CLASSIC SPREAD keeps FILTERBANK display and live handoff aligned while FILTER is off', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  await page.locator('.band-fader').nth(0).fill('50');
  await page.locator('[data-control="spread"]').fill('-0.5');
  const analyzer = await page.evaluate(() => {
    const engine = new window.AudioEngine({});
    const messages = [];
    const resets = [];
    engine.filterbank = {
      setBandBaseGain: (channel, index, value) => messages.push({ channel, index, value }),
      setBandBoostDb() {},
      setBandCutDb() {},
      setFeedbackCore() {},
      panic: () => resets.push('panic')
    };
    engine.setBandBaseGain('left', 0, 50);
    engine.setBandBaseGain('right', 0, 50);
    engine.setSpread(-0.5);
    engine.setSpreadCurve('linear');
    engine.setSpreadMaxOffsetDb(6);
    const effective = engine.getEffectiveBandGains(0);
    const bars = [...document.querySelectorAll('[data-analyzer-band="0"] i')].map(bar => bar.style.height);
    const appEffective = window.ResonantState.getEffectiveBandGains({
      activeMode: 'FB', spreadMode: 'CLASSIC', spread: -0.5, spreadCurve: 'linear', spreadMaxOffsetDb: 6,
      bandGainLeft: [50], bandGainRight: [50]
    }, 0, { maxBandBoostDb: 12, maxBandCutDb: 12 });
    const beforeSwitches = messages.length;
    engine.setFeedbackCore('zdf');
    engine.setFeedbackCore('current');
    return { effective, appEffective, bars, messages, beforeSwitches, afterSwitches: messages.length, resets, state: engine.getState() };
  });

  expect(analyzer.effective.leftDb).toBeCloseTo(9, 12);
  expect(analyzer.effective.rightDb).toBeCloseTo(3, 12);
  expect(analyzer.effective.leftControl).toBeCloseTo(75, 12);
  expect(analyzer.effective.rightControl).toBeCloseTo(25, 12);
  expect(analyzer.appEffective).toEqual(analyzer.effective);
  expect(analyzer.bars).toEqual(['37.5%', '12.5%']);
  expect(analyzer.messages.filter(message => message.index === 0).slice(-2)).toEqual([
    { channel: 'left', index: 0, value: 75 },
    { channel: 'right', index: 0, value: 25 }
  ]);
  expect(analyzer.resets).toEqual([]);
  expect(analyzer.afterSwitches).toBe(analyzer.beforeSwitches);
  expect(analyzer.state.bandGainLeft[0]).toBe(50);
  expect(analyzer.state.bandGainRight[0]).toBe(50);
  expect(analyzer.state.spread).toBeCloseTo(-0.5, 12);
  expect(analyzer.state.spreadCurve).toBe('linear');
  expect(analyzer.state.spreadMaxOffsetDb).toBe(6);
  expect(pageErrors).toEqual([]);
});

test('CLASSIC SPREAD DEV/LAB values are restored with an existing sweetspot snapshot', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const spread = page.locator('[data-control="spread"]');
  const curve = page.locator('[data-spread-curve]');
  const maxOffset = page.locator('[data-spread-max-offset-db]');

  await spread.fill('0.63');
  await curve.selectOption('quadratic');
  await maxOffset.selectOption('9');
  await page.locator('[data-sweetspot-save="A"]').click();
  await spread.fill('0');
  await curve.selectOption('linear');
  await maxOffset.selectOption('3');
  await page.locator('[data-sweetspot-load="A"]').click();

  await expect(spread).toHaveValue('0.63');
  await expect(curve).toHaveValue('quadratic');
  await expect(maxOffset).toHaveValue('9');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('da-filta-sweetspots-v1')));
  expect(saved.slots.A.state).toMatchObject({ spread: 0.63, spreadCurve: 'quadratic', spreadMaxOffsetDb: 9 });
});

test('derived CLASSIC SPREAD controls render finite audio with CURRENT and ZDF', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const api = window.ResonantState;
    const state = api.createInitialState();
    state.spread = -0.75;
    state.spreadCurve = 'smoothstep';
    state.spreadMaxOffsetDb = 9;
    state.bandGainLeft = [50, 0, -25, 35, 0, 0, 0, 0, 0, 0];
    state.bandGainRight = [...state.bandGainLeft];
    const leftControls = Array.from({ length: api.BAND_COUNT }, (_, index) => api.getEffectiveBandGains(state, index).leftControl);
    const rightControls = Array.from({ length: api.BAND_COUNT }, (_, index) => api.getEffectiveBandGains(state, index).rightControl);
    const render = async feedbackCore => {
      const sampleRate = 48000;
      const context = new OfflineAudioContext(2, 4096, sampleRate);
      const input = context.createBuffer(2, context.length, sampleRate);
      for (let index = 0; index < context.length; index += 1) {
        const value = 0.03 * Math.sin(2 * Math.PI * 777 * index / sampleRate);
        input.getChannelData(0)[index] = value;
        input.getChannelData(1)[index] = value;
      }
      const source = context.createBufferSource();
      source.buffer = input;
      const filterbank = await window.Filterbank.create(context, {
        bandGainLeft: leftControls,
        bandGainRight: rightControls,
        feedbackCore,
        feedbackTap: 'post-gain',
        feedbackTopology: 'common-bus',
        resonance: 0.35,
        feedbackBandLeft: Array.from({ length: api.BAND_COUNT }, (_, index) => index === 5),
        feedbackBandRight: Array.from({ length: api.BAND_COUNT }, (_, index) => index === 5)
      });
      source.connect(filterbank.input);
      filterbank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      filterbank.dispose();
      const samples = [output.getChannelData(0), output.getChannelData(1)];
      return samples.every(channel => [...channel].every(Number.isFinite));
    };
    return { leftControls, rightControls, current: await render('current'), zdf: await render('zdf') };
  });

  expect(result.leftControls).not.toEqual(result.rightControls);
  expect(result.current).toBeTruthy();
  expect(result.zdf).toBeTruthy();
});
