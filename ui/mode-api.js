// window.* mode APIs used by tests and automation.
import { MODULATION_TARGETS } from '../modulation-core.mjs';
import { paginateLfoSources } from '../lfo-core.mjs';
import { state, audioEngine } from './app-context.js';
import { selectedMacroIndex } from './macro-mode.js';
import { getFilterModeShape } from './filter-mode.js';
import {
  selectedLfoIndex, LFO_SLOT_PAGE_SIZE, getSelectedLfo, getSourceLfoTelemetry, lfoAssignmentStatus,
  renderLfoControls, setSelectedLfoIndex
} from './lfo-mode.js';
import { clockModTelemetry } from './clock-mod-mode.js';
import { envelopeTelemetry, selectedEnvelopeIndex, getEnvelopeSource } from './envelope-mode.js';

window.FilterMode = Object.freeze({
  getState: () => ({
    selectedWorkspaceMode: state.selectedWorkspaceMode,
    filterbankEnabled: state.filterbankEnabled,
    filterEnabled: state.filterEnabled,
    filterType: state.filterType,
    filterFrequencyHz: state.filterFrequencyHz,
    filterSlope: state.filterSlope,
    filterBandwidth: state.filterBandwidth,
    filterResonance: state.filterResonance,
    filterDepth: state.filterDepth,
    ...Object.fromEntries(window.ResonantState.FILTER_EXTRA_FIELDS.map(field => [field, state[field]]))
  }),
  getShape: () => [...getFilterModeShape()],
  getManualBandState: () => ({ left: [...state.bandGainLeft], right: [...state.bandGainRight], perChannelBands: state.perChannelBands, linked: [...state.bandChannelLinked] }),
  getAudioEngine: () => audioEngine
});
window.LfoMode = Object.freeze({
  getState: () => ({
    lfoEnabled: state.lfoModuleEnabled, lfoModuleEnabled: state.lfoModuleEnabled,
    lfoSources: state.lfoSources.map(source => ({ ...source, assignments: source.assignments.map(assignment => ({ ...assignment })) })), lfoClock: { ...state.lfoClock },
    selectedLfoIndex, pageSize: LFO_SLOT_PAGE_SIZE,
    ...(() => { const selected = getSelectedLfo(); return selected ? {
      lfoWaveform: selected.waveform, lfoRateHz: selected.rateHz, lfoPolarity: selected.polarity,
      lfoPhase: selected.phaseOffsetDeg, lfoTargetId: selected.targetId, lfoAmount: selected.amount,
      selectedSourceEnabled: selected.enabled, selectedSourceId: selected.id
    } : {}; })()
  }),
  getTelemetry: () => { const telemetry = getSourceLfoTelemetry(getSelectedLfo()); return telemetry ? { ...telemetry } : null; },
  getAudioEngine: () => audioEngine,
  selectSlot: index => {
    if (!Number.isInteger(index) || index < 0 || index >= state.lfoSources.length) return false;
    setSelectedLfoIndex(index); renderLfoControls(); return true;
  },
  getSlotPages: (count = state.lfoSources.length) => paginateLfoSources(
    Array.from({ length: Math.min(4, Math.max(0, count)) }, (_, index) => ({ id: `lfo.${index + 1}` })), LFO_SLOT_PAGE_SIZE
  ).map(page => page.map(source => source.id)),
  getTargetRegistry: () => MODULATION_TARGETS.map(target => ({ id: target.id, label: target.label,
    mapping: target.mapping, unit: target.unit, range: [...target.range], channels: [...target.channels] })),
  getAssignmentStatuses: () => state.lfoSources.flatMap(source => source.assignments.map(assignment => ({
    id: assignment.id, sourceId: source.id, ...lfoAssignmentStatus(assignment, source)
  })))
});
window.EnvelopeMode = Object.freeze({
  getState: () => ({ envelopeModuleEnabled: state.envelopeModuleEnabled === true, selectedEnvelopeIndex,
    envelopeSources: (state.envelopeSources || []).map(source => ({ ...source, assignments: source.assignments.map(assignment => ({ ...assignment })) })) }),
  getAudioEngine: () => audioEngine,
  getTelemetry: () => {
    const source = getEnvelopeSource();
    const telemetry = source ? envelopeTelemetry.get(source.id) : null;
    return telemetry ? { ...telemetry } : null;
  },
  getTargetRegistry: () => MODULATION_TARGETS.map(target => ({ id: target.id, label: target.label, group: target.group, channelRouting: target.channelRouting }))
});
window.ClockModMode = Object.freeze({
  getState: () => ({ ...state.clockMod, lockedBands: [...state.clockMod.lockedBands], assignments: state.clockMod.assignments.map(assignment => ({ ...assignment })) }),
  getTelemetry: () => clockModTelemetry ? { ...clockModTelemetry,
    heldLeft: [...(clockModTelemetry.heldLeft || [])], heldRight: [...(clockModTelemetry.heldRight || [])] } : null,
  getAudioEngine: () => audioEngine
});
window.MacroMode = Object.freeze({
  getState: () => ({ ...window.ResonantState.normalizeMacroState(state), selectedMacroIndex }),
  getAudioEngine: () => audioEngine
});
