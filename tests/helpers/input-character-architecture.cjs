// Architecture proof only: never loaded by the app or its normal Worklet.
const p = require('./input-character-oversampling.cjs');
const RATES = { linear: 1, silk: 2, tape: 2, tube: 2, console: 2, crunch: 2, destroy: 4 };
const ratesFor = (rate, adaptive = false) => adaptive && rate === 96000
  ? { linear: 1, silk: 1, tape: 1, tube: 1, console: 1, crunch: 1, destroy: 2 } : RATES;

class CharacterArchitecture {
  constructor(rate, stage = 'linear', model = 'A', amount = 1, rates = RATES) {
    this.rates = rates;
    this.rate = rate; this.model = model; this.active = stage; this.target = null;
    this.amount = amount; this.targetAmount = amount; this.weight = 1; this.warmFrames = 0;
    this.smoothing = Math.exp(-1 / (rate * .015));
    this.up2 = [new p.Up2Stream(), new p.Up2Stream()];
    this.high2 = [new Float32Array(256), new Float32Array(256)];
    this.tube = p.processor(rate * rates.tube, 'tube');
    this.tubeSamples = [new Float32Array(128 * rates.tube), new Float32Array(128 * rates.tube)];
    this.tubeInput = [this.high2]; this.tubeOutput = [this.tubeSamples];
    this.dry = [new Float32Array(192), new Float32Array(192)]; this.dryPosition = 0;
    this.output = [new Float32Array(128), new Float32Array(128)];
    this.branches = {};
    for (const name of Object.keys(rates)) if (name !== 'linear') this.branches[name] = this.createBranch(name);
  }
  createBranch(stage) {
    const factor = this.rates[stage], four = factor === 4;
    const padLength = this.model === 'C' ? 0 : 192 - (factor === 4 ? 192 : factor === 2 ? 128 : 0);
    const high = [new Float32Array(128 * factor), new Float32Array(128 * factor)];
    const shaped = [new Float32Array(128 * factor), new Float32Array(128 * factor)];
    return { stage, factor, node: stage === 'tube' ? null : p.processor(this.rate * factor, stage),
      up4: four ? [new p.Up2Stream(), new p.Up2Stream()] : null,
      high, shaped, inputs: [high], outputs: [shaped],
      down4: four ? [new p.Down2Stream(), new p.Down2Stream()] : null,
      down2: factor >= 2 ? [new p.Down2Stream(), new p.Down2Stream()] : null,
      mid: [new Float32Array(256), new Float32Array(256)],
      correction: [new Float32Array(128), new Float32Array(128)],
      padding: [new Float32Array(padLength), new Float32Array(padLength)], padPosition: 0 };
  }
  resetBranch(stage) {
    const branch = this.branches[stage];
    if (!branch) return;
    for (const filters of [branch.up4, branch.down4, branch.down2]) if (filters) for (const filter of filters) { filter.ring.fill(0); filter.position = 0; }
    for (const array of [...branch.padding, ...branch.mid, ...branch.correction, ...branch.high, ...branch.shaped]) array.fill(0);
    branch.padPosition = 0;
    // All branch curves are stateless. TUBE's persistent state is shared above.
  }
  request(stage) {
    if (!Object.hasOwn(this.rates, stage)) throw new Error('Unknown stage');
    // Production contract: UI requests are coalesced until a current fade finishes.
    if (this.target) { this.queued = stage; return; }
    if (stage === this.active) return;
    this.resetBranch(stage); this.target = stage; this.weight = 0; this.warmFrames = 384;
  }
  panic() {
    // Matches the existing engine: input gain is ramped externally; no Character reset.
    return this.active;
  }
  runBranch(stage) {
    if (stage === 'linear') return null;
    const b = this.branches[stage];
    if (b.factor === 4) for (let c = 0; c < 2; c++) b.up4[c].process(this.high2[c], b.high[c]);
    else for (let c = 0; c < 2; c++) b.high[c].set(b.factor === 1 ? this.hostInput[c] : this.high2[c]);
    if (stage === 'tube') for (let c = 0; c < 2; c++) b.shaped[c].set(this.tubeSamples[c]);
    else b.node.process(b.inputs, b.outputs);
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < b.shaped[c].length; i++) b.shaped[c][i] -= b.high[c][i];
      if (b.factor === 4) { b.down4[c].process(b.shaped[c], b.mid[c]); b.down2[c].process(b.mid[c], b.correction[c]); }
      else if (b.factor === 2) b.down2[c].process(b.shaped[c], b.correction[c]);
      else b.correction[c].set(b.shaped[c]);
    }
    if (b.padding[0].length) {
      for (let i = 0; i < 128; i++) {
        for (let c = 0; c < 2; c++) {
          const old = b.padding[c][b.padPosition]; b.padding[c][b.padPosition] = b.correction[c][i]; b.correction[c][i] = old;
        }
        b.padPosition = (b.padPosition + 1) % b.padding[0].length;
      }
    }
    return b.correction;
  }
  latency(stage) { return this.model === 'A' ? 192 : stage === 'linear' ? 0 : this.model === 'B' ? 192 : this.rates[stage] === 4 ? 192 : this.rates[stage] === 2 ? 128 : 0; }
  process(inputs) {
    this.hostInput = inputs;
    for (let c = 0; c < 2; c++) this.up2[c].process(inputs[c], this.high2[c]);
    // Continuously fed DC state; leaving/entering TUBE never freezes or resets it.
    this.tubeInput[0] = this.rates.tube === 1 ? inputs : this.high2;
    this.tube.process(this.tubeInput, this.tubeOutput);
    const old = this.runBranch(this.active), next = this.target ? this.runBranch(this.target) : null;
    const warming = this.warmFrames > 0;
    const oldDelay = this.latency(this.active), newDelay = this.target ? this.latency(this.target) : oldDelay;
    for (let i = 0; i < 128; i++) {
      this.amount = this.targetAmount + this.smoothing * (this.amount - this.targetAmount);
      if (this.target && !warming) this.weight = 1 + this.smoothing * (this.weight - 1);
      for (let c = 0; c < 2; c++) {
        const dryOld = oldDelay === 0 ? inputs[c][i] : this.dry[c][(this.dryPosition + 192 - oldDelay) % 192];
        const dryNew = newDelay === 0 ? inputs[c][i] : this.dry[c][(this.dryPosition + 192 - newDelay) % 192];
        const first = dryOld + this.amount * (old ? old[c][i] : 0);
        const second = this.target ? dryNew + this.amount * (next ? next[c][i] : 0) : first;
        this.output[c][i] = warming ? first : first + this.weight * (second - first);
        this.dry[c][this.dryPosition] = inputs[c][i];
      }
      this.dryPosition = (this.dryPosition + 1) % 192;
    }
    if (warming) this.warmFrames -= 128;
    if (this.target && !warming && this.weight > .9999) {
      this.active = this.target; this.target = null; this.weight = 1;
      if (this.queued) { const queued = this.queued; this.queued = null; this.request(queued); }
    }
    return this.output;
  }
}
module.exports = { CharacterArchitecture, RATES, ratesFor };
