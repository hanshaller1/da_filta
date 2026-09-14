const { test, expect } = require('playwright/test');

test('band value displays mirror the configured asymmetric dB mapping', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const fader = page.locator('.band-fader').first();
  const value = page.locator('[data-band-value="0"]');
  const boost = page.locator('[data-band-boost-db]');
  const cut = page.locator('[data-band-cut-db]');
  await boost.selectOption('12');
  await cut.selectOption('12');
  for (const [control, expected] of [[-100, '-12.0 dB'], [-50, '-6.0 dB'], [0, '0.0 dB'], [50, '+6.0 dB'], [100, '+12.0 dB']]) {
    await fader.fill(String(control));
    await expect(value).toHaveText(expected);
  }

  await cut.selectOption('60');
  await fader.fill('-50');
  await expect(value).toHaveText('-30.0 dB');
  await fader.fill('-100');
  await expect(value).toHaveText('-60.0 dB');

  await boost.selectOption('24');
  await fader.fill('50');
  await expect(value).toHaveText('+12.0 dB');
  await fader.fill('100');
  await expect(value).toHaveText('+24.0 dB');
  await fader.press('ArrowLeft');
  await expect(value).toHaveText('+23.8 dB');
  await fader.dblclick();
  await expect(value).toHaveText('0.0 dB');

  const layout = await page.evaluate(() => {
    const actions = document.querySelector('.band-actions').getBoundingClientRect();
    const value = document.querySelector('.band-slider-value').getBoundingClientRect();
    const fader = document.querySelector('.fader-wrap').getBoundingClientRect();
    const computed = getComputedStyle(document.querySelector('.band-slider-value'));
    return {
      titleCount: document.querySelectorAll('.band-title').length,
      valueCount: document.querySelectorAll('.band-slider-value').length,
      actionBottom: actions.bottom,
      valueTop: value.top,
      valueBottom: value.bottom,
      faderTop: fader.top,
      borderWidth: computed.borderTopWidth,
      frequencyCount: document.querySelectorAll('.band-value').length
    };
  });
  expect(layout.titleCount).toBe(0);
  expect(layout.valueCount).toBe(10);
  expect(layout.actionBottom).toBeLessThanOrEqual(layout.valueTop + 1);
  expect(layout.valueBottom).toBeLessThanOrEqual(layout.faderTop + 1);
  expect(layout.borderWidth).not.toBe('0px');
  expect(layout.frequencyCount).toBe(10);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
