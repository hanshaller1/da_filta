// Assignment editor shared by LFO, Envelope Follower, Clock Mod and Macros: target context,
// UI modulation graph, row rendering and event binding.
import {
  MODULATION_TARGETS, getModulationTarget, getModulationAssignmentStatus, compileModulationGraph,
  wouldCreateModulationCycle
} from '../modulation-core.mjs';
import { state } from './app-context.js';

const lfoTargetContext = () => ({
  filterEnabled: state.filterEnabled,
  filterbankEnabled: state.filterbankEnabled,
  dynamicEqEnabled: state.dynamicEqEnabled,
  dryWet: state.dryWet,
  baseSpread: state.spread,
  spreadMaxOffsetDb: state.spreadMaxOffsetDb,
  spreadMode: state.spreadMode,
  perChannelBands: state.perChannelBands,
  filterShapeParams: window.FilterShape.shapeParametersFromState(state),
  lfoModuleEnabled: state.lfoModuleEnabled, lfoSources: state.lfoSources,
  envelopeModuleEnabled: state.envelopeModuleEnabled, envelopeSources: state.envelopeSources,
  modulationGraph: getUiModulationGraph()
});
const getUiAssignments = () => [...state.lfoSources, ...state.envelopeSources, ...state.macroSources].flatMap(source => source.assignments)
  .concat(state.clockMod.assignments);
