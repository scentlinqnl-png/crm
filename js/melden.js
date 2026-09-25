// Publieke meldpagina (via QR-sticker). Werkt zonder account of server: alle gegevens staan in de link,
// de melding gaat via WhatsApp of e-mail naar de helpdesk en de app zet hem om in een ticket.
import { buildMessage } from './intake.js';

const p = new URLSearchParams(location.search);
const info = {
  sn: p.get('sn') || '', sys: p.get('sys') || '', loc: p.get('loc') || '',
  k: p.get('k') || '', kn: p.get('kn') || '', b: p.get('b') || '',
  wa: (p.get('wa') || '').replace(/[^\d]/g, ''), m: p.get('m') || '',
};

if (info.b) { document.getElementById('bedrijf').textContent = info.b; document.title = `Melding ${info.b}`; }
const machine = document.getElementById('machine');
if (info.sn || info.sys || info.kn) {
  machine.hidden = false;
  machine.innerHTML = '';
  const add = (label, val) => { if (!val) return; const d = document.createElement('div'); d.className = 'meld-row'; d.innerHTML = `<span class="muted small">${label}</span>`; const b = document.createElement('b'); b.textContent = val; d.append(b); machine.append(d); };
  add('Locatie', [info.kn, info.loc].filter(Boolean).join(' · '));
  add('Systeem', info.sys);
  add('Serienummer', info.sn);
}

const form = document.getElementById('meldForm');
const btns = document.getElementById('sendBtns');
const hint = document.getElementById('hint');
const mk = (label, cls, onClick) => { const b = document.createElement('button'); b.type = 'button'; b.className = `btn ${cls}`; b.textContent = label; b.addEventListener('click', onClick); btns.append(b); };

function message() {
  if (!form.reportValidity()) return null;
  const d = Object.fromEntries(new FormData(form));
  return buildMessage({ ...info, type: d.t, omschrijving: d.o, naam: d.naam, telefoon: d.tel });
}

if (info.wa) mk('Versturen via WhatsApp', 'primary', () => { const t = message(); if (t) location.href = `https://wa.me/${info.wa}?text=${encodeURIComponent(t)}`; });
if (info.m) mk('Versturen via e-mail', info.wa ? '' : 'primary', () => { const t = message(); if (t) location.href = `mailto:${info.m}?subject=${encodeURIComponent(`Melding ${info.sn || info.kn || ''}`.trim())}&body=${encodeURIComponent(t)}`; });
mk('Tekst kopiëren', 'ghost', async () => {
  const t = message();
  if (!t) return;
  try { await navigator.clipboard.writeText(t); hint.textContent = 'Gekopieerd. Plak de tekst in een bericht aan de helpdesk.'; } catch { hint.textContent = t; }
});
if (!info.wa && !info.m) hint.textContent = 'Er is geen helpdesknummer of e-mailadres in deze code opgenomen. Kopieer de tekst en stuur hem naar uw contactpersoon.';
