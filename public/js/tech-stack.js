import { escapeHTML as e, icon } from './ui.js';

export function parseTechStack(value = '') {
  return String(value).split(/[,\r\n]+/).map(item => item.trim()).filter(Boolean);
}

export function serializeTechStack(values) {
  const technologies = values.map(value => String(value).trim()).filter(Boolean);
  if (!technologies.length) throw new Error('Add at least one technology.');
  if (technologies.some(value => /[,\r\n]/.test(value))) throw new Error('Use a separate field for each technology.');
  const stack = technologies.join(', ');
  if (stack.length > 1000) throw new Error('The combined tech stack must not exceed 1,000 characters.');
  return stack;
}

export function technologyField(value = '', index = 1) {
  return `<div class="technology-row" data-technology-row><label class="field"><span>Technology ${index}</span><input type="text" name="technology" value="${e(value)}" maxlength="1000" placeholder="For example, Spring Boot" aria-describedby="tech-stack-help"></label><button type="button" class="icon-btn" data-remove-technology aria-label="Remove technology ${index}">${icon('close', 16)}</button></div>`;
}

export function technologyEditor(stack) {
  const technologies = parseTechStack(stack);
  return `<fieldset class="technology-editor"><legend>Tech stack <span aria-hidden="true">*</span></legend><p id="tech-stack-help" class="fine-print">One technology per field. Add at least one; up to 1,000 characters combined.</p><div data-technology-fields>${(technologies.length ? technologies : ['']).map((value, index) => technologyField(value, index + 1)).join('')}</div><button type="button" class="btn" data-add-technology>Add technology ${icon('plus', 16)}</button></fieldset>`;
}

export function technologyTags(stack, limit = Infinity) {
  const technologies = parseTechStack(stack);
  if (!technologies.length) return '';
  return `<ul class="tech-tags" aria-label="Technologies">${technologies.slice(0, limit).map(value => `<li class="tech-tag" title="${e(value)}">${e(value)}</li>`).join('')}${technologies.length > limit ? `<li class="tech-tag tech-tag-more">+${technologies.length - limit} more</li>` : ''}</ul>`;
}
