// Theme selection, the custom theme editor and its colour helpers.

const THEME_STORAGE_KEY = 'da_filta-theme';
const LEGACY_THEME_STORAGE_KEY = 'resonant-filterbank-theme';
const CUSTOM_THEME_STORAGE_KEY = 'da_filta-custom-theme';
const THEME_VALUES = [
  'current', 'clean-modern', 'dark-studio', 'analog-inspired', 'minimal-dark', 'pro-console',
  'graphite', 'midnight', 'slate', 'forest', 'warm-studio',
  'copper-circuit', 'ultraviolet', 'deep-ocean', 'amber-crt', 'ice-lab'
];
const themeSelect = document.querySelector('[data-theme-select]');
const customThemeOption = themeSelect?.querySelector('option[value="custom"]');
const themeEditor = document.querySelector('.theme-editor');
const themeEditorToggle = document.querySelector('[data-theme-editor-toggle]');
const themeEditorPanel = document.querySelector('[data-theme-editor-panel]');
const themeEditorBase = document.querySelector('[data-theme-editor-base]');
const themeEditorStatus = document.querySelector('[data-theme-editor-status]');
const themeEditorFields = [...document.querySelectorAll('[data-theme-field]')];
const themeEditorOutputs = [...document.querySelectorAll('[data-theme-output]')];
const themeEditorReset = document.querySelector('[data-theme-reset]');
const themeEditorSave = document.querySelector('[data-theme-save]');
const themeEditorClear = document.querySelector('[data-theme-clear]');
const CUSTOM_THEME_PROPERTIES = [
  '--bg', '--cyan', '--text', '--page-background', '--overlay-opacity', '--overlay-line-x', '--overlay-line-y',
  '--panel-border', '--panel-background', '--panel-shadow', '--secondary-text', '--muted-text', '--strong-text',
  '--output-border', '--output-background', '--range-track', '--range-thumb-border', '--range-thumb-shadow',
  '--button-background', '--button-border', '--button-text', '--active-background', '--active-shadow',
  '--band-button-background', '--band-button-border', '--graph-background', '--graph-grid', '--graph-zero',
  '--graph-zero-shadow', '--graph-left', '--graph-right', '--graph-left-color', '--graph-right-color', '--graph-left-shadow', '--fader-track',
  '--fader-track-shadow', '--fader-thumb', '--error', '--color-scheme', '--theme-grid-background', '--spectrum-left', '--spectrum-right'
];
let editorTheme = null;
let runtimeThemeActive = false;
let editorThemeSaved = false;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const colorFromValue = (value, fallback = '#101820') => {
  const match = String(value || '').match(/#[0-9a-f]{3,8}\b/i);
  if (!match) return fallback;
  const hex = match[0].slice(1);
  return `#${hex.length === 3 ? [...hex].map(part => part + part).join('') : hex.slice(0, 6)}`;
};
const rgb = color => {
  const hex = colorFromValue(color).slice(1);
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
};
const hex = ([red, green, blue]) => `#${[red, green, blue].map(value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
const mixColor = (first, second, amount) => {
  const a = rgb(first); const b = rgb(second); const t = clamp(amount);
  return hex(a.map((value, index) => value + (b[index] - value) * t));
};
const withAlpha = (color, alpha) => {
  const [red, green, blue] = rgb(color);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha)})`;
};
const relativeLuminance = color => {
  const channels = rgb(color).map(value => value / 255).map(value => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
const changeSaturation = (color, saturation) => {
  const [red, green, blue] = rgb(color).map(value => value / 255);
  const max = Math.max(red, green, blue); const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return hex([red * 255, green * 255, blue * 255]);
  const chroma = max - min;
  let hue = max === red ? ((green - blue) / chroma + (green < blue ? 6 : 0)) : max === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4;
  hue /= 6;
  const nextSaturation = clamp((lightness > .5 ? chroma / (2 - max - min) : chroma / (max + min)) * saturation, 0, 1);
  const q = lightness < .5 ? lightness * (1 + nextSaturation) : lightness + nextSaturation - lightness * nextSaturation;
  const p = 2 * lightness - q;
  const channel = offset => {
    let t = hue + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    return (t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p) * 255;
  };
  return hex([channel(1 / 3), channel(0), channel(-1 / 3)]);
};
const adjustColor = (color, brightness, saturation) => {
  const saturated = changeSaturation(color, saturation / 100);
  return mixColor(saturated, brightness >= 0 ? '#ffffff' : '#000000', Math.abs(brightness) / 100 * .72);
};
const getBaseThemeName = theme => themeSelect?.querySelector(`option[value="${theme}"]`)?.textContent || theme;
const captureEditorTheme = baseTheme => {
  const style = getComputedStyle(document.body);
  return {
    baseTheme,
    accent: colorFromValue(style.getPropertyValue('--cyan'), '#10eaf7'),
    background: colorFromValue(style.getPropertyValue('--bg'), '#031319'),
    panel: colorFromValue(style.getPropertyValue('--panel-background'), '#15242a'),
    analyzerLeft: colorFromValue(style.getPropertyValue('--graph-left-color'), '#10eaf7'),
    analyzerRight: colorFromValue(style.getPropertyValue('--graph-right-color'), '#1bb9d2'),
    brightness: 0, contrast: 0, saturation: 100, glow: 50, borders: 50, grid: 50,
    gradients: true, shadows: true, backgroundGrid: true
  };
};
const normalizeEditorTheme = value => {
  const baseTheme = THEME_VALUES.includes(value?.baseTheme) ? value.baseTheme : 'current';
  const fallback = captureEditorTheme(baseTheme);
  const number = (key, min, max) => clamp(Number(value?.[key] ?? fallback[key]), min, max);
  return {
    ...fallback,
    baseTheme,
    accent: colorFromValue(value?.accent, fallback.accent), background: colorFromValue(value?.background, fallback.background),
    panel: colorFromValue(value?.panel, fallback.panel), analyzerLeft: colorFromValue(value?.analyzerLeft, fallback.analyzerLeft), analyzerRight: colorFromValue(value?.analyzerRight, fallback.analyzerRight),
    brightness: number('brightness', -100, 100), contrast: number('contrast', -100, 100), saturation: number('saturation', 0, 180), glow: number('glow', 0, 100), borders: number('borders', 0, 100), grid: number('grid', 0, 100),
    gradients: value?.gradients !== false, shadows: value?.shadows !== false, backgroundGrid: value?.backgroundGrid !== false
  };
};
const clearCustomTheme = () => {
  CUSTOM_THEME_PROPERTIES.forEach(property => document.body.style.removeProperty(property));
  runtimeThemeActive = false;
  document.dispatchEvent(new Event('da-filta-theme-change'));
};
const applyCustomTheme = theme => {
  const brightness = theme.brightness;
  const saturation = theme.saturation;
  let background = adjustColor(theme.background, brightness, saturation);
  let panel = adjustColor(theme.panel, brightness, saturation);
  const accent = adjustColor(theme.accent, brightness * .25, saturation);
  const left = adjustColor(theme.analyzerLeft, brightness * .2, saturation);
  const right = adjustColor(theme.analyzerRight, brightness * .2, saturation);
  const contrast = theme.contrast / 100;
  if (contrast < 0) panel = mixColor(panel, background, -contrast * .64);
  if (contrast > 0) panel = mixColor(panel, relativeLuminance(panel) > .48 ? '#ffffff' : '#000000', contrast * .15);
  const lightTheme = relativeLuminance(panel) > .46;
  const text = lightTheme ? '#17232b' : '#eaf1f3';
  const strongText = lightTheme ? '#0d1b22' : '#ffffff';
  const secondaryText = mixColor(text, panel, lightTheme ? .38 : .3);
  const mutedText = mixColor(text, panel, lightTheme ? .52 : .44);
  const border = mixColor(panel, text, .08 + theme.borders / 100 * .48);
  const output = mixColor(panel, background, .36);
  const graphBackground = mixColor(background, panel, .38);
  const button = mixColor(panel, text, lightTheme ? .055 : .09);
  const active = mixColor(panel, accent, lightTheme ? .22 : .18);
  const glow = theme.glow / 100;
  const gradient = (start, end) => theme.gradients ? `linear-gradient(145deg, ${start}, ${end})` : start;
  const set = (property, value) => document.body.style.setProperty(property, value);
  set('--bg', background); set('--cyan', accent); set('--text', text); set('--color-scheme', lightTheme ? 'light' : 'dark');
  set('--page-background', theme.gradients ? `radial-gradient(circle at 50% 0%, ${mixColor(panel, accent, .12)}, ${background} 58%, ${mixColor(background, '#000000', lightTheme ? 0 : .26)})` : background);
  set('--overlay-opacity', theme.backgroundGrid ? String(.025 + theme.grid / 100 * .18) : '0');
  set('--overlay-line-x', withAlpha(accent, .11)); set('--overlay-line-y', withAlpha(accent, .14));
  set('--panel-background', gradient(mixColor(panel, lightTheme ? '#ffffff' : accent, theme.gradients ? .035 : 0), panel));
  set('--panel-border', border);
  set('--panel-shadow', theme.shadows ? `0 3px 12px ${withAlpha(background, .3)}, inset 0 0 14px ${withAlpha(accent, .035)}` : 'none');
  set('--secondary-text', secondaryText); set('--muted-text', mutedText); set('--strong-text', strongText);
  set('--output-background', output); set('--output-border', mixColor(border, output, .25));
  set('--button-background', gradient(mixColor(button, lightTheme ? '#ffffff' : accent, .04), button));
  set('--button-border', mixColor(border, text, .08));
  set('--button-text', text);
  set('--band-button-background', gradient(mixColor(button, accent, .04), button)); set('--band-button-border', border);
  set('--active-background', gradient(mixColor(active, accent, .15), active));
  set('--active-shadow', glow ? `0 0 ${Math.round(3 + glow * 12)}px ${withAlpha(accent, .12 + glow * .48)}` : 'none');
  set('--range-track', theme.gradients ? `linear-gradient(90deg, ${accent}, ${mixColor(accent, panel, .64)})` : accent);
  set('--range-thumb-border', strongText);
  set('--range-thumb-shadow', glow ? `0 0 ${Math.round(2 + glow * 9)}px ${withAlpha(accent, .2 + glow * .55)}` : 'none');
  set('--graph-background', graphBackground);
  set('--graph-grid', withAlpha(mixColor(accent, text, .22), .42));
  set('--theme-grid-background', `linear-gradient(to bottom, color-mix(in srgb, var(--graph-grid) ${theme.grid}%, transparent) 1px, transparent 1px)`);
  set('--graph-zero', withAlpha(accent, .58));
  set('--graph-zero-shadow', glow ? `0 0 ${Math.round(2 + glow * 6)}px ${withAlpha(accent, glow * .42)}` : 'none');
  set('--graph-left', theme.gradients ? `linear-gradient(${mixColor(left, '#ffffff', .17)}, ${left})` : left);
  set('--graph-right', theme.gradients ? `linear-gradient(${mixColor(right, '#ffffff', .14)}, ${right})` : right);
  set('--graph-left-color', left);
  set('--graph-right-color', right);
  set('--graph-left-shadow', glow ? `0 0 ${Math.round(2 + glow * 6)}px ${withAlpha(left, glow * .45)}` : 'none');
  set('--spectrum-left', left); set('--spectrum-right', right);
  set('--fader-track', mixColor(output, background, .46));
  set('--fader-track-shadow', theme.shadows ? `0 0 0 2px ${mixColor(background, '#000000', .35)}, 0 0 8px ${withAlpha(accent, .13)}` : 'none');
  set('--fader-thumb', strongText);
  // Error/panic stays intentionally independent from the user accent.
  set('--error', lightTheme ? '#b43d35' : '#ff8b82');
  runtimeThemeActive = true;
  document.dispatchEvent(new Event('da-filta-theme-change'));
};
const readCustomTheme = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CUSTOM_THEME_STORAGE_KEY) || 'null');
    return stored && typeof stored === 'object' ? stored : null;
  } catch { return null; }
};
const updateCustomOption = () => {
  const hasCustom = Boolean(readCustomTheme());
  if (customThemeOption) customThemeOption.disabled = !hasCustom;
  if (themeEditorClear) themeEditorClear.hidden = !hasCustom;
};
const syncEditorUI = () => {
  if (!editorTheme) return;
  themeEditorBase.textContent = getBaseThemeName(editorTheme.baseTheme);
  themeEditorFields.forEach(field => { field[field.type === 'checkbox' ? 'checked' : 'value'] = editorTheme[field.dataset.themeField]; });
  themeEditorOutputs.forEach(output => {
    const key = output.dataset.themeOutput;
    output.textContent = key === 'saturation' ? `${editorTheme[key]}%` : editorTheme[key];
  });
  themeEditorStatus.textContent = runtimeThemeActive && !editorThemeSaved ? 'UNSAVED' : '';
};
const readStoredTheme = () => {
  try {
    const currentTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (currentTheme !== null) return currentTheme;
    const legacyTheme = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacyTheme !== null) window.localStorage.setItem(THEME_STORAGE_KEY, legacyTheme);
    return legacyTheme;
  } catch { return null; }
};
const applyTheme = value => {
  const savedCustom = value === 'custom' ? readCustomTheme() : null;
  if (savedCustom) {
    const baseTheme = THEME_VALUES.includes(savedCustom.baseTheme) ? savedCustom.baseTheme : 'current';
    clearCustomTheme(); document.body.dataset.theme = baseTheme;
    editorTheme = normalizeEditorTheme(savedCustom); applyCustomTheme(editorTheme); editorThemeSaved = true;
    if (themeSelect) themeSelect.value = 'custom';
    try { window.localStorage.setItem(THEME_STORAGE_KEY, 'custom'); } catch { /* Storage may be unavailable. */ }
  } else {
    const theme = THEME_VALUES.includes(value) ? value : 'current';
    clearCustomTheme(); document.body.dataset.theme = theme; editorTheme = null; editorThemeSaved = false;
    if (themeSelect) themeSelect.value = theme;
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Storage may be unavailable. */ }
  }
  updateCustomOption(); syncEditorUI();
};
applyTheme(readStoredTheme());
themeSelect?.addEventListener('change', event => applyTheme(event.target.value));
const setThemeEditorOpen = open => {
  if (!themeEditorPanel || !themeEditorToggle) return;
  if (open && !editorTheme) editorTheme = captureEditorTheme(document.body.dataset.theme || 'current');
  themeEditorPanel.hidden = !open; themeEditorToggle.setAttribute('aria-expanded', String(open));
  if (open) syncEditorUI();
};
themeEditorToggle?.addEventListener('click', () => setThemeEditorOpen(themeEditorPanel.hidden));
themeEditorFields.forEach(field => field.addEventListener('input', () => {
  if (!editorTheme) editorTheme = captureEditorTheme(document.body.dataset.theme || 'current');
  const key = field.dataset.themeField;
  editorTheme[key] = field.type === 'checkbox' ? field.checked : field.type === 'range' ? Number(field.value) : colorFromValue(field.value);
  editorThemeSaved = false; applyCustomTheme(editorTheme); syncEditorUI();
}));
themeEditorReset?.addEventListener('click', () => {
  const base = editorTheme?.baseTheme || document.body.dataset.theme || 'current';
  applyTheme(base);
  editorTheme = captureEditorTheme(base);
  syncEditorUI();
});
themeEditorSave?.addEventListener('click', () => {
  if (!editorTheme) editorTheme = captureEditorTheme(document.body.dataset.theme || 'current');
  try { window.localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify({ version: 1, ...editorTheme })); } catch { return; }
  runtimeThemeActive = true; editorThemeSaved = true; updateCustomOption();
  if (themeSelect) themeSelect.value = 'custom';
  try { window.localStorage.setItem(THEME_STORAGE_KEY, 'custom'); } catch { /* Storage may be unavailable. */ }
  syncEditorUI();
});
themeEditorClear?.addEventListener('click', () => {
  const base = editorTheme?.baseTheme || document.body.dataset.theme || 'current';
  try { window.localStorage.removeItem(CUSTOM_THEME_STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
  updateCustomOption(); applyTheme(base); setThemeEditorOpen(false);
});
document.addEventListener('pointerdown', event => { if (themeEditor && !themeEditor.contains(event.target)) setThemeEditorOpen(false); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') setThemeEditorOpen(false); });
window.DaFiltaThemeEditor = { applyCustomTheme, clearCustomTheme, getState: () => editorTheme && ({ ...editorTheme }) };
