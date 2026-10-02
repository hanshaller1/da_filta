const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const filterIsActive = (context, types = null) => Boolean(context?.filterEnabled)
  && (!types || types.includes(context?.filterShapeParams?.type));
const dynamicEqIsActive = context => Boolean(context?.dynamicEqEnabled);
const filterbankIsActive = context => Boolean(context?.filterbankEnabled);

const MONO_CHANNELS = Object.freeze(['both']);
const STEREO_CHANNELS = Object.freeze(['both', 'left', 'right', 'spread']);
const descriptor = ({ id, label, group, min, max, mapping, unit, activeWhen, isActive, getBase, getMin, getMax, apply, modulatorId = null, channelRouting = false }) => Object.freeze({
  id, label, group, min, max, range: Object.freeze([min, max]), mapping, unit, channelRouting,
  channels: channelRouting ? STEREO_CHANNELS : MONO_CHANNELS,
  clamp: Object.freeze({ min, max }), activeWhen, isActive, getBase, getMin, getMax, apply, modulatorId,
  modulationCapability: 'continuous'
});

const filterTarget = (id, label, field, min, max, mapping, unit, activeWhen, types = null) => descriptor({
  id, label, group: 'FILTER', min, max, mapping, unit, activeWhen,
  isActive: context => filterIsActive(context, types),
  getBase: context => context?.filterShapeParams?.[field],
  apply: (context, value) => { if (context?.effectiveFilterShapeParams) context.effectiveFilterShapeParams[field] = value; }
});

