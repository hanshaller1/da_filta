// Creates the DEV / LAB controls in panel order. Their audio bindings live in dev-lab-bindings.js.
import { state, audioEngine } from './app-context.js';
import { devLabGroups, addDevLabSelector, addDevLabNumberControl } from './dev-lab-panel.js';

const outputGuardSelect = addDevLabSelector('OUTPUT GUARD', 'data-output-guard-enabled', [['on', 'ON'], ['off', 'OFF']]);
const outputGuardThresholdInput = addDevLabNumberControl({
  label: 'GUARD THRESHOLD', attribute: 'data-output-guard-threshold', min: 0.25, max: 0.95, step: 0.01, suffix: 'FS',
  tooltip: 'Pegelziel für die dynamische Gain Reduction nach dem Master. Standard: 0,80 FS.',
  value: () => audioEngine?.outputGuardThreshold ?? 0.8,
  onChange: value => audioEngine?.setOutputGuardThreshold(value), group: 'output'
});
const outputGuardAttackInput = addDevLabNumberControl({
  label: 'ATTACK', attribute: 'data-output-guard-attack-ms', min: 0.1, max: 50, step: 0.1, suffix: 'ms',
  tooltip: 'Zeitkonstante für schnellere Gain Reduction ohne Lookahead. Standard: 2 ms.',
  value: () => audioEngine?.outputGuardAttackMs ?? 2,
  onChange: value => audioEngine?.setOutputGuardAttackMs(value), group: 'output'
});
const outputGuardReleaseInput = addDevLabNumberControl({
  label: 'RELEASE', attribute: 'data-output-guard-release-ms', min: 20, max: 2000, step: 10, suffix: 'ms',
  tooltip: 'Zeitkonstante für die Rückkehr des Gains zu 1. Standard: 250 ms.',
  value: () => audioEngine?.outputGuardReleaseMs ?? 250,
  onChange: value => audioEngine?.setOutputGuardReleaseMs(value), group: 'output'
});
const outputProtectionSelect = addDevLabSelector('FINAL SAFETY', 'data-output-protection-enabled', [['on', 'ON'], ['off', 'OFF']]);
const outputThresholdInput = addDevLabNumberControl({
  label: 'SAFETY KNEE START', attribute: 'data-output-protection-threshold', min: 0.5, max: 0.95, step: 0.01, suffix: 'FS',
  tooltip: 'Beginn der finalen Soft-Knee-Sicherung; kein zweiter dynamischer Limiter-Threshold. Standard: 0,80 FS.',
  value: () => audioEngine?.outputProtectionThreshold ?? 0.8,
  onChange: value => audioEngine?.setOutputProtectionThreshold(value), group: 'output'
});
const outputSoftnessInput = addDevLabNumberControl({
  label: 'SOFTNESS', attribute: 'data-output-protection-softness', min: 0, max: 100, step: 1, suffix: '%',
  tooltip: '100 % = weichste Kennlinie; 0 % erreicht die feste 0,99-FS-Grenze früher. Der Übergang beginnt glatt am Threshold.',
  value: () => audioEngine?.outputProtectionSoftness ?? 100,
  onChange: value => audioEngine?.setOutputProtectionSoftness(value), group: 'output'
});
const referenceLevelSelect = addDevLabSelector('DEV REFERENCE', 'data-reference-level', [['1', '100 %'], ['0.75', '75 %'], ['0.5', '50 %'], ['0.25', '25 %'], ['0', '0 % / BANDS ONLY']]);
const resonanceEngineSelect = addDevLabSelector('DEV RES ENGINE', 'data-positive-resonance-engine', [['tpt', 'TPT'], ['phase2', 'PHASE 2 · LEGACY']]);
const bandBoostSelect = addDevLabSelector('DEV BAND BOOST', 'data-band-boost-db', [['12', '+12 dB'], ['18', '+18 dB'], ['24', '+24 dB']]);
const bandCutSelect = addDevLabSelector('DEV BAND CUT', 'data-band-cut-db', [['12', '-12 dB'], ['24', '-24 dB'], ['36', '-36 dB'], ['48', '-48 dB'], ['60', '-60 dB']]);
const spreadMaxOffsetSelect = addDevLabSelector('DEV SPREAD MAX OFFSET', 'data-spread-max-offset-db', [['3', '3 dB'], ['6', '6 dB'], ['9', '9 dB'], ['12', '12 dB']]);
if (spreadMaxOffsetSelect) spreadMaxOffsetSelect.value = '6';
const feedbackTopologySelect = addDevLabSelector('DEV FB TOPOLOGY', 'data-feedback-topology', [['isolated-tpt', 'ISOLATED TPT'], ['common-bus', 'COMMON BUS · DA_FILTA-ORIGINAL'], ['local-loop-exp', 'LOCAL LOOP EXP']]);
const feedbackCoreSelect = addDevLabSelector('FEEDBACK CORE', 'data-feedback-core', [['current', 'CURRENT COMMON'], ['zdf', 'UNIFIED ZDF'], ['zdf-per-band', 'PER-BAND ZDF'], ['zdf-shared-band-sat', 'SHARED BUS · BAND SAT']]);
const localLoopTuningSelect = addDevLabSelector('DEV LOCAL LOOP TUNING', 'data-local-loop-tuning', [['current', 'CURRENT'], ['compensated', 'COMPENSATED']]);
const feedbackTapSelect = addDevLabSelector('DEV FB TAP', 'data-feedback-tap', [['pre-gain', 'PRE GAIN'], ['post-gain', 'POST GAIN']]);
const feedbackTapModulationSelect = addDevLabSelector('DEV FB TAP MOD', 'data-feedback-tap-modulation', [['include', 'FADER + MOD'], ['exclude', 'FADER ONLY · LEGACY']]);
const wetModelSelect = addDevLabSelector('DEV WET MODEL', 'data-wet-model', [['reference-delta', 'REFERENCE + DELTA'], ['filterbank-sum', 'FILTERBANK SUM']]);
const commonBusSatSelect = addDevLabSelector('DEV FB SAT', 'data-common-bus-saturation-mode', [['current', 'CURRENT'], ['constant-ceiling', 'CONSTANT CEILING']]);
const commonBusDriveSelect = addDevLabSelector('DEV FB DRIVE', 'data-common-bus-drive', [['0.5', '0.5'], ['1', '1'], ['2', '2'], ['4', '4'], ['8', '8'], ['16', '16']]);
const commonBusCeilingSelect = addDevLabSelector('DEV FB CEILING', 'data-common-bus-ceiling', [['0.25', '0.25'], ['0.5', '0.50'], ['1', '1.00'], ['2', '2.00'], ['4', '4.00']]);
const feedbackAllEngineSelect = addDevLabSelector('DEV FB ALL ENGINE', 'data-feedback-all-engine', [['legacy', 'LEGACY'], ['common-bus', 'COMMON BUS']]);
const feedbackAllSourceSelect = addDevLabSelector('DEV FB ALL SOURCE', 'data-feedback-all-source', [['pre-gain-sum', 'PRE GAIN SUM'], ['post-gain-sum', 'STATIC POST-GAIN SUM']]);
if (feedbackAllSourceSelect) feedbackAllSourceSelect.value = 'post-gain-sum';
const postGainFeedbackWeightSelect = addDevLabSelector('DEV POST GAIN FB WEIGHT', 'data-post-gain-feedback-weight', [['current', 'CURRENT'], ['soft-knee', 'SOFT KNEE']]);
const feedbackAllLevelSelect = addDevLabSelector('DEV FB ALL LEVEL', 'data-feedback-all-level', [
  ['raw', 'RAW'],
  ['sqrt2', '1 / SQRT(2)'],
  ['half', '1 / 2'],
  ['sqrt10', '1 / SQRT(10)'],
  ['tenth', '1 / 10'],
  ['twentieth', '1 / 20'],
  ['fortieth', '1 / 40'],
  ['eightieth', '1 / 80']
]);
if (wetModelSelect) wetModelSelect.value = 'filterbank-sum';
if (feedbackTopologySelect) feedbackTopologySelect.value = 'common-bus';
if (feedbackCoreSelect) feedbackCoreSelect.value = 'zdf-per-band';
if (feedbackTapSelect) feedbackTapSelect.value = 'post-gain';
if (feedbackTapModulationSelect) feedbackTapModulationSelect.value = 'include';
if (feedbackAllEngineSelect) feedbackAllEngineSelect.value = 'common-bus';
if (feedbackAllLevelSelect) feedbackAllLevelSelect.value = 'sqrt10';
const feedbackAllAmountInput = addDevLabNumberControl({
  label: 'FB ALL AMOUNT', attribute: 'data-feedback-all-amount', min: 0, max: 100, step: 1, suffix: '%',
  tooltip: 'Skaliert ausschließlich die Stärke des gemeinsamen FB-ALL/MAIN-Feedback-Loops. 100 % entspricht dem bisherigen Verhalten. LOCAL-Feedback bleibt unverändert.',
  value: () => audioEngine?.feedbackAllAmount ?? 100,
  onChange: value => audioEngine?.setFeedbackAllAmount(value)
});
const feedbackAllResonanceCurveSelect = addDevLabSelector('DEV RESONANCE CURVE', 'data-feedback-all-resonance-curve', [['current', 'CURRENT'], ['soft-knee', 'SOFT KNEE']]);
const feedbackAllSaturationReturnSelect = addDevLabSelector('DEV MAIN SAT/RETURN', 'data-feedback-all-saturation-return', [['current', 'CURRENT'], ['drive-4-return-0.2', 'DRIVE 4 / RETURN 0.2']]);
const negativeResonanceModeSelect = addDevLabSelector('NEG MODE', 'data-negative-resonance-mode', [['signed', 'SIGNED'], ['damping', 'DAMPING'], ['anti-resonance', 'ANTI-RESONANCE'], ['phase', 'PHASE']]);
const negativeResonanceCurveSelect = addDevLabSelector('NEG CURVE', 'data-negative-resonance-curve', [['same-as-positive', 'SAME AS POSITIVE'], ['linear', 'LINEAR'], ['squared', 'SQUARED'], ['soft-knee', 'SOFT KNEE']]);
const negativeResonanceAmountInput = addDevLabNumberControl({ label: 'NEG AMOUNT', attribute: 'data-negative-resonance-amount', min: 0, max: 200, step: 1, suffix: '%', tooltip: 'Stärke des negativen Feedback-Experiments; kein Output-Gain.', value: () => audioEngine?.negativeResonanceAmount ?? 100, onChange: value => audioEngine?.setNegativeResonanceAmount(value), group: 'negative-resonance' });
const negativeResonanceLocalSelect = addDevLabSelector('NEG LOCAL', 'data-negative-resonance-local', [['on', 'ON'], ['off', 'OFF']]);
const negativeResonanceMainSelect = addDevLabSelector('NEG MAIN', 'data-negative-resonance-main', [['on', 'ON'], ['off', 'OFF']]);
const negativeResonancePhaseInput = addDevLabNumberControl({ label: 'NEG PHASE', attribute: 'data-negative-resonance-phase', min: 0, max: 180, step: 1, suffix: '°', tooltip: 'PHASE-Experiment: Zielstärke der stabilen negativen Phaseninteraktion.', value: () => audioEngine?.negativeResonancePhase ?? 90, onChange: value => audioEngine?.setNegativeResonancePhase(value), group: 'negative-resonance' });
const updateNegativeResonanceRelevance = () => { if (negativeResonancePhaseInput) negativeResonancePhaseInput.disabled = negativeResonanceModeSelect?.value !== 'phase'; };
negativeResonanceModeSelect?.addEventListener('change', event => { audioEngine?.setNegativeResonanceMode(event.target.value); updateNegativeResonanceRelevance(); });
negativeResonanceCurveSelect?.addEventListener('change', event => audioEngine?.setNegativeResonanceCurve(event.target.value));
negativeResonanceLocalSelect?.addEventListener('change', event => audioEngine?.setNegativeResonanceLocal(event.target.value === 'on'));
negativeResonanceMainSelect?.addEventListener('change', event => audioEngine?.setNegativeResonanceMain(event.target.value === 'on'));
updateNegativeResonanceRelevance();
const inputPreampStageSelect = addDevLabSelector('DEV INPUT STAGE', 'data-input-preamp-stage', [
  ['linear', 'LINEAR'],
  ['silk', 'SILK'],
  ['tape', 'TAPE'],
  ['tube', 'TUBE'],
  ['console', 'CONSOLE'],
  ['crunch', 'CRUNCH'],
  ['destroy', 'DESTROY']
]);
const addDevLabCharacterSlider = () => {
  const container = devLabGroups.get('input');
  if (!container) return null;
  const control = document.createElement('label');
  control.className = 'dev-lab-control dev-lab-character-control';
  const title = document.createElement('span');
  title.textContent = 'DEV CHARACTER';
  const row = document.createElement('span');
  row.className = 'dev-character-row';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
  slider.value = String(state.inputCharacterAmount);
  slider.setAttribute('data-input-character-amount', '');
  slider.setAttribute('aria-label', 'DEV Character Amount');
  const output = document.createElement('output');
  output.setAttribute('data-input-character-output', '');
  output.textContent = `${state.inputCharacterAmount} %`;
  row.append(slider, output);
  const scale = document.createElement('span');
  scale.className = 'dev-character-scale';
  scale.innerHTML = '<span>0 %</span><span>50 %</span><span>100 %</span>';
  control.append(title, row, scale);
  container.append(control);
  return slider;
};
const inputCharacterAmountSlider = addDevLabCharacterSlider();

export {
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
};
