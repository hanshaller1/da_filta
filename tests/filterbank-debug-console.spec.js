const { test, expect } = require('playwright/test');

test('DEV LAB structured debug console opens and remains an internal, passive surface', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const responseBefore = await page.locator('.fb-workspace').boundingBox();
  const before = await page.evaluate(() => ({ gain: document.querySelector('[data-control="inputGain"]').value, resonance: document.querySelector('[data-control="resonance"]').value, height: document.documentElement.scrollHeight }));
  await page.locator('[data-response-mode="dev-lab"]').click();
  const panel = page.locator('.response-dev-lab');
  await panel.locator('[data-debug-console-toggle]').click();
  const overlay = page.locator('[data-debug-console]');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('[data-debug-log]')).toBeVisible();
  expect(await overlay.evaluate(node => node.closest('.response-dev-lab') === null)).toBeTruthy();
  expect(await page.locator('.fb-workspace').boundingBox()).toEqual(responseBefore);
  await overlay.locator('[data-debug-clear]').click();
  await panel.locator('[data-dev-lab-freeze]').focus();
  await expect(page.locator('#dev-lab-tooltip')).toBeVisible();
  await expect(page.locator('#dev-lab-tooltip')).toContainText('sichtbaren DEV-LAB-Livewerte');
  await overlay.locator('[data-debug-console-close]').click();
  await expect(overlay).toBeHidden();
  await panel.locator('[data-debug-console-toggle]').click();
  await expect(overlay).toBeVisible();
  const after = await page.evaluate(() => ({ gain: document.querySelector('[data-control="inputGain"]').value, resonance: document.querySelector('[data-control="resonance"]').value, height: document.documentElement.scrollHeight }));
  expect(after.gain).toBe(before.gain); expect(after.resonance).toBe(before.resonance); expect(after.height).toBeLessThanOrEqual(before.height); expect(errors).toEqual([]);
});

test('MAIN RESETS L/R uses independent cumulative-counter baselines for reset and new audio sessions', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-response-mode="dev-lab"]').click();
  const packet = (leftResets, rightResets) => {
    const channel = resets => ({ frameCount: 1, resonanceTarget: 0, smoothedResonance: 0, feedbackTopology: 'common-bus', feedbackTap: 'post-gain', wetModel: 'filterbank-sum', commonBusSaturationMode: 'current', commonBusDrive: 1, commonBusCeiling: 1, commonFeedbackReturn: 0, commonTapSum: 0, mainCommonFeedbackReturn: 0, mainTapSum: 0, mainTapSumScaled: 0, mainFeedbackLevelScale: 1, commonSaturationInput: 0, commonSaturationOutput: 0, mainSaturationInput: 0, mainSaturationOutput: 0, saturationActiveFrames: 0, mainCommonNonFiniteResets: resets, bandEnergy: Array(10).fill(0), bandPeak: Array(10).fill(0), localGates: Array(10).fill(0) });
    return { left: channel(leftResets), right: channel(rightResets) };
  };
  const resetValue = () => page.locator('.response-dev-summary div').filter({ hasText: 'MAIN RESETS L/R' });

  await page.evaluate(packet => { window.FilterbankDebugConsole.startSession({ sampleRate: 48000, state: 'running' }); window.FilterbankDebugConsole.receive(packet); }, packet(11, 29));
  await expect(resetValue()).toContainText('0 / 0');
  await page.evaluate(packet => window.FilterbankDebugConsole.receive(packet), packet(12, 29));
  await expect(resetValue()).toContainText('1 / 0');
  await page.locator('[data-feedback-all-level]').selectOption('sqrt2');
  await page.evaluate(packet => window.FilterbankDebugConsole.receive(packet), packet(12, 29));
  await expect(resetValue()).toContainText('1 / 0');

  await page.locator('[data-dev-lab-reset]').click();
  await page.evaluate(packet => window.FilterbankDebugConsole.receive(packet), packet(12, 29));
  await expect(resetValue()).toContainText('0 / 0');
  await page.evaluate(packet => window.FilterbankDebugConsole.receive(packet), packet(13, 30));
  await expect(resetValue()).toContainText('1 / 1');

  await page.evaluate(packet => { window.FilterbankDebugConsole.startSession({ sampleRate: 44100, state: 'running' }); window.FilterbankDebugConsole.receive(packet); }, packet(0, 0));
  await expect(resetValue()).toContainText('0 / 0');
});

