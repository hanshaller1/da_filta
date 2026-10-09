// Global sliders (input, resonance, dry/wet, spread, volume), band feedback buttons, FB ALL,
// channel mode and the fader/spread reset.
import {
  BAND_COUNT, BAND_GAIN_NEUTRAL, GLOBAL_CONTROL_DEFINITIONS, setStateBandBaseGain, state, audioEngine, hooks
} from './app-context.js';
import { renderMacroControls } from './macro-mode.js';
import { renderDynamicEqControls } from './dynamic-eq-mode.js';
import { refreshStatusStrip, scheduleAnalyzerRender } from './band-analyzer.js';
import {
  bands, formatValue, renderBandSliderValues, invalidateSpreadCenter, renderBand, setBandFeedback,
  setFeedbackAll
} from './bands.js';

document.querySelectorAll('[data-control]').forEach(slider => {
  const name = slider.dataset.control;
  const definition = GLOBAL_CONTROL_DEFINITIONS[name];
  const output = document.querySelector(`[data-output="${name}"]`);
  slider.min = String(definition.min);
  slider.max = String(definition.max);
  slider.step = String(definition.step);
  slider.value = String(state[name]);
  const update = () => { state[name] = Number(slider.value); output.textContent = formatValue(name, state[name]); };
  slider.addEventListener('input', update);
  slider.addEventListener('dblclick', () => {
    slider.value = String(definition.defaultValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  update();
});
document.querySelectorAll('[data-feedback-band]').forEach(button => button.addEventListener('click', () => {
  const index=Number(button.dataset.feedbackBand);
  const nextValue=!state.feedbackBandLeft[index];
  setBandFeedback('left', index, nextValue);
  button.classList.toggle('active',nextValue);
  button.setAttribute('aria-pressed',String(nextValue));
}));
const fbAllButton = document.querySelector('.fb-all-toggle');
const channelModeToggle = document.querySelector('[data-channel-toggle]');
const bandResetButton = document.querySelector('[data-band-reset]');
const spreadControl = document.querySelector('[data-control="spread"]');
const spreadControlCard = spreadControl?.closest('.control-card');
const updatePerChannelBands = (syncAudio = true) => {
  bands.classList.toggle('is-per-channel', state.perChannelBands);
  channelModeToggle?.classList.toggle('is-per-channel', state.perChannelBands);
  channelModeToggle?.setAttribute('aria-pressed', String(state.perChannelBands));
  channelModeToggle?.setAttribute('aria-label', state.perChannelBands ? 'CLASSIC aktivieren' : 'P/CH aktivieren');
  const spreadDisabled = state.perChannelBands;
  if (spreadControl) spreadControl.disabled = spreadDisabled;
  spreadControlCard?.classList.toggle('is-disabled', spreadDisabled);
  if (syncAudio) audioEngine?.setPerChannelBands(state.perChannelBands);
  renderBandSliderValues();
  renderDynamicEqControls();
  if (state.selectedWorkspaceMode === 'presets') renderMacroControls();
};
hooks.updatePerChannelBands = updatePerChannelBands;
channelModeToggle?.addEventListener('click', () => {
  state.perChannelBands = !state.perChannelBands;
  updatePerChannelBands();
  hooks.updateDevControlRelevance();
});
const resetBandControls = () => {
  renderGlobalControlValue('spread', 0);
  audioEngine?.setSpread(0);
  for (let index = 0; index < BAND_COUNT; index += 1) {
    setStateBandBaseGain(state, 'left', index, BAND_GAIN_NEUTRAL);
    setStateBandBaseGain(state, 'right', index, BAND_GAIN_NEUTRAL);
    invalidateSpreadCenter(index);
    audioEngine?.setBandBaseGain('left', index, BAND_GAIN_NEUTRAL);
    audioEngine?.setBandBaseGain('right', index, BAND_GAIN_NEUTRAL);
    renderBand(index);
  }
  updatePerChannelBands();
  refreshStatusStrip();
  scheduleAnalyzerRender();
};
bandResetButton?.addEventListener('click', resetBandControls);
const fbAllControl = fbAllButton?.closest('.fb-all-control');
if (fbAllControl) document.querySelector('.filterbank-fb-all-group')?.append(fbAllControl);
fbAllButton.title = 'Separater MAIN-Feedback-Bus mit eigenem Schalter; unabhängig von den einzelnen FB-Bandtasten.';
fbAllButton.addEventListener('click', () => {
  const nextValue=!state.feedbackAllLeft;
  setFeedbackAll('left', nextValue);
  fbAllButton.classList.toggle('active',nextValue);
  fbAllButton.textContent='FB ALL';
  fbAllButton.setAttribute('aria-pressed',String(nextValue));
});
const renderGlobalControlValue = (name, value, precise = false) => {
  const definition = GLOBAL_CONTROL_DEFINITIONS[name];
  const slider = document.querySelector(`[data-control="${name}"]`);
  if (!definition || !slider) return;
  const minimum = name === 'spread' ? -state.spreadMaxOffsetDb : definition.min;
  const maximum = name === 'spread' ? state.spreadMaxOffsetDb : definition.max;
  const clamped = Math.min(maximum, Math.max(minimum, Number(value)));
  const normalized = precise ? clamped : Number(clamped.toFixed(2));
  state[name] = normalized;
  slider.value = String(normalized);
  const output = document.querySelector(`[data-output="${name}"]`);
  if (output) output.textContent = formatValue(name, normalized);
};
const configureSpreadControl = maxOffsetDb => {
  const limit = Number(maxOffsetDb);
  if (!spreadControl || !Number.isFinite(limit)) return;
  spreadControl.min = String(-limit);
  spreadControl.max = String(limit);
  spreadControl.step = '0.1';
  const minLabel = document.querySelector('[data-spread-scale-min]');
  const maxLabel = document.querySelector('[data-spread-scale-max]');
  if (minLabel) minLabel.textContent = `−${limit}`;
  if (maxLabel) maxLabel.textContent = `+${limit}`;
};
const setGlobalControlValue = (name, value) => {
  const slider = document.querySelector(`[data-control="${name}"]`);
  renderGlobalControlValue(name, value);
  if (!slider) return;
  slider.dispatchEvent(new Event('input', { bubbles: true }));
};

export {
  fbAllButton, updatePerChannelBands, renderGlobalControlValue, configureSpreadControl, setGlobalControlValue
};
