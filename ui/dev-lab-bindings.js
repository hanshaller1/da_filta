// Connects the DEV / LAB controls to the AudioEngine and keeps their relevance state current.
import { GLOBAL_CONTROL_DEFINITIONS, state, audioEngine, hooks } from './app-context.js';
import {
  POSITIVE_RESONANCE_AUDITION_VALUES, positiveResonanceAuditionSelect, positiveResonanceDriveSelect,
  positiveResonanceDampingFloorSelect, positiveResonanceOutputSelect, positiveResonanceLatencySelect,
  positiveResonanceCurveSelect
} from './dev-lab-panel.js';
import { devLabTelemetry } from './dev-lab-telemetry.js';
import {
  outputGuardSelect, outputGuardThresholdInput, outputGuardAttackInput, outputGuardReleaseInput,
  outputProtectionSelect, outputThresholdInput, outputSoftnessInput, referenceLevelSelect,
  resonanceEngineSelect, bandBoostSelect, bandCutSelect, spreadMaxOffsetSelect, feedbackTopologySelect,
  feedbackCoreSelect, localLoopTuningSelect, feedbackTapSelect, feedbackTapModulationSelect, wetModelSelect,
  commonBusSatSelect, commonBusDriveSelect, commonBusCeilingSelect, feedbackAllEngineSelect,
  feedbackAllSourceSelect, postGainFeedbackWeightSelect, feedbackAllLevelSelect, feedbackAllAmountInput,
  feedbackAllResonanceCurveSelect, feedbackAllSaturationReturnSelect, negativeResonanceModeSelect,
  negativeResonanceCurveSelect, negativeResonanceAmountInput, negativeResonanceLocalSelect,
  negativeResonanceMainSelect, negativeResonancePhaseInput, inputPreampStageSelect,
  inputCharacterAmountSlider
} from './dev-lab-controls.js';
import { renderFilterMode } from './filter-mode.js';
import {
  renderAnalyzerScale, renderBandSliderValues, invalidateAllSpreadCenters, materializeSpreadDb
} from './bands.js';
import { fbAllButton, renderGlobalControlValue, configureSpreadControl } from './global-controls.js';