const TARGETS = [
  descriptor({
    id: 'global.resonance', label: 'Global Resonance', group: 'GLOBAL', min: -1, max: 1,
    mapping: 'normalized', unit: 'normalized', activeWhen: 'filterbankEnabled',
    isActive: context => filterbankIsActive(context),
    getBase: context => context?.baseResonance,
    apply: (context, value) => context?.setEffectiveResonance?.(value)
  }),
  descriptor({
    id: 'global.dryWet', label: 'Dry / Wet', group: 'GLOBAL', min: 0, max: 100,
    mapping: 'normalized', unit: '%', activeWhen: 'audioMix',
    isActive: context => context?.dryWet !== undefined,
    getBase: context => context?.dryWet,
    apply: (context, value) => context?.setEffectiveDryWet?.(value)
  }),
  descriptor({
    id: 'global.spread', label: 'Spread', group: 'GLOBAL', min: -12, max: 12,
    mapping: 'db', unit: 'dB', activeWhen: 'classicSpread',
    isActive: context => filterbankIsActive(context) && !context?.perChannelBands && context?.spreadMode !== 'FB_CH_SELECT',
    getBase: context => context?.baseSpread,
    getMin: context => -Math.abs(Number(context?.spreadMaxOffsetDb) || 6),
    getMax: context => Math.abs(Number(context?.spreadMaxOffsetDb) || 6),
    apply: (context, value, base) => context?.setEffectiveSpread?.(value, base)
  }),
  descriptor({
    id: 'filterbank.feedbackAllAmount', label: 'FB All Amount', group: 'FILTERBANK', min: 0, max: 100,
    mapping: 'normalized', unit: '%', activeWhen: 'filterbankEnabled',
    isActive: context => filterbankIsActive(context),
    getBase: context => context?.baseFeedbackAllAmount,
    apply: (context, value) => context?.setEffectiveFeedbackAllAmount?.(value)
  }),
  filterTarget('filter.frequencyHz', 'Filter Frequency', 'frequencyHz', 29, 11000, 'logarithmic', 'Hz', 'frequencyFilter', ['lowpass', 'highpass', 'bandpass', 'notch', 'bell', 'tilt']),
  filterTarget('filter.resonance', 'Filter Resonance', 'resonance', 0, 100, 'normalized', '%', 'classicFilter', ['lowpass', 'highpass', 'bandpass', 'notch']),
  filterTarget('filter.depth', 'Filter Depth', 'depth', 0, 100, 'normalized', '%', 'classicFilter', ['lowpass', 'highpass', 'bandpass', 'notch']),
  filterTarget('filter.slope', 'Filter Slope', 'slope', 0, 100, 'normalized', '%', 'slopeFilter', ['lowpass', 'highpass', 'bandpass', 'notch']),
  filterTarget('filter.bandwidth', 'Filter Bandwidth', 'bandwidth', 0, 100, 'normalized', '%', 'widthFilter', ['bandpass', 'notch']),
  filterTarget('filter.gainDb', 'Filter Gain', 'gainDb', -60, 24, 'db', 'dB', 'bellFilter', ['bell']),
  filterTarget('filter.tiltDb', 'Filter Tilt', 'tiltDb', -60, 24, 'db', 'dB', 'tiltFilter', ['tilt']),
  filterTarget('filter.formantVowel', 'Formant Vowel', 'formantVowel', 0, 4, 'continuous-enum', 'vowel', 'formantFilter', ['formant']),
  ...Array.from({ length: 10 }, (_, index) => descriptor({
    id: `filterbank.band.${index}.gainDb`, label: `Band ${index + 1} Gain`, group: 'FILTERBANK',
    min: -60, max: 24, mapping: 'db', unit: 'dB', activeWhen: 'filterbankEnabled', channelRouting: true,
    isActive: context => filterbankIsActive(context),
    getMin: context => -clamp(context?.maxBandCutDb, 0, 60, 12),
    getMax: context => clamp(context?.maxBandBoostDb, 0, 24, 12),
    getBase: (context, channel = 'left') => context?.getModulationBandBaseDb?.(index, channel),
    apply: (context, value, base, channel, nativeOffset = 0) => {
      if (context?.setModulationBandOffset) context.setModulationBandOffset(index, channel, value - base, nativeOffset);
      else if (context?.modulationDirectBandOffsetsDb) context.modulationDirectBandOffsetsDb[index] = value - base;
    }
  })),
  descriptor({
    id: 'dynamicEq.thresholdDb', label: 'Dynamic EQ Threshold', group: 'DYNAMIC EQ', min: -60, max: 0,
    mapping: 'db', unit: 'dBFS', activeWhen: 'dynamicEqEnabled',
    isActive: context => dynamicEqIsActive(context),
    getBase: context => context?.dynamicEqThresholdDb,
    apply: (context, value) => { if (context?.dynamicEqEffectiveSettings) context.dynamicEqEffectiveSettings.dynamicEqThresholdDb = value; }
  }),
  descriptor({
    id: 'dynamicEq.rangeDb', label: 'Dynamic EQ Range', group: 'DYNAMIC EQ', min: 0, max: 12,
    mapping: 'db', unit: 'dB', activeWhen: 'dynamicEqEnabled',
    isActive: context => dynamicEqIsActive(context),
    getBase: context => context?.dynamicEqRangeDb,
    apply: (context, value) => {
      if (context?.dynamicEqEffectiveSettings) {
        context.dynamicEqEffectiveSettings.dynamicEqRangeDb = value;
        context.dynamicEqEffectiveSettings.dynamicEqCutRangeDb = value;
        context.dynamicEqEffectiveSettings.dynamicEqBoostRangeDb = value;
      }
    }
  }),
  descriptor({
    id: 'dynamicEq.strength', label: 'Dynamic EQ Strength', group: 'DYNAMIC EQ', min: 0, max: 100,
    mapping: 'normalized', unit: '%', activeWhen: 'dynamicEqEnabled',
    isActive: context => dynamicEqIsActive(context),
    getBase: context => context?.dynamicEqStrength,
    apply: (context, value) => { if (context?.dynamicEqEffectiveSettings) context.dynamicEqEffectiveSettings.dynamicEqStrength = value; }
  }),
  ...[
    { id: 'dynamicEq.attackMs', label: 'Dynamic EQ Attack', field: 'dynamicEqAttackMs', min: 1, max: 500, unit: 'ms' },
    { id: 'dynamicEq.releaseMs', label: 'Dynamic EQ Release', field: 'dynamicEqReleaseMs', min: 10, max: 2000, unit: 'ms' }
  ].map(({ id, label, field, min, max, unit }) => descriptor({
    id, label, group: 'DYNAMIC EQ', min, max, mapping: 'normalized', unit, activeWhen: 'dynamicEqEnabled',
    isActive: context => dynamicEqIsActive(context), getBase: context => context?.[field],
    apply: (context, value) => {
      if (!context?.dynamicEqEffectiveSettings) return;
      context.dynamicEqEffectiveSettings[field] = value;
      context.setEffectiveDynamicEqTimes?.(context.dynamicEqEffectiveSettings.dynamicEqAttackMs, context.dynamicEqEffectiveSettings.dynamicEqReleaseMs);
    }
  })),
  ...Array.from({ length: 4 }, (_, index) => [
    ['rate', 'Rate', 'rateHz', .01, 20, 'logarithmic', 'Hz'],
    ['amount', 'Output Amount', 'outputAmount', 0, 100, 'normalized', '%']
  ].map(([parameter, label, field, min, max, mapping, unit]) => descriptor({
    id: `lfo.${index + 1}.${parameter}`, modulatorId: `lfo.${index + 1}`,
    label: `LFO ${index + 1} ${label}`, group: 'LFO', min, max, mapping, unit,
    activeWhen: parameter === 'rate' ? 'enabledFreeLfo' : 'enabledLfo',
    isActive: context => Boolean(context?.lfoModuleEnabled && context?.lfoSources?.[index]?.enabled)
      && (parameter !== 'rate' || context.lfoSources[index].rateMode !== 'sync'),
    getBase: context => context?.lfoSources?.[index]?.[field] ?? (parameter === 'amount' ? 100 : 1),
    apply: (context, value) => context?.lfoSources?.[index]?.setEffectiveParameter?.(field, value)
  }))).flat(),
  ...Array.from({ length: 4 }, (_, index) => [
    ['attack', 'Attack', 'attack', 1, 500, 'logarithmic', 'ms'],
    ['release', 'Release', 'release', 10, 3000, 'logarithmic', 'ms'],
    ['amount', 'Output Amount', 'outputAmount', 0, 100, 'normalized', '%']
  ].map(([parameter, label, field, min, max, mapping, unit]) => descriptor({
    id: `envelope.${index + 1}.${parameter}`, modulatorId: `envelope.${index + 1}`,
    label: `ENV ${index + 1} ${label}`, group: 'ENVELOPE', min, max, mapping, unit,
    activeWhen: 'enabledEnvelope',
    isActive: context => Boolean(context?.envelopeModuleEnabled && context?.envelopeSources?.[index]?.enabled),
    getBase: context => context?.envelopeSources?.[index]?.[field] ?? (parameter === 'amount' ? 100 : parameter === 'attack' ? 20 : 250),
    apply: (context, value) => context?.envelopeSources?.[index]?.setEffectiveParameter?.(field, value)
  }))).flat()
];

