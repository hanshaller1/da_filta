const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const filterIsActive = (context, types = null) => Boolean(context?.filterEnabled)
  && (!types || types.includes(context?.filterShapeParams?.type));
const dynamicEqIsActive = context => Boolean(context?.dynamicEqEnabled);
const filterbankIsActive = context => Boolean(context?.filterbankEnabled);
const pathValue = (object, path) => path.split('.').reduce((current, key) => current?.[key], object);

const descriptor = ({ id, label, group, min, max, mapping, unit, activeWhen, isActive, getBase, getRange, apply, channelRouting = false }) => Object.freeze({
  id, label, group, min, max, range: Object.freeze([min, max]), mapping, unit, channelRouting,
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
    getRange: context => ({ min: -Math.abs(Number(context?.spreadMaxOffsetDb) || 6), max: Math.abs(Number(context?.spreadMaxOffsetDb) || 6) }),
    apply: (context, value, base) => context?.setEffectiveSpread?.(value, base)
  }),
  descriptor({
    id: 'filterbank.feedbackAllAmount', label: 'FB All Amount', group: 'FILTERBANK', min: 0, max: 100,
    mapping: 'normalized', unit: '%', activeWhen: 'filterbankEnabled',
    isActive: context => filterbankIsActive(context),
    getBase: context => context?.baseFeedbackAllAmount,
    apply: (context, value) => context?.setEffectiveFeedbackAllAmount?.(value)
  }),
  filterTarget('filter.frequencyHz', 'Filter Frequency', 'frequencyHz', 29, 11000, 'logarithmic', 'Hz', 'filterEnabled'),
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
    getRange: context => ({
      min: -clamp(context?.maxBandCutDb, 0, 60, 12),
      max: clamp(context?.maxBandBoostDb, 0, 24, 12)
    }),
    getBase: (context, channel = 'left') => context?.getModulationBandBaseDb?.(index, channel),
    apply: (context, value, base, channel) => {
      if (context?.setModulationBandOffset) context.setModulationBandOffset(index, channel, value - base);
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
  }))
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

  setAssignment({ sourceId, targetId, amount = 100, channel = 'both', invert = false } = {}) {
    if (typeof sourceId !== 'string' || !sourceId.trim() || typeof targetId !== 'string' || !this.targets.has(targetId)) return false;
    const target = this.targets.get(targetId);
    const normalizedChannel = target.channelRouting && ['left', 'right', 'spread'].includes(channel) ? channel : 'both';
    const normalizedAmount = clamp(amount, 0, 100, 0);
    const existing = this.assignments.findIndex(item => item.sourceId === sourceId && item.targetId === targetId);
    const assignment = { sourceId, targetId, amount: normalizedAmount };
    if (normalizedChannel !== 'both') assignment.channel = normalizedChannel;
    if (invert === true) assignment.invert = true;
    const frozen = Object.freeze(assignment);
    if (existing >= 0) this.assignments[existing] = frozen;
    else this.assignments.push(frozen);
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

  getEffectiveValue(targetId, context, channel = 'both') {
    const target = this.targets.get(targetId);
    if (!target) return undefined;
    const range = this.getTargetRange(target, context);
    const rawBase = target.getBase ? target.getBase(context, channel) : pathValue(context, target.basePath);
    const base = clamp(rawBase, range.min, range.max, target.defaultValue ?? range.min);
    if (target.isActive && !target.isActive(context)) return base;
    let effective = base;
    for (const assignment of this.assignments) {
      if (assignment.targetId !== targetId) continue;
      if (target.channelRouting && assignment.channel && assignment.channel !== 'both'
        && assignment.channel !== 'spread' && assignment.channel !== channel) continue;
      const source = this.sources.get(assignment.sourceId);
      if (!source || assignment.amount === 0) continue;
      const channelSign = target.channelRouting && assignment.channel === 'spread' && channel === 'right' ? -1 : 1;
      const signed = (assignment.invert ? -source.value : source.value) * channelSign;
      const extent = range.max - range.min;
      const delta = signed * (assignment.amount / 100) * extent / 2;
      if (target.mapping === 'logarithmic') {
        const logMin = Math.log(range.min);
        const logMax = Math.log(range.max);
        const logBase = Math.log(Math.max(range.min, effective));
        const logDelta = signed * (assignment.amount / 100) * (logMax - logMin) / 2;
        effective = Math.exp(logBase + logDelta);
      } else effective += delta;
    }
    return clamp(effective, range.min, range.max, base);
  }

  evaluate(context) {
    for (const target of this.targets.values()) {
      if (typeof target.apply !== 'function') continue;
      if (target.channelRouting) {
        for (const channel of ['left', 'right']) {
          const value = this.getEffectiveValue(target.id, context, channel);
          const range = this.getTargetRange(target, context);
          const rawBase = target.getBase ? target.getBase(context, channel) : pathValue(context, target.basePath);
          const base = clamp(rawBase, range.min, range.max, target.defaultValue ?? range.min);
          target.apply(context, value, base, channel);
        }
        continue;
      }
      const value = this.getEffectiveValue(target.id, context);
      const range = this.getTargetRange(target, context);
      const rawBase = target.getBase ? target.getBase(context) : pathValue(context, target.basePath);
      const base = clamp(rawBase, range.min, range.max, target.defaultValue ?? range.min);
      target.apply(context, value, base, 'both');
    }
  }

  getAssignments() { return this.assignments.map(assignment => ({ ...assignment })); }
}
