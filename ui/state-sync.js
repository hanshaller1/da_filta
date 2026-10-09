// Mirrors an AudioEngine state snapshot back into the UI state and every control.
import { normalizeClockState } from '../clock-core.mjs';
import { BAND_COUNT, state } from './app-context.js';
import {
  positiveResonanceAuditionSelect, positiveResonanceDriveSelect, positiveResonanceDampingFloorSelect,
  positiveResonanceOutputSelect, positiveResonanceLatencySelect, positiveResonanceCurveSelect
} from './dev-lab-panel.js';
import {
  outputGuardSelect, outputGuardThresholdInput, outputGuardAttackInput, outputGuardReleaseInput,
  outputProtectionSelect, outputThresholdInput, outputSoftnessInput, referenceLevelSelect,
  resonanceEngineSelect, bandBoostSelect, bandCutSelect, spreadMaxOffsetSelect, feedbackTopologySelect,
  feedbackCoreSelect, localLoopTuningSelect, feedbackTapSelect, feedbackTapModulationSelect, wetModelSelect,
  commonBusSatSelect, commonBusDriveSelect, commonBusCeilingSelect, feedbackAllEngineSelect,
  feedbackAllSourceSelect, postGainFeedbackWeightSelect, feedbackAllLevelSelect, feedbackAllAmountInput,
  feedbackAllResonanceCurveSelect, feedbackAllSaturationReturnSelect, negativeResonanceModeSelect,
  negativeResonanceCurveSelect, negativeResonanceAmountInput, negativeResonanceLocalSelect,
  negativeResonanceMainSelect, negativeResonancePhaseInput, updateNegativeResonanceRelevance,
  inputPreampStageSelect, inputCharacterAmountSlider
} from './dev-lab-controls.js';
import { renderMacroControls } from './macro-mode.js';
import { renderFilterMode } from './filter-mode.js';
import { renderDynamicEqControls } from './dynamic-eq-mode.js';
import { selectedLfoIndex, renderLfoControls, setSelectedLfoIndex } from './lfo-mode.js';
import { renderClockModControls } from './clock-mod-mode.js';
import { renderEnvelopeControls } from './envelope-mode.js';
import { renderFilterPower } from './mode-navigation.js';
import { faders, renderBandSliderValues, invalidateAllSpreadCenters, renderBand } from './bands.js';
import {
  fbAllButton, updatePerChannelBands, renderGlobalControlValue, configureSpreadControl
} from './global-controls.js';
import {
  updateDevControlRelevance, updateLocalLoopTuningRelevance, updateInputCharacterRelevance
} from './dev-lab-bindings.js';

