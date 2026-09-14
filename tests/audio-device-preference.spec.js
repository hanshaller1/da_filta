const { test, expect } = require('playwright/test');

const mockAudioDevices = async (page, devices) => {
  await page.addInitScript(initialDevices => {
    let currentDevices = initialDevices;
    const deviceChangeListeners = [];
    const mediaDevices = navigator.mediaDevices || {};
    mediaDevices.enumerateDevices = async () => currentDevices;
    mediaDevices.addEventListener = (type, listener) => {
      if (type === 'devicechange') deviceChangeListeners.push(listener);
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    window.__setMockAudioDevices = devices => {
      currentDevices = devices;
      deviceChangeListeners.forEach(listener => listener());
    };
  }, devices);
};

const input = (deviceId, label) => ({ kind: 'audioinput', deviceId, label, groupId: deviceId });

test('prefers the first Elektron input without starting audio', async ({ page }) => {
  await mockAudioDevices(page, [input('realtek', 'Mikrofon (Realtek)'), input('syntakt', 'Elektron Syntakt')]);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-audio-input]')).toHaveValue('syntakt');
  await expect(page.locator('[data-audio-status]')).toHaveText('OFF');
});

test('keeps the existing first-input fallback when no Elektron device exists', async ({ page }) => {
  await mockAudioDevices(page, [input('realtek', 'Mikrofon (Realtek)'), input('usb', 'USB Audio Interface')]);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-audio-input]')).toHaveValue('realtek');
});

test('uses a stable first Elektron match', async ({ page }) => {
  await mockAudioDevices(page, [input('syntakt', 'Elektron Syntakt'), input('digitone', 'Elektron Digitone')]);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-audio-input]')).toHaveValue('syntakt');
});

test('does not overwrite a manual input choice on refresh', async ({ page }) => {
  const devices = [input('realtek', 'Mikrofon (Realtek)'), input('syntakt', 'Elektron Syntakt')];
  await mockAudioDevices(page, devices);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-audio-input]').selectOption('realtek');
  await page.evaluate(nextDevices => window.__setMockAudioDevices(nextDevices), devices);
  await expect(page.locator('[data-audio-input]')).toHaveValue('realtek');
});

test('recognizes Elektron after initially empty labels become available', async ({ page }) => {
  await mockAudioDevices(page, [input('realtek', ''), input('syntakt', '')]);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-audio-input]')).toHaveValue('realtek');
  await page.evaluate(() => window.__setMockAudioDevices([
    { kind: 'audioinput', deviceId: 'realtek', label: 'Mikrofon (Realtek)', groupId: 'realtek' },
    { kind: 'audioinput', deviceId: 'syntakt', label: 'Elektron Syntakt', groupId: 'syntakt' }
  ]));
  await expect(page.locator('[data-audio-input]')).toHaveValue('syntakt');
});
