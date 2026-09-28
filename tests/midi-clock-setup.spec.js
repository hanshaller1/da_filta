const { test, expect } = require('playwright/test');

const midiFixture = `() => {
  const makeInput = (id, name) => ({ id, name, manufacturer: 'Test', state: 'connected', onmidimessage: null });
  const a = makeInput('clock-a', 'Clock A');
  const b = makeInput('clock-b', 'Clock B');
  const access = { inputs: new Map([[a.id, a], [b.id, b]]), onstatechange: null };
  window.__midiInputs = { a, b };
  window.__midiAccess = access;
  window.__midiRequests = 0;
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__midiRequests += 1; return access; } });
}`;

async function enableMidi(page) {
  await page.locator('[data-midi-setup].midi-setup-button').click();
  await expect(page.locator('[data-midi-access-status]')).toHaveText('NOT GRANTED');
  expect(await page.evaluate(() => window.__midiRequests)).toBe(0);
  await page.locator('[data-midi-enable]').click();
  await expect(page.locator('[data-midi-access-status]')).toHaveText('CONNECTED');
}

async function closeMidi(page) {
  await page.locator('.midi-dialog-close').click();
  await expect(page.locator('[data-midi-dialog]')).not.toBeVisible();
}

async function sendPulses(page, inputName, count = 30, start = 0, interval = 20.833) {
  await page.evaluate(({ inputName, count, start, interval }) => {
    const input = window.__midiInputs[inputName];
    for (let index = 0; index < count; index += 1) input.onmidimessage?.({ data: [0xf8], timeStamp: start + index * interval });
  }, { inputName, count, start, interval });
}

