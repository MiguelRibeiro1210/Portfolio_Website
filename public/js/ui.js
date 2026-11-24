export const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (name, size = 20) => {
  const paths = { heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>', comment: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>', search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', external: '<path d="M7 17 17 7M7 7h10v10"/>', back: '<path d="M19 12H5m6-6-6 6 6 6"/>', plus: '<path d="M12 5v14M5 12h14"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>', upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>', grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>', lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 5 9 8 9-8"/>', code: '<path d="m8 5-7 7 7 7m8-14 7 7-7 7m-3-16-2 18"/>', file: '<path d="M14 2H5v20h14V7zm0 0v6h5M8 13h8m-8 4h6"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>', github: '<path d="M9 19c-4 1-4-2-6-2m12 5v-4a4 4 0 0 0-1-3c4 0 7-2 7-6a5 5 0 0 0-1-3 5 5 0 0 0 0-4s-2-1-5 2a16 16 0 0 0-6 0C6 1 4 2 4 2a5 5 0 0 0 0 4 5 5 0 0 0-1 3c0 4 3 6 7 6a4 4 0 0 0-1 3v4"/>' };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
};
export const button = (label, action, style = '', symbol = '') => `<button type="button" class="btn ${style}" data-action="${action}">${label}${symbol ? icon(symbol) : ''}</button>`;
export const link = (label, href, style = '', symbol = '') => `<a class="btn ${style}" href="${href}">${label}${symbol ? icon(symbol) : ''}</a>`;
export const placeholder = (text, extra = '') => `<span class="placeholder ${extra}">${escapeHTML(text)}</span>`;
export const field = (label, name, value = '', hint = '', type = 'text', required = false) => `<label class="field"><span>${label}${required ? ' <span aria-hidden="true">*</span>' : ''}</span><input name="${name}" type="${type}" value="${escapeHTML(value)}" placeholder="${hint}" ${required ? 'required' : ''} ${type === 'url' ? 'inputmode="url"' : ''}></label>`;
export const textarea = (label, name, value = '', hint = '', rows = 3) => `<label class="field"><span>${label}</span><textarea name="${name}" rows="${rows}" placeholder="${hint}">${escapeHTML(value)}</textarea></label>`;
export function notify(message) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = message;
  document.querySelector('#notifications').append(el); setTimeout(() => el.remove(), 5000);
}
export function modal(title, content, onSubmit) {
  const el = document.querySelector('#modal');
  el.innerHTML = `<div class="dialog-top"><h2 id="modal-title">${title}</h2><button type="button" class="icon-btn" aria-label="Close dialog" data-close>${icon('close')}</button></div>${content}`;
  el.querySelector('[data-close]').onclick = () => el.close();
  el.onclick = event => { if (event.target === el) { const rect = el.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) el.close(); } };
  if (onSubmit) el.querySelector('form').onsubmit = async event => { event.preventDefault(); const submit = event.submitter; if (submit) submit.disabled = true; try { await onSubmit(new FormData(event.target)); } catch (error) { notify(error.message); } finally { if (submit) submit.disabled = false; } };
  el.showModal();
}
export function confirmAction(title, message, confirmLabel, action) {
  modal(title, `<p>${message}</p><form><div class="dialog-actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn danger" type="submit">${confirmLabel}</button></div></form>`, async () => { await action(); document.querySelector('#modal').close(); });
  document.querySelector('[data-cancel]').onclick = () => document.querySelector('#modal').close();
}
