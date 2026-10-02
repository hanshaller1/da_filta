const { test, expect } = require('playwright/test');
const list = (page, family) => page.locator(`[data-${family}-assignments] > [data-assignment-id]`);
const amount = (row, family, value) => row.locator(`[data-${family}-amount]`).evaluate((element, value) => {
  element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

test('Envelope shares the compact multi-target editor and restores assignment IDs through snapshots @smoke', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="envelope-follower"]').click();
  await page.locator('[data-module-power="envelope-follower"]').click();
  await page.locator('[data-envelope-enable]').click();
  await list(page, 'envelope').first().locator('[data-envelope-target]').selectOption('filterbank.band.4.gainDb');
  await list(page, 'envelope').first().locator('[data-envelope-channel]').selectOption('spread');
  await amount(list(page, 'envelope').first(), 'envelope', 25);
  await list(page, 'envelope').first().locator('[data-envelope-assignment-invert]').check();
  for (const target of ['filter.frequencyHz', 'dynamicEq.thresholdDb', 'filterbank.band.4.gainDb']) {
    await page.locator('[data-envelope-add-assignment]').click();
    await list(page, 'envelope').last().locator('[data-envelope-target]').selectOption(target);
    await amount(list(page, 'envelope').last(), 'envelope', 15);
  }
  await expect(list(page, 'envelope')).toHaveCount(4);
  await expect(list(page, 'envelope').nth(1)).toHaveAttribute('data-assignment-status', 'target-unavailable');
  const saved = (await page.evaluate(() => window.EnvelopeMode.getState())).envelopeSources[0].assignments;
  await page.locator('[data-mode="filter"]').click(); await page.locator('[data-module-power="filter"]').click();
  await page.locator('[data-mode="envelope-follower"]').click();
  await expect(list(page, 'envelope').nth(1)).toHaveAttribute('data-assignment-status', 'active');
  await expect(list(page, 'envelope').nth(1).locator('[data-envelope-channel]')).toBeDisabled();
  await page.locator('[data-dev-lab-group="sweetspots"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-sweetspot-save="A"]').click();
  await list(page, 'envelope').first().locator('[data-envelope-assignment-remove]').click();
  await list(page, 'envelope').first().locator('[data-envelope-assignment-enable]').click();
  await page.locator('[data-sweetspot-load="A"]').click();
  expect((await page.evaluate(() => window.EnvelopeMode.getState())).envelopeSources[0].assignments).toEqual(saved);
  for (const width of [1914, 1440, 1024, 560]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator('#mode-envelope-follower').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width);
    const parameters = await page.locator('.envelope-parameter-grid').evaluate(element => ({
      height: element.clientHeight, scroll: element.scrollHeight, bottom: element.getBoundingClientRect().bottom,
      assignmentsTop: document.querySelector('[data-envelope-assignments]').getBoundingClientRect().top
    }));
    expect(parameters.scroll).toBeLessThanOrEqual(parameters.height + 1);
    expect(parameters.assignmentsTop).toBeGreaterThanOrEqual(parameters.bottom);
    await expect(page.locator('[data-envelope-add-assignment]')).toBeVisible();
  }
});

test('LFO picker prevents self/multi-hop cycles and meta rate automatically reactivates after Sync', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-mode="lfo"]').click();
  await page.locator('[data-module-power="lfo"]').click(); await page.locator('[data-lfo-source-enable]').click();
  await expect(list(page, 'lfo').first().locator('option[value="lfo.1.rate"]')).toHaveJSProperty('disabled', true);
  await list(page, 'lfo').first().locator('[data-lfo-target]').selectOption('lfo.2.rate');
  await amount(list(page, 'lfo').first(), 'lfo', 20);
  const id = await list(page, 'lfo').first().getAttribute('data-assignment-id');
  await expect(list(page, 'lfo').first()).toHaveAttribute('data-assignment-status', 'target-unavailable');
  await page.locator('[data-lfo-slot="1"]').click(); await page.locator('[data-lfo-source-enable]').click();
  await expect(list(page, 'lfo').first().locator('option[value="lfo.1.rate"]')).toHaveJSProperty('disabled', true);
  await list(page, 'lfo').first().locator('[data-lfo-target]').selectOption('envelope.1.attack');
  await page.locator('[data-mode="envelope-follower"]').click();
  await expect(list(page, 'envelope').first().locator('option[value="lfo.1.rate"]')).toHaveJSProperty('disabled', true);
  await page.locator('[data-mode="lfo"]').click(); await page.locator('[data-lfo-rate-mode="sync"]').click();
  await page.locator('[data-lfo-slot="0"]').click();
  await expect(list(page, 'lfo').first()).toHaveAttribute('data-assignment-status', 'target-unavailable');
  await page.locator('[data-lfo-slot="1"]').click(); await page.locator('[data-lfo-rate-mode="free"]').click();
  await page.locator('[data-lfo-slot="0"]').click();
  await expect(list(page, 'lfo').first()).toHaveAttribute('data-assignment-status', 'active');
  await expect(list(page, 'lfo').first()).toHaveAttribute('data-assignment-id', id);
  await page.locator('[data-lfo-slot="1"]').click();
  await page.evaluate(() => window.LfoMode.getAudioEngine().onLfoTelemetry({ sourceId: 'lfo.2',
    enabled: true, phase: .25, rateHz: 8, value: .5 }));
  await expect(page.locator('[data-lfo-phase-readout]')).toContainText('8.00 Hz');
  expect((await page.evaluate(() => window.LfoMode.getState())).lfoSources[1].rateHz).toBe(1);
});

