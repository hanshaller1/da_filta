const { test, expect } = require('playwright/test');

const transparent = value => value === 'transparent' || value === 'rgba(0, 0, 0, 0)';

test('tablet slider hit zones are invisible, enlarged, and kept within their bands', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const geometry = await page.evaluate(() => {
    const rect = element => {
      const { x, y, width, height, left, right, top, bottom } = element.getBoundingClientRect();
      return { x, y, width, height, left, right, top, bottom };
    };
    const globalInputs = [...document.querySelectorAll('.range-hit-area > input[type=range]')];
    const bandAreas = [...document.querySelectorAll('.fader-hit-area')].map(area => ({
      rect: rect(area),
      card: rect(area.closest('.band-card')),
      track: rect(area.closest('.fader-track')),
      background: getComputedStyle(area).backgroundColor,
      inputBackground: getComputedStyle(area.querySelector('.band-fader')).backgroundColor,
      touchAction: getComputedStyle(area).touchAction
    }));
    return {
      globalCount: globalInputs.length,
      globalHeights: globalInputs.map(input => input.getBoundingClientRect().height),
      globalBackgrounds: globalInputs.map(input => getComputedStyle(input).backgroundColor),
      globalTouchActions: globalInputs.map(input => getComputedStyle(input).touchAction),
      bandAreas,
      sliderRules: [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]).map(rule => rule.cssText).join('\\n')
    };
  });

  expect(geometry.globalCount).toBe(5);
  expect(geometry.globalHeights.every(height => height >= 44)).toBeTruthy();
  expect(geometry.globalBackgrounds.every(transparent)).toBeTruthy();
  expect(geometry.globalTouchActions.every(value => value === 'none')).toBeTruthy();
  expect(geometry.bandAreas).toHaveLength(10);
  expect(geometry.bandAreas.every(({ rect, card, track, background, inputBackground, touchAction }) =>
    rect.width === 44 &&
    rect.left >= card.left &&
    rect.right <= card.right &&
    track.width === 10 &&
    transparent(background) &&
    transparent(inputBackground) &&
    touchAction === 'none'
  )).toBeTruthy();
  for (let index = 1; index < geometry.bandAreas.length; index += 1) {
    expect(geometry.bandAreas[index - 1].rect.right).toBeLessThanOrEqual(geometry.bandAreas[index].rect.left);
  }
  expect(geometry.sliderRules).toContain('.band-fader::-webkit-slider-thumb');
  expect(geometry.sliderRules).toContain('width: 16px');
  expect(geometry.sliderRules).toContain('height: 25px');
  expect(geometry.sliderRules).toContain('::-webkit-slider-runnable-track');

  for (const control of ['inputGain', 'resonance', 'dryWet', 'spread', 'volume']) {
    const global = page.locator(`[data-control="${control}"]`);
    const globalBox = await global.boundingBox();
    expect(globalBox).not.toBeNull();
    await page.mouse.move(globalBox.x + globalBox.width * 0.2, globalBox.y + 4);
    await page.mouse.down();
    await page.mouse.move(globalBox.x + globalBox.width * 0.8, globalBox.y + 4, { steps: 8 });
    await page.mouse.up();
    expect(await global.inputValue()).not.toBe(control === 'volume' ? '-6' : control === 'dryWet' ? '50' : '0');
  }

  const faders = page.locator('.band-fader');
  const before = await Promise.all([faders.nth(3).inputValue(), faders.nth(5).inputValue()]);
  const band = faders.nth(4);
  const bandBox = await band.boundingBox();
  expect(bandBox).not.toBeNull();
  await page.mouse.move(bandBox.x + 4, bandBox.y + bandBox.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(bandBox.x + 4, bandBox.y + bandBox.height * 0.2, { steps: 8 });
  await page.mouse.up();
  await expect(band).not.toHaveValue('0');
  await expect(faders.nth(3)).toHaveValue(before[0]);
  await expect(faders.nth(5)).toHaveValue(before[1]);

  for (let index = 0; index < await faders.count(); index += 1) {
    const fader = faders.nth(index);
    const box = await fader.boundingBox();
    await page.mouse.click(box.x + 4, box.y + box.height * 0.2);
    await expect(fader).not.toHaveValue('0');
  }
});

const GLOBAL_SLIDER_VALUES = {
  inputGain: ['0', '6', '12', '18', '24'],
  resonance: ['-1', '-0.5', '0', '0.5', '1'],
  dryWet: ['0', '25', '50', '75', '100'],
  spread: ['-1', '-0.5', '0', '0.5', '1'],
  volume: ['-60', '-45', '-30', '-15', '0']
};

