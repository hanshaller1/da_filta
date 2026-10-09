// DEV / LAB sweetspots: four persisted snapshots of the complete DEV / LAB configuration.
import { normalizeClockState } from '../clock-core.mjs';
import { state, audioEngine } from './app-context.js';
import { SWEETSPOT_SLOTS, sweetspotRows } from './dev-lab-panel.js';
import { commitMacroState } from './macro-mode.js';
import { commitLfoState, renderLfoControls } from './lfo-mode.js';
import { renderClockModControls } from './clock-mod-mode.js';
import { commitEnvelopeState, renderEnvelopeControls } from './envelope-mode.js';
import { setInputCharacterAmount } from './dev-lab-bindings.js';
import { syncUiFromAudioState } from './state-sync.js';

const SWEETSPOT_STORAGE_KEY = 'da-filta-sweetspots-v1';
const sweetspotDefaultName = slot => `Sweetspot ${slot}`;
const createEmptySweetspots = () => Object.fromEntries(SWEETSPOT_SLOTS.map(slot => [slot, { name: sweetspotDefaultName(slot), state: null }]));
const cloneSnapshot = value => JSON.parse(JSON.stringify(value));
const readSweetspots = () => {
  const empty = createEmptySweetspots();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SWEETSPOT_STORAGE_KEY) || 'null');
    if (!parsed || parsed.version !== 1 || !parsed.slots || typeof parsed.slots !== 'object') return empty;
    SWEETSPOT_SLOTS.forEach(slot => {
      const entry = parsed.slots[slot];
      if (!entry || typeof entry !== 'object') return;
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : empty[slot].name;
      const savedState = entry.state && typeof entry.state === 'object' && !Array.isArray(entry.state) ? entry.state : null;
      empty[slot] = { name, state: savedState ? cloneSnapshot(savedState) : null };
    });
  } catch { /* Invalid or unavailable storage means empty slots. */ }
  return empty;
};
let sweetspots = readSweetspots();
const persistSweetspots = () => {
  try { window.localStorage.setItem(SWEETSPOT_STORAGE_KEY, JSON.stringify({ version: 1, slots: sweetspots })); } catch { /* Storage may be unavailable. */ }
};
// This is the complete, explicit DEV/LAB snapshot contract. Normal app state
// is intentionally absent: DEV/LAB snapshots are experimental configurations,
// not production presets.
const DEV_LAB_SNAPSHOT_PROPERTIES = Object.freeze([
  ['macroSources', value => { Object.assign(state, window.ResonantState.normalizeMacroState({ macroSources: value })); commitMacroState(); }],
  ['clockMod', value => { state.clockMod = window.ResonantState.normalizeClockModState(value); audioEngine.setClockModState(state.clockMod); renderClockModControls(); }],
  ['envelopeModuleEnabled', value => { state.envelopeModuleEnabled = value === true; audioEngine.setModulationState(state); renderEnvelopeControls(); }],
  ['envelopeSources', value => {
    Object.assign(state, window.ResonantState.normalizeEnvelopeState({ envelopeSources: value }));
    commitEnvelopeState();
  }],
  ['lfoSources', value => {
    state.lfoSources = window.ResonantState.normalizeModulationState({ lfoSources: value, lfoModuleEnabled: state.lfoModuleEnabled }).lfoSources;
    commitLfoState();
  }],
  ['lfoModuleEnabled', value => { state.lfoModuleEnabled = value === true; commitLfoState(); }],
  ['lfoClock', value => { state.lfoClock = normalizeClockState(value); audioEngine.setLfoClockState(state.lfoClock); renderLfoControls(); }],
  ['inputPreampStage', value => audioEngine.setInputPreampStage(value)],
  ['inputCharacterAmount', value => setInputCharacterAmount(value)],
  ['outputGuardEnabled', value => audioEngine.setOutputGuardEnabled(value)],
  ['outputGuardThreshold', value => audioEngine.setOutputGuardThreshold(value)],
  ['outputGuardAttackMs', value => audioEngine.setOutputGuardAttackMs(value)],
  ['outputGuardReleaseMs', value => audioEngine.setOutputGuardReleaseMs(value)],
  ['outputProtectionEnabled', value => audioEngine.setOutputProtectionEnabled(value)],
  ['outputProtectionThreshold', value => audioEngine.setOutputProtectionThreshold(value)],
  ['outputProtectionSoftness', value => audioEngine.setOutputProtectionSoftness(value)],
  ['referenceLevel', value => audioEngine.setReferenceLevel(value)],
  ['maxBandBoostDb', value => audioEngine.setBandBoostDb(value)],
  ['maxBandCutDb', value => audioEngine.setBandCutDb(value)],
  ['spreadCurve', value => { state.spreadCurve = audioEngine.setSpreadCurve(value); }],
  ['spreadMaxOffsetDb', value => { state.spreadMaxOffsetDb = audioEngine.setSpreadMaxOffsetDb(value); }],
  ['positiveResonanceEngine', value => audioEngine.setPositiveResonanceEngine(value)],
  ['feedbackTopology', value => audioEngine.setFeedbackTopology(value)],
  ['feedbackCore', value => audioEngine.setFeedbackCore(value)],
  ['localLoopTuning', value => audioEngine.setLocalLoopTuning(value)],
  ['feedbackTap', value => audioEngine.setFeedbackTap(value)],
  ['feedbackTapModulation', value => audioEngine.setFeedbackTapModulation(value)],
  ['wetModel', value => audioEngine.setWetModel(value)],
  ['commonBusSaturationMode', value => audioEngine.setCommonBusSaturationMode(value)],
  ['commonBusDrive', value => audioEngine.setCommonBusDrive(value)],
  ['commonBusCeiling', value => audioEngine.setCommonBusCeiling(value)],
  ['feedbackAllEngine', value => audioEngine.setFeedbackAllEngine(value)],
  ['feedbackAllSource', value => audioEngine.setFeedbackAllSource(value)],
  ['postGainFeedbackWeight', value => audioEngine.setPostGainFeedbackWeight(value)],
  ['feedbackAllLevel', value => audioEngine.setFeedbackAllLevel(value)],
  ['feedbackAllAmount', value => audioEngine.setFeedbackAllAmount(value)],
  ['feedbackAllResonanceCurve', value => audioEngine.setFeedbackAllResonanceCurve(value)],
  ['feedbackAllSaturationReturn', value => audioEngine.setFeedbackAllSaturationReturn(value)],
  ['negativeResonanceMode', value => audioEngine.setNegativeResonanceMode(value)],
  ['negativeResonanceCurve', value => audioEngine.setNegativeResonanceCurve(value)],
  ['negativeResonanceAmount', value => audioEngine.setNegativeResonanceAmount(value)],
  ['negativeResonanceLocal', value => audioEngine.setNegativeResonanceLocal(value)],
  ['negativeResonanceMain', value => audioEngine.setNegativeResonanceMain(value)],
  ['negativeResonancePhase', value => audioEngine.setNegativeResonancePhase(value)],
  ['positiveResonanceAuditionGain', value => audioEngine.setPositiveResonanceAuditionGain(value)],
  ['positiveResonanceDrive', value => audioEngine.setPositiveResonanceDrive(value)],
  ['positiveResonanceDampingFloor', value => audioEngine.setPositiveResonanceDampingFloor(value)],
  ['positiveResonanceOutputMode', value => audioEngine.setPositiveResonanceOutputMode(value)],
  ['positiveResonanceLatencyMode', value => audioEngine.setPositiveResonanceLatencyMode(value)],
  ['positiveResonanceCurve', value => audioEngine.setPositiveResonanceCurve(value)]
].map(([key, apply]) => Object.freeze({ key, apply })));
const createDevLabSnapshot = () => {
  const currentState = audioEngine?.getState?.();
  if (!currentState) return null;
  return Object.fromEntries(DEV_LAB_SNAPSHOT_PROPERTIES.map(({ key }) => [key, currentState[key]]));
};
const applyDevLabSnapshot = snapshot => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
  if (!Array.isArray(snapshot.macroSources)) {
    Object.assign(state, window.ResonantState.normalizeMacroState());
    commitMacroState();
  }
  if (!Array.isArray(snapshot.lfoSources)
    && ['lfoEnabled', 'lfoWaveform', 'lfoRateHz', 'lfoPolarity', 'lfoPhase', 'lfoTargetId', 'lfoAmount', 'lfoSeed'].some(key => Object.prototype.hasOwnProperty.call(snapshot, key))) {
    const migrated = window.ResonantState.normalizeModulationState(snapshot);
    state.lfoSources = migrated.lfoSources;
    state.lfoModuleEnabled = migrated.lfoModuleEnabled;
    commitLfoState();
  }
  const snapshotBoolean = (key, fallback) => typeof snapshot[key] === 'boolean' ? snapshot[key] : fallback;
  const snapshotNumber = (key, fallback) => typeof snapshot[key] === 'number' && Number.isFinite(snapshot[key]) ? snapshot[key] : fallback;
  audioEngine.setOutputGuardEnabled(snapshotBoolean('outputGuardEnabled', true));
  audioEngine.setOutputGuardThreshold(snapshotNumber('outputGuardThreshold', 0.8));
  audioEngine.setOutputGuardAttackMs(snapshotNumber('outputGuardAttackMs', 2));
  audioEngine.setOutputGuardReleaseMs(snapshotNumber('outputGuardReleaseMs', 250));
  audioEngine.setOutputProtectionEnabled(snapshotBoolean('outputProtectionEnabled', true));
  audioEngine.setOutputProtectionThreshold(snapshotNumber('outputProtectionThreshold', 0.8));
  audioEngine.setOutputProtectionSoftness(snapshotNumber('outputProtectionSoftness', 100));
  const outputStateFields = new Set([
    'outputGuardEnabled', 'outputGuardThreshold', 'outputGuardAttackMs', 'outputGuardReleaseMs',
    'outputProtectionEnabled', 'outputProtectionThreshold', 'outputProtectionSoftness'
  ]);
  DEV_LAB_SNAPSHOT_PROPERTIES.forEach(({ key, apply }) => {
    if (!outputStateFields.has(key) && Object.prototype.hasOwnProperty.call(snapshot, key)) apply(snapshot[key]);
  });
  syncUiFromAudioState(audioEngine.getState());
};
const renderSweetspots = () => SWEETSPOT_SLOTS.forEach(slot => {
  const entry = sweetspots[slot]; const row = sweetspotRows.get(slot); if (!row) return;
  const nameInput = row.querySelector(`[data-sweetspot-name="${slot}"]`);
  const loadButton = row.querySelector(`[data-sweetspot-load="${slot}"]`);
  const clearButton = row.querySelector(`[data-sweetspot-clear="${slot}"]`);
  nameInput.value = entry.name; loadButton.disabled = !entry.state; clearButton.disabled = !entry.state;
});
SWEETSPOT_SLOTS.forEach(slot => {
  const row = sweetspotRows.get(slot); const nameInput = row.querySelector(`[data-sweetspot-name="${slot}"]`);
  nameInput.addEventListener('input', () => { sweetspots[slot].name = nameInput.value; persistSweetspots(); });
  row.querySelector(`[data-sweetspot-save="${slot}"]`).addEventListener('click', () => {
    const snapshot = createDevLabSnapshot();
    if (!snapshot) return;
    sweetspots[slot] = { name: nameInput.value || sweetspotDefaultName(slot), state: cloneSnapshot(snapshot) };
    persistSweetspots(); renderSweetspots();
  });
  row.querySelector(`[data-sweetspot-load="${slot}"]`).addEventListener('click', () => {
    const savedState = sweetspots[slot]?.state; if (!savedState) return;
    const snapshot = cloneSnapshot(savedState);
    applyDevLabSnapshot(snapshot);
  });
  row.querySelector(`[data-sweetspot-clear="${slot}"]`).addEventListener('click', () => {
    sweetspots[slot].state = null; persistSweetspots(); renderSweetspots();
  });
});
renderSweetspots();
