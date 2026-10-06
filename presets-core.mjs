import { normalizeModulationState } from './lfo-core.mjs';
import { normalizeEnvelopeState } from './envelope-core.mjs';
import { normalizeClockModState } from './clock-mod-core.mjs';
import { normalizeMacroState } from './modulation-core.mjs';

export const PRESET_VERSION = 1;
export const PRESET_FORMAT = 'da_filta-preset';
export const LIBRARY_FORMAT = 'da_filta-preset-library';
export const PRESET_STORAGE_KEY = 'da-filta-presets-v1';
export const SNAPSHOT_STORAGE_KEY = 'da-filta-snapshots-v1';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const clone = value => JSON.parse(JSON.stringify(value));
const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key]]));
const number = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const LFO_FIELDS = ['id', 'enabled', 'waveform', 'rateMode', 'rateHz', 'syncDivision', 'polarity', 'phaseOffsetDeg', 'outputAmount', 'invert', 'seed', 'assignments'];
const ENV_FIELDS = ['id', 'enabled', 'detectorMode', 'attack', 'release', 'delay', 'sensitivity', 'thresholdDb', 'outputAmount', 'assignments'];
const LINEAR = ['inputGainDb', 'inputCharacterAmount', 'resonance', 'dryWet', 'spread', 'feedbackAllAmount',
  'filterResonance', 'filterDepth', 'filterSlope', 'filterBandwidth', 'filterBellWidth', 'filterLowShelfSlope', 'filterHighShelfSlope',
  'filterTiltSlope', 'filterGainDb', 'filterLowShelfGainDb', 'filterHighShelfGainDb', 'filterTiltDb', 'filterFormantVowel',
  'filterFormantShiftSemitones', 'filterFormantWidth', 'filterFormantAmount', 'filterBaxandallBassDb', 'filterBaxandallTrebleDb', 'filterBaxandallSlope',
  'dynamicEqThresholdDb', 'dynamicEqWindowDb', 'dynamicEqRangeDb', 'dynamicEqCutRangeDb', 'dynamicEqBoostRangeDb', 'dynamicEqStrength'];
const LOG = ['filterFrequencyHz', 'filterBellFrequencyHz', 'filterLowShelfFrequencyHz', 'filterHighShelfFrequencyHz', 'filterTiltPivotHz',
  'filterBaxandallCenterHz', 'dynamicEqAttackMs', 'dynamicEqReleaseMs'];
const DISCRETE = ['filterbankEnabled', 'filterEnabled', 'filterType', 'inputPreampStage', 'perChannelBands', 'feedbackAllLeft', 'feedbackAllRight',
  'dynamicEqEnabled', 'dynamicEqMode', 'dynamicEqDetectorMode', 'detectorReferenceMode', 'stereoDetectorMode', 'learnedReferenceValid',
  'learnedReferenceFrozen', 'lfoModuleEnabled', 'envelopeModuleEnabled'];
const routeShape = row => [row.id, row.sourceId, row.targetId, row.channel, row.invert, row.enabled];
const sourceShape = (source, keys) => [pick(source, keys), source.assignments.map(routeShape)];
export function presetStructureKey(state) {
  return JSON.stringify([pick(state, DISCRETE), state.bandChannelLinked, state.feedbackBandLeft, state.feedbackBandRight,
    state.lfoClock.source, state.lfoSources.map(source => sourceShape(source, ['id', 'enabled', 'waveform', 'rateMode', 'syncDivision', 'polarity', 'invert', 'seed'])),
    state.envelopeSources.map(source => sourceShape(source, ['id', 'enabled', 'detectorMode'])),
    sourceShape(state.clockMod, ['enabled', 'waveform', 'direction', 'clockSource', 'clockScale', 'rightInvert', 'lockedBands', 'oscillatorSeed', 'directionSeed']),
    state.macroSources.map(source => sourceShape(source, ['id']))]);
}

