const { test, expect } = require('playwright/test');

test('held band-fader shortcuts move every pressed key independently and stop safely', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const faders = page.locator('.band-fader:not([data-channel])');
  const values = () => faders.evaluateAll(sliders => sliders.map(slider => Number(slider.value)));
  const reset = async () => {
    for (let index = 0; index < 10; index += 1) await faders.nth(index).fill('0');
  };

  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(90);
  let current = await values();
  expect(current[0]).toBeGreaterThan(10);
  expect(current.slice(1)).toEqual(Array(9).fill(0));
  await page.keyboard.up('KeyQ');
  const stoppedQ = (await values())[0];
  await page.waitForTimeout(90);
  expect((await values())[0]).toBe(stoppedQ);

  await reset();
  await page.keyboard.down('KeyQ');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(90);
  current = await values();
  expect(current.slice(0, 3).every(value => value > 10)).toBeTruthy();
  expect(current.slice(3)).toEqual(Array(7).fill(0));
  await page.keyboard.up('KeyQ');
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyE');

  await reset();
  await page.keyboard.down('KeyQ');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(90);
  current = await values();
  expect(current[0]).toBeGreaterThan(10);
  expect(current[1]).toBeLessThan(-10);
  await page.keyboard.up('KeyQ');
  const stoppedFirstBand = (await values())[0];
  await page.waitForTimeout(90);
  current = await values();
  expect(current[0]).toBe(stoppedFirstBand);
  expect(current[1]).toBeLessThan(-10);
  await page.keyboard.up('KeyS');

  await reset();
  await page.keyboard.down('KeyQ');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(90);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const beforeBlurWait = await values();
  await page.waitForTimeout(90);
  expect(await values()).toEqual(beforeBlurWait);

  await reset();
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'text'; input.id = 'keyboard-shortcut-text-target'; document.body.append(input); input.focus();
  });
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(90);
  await page.keyboard.up('KeyQ');
  expect(await values()).toEqual(Array(10).fill(0));

  await page.locator('.analyzer').click();
  const feedback = page.locator('[data-feedback-band="0"]');
  const modulation = page.locator('[data-mod-band="0"]');
  await page.keyboard.press('Digit1');
  await expect(feedback).toHaveClass(/active/);
  await page.keyboard.press('Shift+Digit1');
  await expect(modulation).toBeDisabled();
  await expect(modulation).not.toHaveClass(/active/);
  await expect(feedback).toHaveClass(/active/);
});
