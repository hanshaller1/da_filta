// Persisted keyboard preferences (fader key step and repeat speed) and their DEV / LAB controls.
import { devLabGroups } from './dev-lab-panel.js';

const KEYBOARD_PREFERENCES_STORAGE_KEY = 'da-filta-keyboard-preferences-v1';
const KEY_STEP_DEFAULT_PERCENT = 5;
const KEY_SPEED_DEFAULT_HZ = 30;
const clampKeyboardPreference = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const readKeyboardPreferences = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEYBOARD_PREFERENCES_STORAGE_KEY) || 'null');
    return {
      keyStepPercent: clampKeyboardPreference(stored?.keyStepPercent, .1, 100, KEY_STEP_DEFAULT_PERCENT),
      keySpeedHz: clampKeyboardPreference(stored?.keySpeedHz, 1, 60, KEY_SPEED_DEFAULT_HZ)
    };
  } catch { return { keyStepPercent: KEY_STEP_DEFAULT_PERCENT, keySpeedHz: KEY_SPEED_DEFAULT_HZ }; }
};
const keyboardPreferences = readKeyboardPreferences();
const formatKeyboardPreference = (value, decimals) => String(Number(value.toFixed(decimals)));
const persistKeyboardPreferences = () => {
  try {
    window.localStorage.setItem(KEYBOARD_PREFERENCES_STORAGE_KEY, JSON.stringify(keyboardPreferences));
  } catch { /* Storage may be unavailable. */ }
};
const addKeyboardPreferenceControl = ({ label, attribute, min, max, step, suffix, tooltip, value, onChange, integer = false }) => {
  const container = devLabGroups.get('keyboard');
  if (!container) return null;
  const control = document.createElement('label'); control.className = 'dev-lab-control';
  const title = document.createElement('span'); title.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(integer ? 1 : min);
  input.max = String(max);
  input.step = String(integer ? 1 : step);
  input.value = formatKeyboardPreference(value(), integer ? 0 : (step < 1 ? 1 : 0));
  input.setAttribute(attribute, ''); input.setAttribute('aria-label', `${label} ${suffix}`); input.title = tooltip;
  const unit = document.createElement('em'); unit.textContent = suffix;
  const apply = restoreInvalid => {
    const numeric = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(numeric)) {
      if (restoreInvalid) input.value = formatKeyboardPreference(value(), step < 1 ? 1 : 0);
      return;
    }
    const normalized = integer ? Math.round(numeric) : numeric;
    onChange(Math.min(max, Math.max(min, normalized)));
    input.value = formatKeyboardPreference(value(), integer ? 0 : (step < 1 ? 1 : 0));
  };
  input.addEventListener('input', () => { if (input.value !== '') apply(false); });
  input.addEventListener('change', () => apply(true)); input.addEventListener('blur', () => apply(true));
  control.append(title, input, unit); container.append(control); return input;
};
const keyStepInput = addKeyboardPreferenceControl({
  label: 'KEY STEP', attribute: 'data-key-step-percent', min: .1, max: 100, step: .1, suffix: '%',
  tooltip: 'Bestimmt, wie weit sich ein Band-Fader pro Tastaturschritt bewegt. Der Wert entspricht einem Prozentanteil des vollständigen Fader-Regelwegs. 5 % entspricht dem bisherigen Verhalten; 100 % bewegt den Fader mit einem Schritt bis zum jeweiligen Grenzwert.',
  value: () => keyboardPreferences.keyStepPercent,
  onChange: value => { keyboardPreferences.keyStepPercent = value; persistKeyboardPreferences(); }, integer: true
});
const keySpeedInput = addKeyboardPreferenceControl({
  label: 'KEY SPEED', attribute: 'data-key-speed-hz', min: 1, max: 60, step: 1, suffix: 'Hz',
  tooltip: 'Bestimmt, wie viele Fader-Schritte pro Sekunde beim Gedrückthalten einer Tastaturtaste ausgeführt werden. Der erste Schritt erfolgt sofort. 30 Hz entspricht dem bisherigen Verhalten.',
  value: () => keyboardPreferences.keySpeedHz,
  onChange: value => { keyboardPreferences.keySpeedHz = value; persistKeyboardPreferences(); }
});

export {
  keyboardPreferences
};