export const MODULATION_TARGETS = Object.freeze(TARGETS);
const targetMap = new Map(TARGETS.map(target => [target.id, target]));
export const getModulationTarget = id => targetMap.get(id) || null;
export const isModulationTargetActive = (id, context) => Boolean(targetMap.get(id)?.isActive?.(context));

// Clock's held band taps are outputs of one existing generator, not new
// modulators. Graph ownership is metadata; the assignment core is source agnostic.
const sourceOwners = new Map();
for (const family of ['lfo', 'envelope']) for (let index = 1; index <= 4; index += 1) {
  const id = `${family}.${index}`; sourceOwners.set(id, id);
}
sourceOwners.set('clockMod.1', 'clockMod.1');
for (let index = 0; index < 10; index += 1) sourceOwners.set(`clockMod.1.band.${index}`, 'clockMod.1');
export const getModulationSourceOwner = id => sourceOwners.get(id) || id;
export const modulationAssignmentKey = assignment => `${assignment.sourceId}:${assignment.id}`;

const reaches = (edges, from, destination, visited = new Set()) => {
  if (from === destination) return true;
  if (visited.has(from)) return false;
  visited.add(from);
  for (const next of edges.get(from) || []) if (reaches(edges, next, destination, visited)) return true;
  return false;
};
const assignmentOrder = (a, b) => `${getModulationSourceOwner(a.sourceId)}:${a.targetId}:${a.id}`
  .localeCompare(`${getModulationSourceOwner(b.sourceId)}:${b.targetId}:${b.id}`, 'en');

