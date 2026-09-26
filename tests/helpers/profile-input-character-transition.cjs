// Instrumentation/probes only. No optimized controller is used in this profile.
const fs = require('node:fs');
const path = require('node:path');
const { browserBundle } = require('./input-character-full-graph.cjs');
function instrument(source) {
  const replace = (old, next) => { if (!source.includes(old)) throw new Error(`Missing profile anchor: ${old.slice(0, 60)}`); source = source.replace(old, next); };
  const time = (body, name) => `{ const _start = performance.now(); ${body} this.record(${name}, performance.now() - _start); }`;
  replace('this.rates = rates;', `this.profile = { phase: 'before', sums: {}, counts: {} }; this.initialStage = stage;
    this.record = (name, elapsed) => { const key = this.profile.phase + '/' + name; this.profile.sums[key] = (this.profile.sums[key] || 0) + elapsed; this.profile.counts[key] = (this.profile.counts[key] || 0) + 1; };
    this.rates = rates;`);
  replace('this.resetBranch(stage);', time('this.resetBranch(stage);', "'reset'"));
  replace('const b = this.branches[stage];', `const b = this.branches[stage]; const role = stage === this.active ? 'old/' : 'new/';`);
  const inputCopy = `if (b.factor === 4) for (let c = 0; c < 2; c++) b.up4[c].process(this.high2[c], b.high[c]);
    else for (let c = 0; c < 2; c++) b.high[c].set(b.factor === 1 ? this.hostInput[c] : this.high2[c]);`;
  replace(inputCopy, time(inputCopy, "role + (b.factor === 4 ? 'branch-upsample' : 'input-copy')"));
  const shape = `if (stage === 'tube') for (let c = 0; c < 2; c++) b.shaped[c].set(this.tubeSamples[c]);
    else b.node.process(b.inputs, b.outputs);`;
  replace(shape, time(shape, "role + (stage === 'tube' ? 'tube-cache-copy' : 'shape-with-metadata')"));
  const correction = 'for (let i = 0; i < b.shaped[c].length; i++) b.shaped[c][i] -= b.high[c][i];';
  replace(correction, time(correction, "role + 'correction'"));
  const down = `if (b.factor === 4) { b.down4[c].process(b.shaped[c], b.mid[c]); b.down2[c].process(b.mid[c], b.correction[c]); }
      else if (b.factor === 2) b.down2[c].process(b.shaped[c], b.correction[c]);
      else b.correction[c].set(b.shaped[c]);`;
  replace(down, time(down, "role + (b.factor === 1 ? 'correction-copy' : 'downsample')"));
  const padStart = source.indexOf('    if (b.padding[0].length)');
  const padEnd = source.indexOf('    return b.correction;', padStart);
  const padding = source.slice(padStart, padEnd);
  replace(padding, time(padding, "role + 'padding'"));
  replace('this.hostInput = inputs;', `this.profile.phase = this.target ? (this.warmFrames > 0 ? 'warm' : 'fade') : this.active === this.initialStage ? 'before' : 'after'; this.hostInput = inputs;`);
  const up = 'for (let c = 0; c < 2; c++) this.up2[c].process(inputs[c], this.high2[c]);';
  replace(up, time(up, "'shared-upsample'"));
  replace('this.tube.process(this.tubeInput, this.tubeOutput);', time('this.tube.process(this.tubeInput, this.tubeOutput);', "'persistent-tube-with-metadata'"));
  const hostStart = source.indexOf('    const warming = this.warmFrames > 0;');
  const hostEnd = source.indexOf('    if (warming) this.warmFrames', hostStart);
  const host = source.slice(hostStart, hostEnd);
  // 'warming' is also needed in bookkeeping after the measured host section.
  replace(host, `const _hostStart = performance.now(); ${host} this.record('host-dry-amount-fade', performance.now() - _hostStart);`);
  return source;
}
function profileBundle(origin) { return browserBundle(origin, false, { transformController: instrument }); }

