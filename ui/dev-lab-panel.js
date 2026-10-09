// DEV / LAB panel shell: collapsible groups, the sweetspot group skeleton and the factories that
// add selector and number controls to a group.

const POSITIVE_RESONANCE_AUDITION_VALUES = [0.10, 0.20, 0.30, 0.40, 0.60, 0.80, 1.00, 1.50, 2.00, 4.00];
const positiveResonanceAuditionSelect = document.querySelector('[data-positive-resonance-audition]');
const positiveResonanceDriveSelect = document.querySelector('[data-positive-resonance-drive]');
const positiveResonanceDampingFloorSelect = document.querySelector('[data-positive-resonance-damping-floor]');
const positiveResonanceOutputSelect = document.querySelector('[data-positive-resonance-output]');
const positiveResonanceLatencySelect = document.querySelector('[data-positive-resonance-latency]');
const positiveResonanceCurveSelect = document.querySelector('[data-positive-resonance-curve]');
const addDevSelectOptions = (select, values, format = value => String(value)) => {
  if (!select) return;
  values.forEach(value => {
    const optionValue = format(value);
    if ([...select.options].some(option => option.value === optionValue)) return;
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionValue;
    select.append(option);
  });
};
addDevSelectOptions(positiveResonanceAuditionSelect, [1.50, 2.00, 4.00], value => value.toFixed(2));
addDevSelectOptions(positiveResonanceDriveSelect, [24, 32]);
addDevSelectOptions(positiveResonanceDampingFloorSelect, [-0.05, -0.10], value => value.toFixed(2));
const devLabPanel = document.querySelector('[data-dev-lab-panel]');
const devLabToggle = document.querySelector('[data-dev-lab-toggle]');
const mastheadDevLab = document.querySelector('.masthead-dev-lab');
const mastheadThemeEditor = document.querySelector('.theme-editor');
if (mastheadDevLab && mastheadThemeEditor && devLabToggle) mastheadDevLab.insertBefore(mastheadThemeEditor, devLabToggle);
const devLabControls = document.querySelector('.dev-lab-panel .dev-lab-controls');
const devLabGroups = new Map();
const devLabGroupsOpenByDefault = new Set(['local-feedback', 'main']);
[['input', 'INPUT'], ['output', 'OUTPUT'], ['keyboard', 'KEYBOARD'], ['filterbank', 'FILTERBANK'], ['local-feedback', 'LOCAL FEEDBACK'], ['main', 'FB ALL / MAIN'], ['negative-resonance', 'NEGATIVE RESONANCE'], ['resonator', 'LEGACY / RESONATOR LAB']].forEach(([value, label]) => {
  const group = document.createElement('section');
  group.className = 'dev-lab-group';
  group.dataset.devLabGroup = value;
  const bodyId = `dev-lab-group-${value}-body`;
  const expanded = devLabGroupsOpenByDefault.has(value);
  group.classList.toggle('is-collapsed', !expanded);
  group.innerHTML = `<div class="dev-lab-group-header"><h2>${label}</h2><span class="dev-lab-group-header-actions"><button class="dev-lab-collapse-toggle" type="button" aria-expanded="${expanded}" aria-controls="${bodyId}" aria-label="${label} ${expanded ? 'einklappen' : 'ausklappen'}">${expanded ? '\u25BE' : '\u25B8'}</button><button class="dev-lab-info-button" type="button" data-dev-lab-help="${value}" aria-label="Hilfe zu ${label}" aria-expanded="false" aria-controls="dev-lab-tooltip">i</button></span></div><div class="dev-lab-group-body" id="${bodyId}"${expanded ? '' : ' hidden'}></div>`;
  devLabControls?.append(group);
  devLabGroups.set(value, group.querySelector('.dev-lab-group-body'));
});
const SWEETSPOT_SLOTS = ['A', 'B', 'C', 'D'];
const sweetspotGroup = document.createElement('section');
sweetspotGroup.className = 'dev-lab-group sweetspot-group';
sweetspotGroup.dataset.devLabGroup = 'sweetspots';
sweetspotGroup.classList.add('is-collapsed');
sweetspotGroup.innerHTML = '<div class="dev-lab-group-header"><h2>SWEETSPOTS</h2><span class="dev-lab-group-header-actions"><button class="dev-lab-collapse-toggle" type="button" aria-expanded="false" aria-controls="dev-lab-group-sweetspots-body" aria-label="SWEETSPOTS ausklappen">&#9656;</button></span></div><div class="dev-lab-group-body" id="dev-lab-group-sweetspots-body" hidden><div class="sweetspot-list"></div></div>';
const sweetspotList = sweetspotGroup.querySelector('.sweetspot-list');
const sweetspotRows = new Map();
SWEETSPOT_SLOTS.forEach(slot => {
  const row = document.createElement('div');
  row.className = 'sweetspot-row';
  row.innerHTML = `<strong>${slot}</strong><input type="text" maxlength="48" data-sweetspot-name="${slot}" aria-label="Sweetspot ${slot} Name"><button type="button" data-sweetspot-save="${slot}">SAVE</button><button type="button" data-sweetspot-load="${slot}" disabled>LOAD</button><button type="button" data-sweetspot-clear="${slot}" disabled>CLEAR</button>`;
  sweetspotList?.append(row);
  sweetspotRows.set(slot, row);
});
devLabControls?.append(sweetspotGroup);
devLabControls?.querySelectorAll('.dev-lab-collapse-toggle').forEach(button => {
  button.addEventListener('click', () => {
    const group = button.closest('.dev-lab-group');
    const body = document.getElementById(button.getAttribute('aria-controls'));
    if (!group || !body) return;
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    body.hidden = !expanded;
    group.classList.toggle('is-collapsed', !expanded);
    button.setAttribute('aria-expanded', String(expanded));
    const label = group.querySelector('h2')?.textContent || 'Gruppe';
    button.setAttribute('aria-label', `${label} ${expanded ? 'einklappen' : 'ausklappen'}`);
    button.textContent = expanded ? '\u25BE' : '\u25B8';
  });
});
const groupForDevControl = control => {
  const attribute = control.querySelector('select')?.getAttributeNames().find(name => name.startsWith('data-')) ?? '';
  if (attribute === 'data-input-preamp-stage') return 'input';
  if (attribute === 'data-reference-level' || attribute === 'data-band-boost-db' || attribute === 'data-band-cut-db' || attribute === 'data-spread-max-offset-db' || attribute === 'data-wet-model') return 'filterbank';
  if (attribute === 'data-feedback-topology' || attribute === 'data-feedback-tap' || attribute === 'data-feedback-tap-modulation' || attribute === 'data-local-loop-tuning' || attribute === 'data-feedback-core') return 'local-feedback';
  if (attribute === 'data-feedback-all-engine' || attribute === 'data-feedback-all-source' || attribute === 'data-post-gain-feedback-weight' || attribute === 'data-feedback-all-level') return 'main';
  return 'resonator';
};
const inlineDevLabControls = document.querySelector('.analyzer-header .dev-lab-controls');
inlineDevLabControls?.querySelectorAll(':scope > .dev-audition-control, :scope > .dev-lab-control').forEach(control => {
  devLabGroups.get(groupForDevControl(control))?.append(control);
});
inlineDevLabControls?.remove();
devLabToggle?.addEventListener('click', () => {
  const open = Boolean(devLabPanel?.hidden);
  if (devLabPanel) devLabPanel.hidden = !open;
  devLabToggle.classList.toggle('active', open);
  devLabToggle.setAttribute('aria-expanded', String(open));
});
const addDevLabSelector = (label, attribute, options) => {
  const container = devLabGroups.get({
    'data-input-preamp-stage': 'input',
    'data-reference-level': 'filterbank',
    'data-band-boost-db': 'filterbank',
    'data-band-cut-db': 'filterbank',
    'data-spread-max-offset-db': 'filterbank',
    'data-wet-model': 'filterbank',
    'data-feedback-topology': 'local-feedback',
    'data-feedback-core': 'local-feedback',
    'data-local-loop-tuning': 'local-feedback',
    'data-feedback-tap': 'local-feedback',
    'data-feedback-tap-modulation': 'local-feedback',
    'data-common-bus-saturation-mode': 'local-feedback',
    'data-common-bus-drive': 'local-feedback',
    'data-common-bus-ceiling': 'local-feedback',
    'data-feedback-all-engine': 'main',
    'data-feedback-all-source': 'main',
    'data-post-gain-feedback-weight': 'main',
    'data-feedback-all-level': 'main',
    'data-feedback-all-resonance-curve': 'main',
    'data-feedback-all-saturation-return': 'main',
    'data-negative-resonance-mode': 'negative-resonance', 'data-negative-resonance-curve': 'negative-resonance',
    'data-negative-resonance-local': 'negative-resonance', 'data-negative-resonance-main': 'negative-resonance',
    'data-output-guard-enabled': 'output',
    'data-output-protection-enabled': 'output'
  }[attribute] ?? 'resonator');
  if (!container) return null;
  const control = document.createElement('label');
  control.className = 'dev-lab-control';
  const title = document.createElement('span');
  title.textContent = label;
  const select = document.createElement('select');
  select.setAttribute(attribute, '');
  options.forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.append(option);
  });
  control.append(title, select);
  container.append(control);
  return select;
};
const addDevLabNumberControl = ({ label, attribute, min, max, step, suffix, tooltip, value, onChange, group = 'main' }) => {
  const container = devLabGroups.get(group); if (!container) return null;
  const control = document.createElement('label'); control.className = 'dev-lab-control';
  const title = document.createElement('span'); title.textContent = label;
  const input = document.createElement('input');
  input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value());
  input.setAttribute(attribute, ''); input.setAttribute('aria-label', `${label} ${suffix}`); input.title = tooltip;
  const unit = document.createElement('em'); unit.textContent = suffix;
  const apply = restoreInvalid => {
    const numeric = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(numeric)) { if (restoreInvalid) input.value = String(value()); return; }
    onChange(Math.min(max, Math.max(min, numeric))); input.value = String(value());
  };
  input.addEventListener('input', () => { if (input.value !== '') apply(false); });
  input.addEventListener('change', () => apply(true)); input.addEventListener('blur', () => apply(true));
  control.append(title, input, unit); container.append(control); return input;
};

export {
  POSITIVE_RESONANCE_AUDITION_VALUES, positiveResonanceAuditionSelect, positiveResonanceDriveSelect,
  positiveResonanceDampingFloorSelect, positiveResonanceOutputSelect, positiveResonanceLatencySelect,
  positiveResonanceCurveSelect, devLabGroups, SWEETSPOT_SLOTS, sweetspotRows, addDevLabSelector,
  addDevLabNumberControl
};
