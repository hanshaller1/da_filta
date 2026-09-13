const BAND_FREQUENCIES = ['29 Hz','61 Hz','115 Hz','218 Hz','411 Hz','777 Hz','1.5 kHz','2.8 kHz','5.2 kHz','11 kHz'];
const state = {
  activeMode:'FB', spreadMode:'CLASSIC', channelSelection:'LR',
  inputGain:0, resonance:0, dryWet:50, spread:0, volume:-6,
  bandGainLeft:Array(10).fill(0), bandGainRight:Array(10).fill(0),
  feedbackBandLeft:Array(10).fill(false), feedbackBandRight:Array(10).fill(false),
  feedbackAllLeft:false, feedbackAllRight:false, modulated:Array(10).fill(false)
};
const bands = document.querySelector('.bands');
bands.innerHTML = BAND_FREQUENCIES.map((frequency,index) => `<article class="band-card"><div class="band-title">BAND ${index+1}</div><div class="band-actions"><button class="band-action" type="button" data-feedback-band="${index}">FB</button><button class="band-action" type="button" data-mod-band="${index}">MOD</button></div><div class="fader-wrap"><span class="fader-label positive">+</span><div class="fader-track"><input class="band-fader" type="range" min="-100" max="100" value="0" data-band="${index}" aria-label="${frequency} Fader"></div><span class="fader-label negative">−</span></div><div class="band-value">${frequency}</div></article>`).join('');
const formatValue = (name,value) => { if(name==='dryWet') return `${Math.round(value)} %`; if(name==='inputGain'||name==='volume') return `${Number(value).toFixed(1)} dB`; return Number(value).toFixed(2).replace(/\.00$/,'0'); };

const bars = document.querySelector('.bars');
bars.innerHTML = Array.from({length:10},(_,i)=>`<div class="bar-pair" data-analyzer-band="${i}"><i></i><i></i></div>`).join('');
const faders = [...document.querySelectorAll('.band-fader')];
const updateAnalyzerBand = index => {
  const slider = faders[index];
  const min = Number(slider.min);
  const max = Number(slider.max);
  const visibleValue = (state.bandGainLeft[index] + state.bandGainRight[index]) / 2;
  const normalized = (visibleValue - min) / (max - min);
  const height = 20 + normalized * 60;
  document.querySelectorAll(`[data-analyzer-band="${index}"] i`).forEach(bar => { bar.style.height = `${height}%`; });
};
const setBandGain = (index, value) => {
  const slider = faders[index];
  const min = Number(slider.min);
  const max = Number(slider.max);
  const nextValue = Math.min(max, Math.max(min, Number(value)));
  state.bandGainLeft[index] = nextValue;
  state.bandGainRight[index] = nextValue;
  slider.value = String(nextValue);
  updateAnalyzerBand(index);
};
faders.forEach((slider,index) => { slider.addEventListener('input', () => setBandGain(index, slider.value)); setBandGain(index, 0); });

document.querySelectorAll('[data-control]').forEach(slider => { const name=slider.dataset.control; const output=document.querySelector(`[data-output="${name}"]`); const update=()=>{ state[name]=Number(slider.value); output.textContent=formatValue(name,slider.value); }; slider.addEventListener('input',update); update(); });
document.querySelectorAll('[data-feedback-band]').forEach(button => button.addEventListener('click', () => { const index=Number(button.dataset.feedbackBand); const nextValue=!state.feedbackBandLeft[index]; state.feedbackBandLeft[index]=nextValue; state.feedbackBandRight[index]=nextValue; button.classList.toggle('active',nextValue); button.setAttribute('aria-pressed',String(nextValue)); }));
document.querySelectorAll('[data-mod-band]').forEach(button => button.addEventListener('click', () => { const index=Number(button.dataset.modBand); state.modulated[index]=!state.modulated[index]; button.classList.toggle('active',state.modulated[index]); button.setAttribute('aria-pressed',String(state.modulated[index])); }));
const fbAllButton = document.querySelector('.fb-all-toggle');
fbAllButton.addEventListener('click', () => { const nextValue=!state.feedbackAllLeft; state.feedbackAllLeft=nextValue; state.feedbackAllRight=nextValue; fbAllButton.classList.toggle('active',nextValue); fbAllButton.textContent=nextValue?'ON':'OFF'; fbAllButton.setAttribute('aria-pressed',String(nextValue)); });

const FB_CODES = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'];
const FADER_UP_CODES = ['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP'];
const FADER_DOWN_CODES = ['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon'];
const FADER_NEUTRAL_CODES = ['KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash'];
const isEditableTarget = target => target instanceof HTMLElement && ((target.matches('input, textarea, select') && !target.matches('input[type="range"]')) || target.isContentEditable);
document.addEventListener('keydown', event => {
  if (isEditableTarget(event.target)) return;
  const bandIndex = FB_CODES.indexOf(event.code);
  if (bandIndex !== -1) { if(event.shiftKey) document.querySelector(`[data-mod-band="${bandIndex}"]`).click(); else document.querySelector(`[data-feedback-band="${bandIndex}"]`).click(); event.preventDefault(); return; }
  const upIndex = FADER_UP_CODES.indexOf(event.code);
  if (upIndex !== -1) { const slider=faders[upIndex]; setBandGain(upIndex,Number(slider.value)+(Number(slider.max)-Number(slider.min))*0.05); event.preventDefault(); return; }
  const downIndex = FADER_DOWN_CODES.indexOf(event.code);
  if (downIndex !== -1) { const slider=faders[downIndex]; setBandGain(downIndex,Number(slider.value)-(Number(slider.max)-Number(slider.min))*0.05); event.preventDefault(); return; }
  const neutralIndex = FADER_NEUTRAL_CODES.indexOf(event.code);
  if (neutralIndex !== -1) { setBandGain(neutralIndex,0); event.preventDefault(); }
});
