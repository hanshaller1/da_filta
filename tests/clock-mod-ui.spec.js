const { test, expect } = require('playwright/test');

test('Clock Mod workspace controls, state and progression visualization stay independent from audio power', async ({ page }) => {
  await page.goto('/');
  const engineStatus = await page.evaluate(() => window.ClockModMode.getAudioEngine().status);
  await page.locator('[data-mode="clock-mod"]').click();
  await expect(page.locator('#mode-clock-mod')).toBeVisible();
  await expect(page.locator('[data-module-power="clock-mod"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.ClockModMode.getAudioEngine().status)).toBe(engineStatus);
  await expect(page.locator('[data-clock-mod-grid] line')).toHaveCount(5);
  await expect(page.locator('[data-clock-mod-left-path]')).toHaveAttribute('d', /M/);
  await expect(page.locator('[data-clock-mod-lock]')).toHaveCount(10);

  await page.locator('[data-clock-mod-waveform="triangle"]').click();
  const setRange = (selector, value) => page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await setRange('[data-clock-mod-frequency]', 650);
  await setRange('[data-clock-mod-gain]', 72);
  await setRange('[data-clock-mod-midpoint]', -3);
  await page.locator('[data-clock-mod-direction="ping-pong"]').click();
  await page.locator('[data-clock-mod-bpm]').fill('10000');
  await page.locator('[data-clock-mod-right-invert]').click();
  await page.locator('[data-clock-mod-lock="3"]').click();
  await expect(page.locator('[data-clock-mod-lock="3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-clock-mod-lock="3"]')).toHaveAttribute('aria-label', /band 4/);

  await page.locator('[data-clock-mod-source="midi"]').click();
  await expect(page.locator('[data-clock-mod-bpm]')).toBeDisabled();
  await expect(page.locator('[data-clock-mod-scale]')).toBeEnabled();
  await page.locator('[data-clock-mod-scale]').selectOption('1/16');
  await expect(page.locator('[data-clock-mod-midi-bpm]')).toHaveText('—');
  await expect(page.locator('[data-clock-mod-scale]')).toHaveValue('1/16');

  const state = await page.evaluate(() => window.ClockModMode.getState());
  expect(state.enabled).toBe(false);
  expect(state.waveform).toBe('triangle');
  expect(state.sourceFrequencyHz).toBeGreaterThan(1);
  expect(state.modulationGain).toBe(72);
  expect(state.midpointDb).toBe(-3);
  expect(state.direction).toBe('ping-pong');
  expect(state.clockSource).toBe('midi');
  expect(state.internalBpm).toBe(10000);
  expect(state.clockScale).toBe('1/16');
  expect(state.rightInvert).toBe(true);
  expect(state.lockedBands[3]).toBe(true);

  await page.locator('[data-clock-mod-reset]').click();
  await page.locator('[data-module-power="clock-mod"]').click();
  await expect(page.locator('[data-module-power="clock-mod"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-clock-mod-current-band]')).toHaveAttribute('visibility', 'visible');
  expect(await page.evaluate(() => window.ClockModMode.getAudioEngine().status)).toBe(engineStatus);
  expect((await page.evaluate(() => window.ClockModMode.getState())).enabled).toBe(true);
});

test('Clock Mod workspace has no horizontal viewport overflow at the required sizes', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="clock-mod"]').click();
  await page.locator('[data-module-power="clock-mod"]').click();
  for (const viewport of [
    { width: 1914, height: 907 }, { width: 1440, height: 900 },
    { width: 1914, height: 768 }, { width: 1024, height: 768 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#mode-clock-mod')).toBeVisible();
    const bounds = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      workspace: document.querySelector('.mode-workspace').getBoundingClientRect().width,
      panel: document.querySelector('#mode-clock-mod').getBoundingClientRect().width,
      content: document.querySelector('.clock-mod-editor').scrollWidth,
      contentClient: document.querySelector('.clock-mod-editor').clientWidth
    }));
    expect(bounds.document, JSON.stringify({ viewport, bounds })).toBeLessThanOrEqual(viewport.width);
    expect(bounds.body, JSON.stringify({ viewport, bounds })).toBeLessThanOrEqual(viewport.width);
    expect(bounds.panel).toBeLessThanOrEqual(bounds.workspace + 1);
    expect(bounds.content).toBeLessThanOrEqual(bounds.contentClient + 1);
  }
});
