const { test, expect } = require('playwright/test');

test('KEY STEP and KEY SPEED control only held keyboard band-fader movement', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  if (await page.locator('[data-dev-lab-panel]').isHidden()) await page.locator('[data-dev-lab-toggle]').click();
  const step = page.locator('[data-key-step-percent]');
  const speed = page.locator('[data-key-speed-hz]');
  const faders = page.locator('.band-fader');
  const setPreference = async (input, value) => { await input.fill(value); await input.blur(); };
  const reset = async () => { for (let index = 0; index < 10; index += 1) await faders.nth(index).fill('0'); };

  for (const [percent, expected] of [['0.1', '0.2'], ['1', '2'], ['5', '10'], ['25', '50'], ['50', '100'], ['100', '100']]) {
    await reset(); await setPreference(step, percent); await page.keyboard.press('KeyQ');
    await expect(faders.nth(0)).toHaveValue(expected);
  }

  await setPreference(step, '100'); await faders.nth(0).fill('40');
  await page.keyboard.press('KeyQ'); await expect(faders.nth(0)).toHaveValue('100');
  await page.keyboard.press('KeyA'); await expect(faders.nth(0)).toHaveValue('-100');

  await setPreference(step, '0'); await expect(step).toHaveValue('0.1');
  await setPreference(step, '-10'); await expect(step).toHaveValue('0.1');
  await setPreference(step, '150'); await expect(step).toHaveValue('100');
  await step.fill(''); await step.blur(); await expect(step).toHaveValue('100');
  await setPreference(speed, '0'); await expect(speed).toHaveValue('1');
  await setPreference(speed, '-10'); await expect(speed).toHaveValue('1');
  await setPreference(speed, '100'); await expect(speed).toHaveValue('60');
  await speed.fill(''); await speed.blur(); await expect(speed).toHaveValue('60');

  await reset(); await setPreference(step, '5'); await setPreference(speed, '1');
  await page.keyboard.down('KeyQ'); await expect(faders.nth(0)).toHaveValue('10');
  await page.waitForTimeout(150); await expect(faders.nth(0)).toHaveValue('10');
  await page.waitForTimeout(1000); expect(Number(await faders.nth(0).inputValue())).toBeGreaterThan(10);
  await page.keyboard.up('KeyQ');

  await reset(); await setPreference(speed, '10'); await page.keyboard.down('KeyQ'); await page.waitForTimeout(220); expect(Number(await faders.nth(0).inputValue())).toBeGreaterThan(10); await page.keyboard.up('KeyQ');
  await reset(); await setPreference(speed, '30'); await page.keyboard.down('KeyQ'); await page.waitForTimeout(100); expect(Number(await faders.nth(0).inputValue())).toBeGreaterThan(10); await page.keyboard.up('KeyQ');
  await reset(); await setPreference(speed, '60'); await page.keyboard.down('KeyQ'); await page.waitForTimeout(100); expect(Number(await faders.nth(0).inputValue())).toBeGreaterThan(10); await page.keyboard.up('KeyQ');

  await reset(); await setPreference(step, '5'); await setPreference(speed, '1');
  await page.keyboard.down('KeyQ'); await page.keyboard.down('KeyW');
  await expect(faders.nth(0)).toHaveValue('10'); await expect(faders.nth(1)).toHaveValue('10');
  await page.keyboard.up('KeyQ'); await page.keyboard.up('KeyW');
  await reset(); await page.keyboard.down('KeyQ'); await page.keyboard.down('KeyS');
  await expect(faders.nth(0)).toHaveValue('10'); await expect(faders.nth(1)).toHaveValue('-10');
  await page.keyboard.up('KeyQ'); await page.keyboard.up('KeyS');
  await reset(); await page.keyboard.down('KeyQ'); await page.keyboard.down('KeyW'); await page.keyboard.down('KeyE');
  await expect(faders.nth(0)).toHaveValue('10'); await expect(faders.nth(1)).toHaveValue('10'); await expect(faders.nth(2)).toHaveValue('10');
  await page.keyboard.up('KeyQ'); await page.keyboard.up('KeyW'); await page.keyboard.up('KeyE');

  await reset(); await setPreference(step, '1'); await setPreference(speed, '1');
  await page.keyboard.down('KeyQ'); await expect(faders.nth(0)).toHaveValue('2');
  await setPreference(step, '25'); await setPreference(speed, '60'); await page.waitForTimeout(100);
  expect(Number(await faders.nth(0).inputValue())).toBeGreaterThan(2);
  await page.keyboard.up('KeyQ'); const stopped = await faders.nth(0).inputValue(); await page.waitForTimeout(100); await expect(faders.nth(0)).toHaveValue(stopped);

  await setPreference(step, '12.5'); await setPreference(speed, '10');
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.locator('[data-dev-lab-panel]').isHidden()) await page.locator('[data-dev-lab-toggle]').click();
  await expect(page.locator('[data-key-step-percent]')).toHaveValue('12.5');
  await expect(page.locator('[data-key-speed-hz]')).toHaveValue('10');
});
