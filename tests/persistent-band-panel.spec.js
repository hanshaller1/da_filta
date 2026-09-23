const { test, expect } = require('playwright/test');

const rect = (page, selector) => page.locator(selector).first().evaluate(element => {
  const bounds = element.getBoundingClientRect();
  return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left, width: bounds.width, height: bounds.height };
});

test('desktop keeps permanent band controls aligned and stable across every workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const workspace = await rect(page, '.mode-workspace');
  const outerPanel = await rect(page, '.persistent-band-control-panel');
  const panel = await rect(page, '.persistent-band-panel');
  const channelPanel = await rect(page, '.channel-mode-panel');
  const modeTabs = await rect(page, '.mode-tabs');
  const devLab = await rect(page, '.dev-lab-panel');
  const graph = await rect(page, '.fb-workspace');
  const filterbankControls = await rect(page, '.filterbank-controls-panel');
  const firstCard = await rect(page, '.band-card');
  const panelGap = Number(await page.locator('.console').evaluate(element => getComputedStyle(element).getPropertyValue('--panel-gap').replace('px', '')));

  expect(Math.abs(panel.left - workspace.left)).toBeLessThan(1);
  expect(Math.abs(panel.right - workspace.right)).toBeLessThan(1);
  expect(panel.left).toBe(254);
  expect(panel.right).toBe(1573);
  expect(panel.width).toBe(1319);
  expect(modeTabs.width).toBe(240);
  expect(outerPanel.left).toBe(modeTabs.left);
  expect(outerPanel.right).toBe(workspace.right);
  expect(channelPanel.left - modeTabs.left).toBe(1);
  expect(Math.abs(channelPanel.right - modeTabs.right)).toBeLessThan(1);
  expect(Math.abs(channelPanel.top - panel.top)).toBeLessThan(1);
  expect(Math.abs(channelPanel.bottom - panel.bottom)).toBeLessThan(1);
  expect(Math.abs(outerPanel.bottom - devLab.bottom)).toBeLessThan(1);
  expect(Math.abs((workspace.bottom + panelGap) - outerPanel.top)).toBeLessThan(1);
  expect(Math.abs(graph.top - (workspace.top + 8))).toBeLessThan(1);
  expect(Math.abs((graph.bottom + panelGap) - filterbankControls.top)).toBeLessThan(1);
  expect(workspace.bottom - filterbankControls.bottom).toBeLessThanOrEqual(8);
  expect(workspace.height).toBe(460);
  expect(graph.height).toBeGreaterThan(315);
  expect(firstCard.height).toBe(284);
  await expect(page.locator('.persistent-band-control-panel')).toHaveCount(1);
  await expect(page.locator('.persistent-band-control-panel > .channel-mode-panel')).toHaveCount(1);
  await expect(page.locator('.persistent-band-control-panel .band-card')).toHaveCount(10);
  const contained = await page.locator('.persistent-band-control-panel').evaluate(outer => {
    const panelBounds = outer.getBoundingClientRect();
    const cards = [...outer.querySelectorAll('.band-card')].map(card => card.getBoundingClientRect());
    return {
      rows: new Set(cards.map(card => Math.round(card.top))).size,
      minimumInset: Math.min(...cards.flatMap(card => [card.left - panelBounds.left, panelBounds.right - card.right, card.top - panelBounds.top, panelBounds.bottom - card.bottom])),
      contained: cards.every(card => card.left >= panelBounds.left && card.right <= panelBounds.right && card.top >= panelBounds.top && card.bottom <= panelBounds.bottom)
    };
  });
  expect(contained).toMatchObject({ rows: 1, contained: true });
  expect(contained.minimumInset).toBeGreaterThanOrEqual(7);
  await expect(page.locator('.filterbank-panel-header')).toHaveCount(0);
  await expect(page.locator('.filterbank-controls-panel')).toHaveCount(1);
  await expect(page.locator('.filterbank-controls-header > strong')).toHaveText('BAND FEEDBACK / MODULATION');
  const filterbankControlGeometry = await page.evaluate(() => {
    const header = document.querySelector('.filterbank-controls-header').getBoundingClientRect();
    const firstFb = document.querySelector('[data-feedback-band="0"]').getBoundingClientRect();
    const firstMod = document.querySelector('[data-mod-band="0"]').getBoundingClientRect();
    const fbAll = document.querySelector('.filterbank-controls-panel .fb-all-toggle').getBoundingClientRect();
    return { panelHeight: document.querySelector('.filterbank-controls-panel').getBoundingClientRect().height, gap: firstFb.top - header.bottom, fb: { width: firstFb.width, height: firstFb.height }, fbAboveMod: firstFb.bottom <= firstMod.top, fbAllRight: fbAll.right <= header.right && fbAll.left > header.left + header.width / 2 };
  });
  expect(filterbankControlGeometry).toEqual({ panelHeight: 112, gap: 10, fb: { width: 42, height: 22 }, fbAboveMod: true, fbAllRight: true });
  await expect(page.locator('.band-card .band-action')).toHaveCount(0);
  const alignment = await page.evaluate(() => [...document.querySelectorAll('.filterbank-band-control')].map((control, index) => {
    const center = selector => { const bounds = control.querySelector(selector).getBoundingClientRect(); return (bounds.left + bounds.right) / 2; };
    const card = document.querySelectorAll('.band-card')[index].getBoundingClientRect();
    return { fb: center('[data-feedback-band]'), mod: center('[data-mod-band]'), fader: (card.left + card.right) / 2 };
  }));
  expect(alignment.every(({ fb, mod, fader }) => Math.abs(fb - mod) < 1 && Math.abs(fb - fader) < 1)).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(907);
  const envelopeLabel = page.locator('[data-mode="envelope-follower"] span');
  await expect(envelopeLabel).toHaveCSS('white-space', 'nowrap');
  expect(await envelopeLabel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();

  for (const mode of ['filter', 'lfo', 'presets', 'filterbank']) {
    await page.locator(`[data-mode="${mode}"]`).click();
    await expect(page.locator('.persistent-band-panel')).toBeVisible();
    expect(await rect(page, '.persistent-band-panel')).toEqual(panel);
  }

  await page.locator('.per-channel-toggle').click();
  expect(await rect(page, '.persistent-band-panel')).toEqual(panel);
  const perChannelCard = await rect(page, '.band-card');
  expect(perChannelCard).toEqual(firstCard);
  await expect(page.locator('.channel-faders').first()).toBeVisible();
});

