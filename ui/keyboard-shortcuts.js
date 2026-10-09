// Keyboard shortcuts for feedback gates, faders and the global controls.
import { BAND_COUNT, BAND_GAIN_MIN, BAND_GAIN_MAX, BAND_GAIN_NEUTRAL, state, panic } from './app-context.js';
import { keyboardPreferences } from './keyboard-preferences.js';
import { setBandBaseGain } from './bands.js';
import { setGlobalControlValue } from './global-controls.js';

const FB_CODES = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'];
const FADER_UP_CODES = ['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP'];
const FADER_DOWN_CODES = ['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon'];
const FADER_NEUTRAL_CODES = ['KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash'];
const getBandGainKeyStep = () => (BAND_GAIN_MAX - BAND_GAIN_MIN) * (keyboardPreferences.keyStepPercent / 100);
const getFaderKeyRepeatIntervalMs = () => 1000 / keyboardPreferences.keySpeedHz;
const DRIVE_UP_CODE = 'Equal';
const DRIVE_DOWN_CODE = 'Minus';
const RESONANCE_UP_CODE = 'BracketRight';
const RESONANCE_DOWN_CODE = 'BracketLeft';
const VOLUME_UP_CODE = 'Backslash';
const VOLUME_DOWN_CODE = 'Quote';
const isEditableTarget = target => target instanceof HTMLElement && ((target.matches('input, textarea, select') && !target.matches('input[type="range"]')) || target.isContentEditable);
const pressedFaderKeys = new Set();
let faderKeyboardAnimationFrame = 0;
let faderKeyboardLastStepAt = 0;
const getFaderKeyDelta = code => {
  const upIndex = FADER_UP_CODES.indexOf(code);
  if (upIndex !== -1) return { index: upIndex, delta: getBandGainKeyStep() };
  const downIndex = FADER_DOWN_CODES.indexOf(code);
  return downIndex !== -1 ? { index: downIndex, delta: -getBandGainKeyStep() } : null;
};
const applyPressedFaderKeys = () => {
  const deltas = Array.from({ length: BAND_COUNT }, () => 0);
  pressedFaderKeys.forEach(code => {
    const movement = getFaderKeyDelta(code);
    if (movement) deltas[movement.index] += movement.delta;
  });
  deltas.forEach((delta, index) => {
    if (delta) setBandBaseGain('left', index, state.bandGainLeft[index] + delta);
  });
};
const applyFaderKey = code => {
  const movement = getFaderKeyDelta(code);
  if (movement) setBandBaseGain('left', movement.index, state.bandGainLeft[movement.index] + movement.delta);
};
const animatePressedFaderKeys = now => {
  faderKeyboardAnimationFrame = 0;
  if (!pressedFaderKeys.size) return;
  if (now - faderKeyboardLastStepAt >= getFaderKeyRepeatIntervalMs()) {
    applyPressedFaderKeys();
    faderKeyboardLastStepAt = now;
  }
  faderKeyboardAnimationFrame = requestAnimationFrame(animatePressedFaderKeys);
};
const startPressedFaderKeyAnimation = () => {
  if (!faderKeyboardAnimationFrame) faderKeyboardAnimationFrame = requestAnimationFrame(animatePressedFaderKeys);
};
const clearPressedFaderKeys = () => {
  pressedFaderKeys.clear();
  faderKeyboardLastStepAt = 0;
  if (faderKeyboardAnimationFrame) cancelAnimationFrame(faderKeyboardAnimationFrame);
  faderKeyboardAnimationFrame = 0;
};
document.addEventListener('keydown', event => {
  if (isEditableTarget(event.target)) return;
  if (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter') {
    if (!event.repeat) panic();
    event.preventDefault();
    return;
  }
  if (event.code === DRIVE_UP_CODE) { setGlobalControlValue('inputGain', state.inputGain + 0.5); event.preventDefault(); return; }
  if (event.code === DRIVE_DOWN_CODE) { setGlobalControlValue('inputGain', state.inputGain - 0.5); event.preventDefault(); return; }
  if (event.code === RESONANCE_UP_CODE) { setGlobalControlValue('resonance', state.resonance + 0.02); event.preventDefault(); return; }
  if (event.code === RESONANCE_DOWN_CODE) { setGlobalControlValue('resonance', state.resonance - 0.02); event.preventDefault(); return; }
  if (event.code === VOLUME_UP_CODE) { setGlobalControlValue('volume', state.volume + 0.5); event.preventDefault(); return; }
  if (event.code === VOLUME_DOWN_CODE) { setGlobalControlValue('volume', state.volume - 0.5); event.preventDefault(); return; }
  const bandIndex = FB_CODES.indexOf(event.code);
  if (bandIndex !== -1) {
    if (event.shiftKey) { event.preventDefault(); return; }
    document.querySelector(`[data-feedback-band="${bandIndex}"]`).click();
    event.preventDefault();
    return;
  }
  if (getFaderKeyDelta(event.code)) {
    if (!pressedFaderKeys.has(event.code)) {
      pressedFaderKeys.add(event.code);
      applyFaderKey(event.code);
      faderKeyboardLastStepAt = performance.now();
      startPressedFaderKeyAnimation();
    }
    event.preventDefault();
    return;
  }
  const neutralIndex = FADER_NEUTRAL_CODES.indexOf(event.code);
  if (neutralIndex !== -1) { setBandBaseGain('left', neutralIndex, BAND_GAIN_NEUTRAL); event.preventDefault(); }
});
document.addEventListener('keyup', event => {
  if (pressedFaderKeys.delete(event.code) && !pressedFaderKeys.size) clearPressedFaderKeys();
});
window.addEventListener('blur', clearPressedFaderKeys);