// Enabled but temporarily unavailable edges reserve the graph, so a mode or
// source reactivation cannot introduce a cycle without structural validation.
export function compileModulationGraph(assignments = [], targets = targetMap) {
  const edges = new Map();
  const blocked = new Set();
  for (const id of new Set(sourceOwners.values())) edges.set(id, new Set());
  for (const assignment of [...assignments].sort(assignmentOrder)) {
    const destination = targets.get(assignment.targetId)?.modulatorId;
    if (!destination || assignment.enabled === false) continue;
    const source = getModulationSourceOwner(assignment.sourceId);
    if (!edges.has(source)) edges.set(source, new Set());
    if (!edges.has(destination)) edges.set(destination, new Set());
    if (reaches(edges, destination, source)) { blocked.add(modulationAssignmentKey(assignment)); continue; }
    edges.get(source).add(destination);
  }
  const incoming = new Map([...edges.keys()].map(id => [id, 0]));
  for (const destinations of edges.values()) for (const id of destinations) incoming.set(id, incoming.get(id) + 1);
  const pending = [...incoming.keys()].filter(id => !incoming.get(id)).sort();
  const order = [];
  while (pending.length) {
    const id = pending.shift(); order.push(id);
    for (const destination of edges.get(id)) {
      incoming.set(destination, incoming.get(destination) - 1);
      if (!incoming.get(destination)) { pending.push(destination); pending.sort(); }
    }
  }
  return { edges, blocked, order };
}

export function wouldCreateModulationCycle(assignments, candidate) {
  const destination = getModulationTarget(candidate.targetId)?.modulatorId;
  if (!destination) return false;
  const graph = compileModulationGraph(assignments.filter(item => modulationAssignmentKey(item) !== modulationAssignmentKey(candidate)));
  return reaches(graph.edges, destination, getModulationSourceOwner(candidate.sourceId));
}

// Persist configuration only. Availability is derived from the same registry in
// the editor and Worklet, so temporarily lost targets retain their identity.
export function normalizeModulationAssignments(assignments = [], sourceId = '') {
  const used = new Set();
  return (Array.isArray(assignments) ? assignments : []).map((item, index) => {
    const input = item && typeof item === 'object' ? item : {};
    let id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `${sourceId}.assignment.${index + 1}`;
    while (used.has(id)) id += '.copy';
    used.add(id);
    const targetId = typeof input.targetId === 'string' ? input.targetId.trim() : '';
    const target = getModulationTarget(targetId);
    const channel = (target?.channels || STEREO_CHANNELS).includes(input.channel) ? input.channel : 'both';
    return { id, sourceId: sourceId || input.sourceId || '', targetId,
      amount: clamp(input.amount, 0, 100, 0), channel, invert: input.invert === true, enabled: input.enabled !== false };
  });
}