// The existing state helpers own defaults and normalization. This contract is
// an explicit projection of production bases, not a second application state.
export function createPresetContract(helpers, productDefaults) {
  const defaults = { ...helpers.createInitialState(), ...productDefaults };
  const sanitizeNumbers = (source, reference) => Object.fromEntries(Object.keys(reference).map(key => [key,
    typeof reference[key] === 'number' ? number(source[key], -Number.MAX_VALUE, Number.MAX_VALUE, reference[key]) : source[key] ?? reference[key]]));
  const normalizePresetState = input => {
    const source = object(input);
    const filterDefaults = helpers.normalizeFilterState(defaults);
    const dynamicDefaults = helpers.normalizeDynamicEqState(defaults);
    const filter = helpers.normalizeFilterState(sanitizeNumbers(source, filterDefaults));
    const dynamic = helpers.normalizeDynamicEqState(sanitizeNumbers(source, dynamicDefaults));
    const lfo = normalizeModulationState({ lfoSources: Array.isArray(source.lfoSources) ? source.lfoSources.map(item => object(item)) : defaults.lfoSources,
      lfoModuleEnabled: bool(source.lfoModuleEnabled, defaults.lfoModuleEnabled) });
    const envelope = normalizeEnvelopeState({ envelopeSources: Array.isArray(source.envelopeSources) ? source.envelopeSources.map(item => object(item)) : defaults.envelopeSources });
    const macros = normalizeMacroState({ macroSources: Array.isArray(source.macroSources) ? source.macroSources.map(item => object(item)) : defaults.macroSources });
    const bands = (key, isBoolean = false) => Array.from({ length: helpers.BAND_COUNT }, (_, index) => isBoolean
      ? bool(source[key]?.[index], defaults[key]?.[index] ?? false)
      : number(source[key]?.[index], -100, 100, defaults[key]?.[index] ?? 0));
    const clock = object(source.lfoClock);
    return { ...filter, ...dynamic,
      filterbankEnabled: bool(source.filterbankEnabled, defaults.filterbankEnabled), filterEnabled: bool(source.filterEnabled, defaults.filterEnabled),
      bandGainLeft: bands('bandGainLeft'), bandGainRight: bands('bandGainRight'), bandChannelLinked: bands('bandChannelLinked', true),
      perChannelBands: bool(source.perChannelBands, defaults.perChannelBands), feedbackBandLeft: bands('feedbackBandLeft', true), feedbackBandRight: bands('feedbackBandRight', true),
      feedbackAllLeft: bool(source.feedbackAllLeft, defaults.feedbackAllLeft), feedbackAllRight: bool(source.feedbackAllRight, defaults.feedbackAllRight),
      resonance: number(source.resonance, -1, 1, defaults.resonance), dryWet: number(source.dryWet, 0, 100, defaults.dryWet),
      feedbackAllAmount: number(source.feedbackAllAmount, 0, 100, defaults.feedbackAllAmount),
      spread: number(source.spread, -Math.max(...helpers.SPREAD_MAX_OFFSET_VALUES), Math.max(...helpers.SPREAD_MAX_OFFSET_VALUES), defaults.spread),
      inputGainDb: number(source.inputGainDb, 0, 24, defaults.inputGainDb ?? defaults.inputGain),
      inputPreampStage: ['linear', 'silk', 'tape', 'tube', 'console', 'crunch', 'destroy'].includes(source.inputPreampStage) ? source.inputPreampStage : defaults.inputPreampStage,
      inputCharacterAmount: number(source.inputCharacterAmount, 0, 100, defaults.inputCharacterAmount),
      lfoModuleEnabled: lfo.lfoModuleEnabled, lfoSources: lfo.lfoSources.map(item => pick(item, LFO_FIELDS)),
      envelopeModuleEnabled: bool(source.envelopeModuleEnabled, defaults.envelopeModuleEnabled), envelopeSources: envelope.envelopeSources.map(item => pick(item, ENV_FIELDS)),
      macroSources: macros.macroSources,
      lfoClock: { source: ['internal', 'midi'].includes(clock.source) ? clock.source : defaults.lfoClock.source,
        bpm: number(clock.bpm, 30, 300, defaults.lfoClock.bpm) },
      clockMod: normalizeClockModState({ ...defaults.clockMod, ...object(source.clockMod) }) };
  };
  const capturePresetState = (engineState, uiState = engineState) => normalizePresetState({ ...engineState, bandChannelLinked: uiState.bandChannelLinked });
  const clonePresetState = state => clone(normalizePresetState(state));
  const interpolate = (a, b, t, logarithmic = false) => a === b ? a : logarithmic && a > 0 && b > 0
    ? Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t) : a + (b - a) * t;
  const interpolatePresetState = (snapshotA, snapshotB, percent, limits = defaults) => {
    const a = normalizePresetState(snapshotA), b = normalizePresetState(snapshotB);
    const t = number(percent, 0, 100, 0) / 100;
    if (t === 0) return clone(a);
    if (t === 1) return clone(b);
    const state = clone(t < .5 ? a : b);
    for (const key of LINEAR) state[key] = interpolate(a[key], b[key], t);
    for (const key of LOG) state[key] = interpolate(a[key], b[key], t, true);
    for (const key of ['bandGainLeft', 'bandGainRight']) state[key] = a[key].map((value, index) => helpers.bandGainDbToControl(
      interpolate(helpers.controlToBandGainDb(value, limits.maxBandBoostDb, limits.maxBandCutDb),
        helpers.controlToBandGainDb(b[key][index], limits.maxBandBoostDb, limits.maxBandCutDb), t), limits.maxBandBoostDb, limits.maxBandCutDb));
    for (const key of ['dynamicEqBandSensitivity', 'learnedReferenceDb']) state[key] = a[key].map((value, index) => interpolate(value, b[key][index], t));
    state.lfoClock.bpm = interpolate(a.lfoClock.bpm, b.lfoClock.bpm, t);
    const morphRows = (out, left, right) => out.assignments.forEach(row => {
      const matchA = left.assignments.find(candidate => candidate.id === row.id && JSON.stringify(routeShape(candidate)) === JSON.stringify(routeShape(row)));
      const matchB = right.assignments.find(candidate => candidate.id === row.id && JSON.stringify(routeShape(candidate)) === JSON.stringify(routeShape(row)));
      if (matchA && matchB) row.amount = interpolate(matchA.amount, matchB.amount, t);
    });
    for (const [family, linear, log] of [['lfoSources', ['phaseOffsetDeg', 'outputAmount'], ['rateHz']],
      ['envelopeSources', ['sensitivity', 'thresholdDb', 'outputAmount'], ['attack', 'release', 'delay']], ['macroSources', ['value'], []]]) {
      state[family].forEach((out, index) => {
        for (const key of linear) out[key] = interpolate(a[family][index][key], b[family][index][key], t);
        for (const key of log) out[key] = interpolate(a[family][index][key], b[family][index][key], t, true);
        morphRows(out, a[family][index], b[family][index]);
      });
    }
    for (const key of ['midpointDb', 'modulationGain', 'internalBpm']) state.clockMod[key] = interpolate(a.clockMod[key], b.clockMod[key], t);
    state.clockMod.sourceFrequencyHz = interpolate(a.clockMod.sourceFrequencyHz, b.clockMod.sourceFrequencyHz, t, true);
    morphRows(state.clockMod, a.clockMod, b.clockMod);
    return state;
  };
  const applyPresetState = (engine, state, options) => { const normalized = normalizePresetState(state); engine.applyPresetState(normalized, options); return normalized; };
  return Object.freeze({ normalizePresetState, capturePresetState, clonePresetState, interpolatePresetState, applyPresetState,
    init: freeze(normalizePresetState(defaults)) });
}