async function microProfile(page) {
  await page.route('**/*', async route => { const response = await route.fetch(); await route.fulfill({ response, headers: { ...response.headers(), 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } }); });
  await page.goto('/', { waitUntil: 'networkidle' });
  const options = JSON.parse(fs.readFileSync(path.join(__dirname, '../measurements/input-character-adaptive-oversampling.json'), 'utf8')).options;
  return page.evaluate(async ({ code, options }) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); const { Graph } = await import(url); URL.revokeObjectURL(url);
    const input = [new Float32Array(128), new Float32Array(128)];
    for (let i = 0; i < 128; i++) { input[0][i] = .31 * Math.sin(i * .137) + .04; input[1][i] = .29 * Math.sin(i * .173) - .02; }
    const rows = [], metadata = [], host = [], warmHistory = [];
    const cases = ['tube->destroy', 'tape->destroy', 'destroy->tape', 'destroy->tube'];
    for (const transition of cases) for (let trial = 0; trial < 5; trial++) {
      const [from, to] = transition.split('->'), graph = new Graph(96000, options, from, true), char = graph.character;
      for (let i = 0; i < 512; i++) graph.process(input);
      char.profile.sums = {}; char.profile.counts = {};
      const phase = { before: { total: 0, blocks: 0 }, warm: { total: 0, blocks: 0 }, fade: { total: 0, blocks: 0 }, after: { total: 0, blocks: 0 } };
      for (let i = 0; i < 192; i++) {
        if (i === 32) { char.profile.phase = 'reset'; char.request(to); }
        const key = char.target ? char.warmFrames > 0 ? 'warm' : 'fade' : char.active === from ? 'before' : 'after';
        const begin = performance.now(); graph.process(input); phase[key].total += performance.now() - begin; phase[key].blocks++;
      }
      rows.push({ transition, trial, phase, sums: char.profile.sums, counts: char.profile.counts });
    }
    // Exact constant-stage production process vs its unchanged shape() calls.
    // Diagnostic comparison only; no resident prototype is changed here.
    for (const stage of ['tube', 'tape', 'destroy']) for (let trial = 0; trial < 7; trial++) {
      const graph = new Graph(96000, options, stage, true), node = stage === 'tube' ? graph.character.tube : graph.character.branches[stage].node;
      const frames = stage === 'destroy' ? 256 : 128, data = [new Float32Array(frames), new Float32Array(frames)], output = [new Float32Array(frames), new Float32Array(frames)];
      for (let c = 0; c < 2; c++) for (let i = 0; i < frames; i++) data[c][i] = .4 * Math.sin(i * (.15 + c * .01));
      const inputs = [data], outputs = [output];
      const direct = () => { for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) { const sample = data[c][i]; const shaped = node.shape(stage, sample, c); output[c][i] = sample + (shaped - sample); } };
      for (let i = 0; i < 256; i++) { node.process(inputs, outputs); direct(); }
      const methods = trial & 1 ? ['direct', 'process'] : ['process', 'direct'], timings = {};
      for (const method of methods) { const begin = performance.now(); for (let i = 0; i < 2048; i++) { if (method === 'process') node.process(inputs, outputs); else direct(); } timings[method] = (performance.now() - begin) / 2048; }
      metadata.push({ stage, frames, trial, processMs: timings.process, directMs: timings.direct, removableMs: timings.process - timings.direct });
    }
    // Isolated host-loop constituents, batched for timer resolution.
    for (const stage of ['tape', 'destroy']) {
      const char = new Graph(96000, options, stage, true).character, b = char.branches[stage];
      const operations = {
        amount: () => { for (let i = 0; i < 128; i++) char.amount = char.targetAmount + char.smoothing * (char.amount - char.targetAmount); },
        weight: () => { for (let i = 0; i < 128; i++) char.weight = 1 + char.smoothing * (char.weight - 1); },
        dry: () => { for (let i = 0; i < 128; i++) { for (let c = 0; c < 2; c++) { char.output[c][i] = char.dry[c][char.dryPosition]; char.dry[c][char.dryPosition] = input[c][i]; } char.dryPosition = (char.dryPosition + 1) % 192; } },
        pad: () => { for (let i = 0; i < 128; i++) { for (let c = 0; c < 2; c++) { const old = b.padding[c][b.padPosition]; b.padding[c][b.padPosition] = b.correction[c][i]; b.correction[c][i] = old; } b.padPosition = (b.padPosition + 1) % b.padding[0].length; } },
        mix: () => { for (let i = 0; i < 128; i++) for (let c = 0; c < 2; c++) { const first = input[c][i] + char.amount * b.correction[c][i], second = input[c][i] + char.amount * char.output[c][i]; char.output[c][i] = first + .5 * (second - first); } }
      };
      for (const [name, operation] of Object.entries(operations)) for (let trial = 0; trial < 5; trial++) { for (let i = 0; i < 512; i++) operation(); const begin = performance.now(); for (let i = 0; i < 4096; i++) operation(); host.push({ stage, name, trial, msPerBlock: (performance.now() - begin) / 4096 }); }
    }
    for (const rate of [48000, 96000]) for (const target of ['tape', 'tube', 'destroy']) {
      const cold = new Graph(rate, options, 'linear', true).character, hot = new Graph(rate, options, target, true).character;
      for (let i = 0; i < 32; i++) { cold.process(input); hot.process(input); }
      cold.request(target);
      for (let block = 0; block < 4; block++) { cold.process(input); hot.process(input); let max = 0; for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) max = Math.max(max, Math.abs(cold.branches[target].correction[c][i] - hot.branches[target].correction[c][i])); warmHistory.push({ rate, target, framesFed: (block + 1) * 128, maximum: max }); }
    }
    return { rows, metadata, host, warmHistory, note: 'Main-thread isolated diagnostic with timer/record instrumentation. Category sums are inclusive of measurement overhead and do not allocate native Render tails to JS functions. Production node process vs direct shape preserves its numeric sample+(shaped-sample) expression.' };
  }, { code: profileBundle('http://localhost:3000'), options });
}
module.exports = { microProfile };
