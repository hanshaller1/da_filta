import fs from 'node:fs';
import vm from 'node:vm';
import { FilterShape } from '../../filter-shape-core.mjs';
import { normalizeModulationState } from '../../lfo-core.mjs';
import { normalizeEnvelopeState } from '../../envelope-core.mjs';
import { normalizeClockModState } from '../../clock-mod-core.mjs';
import { normalizeClockState } from '../../clock-core.mjs';
import { normalizeMacroState } from '../../modulation-core.mjs';
import { createPresetContract } from '../../presets-core.mjs';

// Real application defaults/normalizers, without loading DOM or AudioWorklets.
export function presetFixture() {
  const window = { FilterShape };
  vm.runInNewContext(fs.readFileSync(new URL('../../state.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, ''),
    { window, normalizeModulationState, normalizeEnvelopeState, normalizeClockModState, normalizeClockState, normalizeMacroState });
  const helpers = window.ResonantState;
  vm.runInNewContext(fs.readFileSync(new URL('../../audio-engine.js', import.meta.url), 'utf8'), { window, navigator: {} });
  const defaults = { ...helpers.createInitialState(), ...new window.AudioEngine({}).getState() };
  const contract = createPresetContract(helpers, defaults);
  return { helpers, defaults, contract };
}
