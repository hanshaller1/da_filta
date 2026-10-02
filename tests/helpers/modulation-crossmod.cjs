const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const BASE = '4f59aa9';
const cached = new Map();
function reference(file) {
  if (!cached.has(file)) cached.set(file, execFileSync('git', ['show', `${BASE}:${file}`], { cwd: ROOT, encoding: 'utf8' }));
  return cached.get(file);
}
async function installReference(page) {
  await page.context().route('**/tests/crossmod-reference/*', route => route.fulfill({ contentType: 'text/javascript',
    body: reference(new URL(route.request().url()).pathname.split('/').at(-1)) }));
}
function processorFactory(origin, baseline = false) {
  const body = baseline ? reference('filterbank-processor.js') : fs.readFileSync(path.join(ROOT, 'filterbank-processor.js'), 'utf8');
  const imports = body.match(/^import .*;$/gm).join('\n').replace(/from '\.\//g, `from '${origin}/${baseline ? 'tests/crossmod-reference/' : ''}`);
  return `${imports}
export function makeBank(sampleRate, processorOptions) {
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
  let Processor;
  const registerProcessor = (_name, Class) => { Processor = Class; };
  ${body.replace(/^import .*;\r?\n/gm, '')}
  return new Processor({ processorOptions });
}`;
}
function crossmodState(scenario, active = true) {
  const lfoSources = Array.from({ length: 4 }, (_, index) => ({ id: `lfo.${index + 1}`, enabled: index < 2,
    waveform: index === 0 ? 'sine' : 'triangle', rateHz: index === 0 ? .7 : 4, phaseOffsetDeg: 90,
    outputAmount: 50, assignments: index === 1 ? [{ id: 'audio.lfo', targetId: 'filterbank.band.4.gainDb', amount: 45 }] : [] }));
  const envelopeSources = Array.from({ length: 4 }, (_, index) => ({ id: `envelope.${index + 1}`, enabled: index < 2,
    detectorMode: 'peak', attack: 20, release: 100, sensitivity: 200, outputAmount: 50,
    assignments: index === 1 ? [{ id: 'audio.env', targetId: 'filterbank.band.6.gainDb', amount: 45 }] : [] }));
  const clockMod = { enabled: scenario.startsWith('clock'), waveform: 'sine', modulationGain: 100,
    sourceFrequencyHz: 3, internalBpm: 10000, assignments: [] };
  const [source, destination, parameter] = scenario.split(':');
  const targetId = `${destination}.${parameter}`;
  const meta = { id: 'meta', targetId, amount: 35, enabled: active };
  if (source === 'lfo') lfoSources[0].assignments.push(meta);
  if (source === 'env') envelopeSources[0].assignments.push(meta);
  if (source === 'clock') clockMod.assignments.push({ ...meta, sourceId: 'clockMod.1' });
  return { lfoModuleEnabled: true, envelopeModuleEnabled: true, lfoSources, envelopeSources, clockMod,
    clock: { source: 'internal', bpm: 120, running: true }, filterbankEnabled: true, dryWet: 70 };
}
function nativeState(meta = false) {
  const state = crossmodState('lfo:lfo.2:rate', false);
  for (let index = 0; index < 4; index++) Object.assign(state.lfoSources[index], { enabled: true,
    assignments: Array.from({ length: 3 }, (_, band) => ({ id: `audio.${index}.${band}`,
      targetId: `filterbank.band.${index + band}.gainDb`, amount: 10, channel: band === 2 ? 'spread' : 'both' })) });
  state.clockMod.enabled = true;
  delete state.clockMod.assignments; // Migrate the existing ten held routes in both versions.
  if (meta) {
    state.lfoSources[0].assignments.push({ id: 'rate', targetId: 'lfo.2.rate', amount: 20 },
      { id: 'attack', targetId: 'envelope.1.attack', amount: 20 },
      { id: 'release', targetId: 'envelope.1.release', amount: 20 });
    state.envelopeSources[0].assignments.push({ id: 'env.rate', targetId: 'lfo.3.rate', amount: 20 },
      { id: 'env.amount', targetId: 'lfo.4.amount', amount: 20, invert: true });
    state.lfoSources[1].assignments.push({ id: 'env.output', targetId: 'envelope.2.amount', amount: 20 });
  }
  return state;
}

async function measureNativeCrossmod(page) {
  const { summarizeNativeRender } = require('./measure-input-character-full-graph.cjs');
  // Worklet module fetches bypass Playwright routing in Chromium. Serve the
  // frozen production modules from the existing ignored artifact directory.
  const prefix = `/tests/artifacts/crossmod-reference-${BASE}`;
  const folder = path.join(ROOT, prefix.slice(1));
  fs.mkdirSync(folder, { recursive: true });
  const pending = ['filterbank-processor.js'], written = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (written.has(file)) continue;
    const body = reference(file); written.add(file);
    fs.writeFileSync(path.join(folder, file), body);
    for (const match of body.matchAll(/from '\.\/([^']+)'/g)) pending.push(match[1]);
  }
  await page.goto('/');
  const cases = [48000, 96000].flatMap(rate => ['before', 'ordinary', 'meta'].map(mode => ({
    rate, mode, stage: `${mode}@${rate}`, state: nativeState(mode === 'meta')
  })));
  const cdp = await page.context().newCDPSession(page), events = [];
  cdp.on('Tracing.dataCollected', event => events.push(...event.value));
  await cdp.send('Tracing.start', { categories: 'audio,webaudio,disabled-by-default-audio', transferMode: 'ReportEvents' });
  const live = await page.evaluate(async ({ cases, prefix }) => {
    const rows = [];
    for (const config of cases) {
      const context = new AudioContext({ sampleRate: config.rate, latencyHint: 'interactive' });
      await context.audioWorklet.addModule(config.mode === 'before' ? `${prefix}/filterbank-processor.js` : '/filterbank-processor.js');
      const bank = new AudioWorkletNode(context, 'da-filta-processor', { numberOfInputs: 1, numberOfOutputs: 2,
        outputChannelCount: [2, 1], processorOptions: { modulationState: config.state,
          bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
          bandGainLeft: Array(10).fill(20), bandGainRight: Array(10).fill(20), resonance: 0 } });
      const buffer = context.createBuffer(2, config.rate, config.rate);
      for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < config.rate; frame++) {
        buffer.getChannelData(channel)[frame] = .05 * Math.sin(frame / config.rate * Math.PI * 2 * 173 + channel * .2);
      }
      const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
      const analyser = context.createAnalyser(); analyser.fftSize = 2048;
      const mute = context.createGain(); mute.gain.value = 0;
      source.connect(bank); bank.connect(analyser, 0); analyser.connect(mute); mute.connect(context.destination);
      let processorErrors = 0, messages = 0, finite = true, peak = 0, reads = 0, raf;
      bank.onprocessorerror = () => processorErrors++;
      bank.port.onmessage = () => messages++;
      const samples = new Float32Array(2048);
      const read = () => { analyser.getFloatTimeDomainData(samples); reads++;
        for (const value of samples) { finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value)); }
        raf = requestAnimationFrame(read);
      };
      source.start(); await context.resume(); read();
      await new Promise(resolve => setTimeout(resolve, 1500));
      rows.push({ rate: config.rate, actualRate: context.sampleRate, stage: config.stage, processorErrors, messages, finite, peak, reads });
      cancelAnimationFrame(raf); source.stop(); bank.disconnect(); analyser.disconnect(); mute.disconnect(); await context.close();
    }
    return rows;
  }, { cases, prefix });
  const completion = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); await completion;
  const nativeRender = summarizeNativeRender(live, events);
  const starts = events.filter(event => event.name === 'AudioDestination::StartWithWorkletTaskRunner').sort((a, b) => a.ts - b.ts);
  for (let index = 0; index < nativeRender.length; index++) {
    const blocks = events.filter(event => event.name === 'RealtimeAudioDestinationHandler::Render' && event.ph === 'X' && event.args?.frames === 128
      && event.ts >= starts[index].ts && event.ts < (starts[index + 1]?.ts ?? Infinity)).sort((a, b) => a.ts - b.ts);
    const durations = blocks.filter(event => event.ts > blocks[0].ts + 250000).map(event => event.dur / 1000);
    nativeRender[index].meanMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  }
  await cdp.detach();
  return { live, nativeRender };
}
module.exports = { installReference, processorFactory, crossmodState, nativeState, measureNativeCrossmod, BASE };