test('Clock editor preserves ten hold routes and supports independent audio and meta assignments', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-mode="clock-mod"]').click();
  await expect(list(page, 'clock-mod')).toHaveCount(10);
  const saved = await page.evaluate(() => window.ClockModMode.getState().assignments);
  await page.locator('[data-clock-mod-add-assignment]').click();
  await list(page, 'clock-mod').last().locator('[data-clock-mod-target]').selectOption('lfo.2.rate');
  await amount(list(page, 'clock-mod').last(), 'clock-mod', 20);
  await list(page, 'clock-mod').last().locator('[data-clock-mod-hold]').selectOption('clockMod.1.band.3');
  await expect(list(page, 'clock-mod').last().locator('[data-clock-mod-channel]')).toBeDisabled();
  const routes = await page.evaluate(() => window.ClockModMode.getState().assignments);
  expect(routes.slice(0, 10)).toEqual(saved);
  expect(routes[10]).toMatchObject({ sourceId: 'clockMod.1.band.3', targetId: 'lfo.2.rate', amount: 20 });
  await expect(list(page, 'clock-mod').last()).toHaveAttribute('data-assignment-status', 'target-unavailable');
  await page.locator('[data-module-power="clock-mod"]').click();
  await page.locator('[data-mode="lfo"]').click(); await page.locator('[data-module-power="lfo"]').click();
  await page.locator('[data-lfo-slot="1"]').click(); await page.locator('[data-lfo-source-enable]').click();
  await page.locator('[data-mode="clock-mod"]').click();
  await expect(list(page, 'clock-mod').last()).toHaveAttribute('data-assignment-status', 'active');
  await expect(list(page, 'clock-mod').last()).toHaveAttribute('data-assignment-id', routes[10].id);
  await list(page, 'clock-mod').first().locator('[data-clock-mod-assignment-enable]').click();
  await expect(list(page, 'clock-mod').first()).toHaveAttribute('data-assignment-status', 'assignment-disabled');
  await list(page, 'clock-mod').last().locator('[data-clock-mod-assignment-remove]').click();
  await expect(list(page, 'clock-mod')).toHaveCount(10);
  for (const width of [1914, 1440, 1024, 560]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator('#mode-clock-mod').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width);
    await expect(page.locator('[data-clock-mod-add-assignment]')).toBeVisible();
  }
});

test('restored cyclic assignments remain saved and visibly blocked without erasing the legal graph', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('da-filta-sweetspots-v1', JSON.stringify({ version: 1, slots: {
    A: { name: 'Cyclic graph', state: { lfoModuleEnabled: true, envelopeModuleEnabled: true,
      lfoSources: [{ enabled: true, assignments: [{ id: 'a', targetId: 'lfo.2.rate', amount: 20 }] },
        { enabled: true, assignments: [{ id: 'b', targetId: 'envelope.1.attack', amount: 20 }] }],
      envelopeSources: [{ enabled: true, assignments: [{ id: 'c', targetId: 'lfo.1.rate', amount: 20 }] }] } }
  } })));
  await page.goto('/');
  await page.locator('[data-dev-lab-group="sweetspots"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-sweetspot-load="A"]').click(); await page.locator('[data-mode="lfo"]').click();
  // Stable lexical edge compilation blocks b, while a and c stay legal.
  await expect(list(page, 'lfo').first()).toHaveAttribute('data-assignment-status', 'active');
  await page.locator('[data-lfo-slot="1"]').click();
  await expect(list(page, 'lfo').first()).toHaveAttribute('data-assignment-status', 'cycle-blocked');
  await expect(page.locator('[data-lfo-slot="1"]')).toHaveAttribute('data-lost-targets', '1');
  await expect(list(page, 'lfo').first().locator('[data-lfo-target]')).toHaveValue('envelope.1.attack');
  await page.locator('[data-sweetspot-save="B"]').click();
  await list(page, 'lfo').first().locator('[data-lfo-assignment-remove]').click();
  await page.locator('[data-sweetspot-load="B"]').click();
  await expect(list(page, 'lfo').first()).toHaveAttribute('data-assignment-id', 'b');
  await expect(list(page, 'lfo').first()).toHaveAttribute('data-assignment-status', 'cycle-blocked');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('da-filta-sweetspots-v1')).slots.B.state);
  expect(saved.lfoSources[0].assignments[0].id).toBe('a');
  expect(saved.lfoSources[1].assignments[0].id).toBe('b');
  expect(saved.envelopeSources[0].assignments[0].id).toBe('c');
});
