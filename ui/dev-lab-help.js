// DEV / LAB help tooltip.
import { DEV_LAB_HELP, DEV_LAB_GROUP_HELP, RESPONSE_DEV_LAB_HELP } from './dev-lab-help-texts.js';

const devLabTooltip = document.createElement('section');
devLabTooltip.className = 'dev-lab-tooltip';
devLabTooltip.id = 'dev-lab-tooltip';
devLabTooltip.setAttribute('role', 'dialog');
devLabTooltip.setAttribute('aria-label', 'DEV-LAB Hilfe');
devLabTooltip.hidden = true;
document.body.append(devLabTooltip);
let activeDevLabHelpButton = null;
const appendDevLabHelpText = (parent, text) => {
  if (!text) return;
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  parent.append(paragraph);
};
const renderDevLabHelp = (title, entries) => {
  devLabTooltip.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = title;
  devLabTooltip.append(heading);
  entries.forEach(help => {
    const section = document.createElement('section');
    section.className = 'dev-lab-help-entry';
    const entryHeading = document.createElement('h4');
    entryHeading.textContent = help.title;
    section.append(entryHeading);
    appendDevLabHelpText(section, help.what);
    appendDevLabHelpText(section, help.scope);
    if (help.values?.length) {
      const values = document.createElement('ul');
      help.values.forEach(([name, description]) => { const item = document.createElement('li'); const value = document.createElement('strong'); value.textContent = `${name} — `; item.append(value, description); values.append(item); });
      section.append(values);
    }
    appendDevLabHelpText(section, help.default);
    appendDevLabHelpText(section, help.note);
    devLabTooltip.append(section);
  });
};
const positionDevLabTooltip = () => {
  if (!activeDevLabHelpButton) return;
  const anchor = activeDevLabHelpButton.getBoundingClientRect();
  const width = Math.min(460, Math.max(280, window.innerWidth - 24));
  devLabTooltip.style.width = `${width}px`;
  devLabTooltip.style.maxHeight = `${Math.max(160, window.innerHeight - 24)}px`;
  const tooltipHeight = devLabTooltip.getBoundingClientRect().height;
  let left = anchor.right + 8;
  if (left + width > window.innerWidth - 12) left = anchor.left - width - 8;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  let top = anchor.top;
  if (top + tooltipHeight > window.innerHeight - 12) top = window.innerHeight - tooltipHeight - 12;
  top = Math.max(12, top);
  devLabTooltip.style.left = `${left}px`;
  devLabTooltip.style.top = `${top}px`;
};
const hideDevLabTooltip = () => {
  if (activeDevLabHelpButton) activeDevLabHelpButton.setAttribute('aria-expanded', 'false');
  activeDevLabHelpButton = null;
  devLabTooltip.hidden = true;
};
const showDevLabTooltip = button => {
  const key = button.dataset.devLabHelp;
  const entries = key === 'response' ? RESPONSE_DEV_LAB_HELP : (DEV_LAB_GROUP_HELP[key] || []).map(attribute => DEV_LAB_HELP[attribute]).filter(Boolean);
  if (!entries.length) return;
  activeDevLabHelpButton = button;
  renderDevLabHelp(key === 'response' ? 'FILTERBANK RESPONSE · DEV LAB' : button.closest('.dev-lab-group')?.querySelector('h2')?.textContent || 'DEV / LAB', entries);
  devLabTooltip.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  positionDevLabTooltip();
};
document.addEventListener('click', event => {
  const button = event.target.closest('.dev-lab-info-button');
  if (button) {
    if (button === activeDevLabHelpButton) hideDevLabTooltip();
    else { hideDevLabTooltip(); showDevLabTooltip(button); }
    return;
  }
  if (!devLabTooltip.hidden && !devLabTooltip.contains(event.target)) hideDevLabTooltip();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !devLabTooltip.hidden) hideDevLabTooltip(); });
window.addEventListener('resize', positionDevLabTooltip);
