// Gedeelde UI-hulpfuncties voor alle schermen.
import { store, todayISO, fullAddress, norm } from './store.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const dialog = $('#dialog');

// ---------- helpers ----------

export const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const eur = (n) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
export const ml = (n) => (n === null || n === undefined || n === '' ? '–' : `${Math.round(n).toLocaleString('nl-NL')} ml`);
export const fmtDate = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }) : '–');
export const klassBadge = (k) => (k ? `<span class="badge k-${norm(k)}">${h(k)}</span>` : '');
export const telHref = (t) => {
  let d = String(t || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return `tel:${d}`;
  if (d.startsWith('00')) return `tel:+${d.slice(2)}`;
  if (d.startsWith('31') || d.startsWith('32')) return `tel:+${d}`;
  if (d.startsWith('0')) return `tel:${d}`;
  return `tel:0${d}`; // Excel laat de voorloopnul weg (651359093 -> 0651359093)
};
export const navHref = (c) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress(c))}`;

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function weekStart(iso = todayISO()) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return todayISO(d);
}

export function nextWorkday() {
  const d = new Date();
  do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
  return todayISO(d);
}

export function klantOptions(selected) {
  return store.get().customers
    .slice()
    .sort((a, b) => a.naam.localeCompare(b.naam))
    .map((c) => `<option value="${h(c.nr)}" ${String(c.nr) === String(selected) ? 'selected' : ''}>${h(c.naam)} – ${h(c.plaats)}</option>`)
    .join('');
}

export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function openDialog(html, onSubmit) {
  dialog.innerHTML = `<form method="dialog" class="dlg">${html}</form>`;
  const form = $('form', dialog);
  form.addEventListener('submit', (e) => {
    const btn = e.submitter;
    if (btn?.value === 'cancel') return;
    e.preventDefault();
    // Eerst sluiten: onSubmit mag direct een volgende dialoog openen.
    const data = formData(form);
    dialog.close();
    onSubmit(data, btn?.value);
  });
  dialog.showModal();
  return form;
}

// Bevestiging in de app zelf (window.confirm werkt niet in Teams-tabs en ingesloten weergaven).
export function ask(message, okLabel = 'Doorgaan') {
  return new Promise((resolve) => {
    openDialog(`
      <p>${h(message)}</p>
      <div class="actions">
        <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
        <button value="ok" class="btn primary">${h(okLabel)}</button>
      </div>`, () => resolve(true));
    dialog.addEventListener('close', () => resolve(false), { once: true });
  });
}


// Schermen buiten app.js roepen render/sync aan via deze hooks (app.js vult ze in).
export const hooks = { render: () => {}, sync: () => {} };
