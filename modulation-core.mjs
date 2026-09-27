const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const filterIsActive = (context, types = null) => Boolean(context?.filterEnabled)
  && (!types || types.includes(context?.filterShapeParams?.type));
const dynamicEqIsActive = context => Boolean(context?.dynamicEqEnabled);
const filterbankIsActive = context => Boolean(context?.filterbankEnabled);
const pathValue = (object, path) => path.split('.').reduce((current, key) => current?.[key], object);

const descriptor = ({ id, label, group, min, max, mapping, unit, activeWhen, isActive, getBase, getRange, apply }) => Object.freeze({
  id, label, group, min, max, range: Object.freeze([min, max]), mapping, unit,
  clamp: Object.freeze({ min, max }), activeWhen, isActive, getBase, getRange, apply
});

const filterTarget = (id, label, field, min, max, mapping, unit, activeWhen, types = null) => descriptor({
  id, label, group: 'FILTER', min, max, mapping, unit, activeWhen,
  isActive: context => filterIsActive(context, types),
  getBase: context => pathValue(context?.filterShapeParams, field),
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
  filterTarget('filter.frequencyHz', 'Filter Frequency', 'frequencyHz', 29, 11000, 'logarithmic', 'Hz', 'filterEnabled'),
  filterTarget('filter.resonance', 'Filter Resonance', 'resonance', 0, 100, 'normalized', '%', 'classicFilter', ['lowpass', 'highpass', 'bandpass', 'notch']),
  filterTarget('filter.depth', 'Filter Depth', 'depth', 0, 100, 'normalized', '%', 'classicFilter', ['lowpass', 'highpass', 'bandpass', 'notch']),
  filterTarget('filter.gainDb', 'Filter Gain', 'gainDb', -60, 24, 'db', 'dB', 'bellFilter', ['bell']),
  filterTarget('filter.tiltDb', 'Filter Tilt', 'tiltDb', -60, 24, 'db', 'dB', 'tiltFilter', ['tilt']),
  filterTarget('filter.formantVowel', 'Formant Vowel', 'formantVowel', 0, 4, 'continuous-enum', 'vowel', 'formantFilter', ['formant']),
  ...Array.from({ length: 10 }, (_, index) => descriptor({
    id: `filterbank.band.${index}.gainDb`, label: `Band ${index + 1} Gain`, group: 'FILTERBANK',
    min: -60, max: 24, mapping: 'db', unit: 'dB', activeWhen: 'filterbankEnabled',
    isActive: context => filterbankIsActive(context),
    getRange: context => ({
      min: -clamp(context?.maxBandCutDb, 0, 60, 12),
      max: clamp(context?.maxBandBoostDb, 0, 24, 12)
    }),
    getBase: context => context?.getModulationBandBaseDb?.(index),
    apply: (context, value, base) => {
      if (context?.modulationDirectBandOffsetsDb) context.modulationDirectBandOffsetsDb[index] = value - base;
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
  })
];

export const MODULATION_TARGETS = Object.freeze(TARGETS);
const targetMap = new Map(TARGETS.map(target => [target.id, target]));
export const getModulationTarget = id => targetMap.get(id) || null;
export const isModulationTargetActive = (id, context) => Boolean(targetMap.get(id)?.isActive?.(context));

const normalizeSourceSample = source => {
  if (typeof source === 'number') return { value: Number.isFinite(source) ? clamp(source, -1, 1, 0) : 0, range: 'bipolar' };
  if (!source || typeof source !== 'object') return null;
  const range = source.range === 'unipolar' ? 'unipolar' : 'bipolar';
  return {
    value: Number.isFinite(Number(source.value))
      ? clamp(source.value, range === 'unipolar' ? 0 : -1, 1, 0)
      : 0,
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
    const delta = source.range === 'unipolar' ? modulation * (maximum - minimum) / 2 : modulation * (maximum - minimum) / 2;
    return clamp(Math.exp(position + delta), target.min, target.max, base);
  }
  return clamp(base + modulation * extent / 2, target.min, target.max, base);
}

export class ModulationCore {
  constructor(targets = MODULATION_TARGETS) {
    this.targets = new Map(targets.map(target => [target.id, target]));
    this.sources = new Map();
    this.assignments = [];
  }

  registerTarget(target) {
    if (!target || typeof target.id !== 'string' || !target.id || !Number.isFinite(target.min)
      || !Number.isFinite(target.max) || target.min > target.max
      || !['linear', 'logarithmic', 'db', 'normalized', 'continuous-enum'].includes(target.mapping)) return false;
    this.targets.set(target.id, Object.freeze({ ...target }));
    return true;
  }

  setSourceValue(sourceId, value, range = 'bipolar') {
    if (typeof sourceId !== 'string' || !sourceId.trim()) return false;
    const sample = normalizeSourceSample(typeof value === 'object' && value !== null ? value : { value, range });
    if (!sample) return false;
    this.sources.set(sourceId, sample);
    return true;
  }

  removeSource(sourceId) { return this.sources.delete(sourceId); }

  setAssignment({ sourceId, targetId, amount = 100 } = {}) {
    if (typeof sourceId !== 'string' || !sourceId.trim() || typeof targetId !== 'string' || !this.targets.has(targetId)) return false;
    const normalizedAmount = clamp(amount, 0, 100, 0);
    const existing = this.assignments.findIndex(item => item.sourceId === sourceId && item.targetId === targetId);
    const assignment = Object.freeze({ sourceId, targetId, amount: normalizedAmount });
    if (existing >= 0) this.assignments[existing] = assignment;
    else this.assignments.push(assignment);
    return true;
  }

  removeAssignment(sourceId, targetId) {
    const index = this.assignments.findIndex(item => item.sourceId === sourceId && item.targetId === targetId);
    if (index < 0) return false;
    this.assignments.splice(index, 1);
    return true;
  }

  removeAssignmentsForSource(sourceId) {
    const before = this.assignments.length;
    this.assignments = this.assignments.filter(item => item.sourceId !== sourceId);
    return before - this.assignments.length;
  }

  getTargetRange(target, context) {
    const range = target.getRange?.(context);
    return {
      min: clamp(range?.min, target.min, target.max, target.min),
      max: clamp(range?.max, target.min, target.max, target.max)
    };
  }

  getEffectiveValue(targetId, context) {
    const target = this.targets.get(targetId);
    if (!target) return undefined;
    const range = this.getTargetRange(target, context);
    const rawBase = target.getBase ? target.getBase(context) : pathValue(context, target.basePath);
    const base = clamp(rawBase, range.min, range.max, target.defaultValue ?? range.min);
    if (target.isActive && !target.isActive(context)) return base;
    let effective = base;
    for (const assignment of this.assignments) {
      if (assignment.targetId !== targetId) continue;
      const source = this.sources.get(assignment.sourceId);
      if (!source || assignment.amount === 0) continue;
      const extent = range.max - range.min;
      const delta = source.value * (assignment.amount / 100) * extent / 2;
      if (target.mapping === 'logarithmic') {
        const logMin = Math.log(range.min);
        const logMax = Math.log(range.max);
        const logBase = Math.log(Math.max(range.min, effective));
        const logDelta = source.value * (assignment.amount / 100) * (logMax - logMin) / 2;
        effective = Math.exp(logBase + logDelta);
      } else {
        effective += delta;
      }
    }
    return clamp(effective, range.min, range.max, base);
  }

  evaluate(context) {
    for (const target of this.targets.values()) {
      if (typeof target.apply !== 'function') continue;
      const value = this.getEffectiveValue(target.id, context);
      const range = this.getTargetRange(target, context);
      const base = target.getBase ? clamp(target.getBase(context), range.min, range.max, target.defaultValue ?? range.min)
        : clamp(pathValue(context, target.basePath), range.min, range.max, target.defaultValue ?? range.min);
      target.apply(context, value, base);
    }
  }

  getAssignments() { return this.assignments.map(assignment => ({ ...assignment })); }
}