test('global sliders keep a centered visible track and a 44px transparent touch target', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const desktopGeometry = await page.evaluate(values => Object.entries(values).map(([control, testValues]) => {
    const input = document.querySelector(`[data-control="${control}"]`);
    const area = input.closest('.range-hit-area');
    const inputRect = input.getBoundingClientRect();
    const areaRect = area.getBoundingClientRect();
    const normalizedCenters = testValues.map(value => {
      input.value = value;
      const normalized = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
      return inputRect.left + 5 + normalized * (inputRect.width - 10);
    });
    return {
      control,
      inputHeight: inputRect.height,
      inputCenterY: inputRect.top + inputRect.height / 2,
      areaHeight: areaRect.height,
      areaCenterY: areaRect.top + areaRect.height / 2,
      inputBackground: getComputedStyle(input).backgroundColor,
      trackHeight: getComputedStyle(area).getPropertyValue('--global-range-track-height').trim(),
      normalizedCenters,
      inputLeft: inputRect.left,
      inputRight: inputRect.right,
      inputWidth: inputRect.width
    };
  }), GLOBAL_SLIDER_VALUES);

  expect(desktopGeometry).toHaveLength(5);
  for (const slider of desktopGeometry) {
    expect(slider.inputHeight).toBe(44);
    expect(slider.areaHeight).toBe(5);
    expect(slider.inputCenterY).toBeCloseTo(slider.areaCenterY, 5);
    expect(transparent(slider.inputBackground)).toBeTruthy();
    expect(slider.trackHeight).toBe('5px');
    expect(slider.normalizedCenters[0]).toBeCloseTo(slider.inputLeft + 5, 5);
    expect(slider.normalizedCenters[2]).toBeCloseTo(slider.inputLeft + slider.inputWidth / 2, 5);
    expect(slider.normalizedCenters[4]).toBeCloseTo(slider.inputRight - 5, 5);
  }

  for (const [control, values] of Object.entries(GLOBAL_SLIDER_VALUES)) {
    const input = page.locator(`[data-control="${control}"]`);
    for (const value of values) {
      await input.evaluate((element, nextValue) => {
        element.value = nextValue;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
      await expect(input).toHaveValue(value);
    }
  }

  for (const control of Object.keys(GLOBAL_SLIDER_VALUES)) {
    const input = page.locator(`[data-control="${control}"]`);
    const box = await input.boundingBox();
    for (const offsetY of [4, box.height / 2, box.height - 4]) {
      await page.mouse.click(box.x + box.width * 0.7, box.y + offsetY);
      expect(Number(await input.inputValue())).toBeGreaterThan(Number(await input.getAttribute('min')));
    }
  }
});

test('tablet global sliders retain a centered 4px track inside the 44px input', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const tabletGeometry = await page.evaluate(() => [...document.querySelectorAll('.range-hit-area')].map(area => {
    const input = area.querySelector('input[type=range]');
    const inputRect = input.getBoundingClientRect();
    const areaRect = area.getBoundingClientRect();
    return {
      inputHeight: inputRect.height,
      inputCenterY: inputRect.top + inputRect.height / 2,
      areaHeight: areaRect.height,
      areaCenterY: areaRect.top + areaRect.height / 2,
      trackHeight: getComputedStyle(area).getPropertyValue('--global-range-track-height').trim(),
      inputBackground: getComputedStyle(input).backgroundColor
    };
  }));

  expect(tabletGeometry).toHaveLength(5);
  for (const slider of tabletGeometry) {
    expect(slider.inputHeight).toBe(44);
    expect(slider.areaHeight).toBe(4);
    expect(slider.inputCenterY).toBeCloseTo(slider.areaCenterY, 5);
    expect(slider.trackHeight).toBe('4px');
    expect(transparent(slider.inputBackground)).toBeTruthy();
  }
});
test('compact tablet keeps every fader hit zone in its own card', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const areas = await page.evaluate(() => [...document.querySelectorAll('.fader-hit-area')].map(area => {
    const target = area.getBoundingClientRect();
    const card = area.closest('.band-card').getBoundingClientRect();
    return { left: target.left, right: target.right, cardLeft: card.left, cardRight: card.right, width: target.width };
  }));

  expect(areas).toHaveLength(10);
  expect(areas.every(area => area.width === 44 && area.left >= area.cardLeft && area.right <= area.cardRight)).toBeTruthy();
  for (let index = 1; index < areas.length; index += 1) {
    expect(areas[index - 1].right).toBeLessThanOrEqual(areas[index].left);
  }
});
test('desktop keeps the narrow original fader rail while the input target stays transparent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const desktop = await page.evaluate(() => {
    const area = document.querySelector('.fader-hit-area');
    const track = document.querySelector('.fader-track');
    const input = document.querySelector('.band-fader');
    return {
      areaWidth: area.getBoundingClientRect().width,
      trackWidth: track.getBoundingClientRect().width,
      areaBackground: getComputedStyle(area).backgroundColor,
      inputBackground: getComputedStyle(input).backgroundColor,
      inputTouchAction: getComputedStyle(input).touchAction
    };
  });

  expect(desktop.trackWidth).toBe(12);
  expect(desktop.areaWidth).toBe(44);
  expect(transparent(desktop.areaBackground)).toBeTruthy();
  expect(transparent(desktop.inputBackground)).toBeTruthy();
  expect(desktop.inputTouchAction).toBe('none');
});