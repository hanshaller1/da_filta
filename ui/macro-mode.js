// Macro controls of the PRESETS / SNAPSHOTS workspace.
import { getModulationAssignmentStatus } from '../modulation-core.mjs';
import { state, audioEngine } from './app-context.js';
import { lfoTargetContext, renderSourceAssignments, bindAssignmentEditor } from './modulation-assignments.js';

let selectedMacroIndex = 0;
const getSelectedMacro = () => state.macroSources[selectedMacroIndex];
const macroSlots = [...document.querySelectorAll('[data-macro-slot]')];
const renderMacroControls = () => {
  const context = lfoTargetContext();
  state.macroSources.forEach((source, index) => {
    const selected = index === selectedMacroIndex;
    const button = macroSlots[index];
    const assigned = source.assignments.filter(assignment => assignment.targetId);
    const lost = assigned.filter(assignment => ['target-invalid', 'target-unavailable'].includes(
      getModulationAssignmentStatus(assignment, context).reason)).length;
    button.classList.toggle('active', selected);
    button.classList.toggle('has-lost-target', lost > 0);
    button.setAttribute('aria-pressed', String(selected));
    button.dataset.lostTargets = String(lost);
    button.querySelector('.lfo-slot-detail').textContent = lost ? `LOST TARGET (${lost})` : `${assigned.length} ASSIGNED`;
    const input = document.querySelector(`[data-macro-value="${index}"]`);
    input.value = String(source.value);
    document.querySelector(`[data-macro-value-output="${index}"]`).textContent = `${source.value} %`;
  });
  document.querySelector('[data-macro-editor-title]').textContent = `MACRO ${selectedMacroIndex + 1} · ASSIGNMENTS`;
  renderSourceAssignments('macro', getSelectedMacro(), document.querySelector('[data-macro-assignments]'), true);
};
const commitMacroState = () => {
  Object.assign(state, window.ResonantState.normalizeMacroState(state));
  audioEngine?.setModulationState(state);
  renderMacroControls();
};
bindAssignmentEditor('macro', getSelectedMacro, commitMacroState);
macroSlots.forEach((button, index) => button.addEventListener('click', () => {
  selectedMacroIndex = index;
  renderMacroControls();
}));
document.querySelector('.macro-mode-panel')?.addEventListener('keydown', event => {
  // Native workspace button activation owns Enter/Space before global Panic.
  if (event.target.closest('button') && (event.key === 'Enter' || event.key === ' ')) event.stopPropagation();
});
document.querySelectorAll('[data-macro-value]').forEach(input => input.addEventListener('input', () => {
  const source = state.macroSources[Number(input.dataset.macroValue)];
  source.value = Math.min(100, Math.max(0, Number(input.value)));
  document.querySelector(`[data-macro-value-output="${input.dataset.macroValue}"]`).textContent = `${source.value} %`;
  audioEngine?.setMacroValue(source.id, source.value);
}));

export {
  selectedMacroIndex, renderMacroControls, commitMacroState
};
