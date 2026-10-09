// Band boost/cut range currently selected in DEV / LAB and the effective display gains derived from it.
import { getEffectiveBandGains, state, hooks } from './app-context.js';
import { bandBoostSelect, bandCutSelect } from './dev-lab-controls.js';

const getBandBoostDb = () => Number(bandBoostSelect?.value ?? 12);
const getBandCutDb = () => Number(bandCutSelect?.value ?? 12);
// FILTERBANK editor visuals intentionally describe the manual FILTERBANK
// controls, not the final DSP basis selected by another powered module.
const getFilterbankDisplayBandGains = index => getEffectiveBandGains(state, index, {
  maxBandBoostDb: getBandBoostDb(),
  maxBandCutDb: getBandCutDb()
});
hooks.getFilterbankDisplayBandGains = getFilterbankDisplayBandGains;

export {
  getFilterbankDisplayBandGains, getBandBoostDb, getBandCutDb
};