test('MIDI dialog opens globally from masthead and LFO setup without requesting access', async ({ page }) => {
  await page.addInitScript(`(${midiFixture})()`);
  await page.goto('/');
  await page.locator('[data-midi-setup].midi-setup-button').click();
  await expect(page.locator('[data-midi-dialog]')).toBeVisible();
  await expect(page.locator('#midi-dialog-title')).toHaveText('MIDI SETUP');
  await expect(page.locator('[data-midi-access-status]')).toHaveText('NOT GRANTED');
  expect(await page.evaluate(() => window.__midiRequests)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-midi-dialog]')).not.toBeVisible();
  await page.locator('[data-mode="lfo"]').click();
  await page.locator('.lfo-midi-setup').click();
  await expect(page.locator('[data-midi-dialog]')).toBeVisible();
  expect(await page.evaluate(() => window.__midiRequests)).toBe(0);
  for (const viewport of [{ width: 1914, height: 907 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    const bounds = await page.locator('[data-midi-dialog]').evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, scrollWidth: dialog.scrollWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width + 1);
  }
});

test('only the selected input drives clock, and switching inputs clears lock and listeners', async ({ page }) => {
  await page.addInitScript(`(${midiFixture})()`);
  await page.goto('/');
  await enableMidi(page);
  await page.locator('[data-midi-input]').selectOption('clock-a');
  await expect(page.locator('.midi-setup-button')).toHaveClass(/midi-status-warning/);
  await page.locator('[data-midi-transport]').selectOption('auto');
  await closeMidi(page);
  await page.locator('[data-mode="lfo"]').click();
  await page.locator('[data-lfo-rate-mode="sync"]').click();
  await page.locator('[data-lfo-clock-source]').selectOption('midi');
  await sendPulses(page, 'b');
  await expect(page.locator('[data-midi-clock-status]')).toHaveText('NO CLOCK');
  await sendPulses(page, 'a');
  await expect(page.locator('[data-midi-clock-status]')).toHaveText('LOCKED');
  await expect(page.locator('[data-midi-tempo]')).toHaveText('120.0 BPM');
  await expect(page.locator('.midi-setup-button')).toHaveClass(/midi-status-active/);
  await sendPulses(page, 'a', 30, 3000, 19.8413);
  await expect(page.locator('[data-midi-tempo]')).toHaveText('126.0 BPM');
  await page.evaluate(() => {
    let timestamp = 4000;
    for (const interval of [19.2, 20.4, 19.5, 20.2, 19.8, 20.1, 19.4, 20.3]) {
      window.__midiInputs.a.onmidimessage({ data: [0xf8], timeStamp: timestamp });
      timestamp += interval;
    }
  });
  const tempoAfterJitter = await page.locator('[data-midi-tempo]').textContent();
  expect(Number.parseFloat(tempoAfterJitter)).toBeGreaterThan(124);
  expect(Number.parseFloat(tempoAfterJitter)).toBeLessThan(128);
  await page.locator('[data-midi-setup].midi-setup-button').click();
  await page.locator('[data-midi-input]').selectOption('clock-b');
  await expect(page.locator('[data-midi-clock-status]')).toHaveText('NO CLOCK');
  await sendPulses(page, 'a');
  await expect(page.locator('[data-midi-clock-status]')).toHaveText('NO CLOCK');
  await sendPulses(page, 'b');
  await expect(page.locator('[data-midi-clock-status]')).toHaveText('LOCKED');
});

test('FOLLOW START / STOP and CLOCK AUTO-RUN apply their transport semantics', async ({ page }) => {
  await page.addInitScript(`(${midiFixture})()`);
  await page.goto('/');
  await enableMidi(page);
  await page.locator('[data-midi-input]').selectOption('clock-a');
  await closeMidi(page);
  await page.locator('[data-mode="lfo"]').click();
  await page.locator('[data-lfo-rate-mode="sync"]').click();
  await page.locator('[data-lfo-clock-source]').selectOption('midi');
  await page.evaluate(() => {
    let timestamp = 0;
    for (let index = 0; index < 30; index += 1) {
      window.__midiInputs.a.onmidimessage({ data: [0xf8], timeStamp: timestamp });
      timestamp += 20.833;
    }
  });
  expect((await page.evaluate(() => window.LfoMode.getState().lfoClock)).running).toBe(false);
  await expect(page.locator('[data-midi-transport-status]')).toHaveText('—');
  await page.evaluate(() => window.__midiInputs.a.onmidimessage({ data: [0xfa], timeStamp: 1000 }));
  expect((await page.evaluate(() => window.LfoMode.getState().lfoClock)).running).toBe(true);
  await page.evaluate(() => window.__midiInputs.a.onmidimessage({ data: [0xfc], timeStamp: 1001 }));
  expect((await page.evaluate(() => window.LfoMode.getState().lfoClock)).running).toBe(false);
  await page.locator('[data-midi-setup].midi-setup-button').click();
  await page.locator('[data-midi-transport]').selectOption('auto');
  await closeMidi(page);
  await sendPulses(page, 'a', 30, 2000);
  expect((await page.evaluate(() => window.LfoMode.getState().lfoClock)).running).toBe(true);
  await page.evaluate(() => window.__midiInputs.a.onmidimessage({ data: [0xfc], timeStamp: 3000 }));
  expect((await page.evaluate(() => window.LfoMode.getState().lfoClock)).running).toBe(false);
  await expect(page.locator('[data-midi-clock-status]')).toHaveText('STOPPED');
  await sendPulses(page, 'a', 4, 4000);
  expect((await page.evaluate(() => window.LfoMode.getState().lfoClock)).running).toBe(true);
});

test('no input, unavailable API, denied permission, receive toggle, hotplug, and masthead status stay usable', async ({ browser }) => {
  const unavailable = await browser.newPage();
  await unavailable.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined }));
  await unavailable.goto('/');
  await unavailable.locator('[data-midi-setup].midi-setup-button').click();
  await expect(unavailable.locator('[data-midi-access-status]')).toHaveText('UNAVAILABLE');
  await expect(unavailable.locator('[data-midi-enable]')).toBeEnabled();
  await unavailable.close();

  const denied = await browser.newPage();
  await denied.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { throw new DOMException('denied', 'NotAllowedError'); } }));
  await denied.goto('/');
  await denied.locator('[data-midi-setup].midi-setup-button').click();
  await denied.locator('[data-midi-enable]').click();
  await expect(denied.locator('[data-midi-access-status]')).toHaveText('NOT GRANTED');
  await expect(denied.locator('[data-midi-access-message]')).toContainText('Try again');
  await expect(denied.locator('[data-midi-enable]')).toBeEnabled();
  await denied.close();

  const page = await browser.newPage();
  await page.addInitScript(`(${midiFixture})()`);
  await page.goto('/');
  await enableMidi(page);
  await page.locator('[data-midi-input]').selectOption('clock-a');
  await page.locator('[data-midi-receive]').uncheck();
  await sendPulses(page, 'a');
  await expect(page.locator('[data-midi-clock-status]')).toHaveText('DISABLED');
  await page.locator('[data-midi-receive]').check();
  await page.evaluate(() => { window.__midiAccess.inputs.delete('clock-a'); window.__midiInputs.a.state = 'disconnected'; window.__midiAccess.onstatechange?.({ port: window.__midiInputs.a }); });
  await expect(page.locator('[data-midi-input]')).toHaveValue('');
  await expect(page.locator('[data-midi-input] option[value="clock-b"]')).toHaveCount(1);
  await expect(page.locator('[data-midi-clock-status]')).toHaveText('NO INPUT');
  await expect(page.locator('.midi-setup-button')).toHaveClass(/midi-status-neutral/);
  await expect(page.locator('.midi-setup-button')).toHaveAttribute('aria-label', 'MIDI Setup');
  await page.close();
});
