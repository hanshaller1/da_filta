const fs = require('node:fs');
const path = require('node:path');
const read = filename => fs.readFileSync(path.resolve(__dirname, '../..', filename), 'utf8');

function browserBundle(origin, worklet = false, { variant = 'p3b4', transformController } = {}) {
  const input = read('input-preamp-processor.js');
  const bank = read('filterbank-processor.js').replace(/^import .*;\r?\n/gm, '');
  const helper = read('tests/helpers/input-character-oversampling.cjs');
  const kernel = helper.slice(helper.indexOf('function bessel0'), helper.indexOf('const filterFFTs'));
  const streams = helper.slice(helper.indexOf('class Up2Stream'), helper.indexOf('class StreamingPrototype'));
  const architecture = read('tests/helpers/input-character-architecture.cjs');
  let controller = architecture.slice(architecture.indexOf('class CharacterArchitecture'), architecture.indexOf('module.exports'));
  if (transformController) controller = transformController(controller);
  if (variant !== 'p3b4') {
    const optimized = read(variant === 'shape' ? 'tests/helpers/input-character-architecture-shape.cjs' : 'tests/helpers/input-character-architecture-optimized.cjs');
    controller += optimized.slice(optimized.indexOf('class OptimizedCharacterArchitecture'), optimized.indexOf('module.exports'));
  }
  const rates = architecture.match(/const RATES = .*;/)[0];
  const prefix = `import { LinearTptSvf, OversampledPositiveTptResonator } from '${origin}/tpt-svf.js';
import { normalizeDynamicEq, targetGainDb, smoothGain, timeCoefficient } from '${origin}/dynamic-eq-core.mjs';
const deps = { LinearTptSvf, OversampledPositiveTptResonator, normalizeDynamicEq, targetGainDb, smoothGain, timeCoefficient };
function classesFor(rate) {
  const sampleRate = rate;
  class Stub { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
  const AudioWorkletProcessor = Stub;
  const registered = {};
  const registerProcessor = (name, Class) => { registered[name] = Class; };
  const { LinearTptSvf, OversampledPositiveTptResonator, normalizeDynamicEq, targetGainDb, smoothGain, timeCoefficient } = deps;
  ${bank}
  ${read('output-guard-processor.js')}
  ${read('output-protection-processor.js')}
  function makeInput(rate, stage) {
    const sampleRate = rate;
    let Class;
    const registerProcessor = (_, value) => { Class = value; };
    ${input}
    return new Class({ processorOptions: { stage, characterAmount: 1, inputGainDb: 0 } });
  }
  ${kernel}
  ${streams}
  const p = { processor: makeInput, Up2Stream, Down2Stream };
  ${rates}
  ${architecture.slice(architecture.indexOf('const ratesFor'), architecture.indexOf('class CharacterArchitecture'))}
  ${controller}
  return { CharacterArchitecture: ${variant === 'p3b4' ? 'CharacterArchitecture' : 'OptimizedCharacterArchitecture'}, registered, ratesFor };
}
const classCache = new Map();
export class Graph {
  constructor(rate, options, stage, adaptive = false) {
    if (!classCache.has(rate)) classCache.set(rate, classesFor(rate));
    const classes = classCache.get(rate);
    this.character = new classes.CharacterArchitecture(rate, stage, 'A', .5, classes.ratesFor(rate, adaptive), '${variant}');
    const registry = classes.registered;
    this.bank = new registry['da-filta-processor']({ processorOptions: options });
    this.guard = new registry['da-filta-output-guard']({ processorOptions: { enabled: true, threshold: .8, attackMs: 2, releaseMs: 250, telemetryEnabled: false } });
    this.safety = new registry['da-filta-output-protection']({ processorOptions: { enabled: true, threshold: .8, softness: 1, telemetryEnabled: false } });
    this.bankOut = [new Float32Array(128), new Float32Array(128)];
    this.mix = [new Float32Array(128), new Float32Array(128)];
    this.guardOut = [new Float32Array(128), new Float32Array(128)];
    this.final = [new Float32Array(128), new Float32Array(128)];
    this.bankInWrapper = [null]; this.bankOutWrapper = [this.bankOut];
    this.mixWrapper = [this.mix]; this.guardWrapper = [this.guardOut]; this.finalWrapper = [this.final];
    this.telemetry = 0;
    this.bank.port.postMessage = message => { this.telemetry++; if (this.onTelemetry) this.onTelemetry(message); };
  }
  process(input) {
    const character = this.character.process(input);
    this.bankInWrapper[0] = character;
    this.bank.process(this.bankInWrapper, this.bankOutWrapper);
    // Production's linear global dry/wet and master; both receive Character's common delay.
    for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) this.mix[c][i] = (.3 * character[c][i] + .7 * this.bankOut[c][i]) * 10 ** (-6 / 20);
    this.guard.process(this.mixWrapper, this.guardWrapper);
    this.safety.process(this.guardWrapper, this.finalWrapper);
    return this.final;
  }
}
`;
  if (!worklet) return prefix;
  return prefix + `
class FullGraphHarness extends globalThis.AudioWorkletProcessor {
  constructor(options) {
    super();
    this.graph = new Graph(sampleRate, options.processorOptions.bank, options.processorOptions.stage, options.processorOptions.adaptive);
    this.graph.onTelemetry = data => this.port.postMessage({ type: 'telemetry', data });
    this.blocks = 0; this.elapsed = 0; this.nonfinite = 0; this.peak = 0; this.gaps = 0;
    this.lastFrame = null; this.started = currentFrame; this.switchDone = false;
    this.switchTo = options.processorOptions.switchTo;
    this.port.onmessage = event => {
      if (event.data === 'snapshot') this.port.postMessage({ type: 'snapshot', blocks: this.blocks, quantizedComputeMs: this.elapsed, nonfinite: this.nonfinite, peak: this.peak, gaps: this.gaps, audioTime: currentTime, telemetry: this.graph.telemetry, tubePole: this.graph.character.tube.tubeDcPole });
    };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    if (input.length < 2) return true;
    if (this.switchTo && !this.switchDone && currentFrame - this.started > sampleRate * .5) { this.graph.character.request(this.switchTo); this.switchDone = true; }
    const before = Date.now();
    const final = this.graph.process(input);
    const elapsed = Date.now() - before;
    if (currentFrame - this.started > sampleRate * .25) { this.elapsed += elapsed; this.blocks++; }
    if (this.lastFrame !== null && currentFrame !== this.lastFrame + 128) this.gaps++;
    this.lastFrame = currentFrame;
    for (let c = 0; c < 2; c++) {
      outputs[0][c].set(final[c]); outputs[1][c].set(this.graph.character.output[c]); outputs[2][c].set(this.graph.bankOut[c]);
      for (let i = 0; i < 128; i++) { this.nonfinite += Number.isFinite(final[c][i]) ? 0 : 1; this.peak = Math.max(this.peak, Math.abs(final[c][i])); }
    }
    return true;
  }
}
globalThis.registerProcessor('p3b3-full-graph', FullGraphHarness);
`;
}
module.exports = { browserBundle };