export function presetName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 64) throw new Error('Name muss 1–64 Zeichen enthalten.');
  return name;
}

export class PresetStore {
  constructor(contract, storage) {
    this.contract = contract; this.storage = storage; this.presets = []; this.snapshots = { A: null, B: null }; this.error = '';
    for (const [key, format] of [[PRESET_STORAGE_KEY, LIBRARY_FORMAT], [SNAPSHOT_STORAGE_KEY, 'da_filta-snapshots']]) {
      try {
        const raw = storage.getItem(key); if (!raw) continue;
        const data = JSON.parse(raw);
        if (data.format !== format || data.version !== PRESET_VERSION) throw new Error('Unbekanntes gespeichertes Format/Version.');
        if (key === PRESET_STORAGE_KEY) this.appendImportedEntries(this.validateImport(data));
        else for (const slot of ['A', 'B']) if (data.slots?.[slot]) this.snapshots[slot] = freeze(contract.clonePresetState(data.slots[slot]));
      } catch (error) { this.error = `Speicher nicht lesbar: ${error.message}`; }
    }
  }
  uniqueId() { let id; do { id = globalThis.crypto?.randomUUID?.() || `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`; } while (this.presets.some(item => item.id === id)); return id; }
  entry(id) { return this.presets.find(item => item.id === id); }
  checkName(name, exceptId) {
    const normalized = presetName(name);
    if (normalized === 'INIT' || this.presets.some(item => item.id !== exceptId && item.name === normalized)) throw new Error('Name bereits vorhanden. UPDATE oder anderen Namen verwenden.');
    return normalized;
  }
  persist(snapshots = false) {
    try {
      this.storage.setItem(snapshots ? SNAPSHOT_STORAGE_KEY : PRESET_STORAGE_KEY, JSON.stringify(snapshots
        ? { format: 'da_filta-snapshots', version: PRESET_VERSION, slots: this.snapshots } : this.exportLibrary()));
      this.error = ''; return true;
    } catch (error) { this.error = `Nicht dauerhaft gespeichert: ${error.message}. Im Arbeitsspeicher weiterhin verfügbar.`; return false; }
  }
  saveAs(name, state) {
    const entry = { id: this.uniqueId(), name: this.checkName(name), version: PRESET_VERSION, state: this.contract.clonePresetState(state) };
    this.presets.push(entry); this.persist(); return entry;
  }
  update(id, state) { const entry = this.entry(id); if (!entry) throw new Error('User-Preset auswählen. INIT ist schreibgeschützt.'); entry.state = this.contract.clonePresetState(state); this.persist(); return entry; }
  rename(id, name) { const entry = this.entry(id); if (!entry) throw new Error('INIT ist schreibgeschützt.'); entry.name = this.checkName(name, id); this.persist(); return entry; }
  duplicate(id, name) { const entry = id === 'factory:init' ? { state: this.contract.init } : this.entry(id); if (!entry) throw new Error('Preset fehlt.'); return this.saveAs(name, entry.state); }
  delete(id) { if (!this.entry(id)) throw new Error('INIT ist schreibgeschützt.'); this.presets = this.presets.filter(item => item.id !== id); this.persist(); }
  capture(slot, state) { if (!['A', 'B'].includes(slot)) throw new Error('Ungültiger Snapshot-Slot.'); this.snapshots[slot] = freeze(this.contract.clonePresetState(state)); this.persist(true); }
  exportPreset(id) {
    const entry = id === 'factory:init' ? { name: 'INIT', state: this.contract.init } : this.entry(id);
    if (!entry) throw new Error('Preset fehlt.');
    return { format: PRESET_FORMAT, version: PRESET_VERSION, name: entry.name, state: this.contract.clonePresetState(entry.state) };
  }
  exportLibrary() { return { format: LIBRARY_FORMAT, version: PRESET_VERSION,
    presets: this.presets.map(entry => ({ id: entry.id, ...this.exportPreset(entry.id) })) }; }
  validateImport(data) {
    if (!data || ![PRESET_FORMAT, LIBRARY_FORMAT].includes(data.format) || data.version !== PRESET_VERSION) throw new Error('Unbekanntes Preset-Format oder nicht unterstützte Version.');
    const entries = data.format === PRESET_FORMAT ? [data] : data.presets;
    if (!Array.isArray(entries)) throw new Error('Preset-Library muss eine Preset-Liste enthalten.');
    return entries.map(entry => {
      if (!entry || entry.version !== PRESET_VERSION || entry.format !== PRESET_FORMAT || !entry.state || typeof entry.state !== 'object' || Array.isArray(entry.state)) throw new Error('Ungültiger Preset-Eintrag.');
      return { id: typeof entry.id === 'string' && entry.id && entry.id !== 'factory:init' ? entry.id : this.uniqueId(),
        name: presetName(entry.name), version: PRESET_VERSION, state: this.contract.clonePresetState(entry.state) };
    });
  }
  appendImportedEntries(entries) {
    for (const entry of entries) {
      const base = entry.name; let suffix = 2;
      while (entry.name === 'INIT' || this.presets.some(item => item.name === entry.name)) { const tail = ` (${suffix++})`; entry.name = base.slice(0, 64 - tail.length) + tail; }
      if (this.presets.some(item => item.id === entry.id)) entry.id = this.uniqueId();
      this.presets.push(entry);
    }
    return entries;
  }
  import(text) { const entries = this.appendImportedEntries(this.validateImport(JSON.parse(text))); this.persist(); return entries; }
}
