const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { summarizeNativeRender } = require('./measure-input-character-full-graph.cjs');
const BASE_REVISION = '3c15441';
const ROOT = path.resolve(__dirname, '../..');
const SOURCES = ['filterbank-processor.js', 'input-preamp-processor.js', 'output-guard-processor.js',
  'output-protection-processor.js', 'tpt-svf.js', 'dynamic-eq-core.mjs', 'filter-shape-core.mjs',
  'modulation-core.mjs', 'lfo-core.mjs', 'envelope-core.mjs', 'clock-core.mjs', 'clock-mod-core.mjs',
  'audio-engine.js', 'filterbank.js'];
const baselineCache = new Map();
function source(file, baseline = false) {
  if (!baseline) return fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (!baselineCache.has(file)) baselineCache.set(file, execFileSync('git', ['show', `${BASE_REVISION}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4e6 }));
  return baselineCache.get(file);
}
async function installBaselineRoutes(page, production = false) {
  const serve = route => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!SOURCES.includes(file)) throw new Error(`Unknown baseline dependency: ${file}`);
    return route.fulfill({ contentType: 'text/javascript', body: source(file, true) });
  };
  await page.route('**/tests/p2-baseline/*', serve);
  if (production) for (const file of SOURCES) await page.route(`**/${file}`, serve);
}
function processorBundle(origin, baseline = false) {
  const bank = source('filterbank-processor.js', baseline);
  const input = source('input-preamp-processor.js', baseline);
  const imports = bank.match(/^import .*;$/gm).join('\n').replace(/from '\.\//g, `from '${origin}/${baseline ? 'tests/p2-baseline/' : ''}`);
  return `${imports}
export function classesFor(sampleRate) {
  const registered = {};
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
  const registerProcessor = (name, Class) => { registered[name] = Class; };
  ${bank.replace(/^import .*;\r?\n/gm, '')}
  ${input}
  ${source('output-guard-processor.js', baseline)}
  ${source('output-protection-processor.js', baseline)}
  return registered;
}`;
}
function featureCases() {
  return [
    { name: 'idle', idle: true }, { name: 'filterbank' }, { name: 'filter', filter: true },
    { name: 'dynamic-eq', dynamicEq: true }, { name: 'lfo-one', lfo: 1 },
    { name: 'lfo-many', lfo: 12 }, { name: 'envelope', envelope: true },
    { name: 'clock-mod', clock: true }, { name: 'current-local', topology: 'local-loop-exp', bands: 5, resonance: .6 },
    { name: 'current-local-main', topology: 'local-loop-exp', bands: 5, main: true, resonance: .6 },
    { name: 'unified', core: 'zdf', bands: 5, main: true, resonance: .6 },
    { name: 'per-band', core: 'zdf-per-band', bands: 5, main: true, resonance: .6 },
    { name: 'tube', stage: 'tube' }, { name: 'destroy', stage: 'destroy' },
    { name: 'heavy', stage: 'tube', dynamicEq: true, lfo: 12, envelope: true, clock: true, bands: 5, main: true, resonance: .6 },
    { name: 'worst', stage: 'destroy', dynamicEq: true, lfo: 32, envelope: true, clock: true, bands: 10, main: true, resonance: 1, core: 'zdf-per-band', diagnostics: true },
    { name: 'diagnostics-linear', bands: 5, main: true, resonance: .6, diagnostics: true },
    { name: 'diagnostics-nonlinear', bands: 5, resonance: .6, topology: 'isolated-tpt', diagnostics: true, nonlinearDiagnostics: true },
    { name: 'safety-telemetry', safetyTelemetry: true }
  ];
}
function coreCases() {
  const cases = [];
  for (const core of ['current-common', 'current-local', 'zdf', 'zdf-per-band']) {
    const config = { core: core.startsWith('current') ? 'current' : core, topology: core === 'current-local' ? 'local-loop-exp' : 'common-bus' };
    for (const resonance of [.7, -.7]) for (const route of ['local', 'main', 'both']) {
      cases.push({ ...config, name: `${core}/${resonance > 0 ? '+' : '-'}/${route}/5`, resonance, bands: route === 'main' ? 0 : 5, main: route !== 'local', rates: [48000, 96000] });
    }
    for (const bands of [1, 2, 10]) cases.push({ ...config, name: `${core}/+/both/${bands}`, resonance: .7, bands, main: true, rates: [96000] });
    for (const resonance of [.7, -.7]) cases.push({ ...config, name: `${core}/${resonance > 0 ? '+' : '-'}/both/5@44`, resonance, bands: 5, main: true, rates: [44100] });
    cases.push({ ...config, name: `${core}/zero`, resonance: 0, bands: 10, main: true, rates: [96000] });
    cases.push({ ...config, name: `${core}/closed`, resonance: .7, bands: 0, main: false, rates: [96000] });
  }
  cases.push({ name: 'legacy-main', resonance: .7, bands: 5, main: true, legacy: true, rates: [48000, 96000] });
  cases.push({ name: 'isolated-tpt', resonance: .7, bands: 2, topology: 'isolated-tpt', rates: [48000, 96000] });
  return cases;
}
// These functions are also serialized into the browser; keep them self-contained.
function modulationOptions(config) {
  const lfoSources = Array.from({ length: 4 }, (_, slot) => ({ id: `lfo.${slot + 1}`, enabled: Boolean(config.lfo),
    waveform: slot === 3 ? 'sample-hold' : 'sine', rateMode: slot % 2 ? 'sync' : 'free', rateHz: .7 + slot,
    assignments: Array.from({ length: Math.ceil((config.lfo || 0) / 4) }, (_, i) => ({ id: `route-${slot}-${i}`,
      targetId: slot === 0 && i === 0 ? 'global.resonance' : `filterbank.band.${(slot * 3 + i) % 10}.gainDb`,
      amount: 10, channel: i % 2 ? 'spread' : 'both', enabled: true })) }));
  // One-assignment scenario has exactly one route and one active source.
  if (config.lfo === 1) for (let slot = 1; slot < 4; slot++) { lfoSources[slot].enabled = false; lfoSources[slot].assignments = []; }
  return { lfoModuleEnabled: Boolean(config.lfo), lfoSources,
    envelopeModuleEnabled: Boolean(config.envelope), envelopeSources: [{ enabled: Boolean(config.envelope), detectorMode: 'rms',
      attack: 20, release: 250, delay: 40, targetId: config.envelope ? 'filterbank.band.3.gainDb' : '', amount: 15, channel: 'spread' }],
    clock: { source: 'internal', bpm: 123, running: true },
    clockMod: { enabled: Boolean(config.clock), internalBpm: 123, sourceFrequencyHz: 3, modulationGain: 20 },
    filterbankEnabled: !config.idle, filterEnabled: Boolean(config.filter), dryWet: 70, baseResonance: config.resonance || 0 };
}
function bankOptions(config, frequencies, qs) {
  return { bandFrequencies: frequencies, bandQs: qs, bandGainLeft: Array(10).fill(25), bandGainRight: Array(10).fill(25),
    feedbackBandLeft: Array.from({ length: 10 }, (_, i) => i < (config.bands || 0)),
    feedbackBandRight: Array.from({ length: 10 }, (_, i) => i < (config.bands || 0)),
    feedbackAllLeft: Boolean(config.main), feedbackAllRight: Boolean(config.main), resonance: config.resonance || 0,
    feedbackTopology: config.topology || 'common-bus', feedbackCore: config.core || 'current',
    feedbackAllEngine: config.legacy ? 'legacy' : 'common-bus', feedbackAllSource: 'post-gain-sum',
    feedbackAllLevel: 'raw', wetModel: 'filterbank-sum', spectralCoreRequired: !config.idle,
    collectResonatorDiagnostics: Boolean(config.diagnostics), collectNonlinearResonatorDiagnostics: Boolean(config.nonlinearDiagnostics),
    dynamicEqEnabled: Boolean(config.dynamicEq), dynamicEqMode: 'cut', dynamicEqThresholdDb: -30,
    modulationState: modulationOptions(config) };
}
function harnessModule(origin, baseline = false) {
  return `${processorBundle(origin, baseline)}
const modulationOptions = ${modulationOptions.toString()};
const bankOptions = ${bankOptions.toString()};
const registryCache = new Map();
export class Harness {
  constructor(rate, config, frequencies, qs) {
    this.rate = rate; this.config = config;
    if (!registryCache.has(rate)) registryCache.set(rate, classesFor(rate));
    this.classes = registryCache.get(rate);
    const options = bankOptions(config, frequencies, qs);
    if (config.filter) {
      // Reuse the application's actual static FILTER composition, rather
      // than toggling only the modulation flag in this processor harness.
      const engine = new window.AudioEngine({});
      engine.bandGainLeft.fill(25); engine.bandGainRight.fill(25); engine.setFilterEnabled(true);
      options.bandGainLeft = engine.effectiveBandGainLeft; options.bandGainRight = engine.effectiveBandGainRight;
      options.modulationState = engine.getModulationState();
    }
    this.bank = new this.classes['da-filta-processor']({ processorOptions: options });
    this.input = new this.classes['resonant-input-preamp-processor']({ processorOptions: { stage: config.stage || 'linear', characterAmount: config.amount ?? 1 } });
    this.guard = new this.classes['da-filta-output-guard']({ processorOptions: { enabled: true, telemetryEnabled: Boolean(config.safetyTelemetry) } });
    this.safety = new this.classes['da-filta-output-protection']({ processorOptions: { enabled: true, telemetryEnabled: Boolean(config.safetyTelemetry) } });
    this.samples = [new Float32Array(128), new Float32Array(128)];
    for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) this.samples[c][i] = .15 * Math.sin(i * .19 + c * .27) + .03 * Math.cos(i * .71);
    this.character = [new Float32Array(128), new Float32Array(128)];
    this.wet = [new Float32Array(128), new Float32Array(128)];
    this.mod = [new Float32Array(128)]; this.mix = [new Float32Array(128), new Float32Array(128)];
    this.guarded = [new Float32Array(128), new Float32Array(128)]; this.output = [new Float32Array(128), new Float32Array(128)];
    this.inputIn = [this.samples]; this.inputOut = [this.character]; this.bankIn = [this.character]; this.bankOut = [this.wet, this.mod];
    this.mixIn = [this.mix]; this.guardOut = [this.guarded]; this.safetyIn = [this.guarded]; this.safetyOut = [this.output];
    this.messages = 0;
    for (const processor of [this.bank, this.guard, this.safety]) processor.port.postMessage = message => { this.messages++; this.lastMessage = message; };
  }
  process(part = 'graph') {
    if (part === 'input') { this.input.process(this.inputIn, this.inputOut); return this.character; }
    if (part === 'bank') { this.bank.process(this.inputIn, this.bankOut); return this.wet; }
    if (part === 'guard') { this.guard.process(this.inputIn, this.guardOut); return this.guarded; }
    if (part === 'safety') { this.safety.process(this.inputIn, this.safetyOut); return this.output; }
    this.input.process(this.inputIn, this.inputOut); this.bank.process(this.bankIn, this.bankOut);
    for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) this.mix[c][i] = (.3 * this.character[c][i] + .7 * this.wet[c][i]) * .5011872336272722;
    this.guard.process(this.mixIn, this.guardOut); this.safety.process(this.safetyIn, this.safetyOut); return this.output;
  }
}
export { bankOptions, modulationOptions };
`;
}
async function loadHarnesses(page) {
  await installBaselineRoutes(page);
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  await page.evaluate(async ({ before, after }) => {
    const load = code => import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    window.p2Before = await load(before); window.p2After = await load(after);
  }, { before: harnessModule(origin, true), after: harnessModule(origin) });
}
async function measureNative(page, cases, { baseline = false, durationMs = 1500 } = {}) {
  for (const file of SOURCES) await page.unroute(`**/${file}`);
  if (baseline) await installBaselineRoutes(page, true);
  await page.goto('/');
  const cdp = await page.context().newCDPSession(page), events = [];
  cdp.on('Tracing.dataCollected', event => events.push(...event.value));
  await cdp.send('Tracing.start', { categories: 'audio,webaudio,disabled-by-default-audio,v8', transferMode: 'ReportEvents' });
  const live = await page.evaluate(async ({ cases, modulationCode, durationMs }) => {
    const modulationOptions = new Function(`return (${modulationCode})`)();
    const Context = window.AudioContext, play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { this.muted = true; return play.call(this); };
    const rows = [];
    try {
      for (const config of cases) {
        window.AudioContext = class extends Context { constructor() { super({ sampleRate: config.rate, latencyHint: 'interactive' }); } };
        const engine = new window.AudioEngine({}); let processorErrors = 0, messages = 0, reads = 0, finite = true, peak = 0;
        engine.setFilterbankEnabled(!config.idle); engine.setFilterEnabled(Boolean(config.filter));
        engine.setFeedbackTopology(config.topology || 'common-bus'); engine.setFeedbackCore(config.core || 'current');
        engine.setResonance(config.resonance || 0); engine.setDynamicEq({ dynamicEqEnabled: Boolean(config.dynamicEq), dynamicEqThresholdDb: -30 });
        engine.setInputPreampStage((config.stage || 'linear').split('->')[0]); engine.setInputCharacterAmount(100 * (config.amount ?? 1));
        engine.setDryWet(70); engine.setVolumeDb(-6); engine.setModulationState(modulationOptions(config));
        engine.setResonatorDiagnosticsEnabled(Boolean(config.diagnostics), Boolean(config.nonlinearDiagnostics));
        for (const channel of ['left', 'right']) {
          for (let i = 0; i < 10; i++) { engine.setBandBaseGain(channel, i, 25); engine.setBandFeedback(channel, i, i < (config.bands || 0)); }
          engine.setFeedbackAll(channel, Boolean(config.main));
        }
        engine.loadSampleBuffer = async () => {
          const buffer = engine.context.createBuffer(2, config.rate, config.rate);
          for (let c = 0; c < 2; c++) for (let i = 0; i < config.rate; i++) buffer.getChannelData(c)[i] = .15 * Math.sin(2 * Math.PI * 173 * i / config.rate + c * .27) + .03 * Math.cos(2 * Math.PI * 2203 * i / config.rate);
          return buffer;
        };
        await engine.start({ sourceMode: 'sample', sample: { id: 'p2', path: 'generated-p2-source' } });
        for (const node of [engine.inputPreampNode, engine.filterbank.workletNode, engine.outputGuardNode, engine.outputProtectionNode]) {
          node.addEventListener('processorerror', () => { processorErrors++; });
          node.port.addEventListener('message', () => { messages++; }); node.port.start();
        }
        const analyser = engine.context.createAnalyser(); analyser.fftSize = 2048; engine.outputProtectionNode.connect(analyser);
        const samples = new Float32Array(2048); let raf;
        const read = () => { analyser.getFloatTimeDomainData(samples); reads++; for (const value of samples) { finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value)); } raf = requestAnimationFrame(read); };
        read();
        if (config.stage?.includes('->')) {
          await new Promise(resolve => setTimeout(resolve, 240)); engine.setInputPreampStage(config.stage.split('->')[1]);
          await new Promise(resolve => setTimeout(resolve, durationMs - 240));
        } else await new Promise(resolve => setTimeout(resolve, durationMs));
        rows.push({ rate: config.rate, actualRate: engine.context.sampleRate, stage: config.name + (config.stage?.includes('->') ? ':' + config.stage : ''), processorErrors, messages, reads, finite, peak });
        cancelAnimationFrame(raf); await engine.stop();
      }
    } finally { window.AudioContext = Context; HTMLMediaElement.prototype.play = play; }
    return rows;
  }, { cases, modulationCode: modulationOptions.toString(), durationMs });
  const completion = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); await completion;
  const nativeRender = summarizeNativeRender(live, events);
  const starts = events.filter(e => e.name === 'AudioDestination::StartWithWorkletTaskRunner').sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < nativeRender.length; i++) {
    const blocks = events.filter(e => e.name === 'RealtimeAudioDestinationHandler::Render' && e.ph === 'X' && e.args?.frames === 128
      && e.ts >= starts[i].ts && e.ts < (starts[i + 1]?.ts ?? Infinity)).sort((a, b) => a.ts - b.ts);
    const durations = blocks.filter(e => e.ts > blocks[0].ts + 250000).map(e => e.dur / 1000);
    nativeRender[i].meanMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  }
  return { baseline, base: BASE_REVISION, live, nativeRender, gcEvents: events.filter(event => /GC|Scavenge/.test(event.name)).length };
}
module.exports = { BASE_REVISION, source, installBaselineRoutes, processorBundle, harnessModule, loadHarnesses, featureCases, coreCases, measureNative };
