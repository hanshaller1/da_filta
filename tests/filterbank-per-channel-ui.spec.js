const { test, expect } = require('playwright/test');

test('P/CH swaps one center fader for an L/R pair without visual overlap', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const centers = page.locator('.center-fader');
  const channels = page.locator('.channel-faders');
  await expect(centers).toHaveCount(10);
  await expect(channels).toHaveCount(10);
  await expect(centers.first()).toBeVisible();
  await expect(channels.first()).toBeHidden();
  await expect(page.locator('.filterbank-controls-panel .fb-all-toggle')).toBeVisible();
  const cardLayout = await page.locator('.bands').evaluate(bands => {
    const [first, second] = [...bands.querySelectorAll('.band-card')];
    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();
    const style = getComputedStyle(first);
    return { gap: secondRect.left - firstRect.right, borderWidth: style.borderTopWidth, radius: style.borderTopLeftRadius };
  });
  expect(cardLayout.gap).toBeGreaterThan(0);
  expect(cardLayout.borderWidth).toBe('1px');
  expect(cardLayout.radius).toBe('5px');
  const standardLayout = await page.locator('.band-card').first().evaluate(card => {
    const track = card.querySelector('.center-fader .fader-track').getBoundingClientRect();
    const value = card.querySelector('.band-slider-value');
    return { trackBottom: track.bottom, trackHeight: track.height, valueTop: value.getBoundingClientRect().top, fontSize: getComputedStyle(value).fontSize };
  });
  expect(standardLayout.valueTop).toBeGreaterThanOrEqual(standardLayout.trackBottom);
  expect(standardLayout.fontSize).toBe('10px');
  expect(await page.locator('.center-fader .fader-label').evaluateAll(labels => labels.every(label => getComputedStyle(label).display === 'none'))).toBe(true);
  await page.locator('.per-channel-toggle').click();
  const spread = page.locator('[data-control="spread"]');
  const spreadCard = spread.locator('xpath=ancestor::label[contains(@class, "control-card")]');
  await expect(spread).toBeDisabled();
  await expect(spreadCard).toHaveClass(/is-disabled/);
  await expect(centers.first()).toBeHidden();
  await expect(channels.first()).toBeVisible();
  await expect(page.locator('.band-fader-channel')).toHaveCount(20);
  const perChannelLayout = await channels.first().evaluate(pair => {
    const left = pair.querySelector('.channel-fader:has([data-channel="left"]) .fader-track').getBoundingClientRect();
    const right = pair.querySelector('.channel-fader:has([data-channel="right"]) .fader-track').getBoundingClientRect();
    const link = pair.querySelector('.band-link-toggle').getBoundingClientRect();
    const label = pair.querySelector('.channel-fader > output').getBoundingClientRect();
    return { separation: right.x - left.x, trackHeight: left.height, labelTop: label.top, trackBottom: left.bottom, linkOffset: Math.abs((link.x + link.width / 2) - ((left.x + right.x) / 2)) };
  });
  expect(perChannelLayout.separation).toBeLessThanOrEqual(55);
  expect(perChannelLayout.trackHeight).toBeGreaterThanOrEqual(standardLayout.trackHeight - 1);
  expect(perChannelLayout.labelTop).toBeGreaterThanOrEqual(perChannelLayout.trackBottom);
  expect(perChannelLayout.linkOffset).toBeLessThanOrEqual(5);
  await expect(page.locator('[data-band-link="0"]')).toHaveAttribute('aria-pressed', 'false');
  const values = await page.evaluate(() => {
    const left = document.querySelector('.band-fader-channel[data-band="0"][data-channel="left"]');
    const right = document.querySelector('.band-fader-channel[data-band="0"][data-channel="right"]');
    left.value = '25'; left.dispatchEvent(new Event('input', { bubbles: true }));
    return { left: left.value, right: right.value };
  });
  expect(values.left).toBe('25');
  expect(values.right).toBe('0');
  await page.locator('[data-band-link="0"]').click();
  await expect(page.locator('[data-band-link="0"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.classic-channel-toggle').click();
  await expect(spread).toBeEnabled();
  await expect(spreadCard).not.toHaveClass(/is-disabled/);
  await expect(centers.first()).toBeVisible();
  await expect(channels.first()).toBeHidden();
});

test('the permanent panel uses one channel toggle and reset neutralizes both stored channels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-channel-toggle]')).toHaveCount(1);
  await expect(page.locator('.channel-mode-panel strong')).toHaveCount(0);

  await page.locator('[data-control="spread"]').fill('4');
  await page.locator('.center-fader .band-fader').first().fill('35');
  await page.locator('[data-channel-toggle]').click();
  await page.locator('.band-fader-channel[data-band="0"][data-channel="left"]').fill('40');
  await page.locator('.band-fader-channel[data-band="0"][data-channel="right"]').fill('-25');
  await page.locator('[data-band-reset]').click();

  const resetState = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return {
      ui: window.FilterMode.getManualBandState(),
      engineLeft: [...engine.bandGainLeft],
      engineRight: [...engine.bandGainRight],
      spread: document.querySelector('[data-control="spread"]').value,
      analyzer: [...document.querySelectorAll('[data-analyzer-band] i[data-channel]')].map(bar => bar.style.height),
      mode: document.querySelector('[data-channel-toggle]').getAttribute('aria-pressed')
    };
  });
  expect(resetState.ui.left).toEqual(Array(10).fill(0));
  expect(resetState.ui.right).toEqual(Array(10).fill(0));
  expect(resetState.engineLeft).toEqual(Array(10).fill(0));
  expect(resetState.engineRight).toEqual(Array(10).fill(0));
  expect(resetState.spread).toBe('0');
  expect(resetState.analyzer).toEqual(Array(20).fill('0%'));
  expect(resetState.mode).toBe('true');

  await page.locator('[data-channel-toggle]').click();
  await expect(page.locator('.center-fader .band-fader').first()).toHaveValue('0');
  await page.locator('[data-channel-toggle]').click();
  await expect(page.locator('.band-fader-channel[data-band="0"][data-channel="left"]')).toHaveValue('0');
  await expect(page.locator('.band-fader-channel[data-band="0"][data-channel="right"]')).toHaveValue('0');

  const backgrounds = await page.evaluate(() => {
    const panel = document.querySelector('.persistent-band-control-panel');
    const workspace = document.querySelector('.mode-workspace');
    const channel = document.querySelector('.channel-mode-panel');
    return {
      panel: getComputedStyle(panel).backgroundColor,
      workspace: getComputedStyle(workspace).backgroundColor,
      channel: getComputedStyle(channel).backgroundColor,
      borderRight: getComputedStyle(channel).borderRightWidth,
      scrollWidth: document.documentElement.scrollWidth
    };
  });
  expect(backgrounds.panel).toBe(backgrounds.workspace);
  expect(backgrounds.channel).toBe(backgrounds.workspace);
  expect(backgrounds.borderRight).toBe('0px');
  expect(backgrounds.scrollWidth).toBe(1440);
});