test('structured events are bounded, timestamped, passive and survive the diagnostic flow', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.locator('[data-response-mode="dev-lab"]').click();
  const panel = page.locator('.response-dev-lab');
  await panel.locator('[data-debug-console-toggle]').click();
  const packet = (dominant = 4, activity = 1) => {
    const channel = () => ({ frameCount: 100, sourcePeak: .5, sourceEnergy: 10, wetPeak: .6, wetEnergy: 12, wetDcSum: .2, resonanceTarget: .8, smoothedResonance: .79, feedbackTopology: 'common-bus', feedbackTap: 'post-gain', wetModel: 'filterbank-sum', commonBusSaturationMode: 'constant-ceiling', commonBusDrive: 2, commonBusCeiling: 1, commonFeedbackReturn: .25, commonTapSum: .5, mainCommonFeedbackReturn: .1, mainTapSum: .2, mainTapSumScaled: .2, mainFeedbackLevelScale: 1, commonSaturationInput: .7, commonSaturationOutput: .4, mainSaturationInput: .4, mainSaturationOutput: .2, saturationActiveFrames: activity * 100, mainCommonNonFiniteResets: 0, bandEnergy: Array.from({ length: 10 }, (_, index) => index === dominant ? 10 : 1), bandPeak: Array(10).fill(.1), localGates: Array(10).fill(0) });
    return { left: channel(), right: channel() };
  };
  await page.evaluate(packet => { window.FilterbankDebugConsole.startSession({ sampleRate: 48000, state: 'running' }); window.FilterbankDebugConsole.receive(packet); }, packet());
  const overlay = page.locator('[data-debug-console]');
  await expect(overlay.locator('[data-debug-log]')).toContainText('AUDIO START');
  await expect(overlay.locator('[data-debug-log]')).toContainText('SAT ACTIVITY');
  await panel.locator('[data-debug-mark]').click();
  await expect(overlay.locator('[data-debug-log]')).toContainText('USER MARK #1');
  const before = await page.evaluate(() => ({ resonance: document.querySelector('[data-control="resonance"]').value, gain: document.querySelector('[data-control="inputGain"]').value }));
  await panel.locator('[data-debug-snapshot]').click();
  await expect(overlay.locator('[data-debug-log]')).toContainText('SNAPSHOT #1');
  const after = await page.evaluate(() => ({ resonance: document.querySelector('[data-control="resonance"]').value, gain: document.querySelector('[data-control="inputGain"]').value }));
  expect(after).toEqual(before);
  await page.evaluate(packet => window.FilterbankDebugConsole.receive(packet), packet(5));
  await expect(overlay.locator('[data-debug-log]')).toContainText('DOMINANT BAND');
  await page.waitForTimeout(3050);
  await page.evaluate(packet => window.FilterbankDebugConsole.receive(packet), packet(5));
  await expect(overlay.locator('[data-debug-log]')).toContainText('DOMINANT STABLE');
  await expect(overlay.locator('[data-debug-max]')).toContainText('SAT ACT');
  await overlay.locator('[data-debug-copy]').click();
  await expect(overlay.locator('[data-debug-copy-state]')).toHaveText('COPIED');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('FILTERBANK DEBUG REPORT'); expect(copied).toContain('AUDIO START');
  const count = await page.evaluate(() => { for (let index = 0; index < 1005; index += 1) window.FilterbankDebugConsole.logEvent(`TEST ${index}`); return window.FilterbankDebugConsole.eventCount(); });
  expect(count).toBe(1000);
  await page.evaluate(() => window.FilterbankDebugConsole.setAudioOff());
  await expect(overlay.locator('[data-debug-log]')).toContainText('AUDIO STOP');
  await page.evaluate(() => window.FilterbankDebugConsole.startSession({ sampleRate: 44100, state: 'running' }));
  await expect(overlay.locator('[data-debug-log]')).toContainText('SR 44100 Hz');
});

test('DEBUG CONSOLE is draggable and resizable without changing response layout', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 }); await page.goto('/');
  await page.locator('[data-response-mode="dev-lab"]').click();
  const response = page.locator('.fb-workspace'); const before = await response.boundingBox();
  await page.locator('[data-debug-console-toggle]').click(); const overlay = page.locator('[data-debug-console]');
  const initial = await overlay.boundingBox(); const header = overlay.locator('[data-debug-console-drag-handle]'); const headerBox = await header.boundingBox();
  await page.mouse.move(headerBox.x + 18, headerBox.y + 12); await page.mouse.down(); await page.mouse.move(headerBox.x - 170, headerBox.y - 110, { steps: 3 }); await page.mouse.up();
  const moved = await overlay.boundingBox(); expect(moved.x).toBeLessThan(initial.x); expect(moved.y).toBeLessThan(initial.y); expect(await response.boundingBox()).toEqual(before);
  const clear = overlay.locator('[data-debug-clear]'); const clearBox = await clear.boundingBox(); const beforeButton = await overlay.boundingBox(); await page.mouse.click(clearBox.x + 4, clearBox.y + 4); expect(await overlay.boundingBox()).toEqual(beforeButton);
  const grip = overlay.locator('[data-debug-console-resize]'); const gripBox = await grip.boundingBox(); await page.mouse.move(gripBox.x + 5, gripBox.y + 5); await page.mouse.down(); await page.mouse.move(gripBox.x - 500, gripBox.y - 500, { steps: 3 }); await page.mouse.up();
  const minimum = await overlay.boundingBox(); expect(minimum.width).toBeGreaterThanOrEqual(500); expect(minimum.height).toBeGreaterThanOrEqual(280);
  await page.setViewportSize({ width: 620, height: 420 }); const viewport = await page.evaluate(() => { window.dispatchEvent(new Event('resize')); return { width: window.innerWidth, height: window.innerHeight }; }); const clamped = await overlay.boundingBox(); expect(clamped.x).toBeGreaterThanOrEqual(12); expect(clamped.y).toBeGreaterThanOrEqual(12); expect(clamped.x + clamped.width).toBeLessThanOrEqual(viewport.width - 12); expect(clamped.y + clamped.height).toBeLessThanOrEqual(viewport.height - 12);
  const remembered = await overlay.boundingBox(); await overlay.locator('[data-debug-console-close]').click(); await page.evaluate(() => document.querySelector('[data-debug-console-toggle]').click()); expect(await overlay.boundingBox()).toEqual(remembered);
});
