// PRESETS / SNAPSHOTS: preset library, A/B snapshots, morph and JSON import/export.
import { createPresetContract, PresetStore, presetStructureKey } from '../presets-core.mjs';
import { state, audioEngine } from './app-context.js';
import { syncUiFromAudioState } from './state-sync.js';

const presetContract = createPresetContract(window.ResonantState, audioEngine.getState());
const presetStore = new PresetStore(presetContract, {
  getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value)
});
const presetList = document.querySelector('[data-preset-list]');
const presetNameInput = document.querySelector('[data-preset-name]');
const presetStatus = document.querySelector('[data-preset-status]');
const presetMorph = document.querySelector('[data-preset-morph]');
let selectedPresetId = 'factory:init';
let presetConfirmation = null;
const captureProductionState = () => presetContract.capturePresetState(audioEngine.getState(), state);
const applyProductionState = (snapshot, morph = false) => {
  const continuous = morph && presetStructureKey(captureProductionState()) === presetStructureKey(snapshot);
  const normalized = presetContract.applyPresetState(audioEngine, snapshot, { continuous });
  syncUiFromAudioState({ ...audioEngine.getState(), bandChannelLinked: normalized.bandChannelLinked }, true);
  return normalized;
};
const setPresetStatus = message => { presetStatus.textContent = [message, presetStore.error].filter(Boolean).join(' · '); };
const cancelPresetConfirmation = () => { presetConfirmation = null; document.querySelector('[data-preset-confirmation]').hidden = true; };
const renderPresetControls = () => {
  const options = [{ label: 'FACTORY', entries: [{ id: 'factory:init', name: 'INIT' }] }, { label: 'USER', entries: presetStore.presets }];
  presetList.replaceChildren(...options.map(group => {
    const element = document.createElement('optgroup'); element.label = group.label;
    group.entries.forEach(entry => { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.name; element.append(option); });
    return element;
  }));
  presetList.value = selectedPresetId;
  presetNameInput.value = selectedPresetId === 'factory:init' ? 'INIT' : presetStore.entry(selectedPresetId)?.name || '';
  document.querySelector('[data-preset-selected-name]').textContent = presetNameInput.value;
  for (const action of ['update', 'rename', 'delete']) document.querySelector(`[data-preset-action="${action}"]`).disabled = selectedPresetId === 'factory:init';
  for (const slot of ['A', 'B']) {
    document.querySelector(`[data-snapshot-status="${slot}"]`).textContent = presetStore.snapshots[slot] ? 'CAPTURED' : 'EMPTY';
    document.querySelector(`[data-snapshot-recall="${slot}"]`).disabled = !presetStore.snapshots[slot];
  }
  presetMorph.disabled = !(presetStore.snapshots.A && presetStore.snapshots.B);
};
const runPresetAction = action => {
  try { action(); } catch (error) { setPresetStatus(error.message); }
};
const requestPresetConfirmation = (label, action) => {
  presetConfirmation = { id: selectedPresetId, action };
  document.querySelector('[data-preset-confirm-label]').textContent = label;
  document.querySelector('[data-preset-confirmation]').hidden = false;
  document.querySelector('[data-preset-confirm]').focus();
};
const downloadPresets = (data, filename) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
};
const presetActions = {
  load: () => { applyProductionState(selectedPresetId === 'factory:init' ? presetContract.init : presetStore.entry(selectedPresetId).state); setPresetStatus('PRESET LOADED'); },
  save: () => { selectedPresetId = presetStore.saveAs(presetNameInput.value, captureProductionState()).id; renderPresetControls(); setPresetStatus('PRESET SAVED'); },
  update: () => requestPresetConfirmation('UPDATE ausgewähltes User-Preset?', () => { presetStore.update(selectedPresetId, captureProductionState()); setPresetStatus('PRESET UPDATED'); }),
  rename: () => { presetStore.rename(selectedPresetId, presetNameInput.value); renderPresetControls(); setPresetStatus('PRESET RENAMED'); },
  duplicate: () => { selectedPresetId = presetStore.duplicate(selectedPresetId, presetNameInput.value).id; renderPresetControls(); setPresetStatus('PRESET DUPLICATED'); },
  delete: () => requestPresetConfirmation('DELETE ausgewähltes User-Preset?', () => { presetStore.delete(selectedPresetId); selectedPresetId = 'factory:init'; renderPresetControls(); setPresetStatus('PRESET DELETED'); }),
  import: () => document.querySelector('[data-preset-import]').click(),
  export: () => { downloadPresets(presetStore.exportPreset(selectedPresetId), 'da-filta-preset.json'); setPresetStatus('PRESET EXPORTED'); },
  'export-library': () => { downloadPresets(presetStore.exportLibrary(), 'da-filta-preset-library.json'); setPresetStatus('LIBRARY EXPORTED'); }
};
presetList.addEventListener('change', () => { selectedPresetId = presetList.value; cancelPresetConfirmation(); renderPresetControls(); setPresetStatus('SELECTED · LOAD TO RECALL'); });
document.querySelectorAll('[data-preset-action]').forEach(button => button.addEventListener('click', () => { cancelPresetConfirmation(); runPresetAction(presetActions[button.dataset.presetAction]); }));
document.querySelector('[data-preset-confirm]').addEventListener('click', () => { const pending = presetConfirmation; cancelPresetConfirmation(); if (pending?.id === selectedPresetId) runPresetAction(pending.action); });
document.querySelector('[data-preset-cancel]').addEventListener('click', cancelPresetConfirmation);
document.querySelector('[data-preset-import]').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { const imported = presetStore.import(await file.text()); if (imported.length) selectedPresetId = imported[0].id; renderPresetControls(); setPresetStatus(`${imported.length} PRESETS IMPORTED`); }
  catch (error) { setPresetStatus(`IMPORT ERROR: ${error.message}`); }
  finally { event.target.value = ''; }
});
document.querySelectorAll('[data-snapshot-capture]').forEach(button => button.addEventListener('click', () => runPresetAction(() => {
  presetStore.capture(button.dataset.snapshotCapture, captureProductionState()); renderPresetControls(); setPresetStatus('SNAPSHOT CAPTURED');
})));
document.querySelectorAll('[data-snapshot-recall]').forEach(button => button.addEventListener('click', () => runPresetAction(() => {
  const slot = button.dataset.snapshotRecall; applyProductionState(presetStore.snapshots[slot]); presetMorph.value = slot === 'A' ? '0' : '100';
  document.querySelector('[data-preset-morph-output]').textContent = `${presetMorph.value} %`; setPresetStatus(`SNAPSHOT ${slot} RECALLED`);
})));
presetMorph.addEventListener('input', () => runPresetAction(() => {
  if (presetMorph.disabled) return;
  applyProductionState(presetContract.interpolatePresetState(presetStore.snapshots.A, presetStore.snapshots.B, Number(presetMorph.value), audioEngine), true);
  document.querySelector('[data-preset-morph-output]').textContent = `${presetMorph.value} %`; setPresetStatus('MORPH · DISCRETE A < 50 % / B ≥ 50 %');
}));
document.querySelector('#mode-presets').addEventListener('keydown', event => {
  if (event.target.closest('button') && ['Enter', ' '].includes(event.key)) event.stopPropagation();
  if (event.key === 'Escape') cancelPresetConfirmation();
});
renderPresetControls(); setPresetStatus('CAPTURE A + B TO ENABLE MORPH');
window.PresetMode = Object.freeze({ capture: captureProductionState, apply: applyProductionState, contract: presetContract,
  getState: () => ({ presets: structuredClone(presetStore.presets), snapshots: structuredClone(presetStore.snapshots), selectedPresetId }),
  getAudioEngine: () => audioEngine });