export function getModulationAssignmentStatus(assignment, context, sourceEnabled = true) {
  const target = getModulationTarget(assignment?.targetId);
  const available = Boolean(target && target.isActive(context));
  const reason = !assignment?.targetId ? 'no-target' : !target ? 'target-invalid'
    : assignment.enabled === false ? 'assignment-disabled'
      : context?.modulationGraph?.blocked.has(modulationAssignmentKey(assignment)) ? 'cycle-blocked'
      : !available ? 'target-unavailable'
      : !sourceEnabled ? 'source-disabled' : 'active';
  return { available, active: reason === 'active', valid: Boolean(target), reason };
}

const normalizeSourceSample = source => {
  if (typeof source === 'number') return { value: Number.isFinite(source) ? clamp(source, -1, 1, 0) : 0, range: 'bipolar' };
  if (!source || typeof source !== 'object') return null;
  const range = source.range === 'unipolar' ? 'unipolar' : 'bipolar';
  return {
    value: Number.isFinite(Number(source.value)) ? clamp(source.value, -1, 1, 0) : 0,
    range
  };
};

export function mapModulationValue(target, baseValue, sourceValue, amount = 100) {
  if (!target || !['linear', 'logarithmic', 'db', 'normalized', 'continuous-enum'].includes(target.mapping)) return NaN;
  const base = clamp(baseValue, target.min, target.max, target.min);
  const source = normalizeSourceSample(sourceValue);
  const amountScale = clamp(amount, 0, 100, 0) / 100;
  if (!source || amountScale === 0) return base;
  const extent = target.max - target.min;
  const modulation = source.value * amountScale;
  if (target.mapping === 'logarithmic') {
    const minimum = Math.log(target.min);
    const maximum = Math.log(target.max);
    const position = Math.log(Math.max(target.min, base));
    const delta = modulation * (maximum - minimum) / 2;
    return clamp(Math.exp(position + delta), target.min, target.max, base);
  }
  return clamp(base + modulation * extent / 2, target.min, target.max, base);
}

export class ModulationCore {
  constructor(targets = MODULATION_TARGETS) {
    this.targets = new Map(targets.map(target => [target.id, target]));
    this.sources = new Map();
    this.assignments = [];
    this.compiledTargets = [];
    this.compiledTargetMap = new Map();
    this.compileAssignments();
  }

  registerTarget(target) {
    if (!target || typeof target.id !== 'string' || !target.id || !Number.isFinite(target.min)
      || !Number.isFinite(target.max) || target.min > target.max
      || !['linear', 'logarithmic', 'db', 'normalized', 'continuous-enum'].includes(target.mapping)) return false;
    this.targets.set(target.id, Object.freeze({ ...target }));
    this.graphSignature = null;
    this.compileAssignments();
    return true;
  }

  setSourceValue(sourceId, value, range = 'bipolar', enabled = true) {
    if (typeof sourceId !== 'string' || !sourceId) return false;
    let sample = this.sources.get(sourceId);
    if (!sample) {
      sample = { value: 0, rightValue: 0, nativeValue: 0, nativeRightValue: 0, nativeUnit: null, range: 'bipolar', enabled: false };
      this.sources.set(sourceId, sample);
      this.compileAssignments();
    }
    const object = value !== null && typeof value === 'object';
    sample.value = clamp(object ? value.value : value, -1, 1, 0);
    sample.rightValue = object ? clamp(value.rightValue ?? value.value, -1, 1, 0) : sample.value;
    sample.range = (object ? value.range : range) === 'unipolar' ? 'unipolar' : 'bipolar';
    sample.enabled = object ? value.enabled !== false : enabled;
    return true;
  }

  removeSource(sourceId) {
    const sample = this.sources.get(sourceId);
    if (sample) sample.enabled = false;
    return this.sources.delete(sourceId);
  }