test('permanent band panel follows viewport height and survives DEV/LAB visibility changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const initial = await rect(page, '.persistent-band-panel');
  const initialOuter = await rect(page, '.persistent-band-control-panel');
  const initialWorkspace = await rect(page, '.mode-workspace');
  const initialCard = await rect(page, '.band-card');
  expect(Math.abs(initialOuter.bottom - (await rect(page, '.dev-lab-panel')).bottom)).toBeLessThan(1);
  expect((await rect(page, '.mode-tabs')).width).toBe(176);
  expect(initialOuter.right).toBe(initial.right);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  expect(await page.locator('.band-card').evaluateAll(cards => new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size)).toBe(1);
  const alignmentAt = () => page.evaluate(() => [...document.querySelectorAll('.filterbank-band-control')].map((control, index) => {
    const fb = control.querySelector('[data-feedback-band]').getBoundingClientRect();
    const card = document.querySelectorAll('.band-card')[index].getBoundingClientRect();
    return Math.abs((fb.left + fb.right) / 2 - (card.left + card.right) / 2);
  }));
  expect((await alignmentAt()).every(delta => delta < 1)).toBeTruthy();

  await page.setViewportSize({ width: 1440, height: 1000 });
  const resized = await rect(page, '.persistent-band-panel');
  const resizedOuter = await rect(page, '.persistent-band-control-panel');
  expect(resized.bottom).toBeGreaterThan(initial.bottom);
  expect(resized.top).toBeGreaterThan(initial.top);
  expect(resized.height).toBe(initial.height);
  expect((await rect(page, '.band-card')).height).toBe(initialCard.height);
  expect((await rect(page, '.mode-workspace')).height).toBeGreaterThan(initialWorkspace.height);
  expect(Math.abs(resizedOuter.bottom - (await rect(page, '.dev-lab-panel')).bottom)).toBeLessThan(1);
  expect((await alignmentAt()).every(delta => delta < 1)).toBeTruthy();

  await page.locator('[data-dev-lab-toggle]').click();
  await expect(page.locator('.dev-lab-panel')).toBeHidden();
  const hidden = await rect(page, '.persistent-band-control-panel');
  expect(hidden.top).toBe(resizedOuter.top);
  expect(hidden.bottom).toBe(resizedOuter.bottom);
  expect(hidden.height).toBe(resizedOuter.height);

  await page.locator('[data-dev-lab-toggle]').click();
  await expect(page.locator('.dev-lab-panel')).toBeVisible();
  expect(Math.abs((await rect(page, '.persistent-band-control-panel')).bottom - (await rect(page, '.dev-lab-panel')).bottom)).toBeLessThan(1);
});