const setPositiveResonanceAuditionGain = value => {
  const numericValue = Number(value);
  const nextValue = POSITIVE_RESONANCE_AUDITION_VALUES.includes(numericValue) ? numericValue : 0.10;
  if (positiveResonanceAuditionSelect) positiveResonanceAuditionSelect.value = nextValue.toFixed(2);
  audioEngine.setPositiveResonanceAuditionGain(nextValue);
};
setPositiveResonanceAuditionGain(positiveResonanceAuditionSelect?.value ?? 0.10);
positiveResonanceAuditionSelect?.addEventListener('change', event => setPositiveResonanceAuditionGain(event.target.value));
const POSITIVE_RESONANCE_DRIVE_VALUES = [1, 2, 4, 8, 16, 24, 32];
const setPositiveResonanceDrive = value => {
  const numericValue = Number(value);
  const nextValue = POSITIVE_RESONANCE_DRIVE_VALUES.includes(numericValue) ? numericValue : 1;
  if (positiveResonanceDriveSelect) positiveResonanceDriveSelect.value = String(nextValue);
  audioEngine.setPositiveResonanceDrive(nextValue);
};
setPositiveResonanceDrive(positiveResonanceDriveSelect?.value ?? 1);
positiveResonanceDriveSelect?.addEventListener('change', event => setPositiveResonanceDrive(event.target.value));
const POSITIVE_RESONANCE_DAMPING_FLOOR_VALUES = [0.10, 0.05, 0.02, 0.00, -0.02, -0.05, -0.10];
const setPositiveResonanceDampingFloor = value => {
  const numericValue = Number(value);
  const nextValue = POSITIVE_RESONANCE_DAMPING_FLOOR_VALUES.includes(numericValue) ? numericValue : 0.10;
  if (positiveResonanceDampingFloorSelect) positiveResonanceDampingFloorSelect.value = nextValue.toFixed(2);
  audioEngine.setPositiveResonanceDampingFloor(nextValue);
};
setPositiveResonanceDampingFloor(positiveResonanceDampingFloorSelect?.value ?? 0.10);
positiveResonanceDampingFloorSelect?.addEventListener('change', event => setPositiveResonanceDampingFloor(event.target.value));
const POSITIVE_RESONANCE_OUTPUT_VALUES = ['current-residual', 'nonlinear-base', 'full-nonlinear'];
const setPositiveResonanceOutputMode = value => {
  const nextValue = POSITIVE_RESONANCE_OUTPUT_VALUES.includes(value) ? value : 'current-residual';
  if (positiveResonanceOutputSelect) positiveResonanceOutputSelect.value = nextValue;
  audioEngine.setPositiveResonanceOutputMode(nextValue);
};
setPositiveResonanceOutputMode(positiveResonanceOutputSelect?.value ?? 'current-residual');
positiveResonanceOutputSelect?.addEventListener('change', event => setPositiveResonanceOutputMode(event.target.value));
const POSITIVE_RESONANCE_LATENCY_VALUES = ['current', 'matched'];
const setPositiveResonanceLatencyMode = value => {
  const nextValue = POSITIVE_RESONANCE_LATENCY_VALUES.includes(value) ? value : 'current';
  if (positiveResonanceLatencySelect) positiveResonanceLatencySelect.value = nextValue;
  audioEngine.setPositiveResonanceLatencyMode(nextValue);
};
setPositiveResonanceLatencyMode(positiveResonanceLatencySelect?.value ?? 'current');
positiveResonanceLatencySelect?.addEventListener('change', event => setPositiveResonanceLatencyMode(event.target.value));
const POSITIVE_RESONANCE_CURVE_VALUES = ['current', 'early', 'aggressive'];
const setPositiveResonanceCurve = value => {
  const nextValue = POSITIVE_RESONANCE_CURVE_VALUES.includes(value) ? value : 'current';
  if (positiveResonanceCurveSelect) positiveResonanceCurveSelect.value = nextValue;
  audioEngine.setPositiveResonanceCurve(nextValue);
};
setPositiveResonanceCurve(positiveResonanceCurveSelect?.value ?? 'current');
positiveResonanceCurveSelect?.addEventListener('change', event => setPositiveResonanceCurve(event.target.value));
const devControlOriginalTitles = new WeakMap();
const setDevControlRelevance = (control, active, reason) => {
  if (!control) return;
  if (!devControlOriginalTitles.has(control)) devControlOriginalTitles.set(control, control.title);
  control.disabled = !active;
  control.setAttribute('aria-disabled', String(!active));
  control.title = active ? devControlOriginalTitles.get(control) : reason;
  const label = control.closest('.dev-lab-control');
  label?.classList.toggle('is-irrelevant', !active);
  if (label) label.title = active ? '' : reason;
};
const updateDevControlRelevance = () => {
  const topology = audioEngine.feedbackTopology;
  const core = audioEngine.feedbackCore;
  const mainBus = topology !== 'isolated-tpt' && (core !== 'current' || audioEngine.feedbackAllEngine === 'common-bus');
  const staticMainTap = mainBus && audioEngine.feedbackAllSource === 'post-gain-sum';
  const sharedBandSat = core === 'zdf-shared-band-sat';
  const isolatedTpt = topology === 'isolated-tpt' && core !== 'zdf-per-band' && !sharedBandSat;
  const positiveResonator = isolatedTpt && audioEngine.positiveResonanceEngine === 'tpt';
  const mainCurrentSaturation = mainBus && audioEngine.feedbackAllEngine === 'common-bus'
    && audioEngine.commonBusSaturationMode === 'current' && topology === 'common-bus';
  for (const control of [outputGuardThresholdInput, outputGuardAttackInput, outputGuardReleaseInput]) {
    setDevControlRelevance(control, audioEngine.outputGuardEnabled, 'Nur bei OUTPUT GUARD ON aktiv.');
  }
  setDevControlRelevance(outputThresholdInput, audioEngine.outputProtectionEnabled, 'Nur bei FINAL SAFETY ON aktiv.');
  setDevControlRelevance(outputSoftnessInput, audioEngine.outputProtectionEnabled, 'Nur bei FINAL SAFETY ON aktiv.');
  setDevControlRelevance(referenceLevelSelect, audioEngine.wetModel === 'reference-delta', 'Nur mit REFERENCE + DELTA aktiv.');
  setDevControlRelevance(spreadMaxOffsetSelect, !state.perChannelBands, 'Nur im CLASSIC-Spread-Modus aktiv.');
  setDevControlRelevance(feedbackCoreSelect, topology !== 'isolated-tpt' || sharedBandSat, 'ZDF ist nur mit COMMON BUS oder LOCAL LOOP EXP aktiv.');
  setDevControlRelevance(localLoopTuningSelect, topology === 'local-loop-exp' && core === 'current' && audioEngine.positiveResonanceEngine === 'tpt', 'Nur mit LOCAL LOOP EXP + CURRENT + TPT aktiv.');
  setDevControlRelevance(feedbackTapSelect, !sharedBandSat && (topology === 'common-bus' || (topology === 'local-loop-exp' && core === 'zdf-per-band')), 'Nur für COMMON BUS oder LOCAL LOOP EXP + ZDF PER-BAND aktiv; nicht mit SHARED BUS · BAND SAT.');
  const zdfPostGainLocalTap = (core === 'zdf' && topology === 'common-bus' && audioEngine.feedbackTap === 'post-gain')
    || (core === 'zdf-per-band' && topology !== 'isolated-tpt' && audioEngine.feedbackTap === 'post-gain');
  setDevControlRelevance(feedbackTapModulationSelect, !sharedBandSat && (zdfPostGainLocalTap || (core !== 'current' && staticMainTap)),
    'Nur mit UNIFIED/PER-BAND ZDF und POST-GAIN-Tap oder POST-GAIN-MAIN-Summe aktiv.');
  setDevControlRelevance(commonBusSatSelect, !sharedBandSat && (topology === 'common-bus' || mainBus), 'Nur mit COMMON-BUS-Return aktiv; nicht mit SHARED BUS · BAND SAT.');
  const constantCeiling = commonBusSatSelect && !commonBusSatSelect.disabled && audioEngine.commonBusSaturationMode === 'constant-ceiling';
  setDevControlRelevance(commonBusDriveSelect, constantCeiling, 'Nur mit COMMON-BUS-Return + CONSTANT CEILING aktiv.');
  setDevControlRelevance(commonBusCeilingSelect, constantCeiling, 'Nur mit COMMON-BUS-Return + CONSTANT CEILING aktiv.');
  setDevControlRelevance(feedbackAllEngineSelect, topology !== 'isolated-tpt' && core === 'current', 'Nur im CURRENT-Core mit COMMON BUS oder LOCAL LOOP EXP aktiv.');
  setDevControlRelevance(feedbackAllSourceSelect, mainBus, 'Nur mit COMMON-BUS-MAIN aktiv.');
  setDevControlRelevance(postGainFeedbackWeightSelect, staticMainTap, 'Nur mit COMMON-BUS-MAIN + STATIC POST-GAIN SUM aktiv.');
  setDevControlRelevance(feedbackAllLevelSelect, mainBus, 'Nur mit COMMON-BUS-MAIN aktiv.');
  setDevControlRelevance(feedbackAllAmountInput, !(topology === 'isolated-tpt' && core !== 'current'), 'In dieser Feedback-Topologie ohne MAIN-Return.');
  setDevControlRelevance(feedbackAllResonanceCurveSelect, mainBus && topology === 'common-bus', 'Nur für positive COMMON-BUS-MAIN-Resonance aktiv.');
  setDevControlRelevance(feedbackAllSaturationReturnSelect, mainCurrentSaturation, 'Nur mit COMMON-BUS-MAIN + CURRENT-Saturation aktiv.');
  const negative = audioEngine.resonance < 0;
  for (const control of [negativeResonanceModeSelect, negativeResonanceCurveSelect, negativeResonanceAmountInput, negativeResonanceLocalSelect, negativeResonanceMainSelect]) {
    setDevControlRelevance(control, negative, 'Nur bei negativer Resonance aktiv.');
  }
  setDevControlRelevance(negativeResonancePhaseInput, negative && audioEngine.negativeResonanceMode === 'phase', 'Nur bei negativer Resonance im PHASE-Modus aktiv.');
  setDevControlRelevance(resonanceEngineSelect, isolatedTpt, 'Nur im ISOLATED TPT-Pfad aktiv.');
  for (const control of [positiveResonanceAuditionSelect, positiveResonanceDriveSelect, positiveResonanceDampingFloorSelect, positiveResonanceOutputSelect, positiveResonanceLatencySelect, positiveResonanceCurveSelect]) {
    setDevControlRelevance(control, positiveResonator, 'Nur im positiven ISOLATED TPT-Resonatorpfad aktiv.');
  }
};
hooks.updateDevControlRelevance = updateDevControlRelevance;
const bindDevLabSelect = (select, apply, fallback) => {
  if (!select) return;
  let previous = select.value ?? fallback;
  apply(previous);
  select.addEventListener('change', event => {
    const next = event.target.value;
    apply(next);
    updateDevControlRelevance();
    devLabTelemetry.logStateChange(select.previousElementSibling?.textContent || select.closest('label')?.querySelector('span')?.textContent || 'DEV PARAMETER', previous, next);
    previous = next;
  });
};
bindDevLabSelect(outputGuardSelect, value => audioEngine.setOutputGuardEnabled(value === 'on'), 'on');
bindDevLabSelect(outputProtectionSelect, value => audioEngine.setOutputProtectionEnabled(value === 'on'), 'on');
bindDevLabSelect(referenceLevelSelect, value => audioEngine.setReferenceLevel(value), '1');
bindDevLabSelect(resonanceEngineSelect, value => audioEngine.setPositiveResonanceEngine(value), 'tpt');
bindDevLabSelect(bandBoostSelect, value => {
  audioEngine.setBandBoostDb(value);
  invalidateAllSpreadCenters();
  renderAnalyzerScale();
  renderBandSliderValues();
  renderFilterMode();
}, '12');
bindDevLabSelect(bandCutSelect, value => {
  audioEngine.setBandCutDb(value);
  invalidateAllSpreadCenters();
  renderAnalyzerScale();
  renderBandSliderValues();
  renderFilterMode();
}, '12');
bindDevLabSelect(spreadMaxOffsetSelect, value => {
  state.spreadMaxOffsetDb = audioEngine.setSpreadMaxOffsetDb(value);
  configureSpreadControl(state.spreadMaxOffsetDb);
  const clampedSpread = window.ResonantState.clampSpread(state.spread, state.spreadMaxOffsetDb);
  if (clampedSpread !== state.spread) {
    renderGlobalControlValue('spread', clampedSpread);
    audioEngine.setSpread(clampedSpread);
    materializeSpreadDb(clampedSpread);
  } else renderBandSliderValues();
}, '6');
const updateLocalLoopTuningRelevance = () => {
  updateDevControlRelevance();
  const localTitle = audioEngine.feedbackCore === 'zdf-per-band'
    ? 'LOCAL: Eigene Rückkopplung dieses Bands; FB ALL ergänzt eine separate gemeinsame MAIN-Schleife.'
    : audioEngine.feedbackCore === 'zdf' ? 'UNIFIED ZDF: Dieses Band speist den gemeinsamen impliziten Feedback-Return.'
    : audioEngine.feedbackCore === 'zdf-shared-band-sat' ? 'SHARED BUS: Dieses Band speist den gemeinsamen Eingangssummierer aller Bänder und begrenzt sich in seiner eigenen Gain-Stufe.'
      : audioEngine.feedbackTopology === 'common-bus'
        ? 'COMMON BUS: Dieses Band speist den gemeinsamen Feedback-Bus; sein Return regt alle zehn Bänder dieses Kanals an.'
        : 'LOCAL: Rückkopplung dieses Bands im gewählten DEV/LAB-Pfad.';
  document.querySelectorAll('[data-feedback-band]').forEach(button => { button.title = localTitle; });
  if (fbAllButton) {
    fbAllButton.disabled = false;
    fbAllButton.classList.remove('is-phase-one-inactive');
    fbAllButton.title = 'Separater MAIN-Feedback-Bus mit eigenem Schalter; unabhängig von den einzelnen FB-Bandtasten.';
    fbAllButton.textContent = 'FB ALL';
    fbAllButton.setAttribute('aria-pressed', String(state.feedbackAllLeft));
  }
};
bindDevLabSelect(feedbackTopologySelect, value => {
  audioEngine.setFeedbackTopology(value);
  updateLocalLoopTuningRelevance();
}, 'isolated-tpt');
bindDevLabSelect(feedbackCoreSelect, value => { audioEngine.setFeedbackCore(value); updateLocalLoopTuningRelevance(); }, 'zdf-per-band');
bindDevLabSelect(localLoopTuningSelect, value => audioEngine.setLocalLoopTuning(value), 'current');
bindDevLabSelect(feedbackTapSelect, value => audioEngine.setFeedbackTap(value), 'pre-gain');
bindDevLabSelect(feedbackTapModulationSelect, value => audioEngine.setFeedbackTapModulation(value), 'include');
bindDevLabSelect(wetModelSelect, value => audioEngine.setWetModel(value), 'reference-delta');
bindDevLabSelect(commonBusSatSelect, value => audioEngine.setCommonBusSaturationMode(value), 'current');
bindDevLabSelect(commonBusDriveSelect, value => audioEngine.setCommonBusDrive(value), '1');
bindDevLabSelect(commonBusCeilingSelect, value => audioEngine.setCommonBusCeiling(value), '1');
bindDevLabSelect(feedbackAllEngineSelect, value => audioEngine.setFeedbackAllEngine(value), 'legacy');
bindDevLabSelect(feedbackAllSourceSelect, value => audioEngine.setFeedbackAllSource(value), 'post-gain-sum');
bindDevLabSelect(postGainFeedbackWeightSelect, value => audioEngine.setPostGainFeedbackWeight(value), 'current');
bindDevLabSelect(feedbackAllLevelSelect, value => audioEngine.setFeedbackAllLevel(value), 'raw');
bindDevLabSelect(feedbackAllResonanceCurveSelect, value => audioEngine.setFeedbackAllResonanceCurve(value), 'current');
bindDevLabSelect(feedbackAllSaturationReturnSelect, value => audioEngine.setFeedbackAllSaturationReturn(value), 'current');
const updateInputCharacterRelevance = () => {
  const control = inputCharacterAmountSlider?.closest('.dev-lab-character-control');
  const irrelevant = inputPreampStageSelect?.value === 'linear';
  control?.classList.toggle('is-irrelevant', irrelevant);
  if (inputCharacterAmountSlider) inputCharacterAmountSlider.disabled = irrelevant;
  inputCharacterAmountSlider?.setAttribute('aria-disabled', String(irrelevant));
};
bindDevLabSelect(inputPreampStageSelect, value => {
  const stage = audioEngine.setInputPreampStage(value);
  if (inputPreampStageSelect) inputPreampStageSelect.value = stage;
  updateInputCharacterRelevance();
}, 'linear');
const setInputCharacterAmount = value => {
  const definition = GLOBAL_CONTROL_DEFINITIONS.inputCharacterAmount;
  const numeric = Number(value);
  const amount = Number.isFinite(numeric) ? Math.max(definition.min, Math.min(definition.max, Math.round(numeric))) : definition.defaultValue;
  state.inputCharacterAmount = amount;
  if (inputCharacterAmountSlider) inputCharacterAmountSlider.value = String(amount);
  const output = document.querySelector('[data-input-character-output]');
  if (output) output.textContent = `${amount} %`;
  audioEngine.setInputCharacterAmount(amount);
};
setInputCharacterAmount(state.inputCharacterAmount);
inputCharacterAmountSlider?.addEventListener('input', event => setInputCharacterAmount(event.target.value));
document.addEventListener('change', event => {
  if (event.target.closest('.dev-lab-control')) updateDevControlRelevance();
});
updateDevControlRelevance();

export {
  updateDevControlRelevance, updateLocalLoopTuningRelevance, updateInputCharacterRelevance,
  setInputCharacterAmount
};