  setAssignment({ id, sourceId, targetId, amount = 100, channel = 'both', invert = false, enabled = true } = {}, compile = true) {
    if (typeof sourceId !== 'string' || !sourceId.trim() || typeof targetId !== 'string') return false;
    const target = this.targets.get(targetId);
    const normalizedChannel = !target || target.channelRouting ? (STEREO_CHANNELS.includes(channel) ? channel : 'both') : 'both';
    const normalizedAmount = clamp(amount, 0, 100, 0);
    // ID-less callers keep the legacy source/target upsert contract. Explicit
    // IDs allow any number of independent rows, including duplicate targets.
    const assignmentId = typeof id === 'string' && id ? id : `${sourceId}:${targetId}`;
    const existing = this.assignments.findIndex(item => item.id === assignmentId && item.sourceId === sourceId);
    const assignment = { id: assignmentId, sourceId, targetId, amount: normalizedAmount,
      channel: normalizedChannel, invert: invert === true, enabled: enabled !== false };
    const frozen = Object.freeze(assignment);
    if (existing >= 0) this.assignments[existing] = frozen;
    else this.assignments.push(frozen);
    if (compile) this.compileAssignments();
    return true;
  }

  setAssignments(assignments = []) {
    this.assignments = [];
    for (let index = 0; index < assignments.length; index += 1) {
      const assignment = assignments[index];
      this.setAssignment({ ...assignment, id: assignment.id || `${assignment.sourceId}.assignment.${index + 1}` }, false);
    }
    this.compileAssignments();
  }

  removeAssignment(sourceId, targetId) {
    const index = this.assignments.findIndex(item => targetId === undefined ? item.id === sourceId
      : item.sourceId === sourceId && item.targetId === targetId);
    if (index < 0) return false;
    this.assignments.splice(index, 1);
    this.compileAssignments();
    return true;
  }

  removeAssignmentsForSource(sourceId) {
    const before = this.assignments.length;
    this.assignments = this.assignments.filter(item => item.sourceId !== sourceId);
    this.compileAssignments();
    return before - this.assignments.length;
  }

  getTargetRange(target, context) {
    const range = target.getRange?.(context);
    return {
      min: clamp(target.getMin ? target.getMin(context) : range?.min, target.min, target.max, target.min),
      max: clamp(target.getMax ? target.getMax(context) : range?.max, target.min, target.max, target.max)
    };
  }

  compileAssignments() {
    // Called only on configuration/source registration. Runtime walks direct
    // source references grouped by target, without assignment scans or objects.
    this.compiledTargets = [];
    this.compiledTargetMap.clear();
    const signature = JSON.stringify([...this.assignments].sort(assignmentOrder)
      .map(item => [item.id, item.sourceId, item.targetId, item.enabled]));
    if (signature !== this.graphSignature) {
      this.graph = compileModulationGraph(this.assignments, this.targets);
      this.graphSignature = signature;
      this.graphCompilationCount = (this.graphCompilationCount || 0) + 1;
    }
    this.compilationCount = (this.compilationCount || 0) + 1;
    this.modulatorTargets = new Map(this.graph.order.map(id => [id, []]));
    this.hasMetaAssignments = this.assignments.some(item => this.targets.get(item.targetId)?.modulatorId);
    for (const target of this.targets.values()) {
      const record = { target, links: [], baseKeys: target.basePath?.split('.') || [],
        base: 0, nativeContribution: 0, logarithmic: target.mapping === 'logarithmic' };
      if (target.modulatorId) this.modulatorTargets.get(target.modulatorId)?.push(record);
      else this.compiledTargets.push(record);
      this.compiledTargetMap.set(target.id, record);
    }
    const ordered = this.hasMetaAssignments ? [...this.assignments].sort(assignmentOrder) : this.assignments;
    for (const assignment of ordered) {
      const record = this.compiledTargetMap.get(assignment.targetId);
      if (!record || !assignment.enabled || this.graph.blocked.has(modulationAssignmentKey(assignment))) continue;
      let source = this.sources.get(assignment.sourceId);
      if (!source) {
        source = { value: 0, rightValue: 0, nativeValue: 0, nativeRightValue: 0, nativeUnit: null, range: 'bipolar', enabled: false };
        this.sources.set(assignment.sourceId, source);
      }
      const scale = assignment.amount / 100 * (assignment.invert ? -1 : 1);
      // Duplicate rows remain independently editable, but runtime work scales
      // with sources/targets rather than the number of editor rows.
      let link = record.links.find(item => item.source === source);
      if (!link) { link = { source, left: 0, right: 0, both: 0, rightSpread: 0 }; record.links.push(link); }
      link.left += assignment.channel === 'right' ? 0 : scale;
      link.right += assignment.channel === 'left' ? 0 : assignment.channel === 'spread' ? -scale : scale;
      if (assignment.channel === 'spread') link.rightSpread -= scale;
      link.both += scale;
    }
  }