const syncUiFromAudioState = (snapshot, fromPreset = false) => {
  if (!snapshot) return;
  Object.assign(state, window.ResonantState.normalizeDynamicEqState(snapshot));
  Object.assign(state, window.ResonantState.normalizeModulationState(snapshot));
  Object.assign(state, window.ResonantState.normalizeEnvelopeState(snapshot));
  Object.assign(state, window.ResonantState.normalizeMacroState(snapshot));
  state.clockMod = window.ResonantState.normalizeClockModState(snapshot.clockMod ?? state.clockMod ?? {});
  state.envelopeModuleEnabled = snapshot.envelopeModuleEnabled === true;
  if (snapshot.lfoClock) state.lfoClock = normalizeClockState(snapshot.lfoClock);
  setSelectedLfoIndex(Math.min(selectedLfoIndex, Math.max(0, state.lfoSources.length - 1)));
  renderDynamicEqControls();
  Object.assign(state, window.ResonantState.normalizeFilterState({
    filterType: snapshot.filterType ?? state.filterType,
    filterFrequencyHz: snapshot.filterFrequencyHz ?? state.filterFrequencyHz,
    filterSlope: snapshot.filterSlope ?? state.filterSlope,
    filterBandwidth: snapshot.filterBandwidth ?? state.filterBandwidth,
    filterResonance: snapshot.filterResonance ?? state.filterResonance,
    filterDepth: snapshot.filterDepth ?? state.filterDepth,
    ...Object.fromEntries(window.ResonantState.FILTER_EXTRA_FIELDS.map(field => [field, snapshot[field] ?? window.ResonantState.normalizeFilterState({})[field]]))
  }));
  if (snapshot.filterEnabled !== undefined) state.filterEnabled = Boolean(snapshot.filterEnabled);
  if (snapshot.filterbankEnabled !== undefined) state.filterbankEnabled = Boolean(snapshot.filterbankEnabled);
  state.bandGainLeft = Array.from({ length: BAND_COUNT }, (_, index) => Number(snapshot.bandGainLeft?.[index] ?? 0));
  state.bandGainRight = Array.from({ length: BAND_COUNT }, (_, index) => Number(snapshot.bandGainRight?.[index] ?? 0));
  invalidateAllSpreadCenters();
  state.perChannelBands = Boolean(snapshot.perChannelBands);
  state.bandChannelLinked = Array.from({ length: BAND_COUNT }, (_, index) => Boolean(snapshot.bandChannelLinked?.[index]));
  state.feedbackBandLeft = Array.from({ length: BAND_COUNT }, (_, index) => Boolean(snapshot.feedbackBandLeft?.[index]));
  state.feedbackBandRight = Array.from({ length: BAND_COUNT }, (_, index) => Boolean(snapshot.feedbackBandRight?.[index]));
  state.feedbackAllLeft = Boolean(snapshot.feedbackAllLeft);
  state.feedbackAllRight = Boolean(snapshot.feedbackAllRight);
  if (snapshot.spreadMaxOffsetDb !== undefined) state.spreadMaxOffsetDb = Number(snapshot.spreadMaxOffsetDb);
  configureSpreadControl(state.spreadMaxOffsetDb);
  if (snapshot.resonance !== undefined) renderGlobalControlValue('resonance', snapshot.resonance, fromPreset);
  if (snapshot.inputGainDb !== undefined) renderGlobalControlValue('inputGain', snapshot.inputGainDb, fromPreset);
  if (snapshot.dryWet !== undefined) renderGlobalControlValue('dryWet', snapshot.dryWet, fromPreset);
  if (snapshot.spread !== undefined) renderGlobalControlValue('spread', snapshot.spread, fromPreset);
  if (snapshot.volumeDb !== undefined) renderGlobalControlValue('volume', snapshot.volumeDb);
  if (snapshot.spreadMode !== undefined) state.spreadMode = snapshot.spreadMode;
  if (snapshot.spreadCurve !== undefined) state.spreadCurve = snapshot.spreadCurve;
  faders.forEach((_, index) => renderBand(index));
  document.querySelectorAll('[data-feedback-band]').forEach(button => {
    const active = state.feedbackBandLeft[Number(button.dataset.feedbackBand)];
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  if (fbAllButton) {
    fbAllButton.classList.toggle('active', state.feedbackAllLeft);
    fbAllButton.textContent = 'FB ALL';
    fbAllButton.setAttribute('aria-pressed', String(state.feedbackAllLeft));
  }
  updatePerChannelBands(!fromPreset);
  const selectValues = [
    [outputGuardSelect, snapshot.outputGuardEnabled === undefined ? undefined : snapshot.outputGuardEnabled ? 'on' : 'off'],
    [outputProtectionSelect, snapshot.outputProtectionEnabled === undefined ? undefined : snapshot.outputProtectionEnabled ? 'on' : 'off'],
    [bandBoostSelect, snapshot.maxBandBoostDb], [bandCutSelect, snapshot.maxBandCutDb],
    [spreadMaxOffsetSelect, snapshot.spreadMaxOffsetDb],
    [referenceLevelSelect, snapshot.referenceLevel], [resonanceEngineSelect, snapshot.positiveResonanceEngine],
    [feedbackTopologySelect, snapshot.feedbackTopology], [feedbackCoreSelect, snapshot.feedbackCore], [localLoopTuningSelect, snapshot.localLoopTuning],
    [feedbackTapSelect, snapshot.feedbackTap], [feedbackTapModulationSelect, snapshot.feedbackTapModulation], [wetModelSelect, snapshot.wetModel],
    [commonBusSatSelect, snapshot.commonBusSaturationMode], [commonBusDriveSelect, snapshot.commonBusDrive],
    [commonBusCeilingSelect, snapshot.commonBusCeiling], [feedbackAllEngineSelect, snapshot.feedbackAllEngine],
    [feedbackAllSourceSelect, snapshot.feedbackAllSource], [postGainFeedbackWeightSelect, snapshot.postGainFeedbackWeight],
    [feedbackAllLevelSelect, snapshot.feedbackAllLevel], [feedbackAllResonanceCurveSelect, snapshot.feedbackAllResonanceCurve],
    [feedbackAllSaturationReturnSelect, snapshot.feedbackAllSaturationReturn], [resonanceEngineSelect, snapshot.positiveResonanceEngine],
    [negativeResonanceModeSelect, snapshot.negativeResonanceMode], [negativeResonanceCurveSelect, snapshot.negativeResonanceCurve],
    [negativeResonanceLocalSelect, snapshot.negativeResonanceLocal === undefined ? undefined : snapshot.negativeResonanceLocal ? 'on' : 'off'],
    [negativeResonanceMainSelect, snapshot.negativeResonanceMain === undefined ? undefined : snapshot.negativeResonanceMain ? 'on' : 'off'],
    [positiveResonanceAuditionSelect, snapshot.positiveResonanceAuditionGain], [positiveResonanceDriveSelect, snapshot.positiveResonanceDrive],
    [positiveResonanceDampingFloorSelect, snapshot.positiveResonanceDampingFloor], [positiveResonanceOutputSelect, snapshot.positiveResonanceOutputMode],
    [positiveResonanceLatencySelect, snapshot.positiveResonanceLatencyMode], [positiveResonanceCurveSelect, snapshot.positiveResonanceCurve]
  ];
  const setSelectValue = (select, value) => {
    if (!select || value === undefined) return;
    const textValue = String(value);
    const exact = [...select.options].find(option => option.value === textValue);
    const numeric = exact || (Number.isFinite(Number(value)) ? [...select.options].find(option => Number(option.value) === Number(value)) : null);
    select.value = numeric?.value ?? textValue;
  };
  selectValues.forEach(([select, value]) => setSelectValue(select, value));
  if (feedbackAllAmountInput && snapshot.feedbackAllAmount !== undefined) feedbackAllAmountInput.value = String(snapshot.feedbackAllAmount);
  if (outputGuardThresholdInput && snapshot.outputGuardThreshold !== undefined) outputGuardThresholdInput.value = String(snapshot.outputGuardThreshold);
  if (outputGuardAttackInput && snapshot.outputGuardAttackMs !== undefined) outputGuardAttackInput.value = String(snapshot.outputGuardAttackMs);
  if (outputGuardReleaseInput && snapshot.outputGuardReleaseMs !== undefined) outputGuardReleaseInput.value = String(snapshot.outputGuardReleaseMs);
  if (outputThresholdInput && snapshot.outputProtectionThreshold !== undefined) outputThresholdInput.value = String(snapshot.outputProtectionThreshold);
  if (outputSoftnessInput && snapshot.outputProtectionSoftness !== undefined) outputSoftnessInput.value = String(snapshot.outputProtectionSoftness);
  if (negativeResonanceAmountInput && snapshot.negativeResonanceAmount !== undefined) negativeResonanceAmountInput.value = String(snapshot.negativeResonanceAmount);
  if (negativeResonancePhaseInput && snapshot.negativeResonancePhase !== undefined) negativeResonancePhaseInput.value = String(snapshot.negativeResonancePhase);
  setSelectValue(inputPreampStageSelect, snapshot.inputPreampStage);
  if (inputCharacterAmountSlider && snapshot.inputCharacterAmount !== undefined) {
    state.inputCharacterAmount = Number(snapshot.inputCharacterAmount);
    inputCharacterAmountSlider.value = String(snapshot.inputCharacterAmount);
    const output = document.querySelector('[data-input-character-output]');
    if (output) output.textContent = `${snapshot.inputCharacterAmount} %`;
  }
  updateInputCharacterRelevance();
  updateLocalLoopTuningRelevance();
  updateNegativeResonanceRelevance();
  updateDevControlRelevance();
  renderBandSliderValues();
  renderFilterPower();
  renderFilterMode();
  // Hidden source editors render from this base state when their workspace
  // opens. Morph must not rebuild their slot and assignment DOM every frame.
  if (!fromPreset || state.selectedWorkspaceMode === 'lfo') renderLfoControls();
  if (!fromPreset || state.selectedWorkspaceMode === 'envelope-follower') renderEnvelopeControls();
  if (!fromPreset || state.selectedWorkspaceMode === 'clock-mod') renderClockModControls();
  if (!fromPreset || state.selectedWorkspaceMode === 'presets') renderMacroControls();
};

export {
  syncUiFromAudioState
};
