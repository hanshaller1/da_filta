// Mode tabs, workspace switching and the FILTERBANK / FILTER power buttons.
import { state, audioEngine, updateResonatorDiagnostics, hooks } from './app-context.js';
import { renderMacroControls } from './macro-mode.js';
import { filterSpectrumRenderer, renderFilterMode } from './filter-mode.js';
import { renderLfoControls, startLfoDisplay, stopLfoDisplay } from './lfo-mode.js';
import { renderClockModControls } from './clock-mod-mode.js';
import { renderEnvelopeControls } from './envelope-mode.js';

const modeTabs = [...document.querySelectorAll('[data-mode]')];
const modePanels = [...document.querySelectorAll('[data-mode-panel]')];
const filterbankPowerButton = document.querySelector('[data-module-power="filterbank"]');
const filterPowerButton = document.querySelector('[data-module-power="filter"]');
const renderFilterPower = () => {
  if (filterbankPowerButton) {
    filterbankPowerButton.setAttribute('aria-pressed', String(state.filterbankEnabled));
    filterbankPowerButton.setAttribute('aria-label', state.filterbankEnabled ? 'FILTERBANK ausschalten' : 'FILTERBANK einschalten');
  }
  if (filterPowerButton) {
    filterPowerButton.setAttribute('aria-pressed', String(state.filterEnabled));
    filterPowerButton.setAttribute('aria-label', state.filterEnabled ? 'FILTER ausschalten' : 'FILTER einschalten');
  }
};
const setFilterbankEnabled = enabled => {
  state.filterbankEnabled = Boolean(enabled);
  audioEngine?.setFilterbankEnabled(state.filterbankEnabled);
  renderFilterPower();
  renderLfoControls();
  return state.filterbankEnabled;
};
const setFilterEnabled = enabled => {
  state.filterEnabled = Boolean(enabled);
  audioEngine?.setFilterEnabled(state.filterEnabled);
  renderFilterPower();
  hooks.updatePerChannelBands();
  renderLfoControls();
  return state.filterEnabled;
};
renderFilterPower();
filterbankPowerButton?.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  if (event.detail === 0) return;
  setFilterbankEnabled(!state.filterbankEnabled);
});
filterPowerButton?.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  if (event.detail === 0) return;
  setFilterEnabled(!state.filterEnabled);
});
const selectMode = mode => {
  if (mode === 'makros') mode = 'presets';
  if (!modePanels.some(panel => panel.dataset.modePanel === mode)) return;
  state.selectedWorkspaceMode = mode;
  modeTabs.forEach(tab => {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  modePanels.forEach(panel => { panel.hidden = panel.dataset.modePanel !== mode; });
  filterSpectrumRenderer.setVisible(mode === 'filter');
  updateResonatorDiagnostics();
  if (mode === 'filter') renderFilterMode();
  if (mode === 'lfo') { renderLfoControls(); startLfoDisplay(); }
  else stopLfoDisplay();
  if (mode === 'clock-mod') renderClockModControls();
  if (mode === 'envelope-follower') renderEnvelopeControls();
  if (mode === 'presets') renderMacroControls();
};
modeTabs.forEach((tab, index) => {
  tab.tabIndex = tab.classList.contains('active') ? 0 : -1;
  tab.addEventListener('click', () => selectMode(tab.dataset.mode));
  tab.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? modeTabs.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + modeTabs.length) % modeTabs.length;
    modeTabs[nextIndex].focus();
    selectMode(modeTabs[nextIndex].dataset.mode);
  });
});

export {
  renderFilterPower
};