  effectiveValue(record, context, channel, clampResult = true) {
    const target = record.target;
    // Built-in dynamic ranges use scalar readers. Legacy custom descriptors
    // can retain getRange; no product target allocates here.
    const range = target.getRange?.(context);
    const min = clamp(target.getMin ? target.getMin(context) : range?.min, target.min, target.max, target.min);
    const max = clamp(target.getMax ? target.getMax(context) : range?.max, min, target.max, target.max);
    let rawBase = target.getBase ? target.getBase(context, channel) : context;
    if (!target.getBase) for (let index = 0; index < record.baseKeys.length; index += 1) rawBase = rawBase?.[record.baseKeys[index]];
    const base = clamp(rawBase, min, max, target.defaultValue ?? min);
    record.base = base;
    record.nativeContribution = 0;
    if (target.isActive && !target.isActive(context)) return base;
    let contribution = 0;
    let nativeContribution = 0;
    for (let index = 0; index < record.links.length; index += 1) {
      const link = record.links[index];
      if (!link.source.enabled) continue;
      const scale = channel === 'left' ? link.left : channel === 'right' ? link.right : link.both;
      if (link.source.nativeUnit === target.unit) {
        nativeContribution += channel === 'right'
          ? link.source.nativeRightValue * scale + (link.source.nativeValue - link.source.nativeRightValue) * link.rightSpread
          : link.source.nativeValue * scale;
      } else contribution += channel === 'right'
        ? link.source.rightValue * scale + (link.source.value - link.source.rightValue) * link.rightSpread
        : link.source.value * scale;
    }
    record.nativeContribution = nativeContribution;
    if (target.modulatorId && contribution === 0 && nativeContribution === 0) return base;
    if (record.logarithmic) {
      const position = Math.log(base) + contribution * (Math.log(max) - Math.log(min)) / 2;
      return Math.exp(clamp(position, Math.log(min), Math.log(max), Math.log(base)));
    }
    const value = base + contribution * (max - min) / 2 + (clampResult ? nativeContribution : 0);
    return clampResult ? clamp(value, min, max, base) : value;
  }

  getEffectiveValue(targetId, context, channel = 'both') {
    const record = this.compiledTargetMap.get(targetId);
    return record ? this.effectiveValue(record, context, channel) : undefined;
  }

  evaluate(context) { this.evaluateRecords(this.compiledTargets, context); }

  evaluateRecords(records, context) {
    for (let index = 0; index < records.length; index += 1) {
      this.evaluateRecord(records[index], context);
    }
  }

  evaluateRecord(record, context) {
    const target = record.target;
    if (typeof target.apply !== 'function') return;
    if (target.channelRouting) {
      const clampResult = !context.deferModulationBandClamp;
      const left = this.effectiveValue(record, context, 'left', clampResult);
      target.apply(context, left, record.base, 'left', record.nativeContribution);
      const right = this.effectiveValue(record, context, 'right', clampResult);
      target.apply(context, right, record.base, 'right', record.nativeContribution);
      return;
    }
    const value = this.effectiveValue(record, context, 'both');
    target.apply(context, value, record.base, 'both');
  }

  getAssignments() { return this.assignments.map(assignment => ({ ...assignment })); }
}