test('tablet keeps the moved band controls at their existing responsive height', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.goto('/', { waitUntil: 'networkidle' });

  await expect(page.locator('.persistent-band-panel')).toBeVisible();
  await expect(page.locator('.persistent-band-control-panel')).toHaveCSS('display', 'contents');
  expect((await rect(page, '.bands')).height).toBeGreaterThanOrEqual(250);
  expect((await rect(page, '.band-card')).height).toBeGreaterThan(200);
  await page.locator('[data-mode="filter"]').click();
  await expect(page.locator('.persistent-band-panel')).toBeVisible();
});

test('desktop near the breakpoint keeps all ten bands and FILTER controls inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/', { waitUntil: 'networkidle' });
  expect((await rect(page, '.mode-tabs')).width).toBe(176);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
  expect(await page.locator('.band-card').evaluateAll(cards => new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size)).toBe(1);
  await page.locator('[data-mode="filter"]').click();
  const filterPanel = await rect(page, '.filter-mode-panel');
  const workspace = await rect(page, '.mode-workspace');
  expect(filterPanel.left).toBeGreaterThanOrEqual(workspace.left);
  expect(filterPanel.right).toBeLessThanOrEqual(workspace.right);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
});

test('moved FB, MOD and FB ALL controls retain state and remain FILTERBANK-only', async ({ page }) => {
  await page.goto('/');
  const feedback = page.locator('[data-feedback-band="3"]');
  const modulation = page.locator('[data-mod-band="3"]');
  const feedbackAll = page.locator('.filterbank-controls-panel .fb-all-toggle');

  await feedback.click();
  await modulation.click();
  await feedbackAll.click();
  await expect(feedback).toHaveAttribute('aria-pressed', 'true');
  await expect(modulation).toHaveAttribute('aria-pressed', 'true');
  await expect(feedbackAll).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return engine.feedbackBandLeft[3] && engine.feedbackBandRight[3] && engine.feedbackAllLeft && engine.feedbackAllRight;
  })).toBeTruthy();

  await page.locator('[data-mode="filter"]').click();
  await expect(page.locator('.filterbank-controls-panel')).toBeHidden();
  await expect(page.locator('.channel-mode-panel')).toBeVisible();
  await expect(page.locator('.band-card .band-action')).toHaveCount(0);

  await page.locator('[data-mode="filterbank"]').click();
  await expect(feedback).toHaveAttribute('aria-pressed', 'true');
  await expect(modulation).toHaveAttribute('aria-pressed', 'true');
  await expect(feedbackAll).toHaveAttribute('aria-pressed', 'true');
});
