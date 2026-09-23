const { test, expect } = require('playwright/test');

const rect = (page, selector) => page.locator(selector).first().evaluate(element => {
  const bounds = element.getBoundingClientRect();
  return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left, width: bounds.width, height: bounds.height };
});

test('desktop keeps permanent band controls aligned and stable across every workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const workspace = await rect(page, '.mode-workspace');
  const panel = await rect(page, '.persistent-band-panel');
  const devLab = await rect(page, '.dev-lab-panel');
  const graph = await rect(page, '.fb-workspace');
  const firstCard = await rect(page, '.band-card');
  const panelGap = Number(await page.locator('.console').evaluate(element => getComputedStyle(element).getPropertyValue('--panel-gap').replace('px', '')));

  expect(Math.abs(panel.left - workspace.left)).toBeLessThan(1);
  expect(Math.abs(panel.right - workspace.right)).toBeLessThan(1);
  expect(Math.abs(panel.bottom - devLab.bottom)).toBeLessThan(1);
  expect(Math.abs((workspace.bottom + panelGap) - panel.top)).toBeLessThan(1);
  expect(Math.abs(graph.top - (workspace.top + 8))).toBeLessThan(1);
  expect(workspace.bottom - graph.bottom).toBeLessThanOrEqual(8);
  expect(graph.height).toBeGreaterThan(300);
  await expect(page.locator('.filterbank-panel-header')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(907);

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
  const initialWorkspace = await rect(page, '.mode-workspace');
  const initialCard = await rect(page, '.band-card');
  expect(Math.abs(initial.bottom - (await rect(page, '.dev-lab-panel')).bottom)).toBeLessThan(1);

  await page.setViewportSize({ width: 1440, height: 1000 });
  const resized = await rect(page, '.persistent-band-panel');
  expect(resized.bottom).toBeGreaterThan(initial.bottom);
  expect(resized.top).toBeGreaterThan(initial.top);
  expect(resized.height).toBe(initial.height);
  expect((await rect(page, '.band-card')).height).toBe(initialCard.height);
  expect((await rect(page, '.mode-workspace')).height).toBeGreaterThan(initialWorkspace.height);
  expect(Math.abs(resized.bottom - (await rect(page, '.dev-lab-panel')).bottom)).toBeLessThan(1);

  await page.locator('[data-dev-lab-toggle]').click();
  await expect(page.locator('.dev-lab-panel')).toBeHidden();
  const hidden = await rect(page, '.persistent-band-panel');
  expect(hidden.top).toBe(resized.top);
  expect(hidden.bottom).toBe(resized.bottom);
  expect(hidden.height).toBe(resized.height);

  await page.locator('[data-dev-lab-toggle]').click();
  await expect(page.locator('.dev-lab-panel')).toBeVisible();
  expect(Math.abs((await rect(page, '.persistent-band-panel')).bottom - (await rect(page, '.dev-lab-panel')).bottom)).toBeLessThan(1);
});

test('tablet keeps the moved band controls at their existing responsive height', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.goto('/', { waitUntil: 'networkidle' });

  await expect(page.locator('.persistent-band-panel')).toBeVisible();
  expect((await rect(page, '.bands')).height).toBeGreaterThanOrEqual(250);
  expect((await rect(page, '.band-card')).height).toBeGreaterThan(200);
  await page.locator('[data-mode="filter"]').click();
  await expect(page.locator('.persistent-band-panel')).toBeVisible();
});