let uiModulationGraphKey = '';
let uiModulationGraph = null;
const uiCycleOptions = new Map();
const getUiModulationGraph = () => {
  const assignments = getUiAssignments();
  const key = JSON.stringify(assignments.map(({ id, sourceId, targetId, enabled }) => [id, sourceId, targetId, enabled]));
  if (key !== uiModulationGraphKey || !uiModulationGraph) {
    uiModulationGraphKey = key; uiModulationGraph = compileModulationGraph(assignments);
    uiCycleOptions.clear();
  }
  return uiModulationGraph;
};
const populateModulationTargetSelect = select => {
  if (!select) return;
  select.replaceChildren(new Option('NONE', ''));
  const groups = new Map();
  for (const target of MODULATION_TARGETS) {
    if (!groups.has(target.group)) {
      const group = document.createElement('optgroup');
      group.label = target.group;
      groups.set(target.group, group);
      select.append(group);
    }
    const option = document.createElement('option');
    option.value = target.id;
    option.textContent = target.label;
    groups.get(target.group).append(option);
  }
};
const renderSourceAssignments = (kind, source, list, moduleEnabled) => {
  if (!list || !source) return;
  // Preserve row/option nodes when visible macro values and amounts morph.
  const setText = (element, value) => {
    if (element.textContent === value) return;
    if (element.childNodes.length === 1 && element.firstChild.nodeType === Node.TEXT_NODE) element.firstChild.data = value;
    else element.textContent = value;
  };
  const assignments = source.assignments;
  const rows = [...list.children];
  if (list.dataset.sourceId !== source.id || rows.length !== assignments.length
    || rows.some((row, index) => row.dataset.assignmentId !== assignments[index].id)) {
    list.dataset.sourceId = source.id;
    list.replaceChildren();
    for (const assignment of assignments) {
      const row = document.createElement('div');
      row.className = 'lfo-row lfo-assignment-row';
      row.dataset.assignmentId = assignment.id;
      row.innerHTML = `<label class="lfo-target-control"><span>TARGET</span><select data-${kind}-target data-assignment-field="targetId" aria-label="${kind} assignment target"></select><small data-${kind}-target-state></small></label>
        <label class="lfo-inline-control lfo-assignment-amount"><span>AMOUNT <output data-${kind}-amount-output></output></span><input class="filter-style-slider" type="range" min="-100" max="100" step="1" data-${kind}-amount data-assignment-field="amount" aria-label="${kind} assignment amount"></label>
        <label class="lfo-inline-control"><span>CHANNEL</span><select data-${kind}-channel data-assignment-field="channel" aria-label="${kind} assignment channel"></select></label>
        <label class="lfo-inline-control lfo-assignment-invert"><span>INVERT</span><input type="checkbox" data-${kind}-assignment-invert ${kind === 'envelope' ? 'data-envelope-invert' : ''} data-assignment-field="invert" aria-label="Invert ${kind} assignment"></label>
        <div class="lfo-assignment-actions"><button class="dynamic-eq-view-toggle" type="button" data-${kind}-assignment-enable aria-label="Enable ${kind} assignment"></button><button class="dynamic-eq-view-toggle" type="button" data-${kind}-assignment-remove aria-label="Remove ${kind} assignment">×</button></div>
        ${kind === 'clock-mod' ? '<label class="lfo-inline-control clock-mod-hold-control"><span>HOLD</span><select data-clock-mod-hold data-assignment-field="sourceId" aria-label="Clock Mod held output"></select></label>' : ''}`;
      populateModulationTargetSelect(row.querySelector(`[data-${kind}-target]`));
      row.querySelector(`[data-${kind}-assignment-enable]`).classList.add('ui-role-toggle');
      row.querySelector(`[data-${kind}-assignment-remove]`).classList.add('ui-role-danger');
      if (kind === 'clock-mod') row.querySelector('[data-clock-mod-hold]').replaceChildren(new Option('LATEST', 'clockMod.1'),
        ...Array.from({ length: 10 }, (_, band) => new Option(`BAND ${band + 1}`, `clockMod.1.band.${band}`)));
      list.append(row);
    }
  }
  [...list.children].forEach((row, index) => {
    const assignment = assignments[index];
    const target = getModulationTarget(assignment.targetId);
    const select = row.querySelector(`[data-${kind}-target]`);
    getUiModulationGraph();
    const optionKey = `${assignment.sourceId}:${assignment.id}`;
    let cycles = uiCycleOptions.get(optionKey);
    if (!cycles) {
      cycles = new Set(MODULATION_TARGETS.filter(target => target.modulatorId
        && wouldCreateModulationCycle(getUiAssignments(), { ...assignment, targetId: target.id })).map(target => target.id));
      uiCycleOptions.set(optionKey, cycles);
    }
    for (const option of select.options) {
      const descriptor = getModulationTarget(option.value);
      if (!descriptor) continue;
      const cycle = cycles.has(option.value);
      option.disabled = cycle;
      setText(option, descriptor.label + (cycle ? ' · CYCLE' : ''));
    }
    if (assignment.targetId && !target && ![...select.options].some(option => option.value === assignment.targetId)) {
      select.add(new Option(`INVALID · ${assignment.targetId}`, assignment.targetId));
    }
    select.value = assignment.targetId;
    row.querySelector(`[data-${kind}-amount]`).value = String(assignment.amount);
    setText(row.querySelector(`[data-${kind}-amount-output]`), `${Math.round(assignment.amount)} %`);
    const channel = row.querySelector(`[data-${kind}-channel]`);
    const channels = target?.channels || [assignment.channel || 'both'];
    if (channel.dataset.targetId !== assignment.targetId || !channel.options.length) {
      channel.replaceChildren(...channels.map(value => new Option(value.toUpperCase(), value)));
      channel.dataset.targetId = assignment.targetId;
    }
    channel.value = channels.includes(assignment.channel) ? assignment.channel : 'both';
    channel.disabled = channels.length === 1;
    const invert = row.querySelector(`[data-${kind}-assignment-invert]`);
    invert.checked = assignment.invert;
    invert.setAttribute('aria-pressed', String(assignment.invert));
    if (kind === 'clock-mod') row.querySelector('[data-clock-mod-hold]').value = assignment.sourceId;
    const enable = row.querySelector(`[data-${kind}-assignment-enable]`);
    setText(enable, assignment.enabled ? 'ON' : 'OFF');
    enable.setAttribute('aria-pressed', String(assignment.enabled));
    const status = getModulationAssignmentStatus(assignment, lfoTargetContext(), moduleEnabled && source.enabled !== false);
    row.dataset.assignmentStatus = status.reason;
    setText(row.querySelector(`[data-${kind}-target-state]`), {
      'no-target': 'NO TARGET', 'target-invalid': 'INVALID TARGET',
      'target-unavailable': 'UNAVAILABLE · TARGET INACTIVE',
      'assignment-disabled': 'ASSIGNMENT OFF', 'source-disabled': 'ASSIGNED · SOURCE OFF', 'cycle-blocked': 'CYCLE BLOCKED', active: 'ACTIVE'
    }[status.reason]);
    row.classList.toggle('is-inactive', ['target-invalid', 'target-unavailable', 'cycle-blocked'].includes(status.reason));
  });
};
const bindAssignmentEditor = (kind, getSource, commit) => {
  const list = document.querySelector('[data-' + kind + '-assignments]');
  document.querySelector('[data-' + kind + '-add-assignment]')?.addEventListener('click', () => {
    const source = getSource();
    source.assignments.push({ id: source.id + '.assignment.' + crypto.randomUUID(), sourceId: source.id,
      targetId: '', amount: 0, channel: 'both', invert: false, enabled: true });
    commit();
  });
  const edit = event => {
    const field = event.target.dataset.assignmentField;
    if (!field || (field === 'amount') !== (event.type === 'input')) return;
    const assignment = getSource()?.assignments.find(item => item.id === event.target.closest('[data-assignment-id]')?.dataset.assignmentId);
    if (!assignment) return;
    const value = field === 'invert' ? event.target.checked : field === 'amount' ? Number(event.target.value) : event.target.value;
    if ((field === 'targetId' || field === 'sourceId') && wouldCreateModulationCycle(getUiAssignments(), { ...assignment, [field]: value })) {
      commit(); return;
    }
    assignment[field] = value;
    if (field === 'targetId' && !getModulationTarget(value)?.channelRouting) assignment.channel = 'both';
    commit();
  };
  list?.addEventListener('input', edit);
  list?.addEventListener('change', edit);
  list?.addEventListener('click', event => {
    const row = event.target.closest('[data-assignment-id]');
    const source = getSource();
    const index = source?.assignments.findIndex(item => item.id === row?.dataset.assignmentId);
    if (index === undefined || index < 0) return;
    if (event.target.closest('[data-' + kind + '-assignment-remove]')) source.assignments.splice(index, 1);
    else if (event.target.closest('[data-' + kind + '-assignment-enable]')) source.assignments[index].enabled = !source.assignments[index].enabled;
    else return;
    commit();
  });
};

export {
  lfoTargetContext, renderSourceAssignments, bindAssignmentEditor
};
