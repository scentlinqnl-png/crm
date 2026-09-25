// Import uit CSV of Excel: klanten, contactpersonen, contracten en systemen, met kolomkoppeling en voorbeeld.
/* global XLSX */
import { store, uid, now, norm, nextKlantnr, kmFor, minFor, serialToISO } from './store.js';
import { $, $$, h, toast, hooks } from './ui.js';
import { download } from './excel.js';
import { distanceFromStart } from './geo.js';

const TYPES = {
  klanten: {
    label: 'Klanten',
    fields: [
      ['nr', 'Klantnr.', ['klantnr', 'klantnummer', 'nr', 'nummer', 'debiteurnummer', 'relatienummer', 'id']],
      ['naam', 'Naam *', ['naam', 'klantnaam', 'bedrijf', 'bedrijfsnaam', 'organisatie', 'company', 'name', 'relatie']],
      ['adres', 'Adres', ['adres', 'straat', 'address', 'straat en huisnummer', 'bezoekadres']],
      ['postcode', 'Postcode', ['postcode', 'zip', 'postal code']],
      ['plaats', 'Plaats', ['plaats', 'woonplaats', 'stad', 'city', 'vestigingsplaats']],
      ['telefoon', 'Telefoon', ['telefoon', 'tel', 'telefoonnummer', 'phone', 'mobiel']],
      ['sector', 'Sector', ['sector', 'branche', 'industrie']],
      ['email', 'E-mail', ['email', 'e-mail', 'mail']],
    ],
    required: ['naam'],
  },
  contacten: {
    label: 'Contactpersonen',
    fields: [
      ['klant', 'Klantnr. of klantnaam *', ['klantnr', 'klantnummer', 'klant', 'bedrijf', 'bedrijfsnaam', 'organisatie', 'company']],
      ['naam', 'Naam *', ['naam', 'contactpersoon', 'contact', 'name', 'volledige naam']],
      ['functie', 'Functie', ['functie', 'rol', 'title', 'job title']],
      ['telefoon', 'Telefoon', ['telefoon', 'tel', 'mobiel', 'phone']],
      ['email', 'E-mail', ['email', 'e-mail', 'mail']],
    ],
    required: ['klant', 'naam'],
  },
  contracten: {
    label: 'Contracten',
    fields: [
      ['klant', 'Klantnr. of klantnaam *', ['klantnr', 'klantnummer', 'klant', 'bedrijf', 'bedrijfsnaam']],
      ['omschrijving', 'Omschrijving *', ['omschrijving', 'contract', 'product', 'description']],
      ['soort', 'Soort (abonnement/lease/huur/koop)', ['soort', 'type', 'contractsoort']],
      ['perMaand', 'Per maand (€)', ['per maand', 'maandbedrag', 'bedrag per maand', 'mrr', 'maand']],
      ['eenmalig', 'Eenmalig (€)', ['eenmalig', 'eenmalige kosten', 'aanschaf']],
      ['start', 'Startdatum', ['start', 'startdatum', 'ingangsdatum', 'begindatum']],
      ['eind', 'Einddatum', ['eind', 'einddatum', 'looptijd tot', 'afloopdatum']],
    ],
    required: ['klant', 'omschrijving'],
  },
  systemen: {
    label: 'Geplaatste systemen',
    fields: [
      ['klant', 'Klantnr. of klantnaam *', ['klantnr', 'klantnummer', 'klant', 'bedrijf', 'bedrijfsnaam']],
      ['systeem', 'Systeem *', ['systeem', 'machine', 'apparaat', 'model', 'type']],
      ['serienummer', 'Serienummer', ['serienummer', 'sn', 'serial', 'serie']],
      ['locatie', 'Plek in het pand', ['locatie', 'plek', 'ruimte', 'positie']],
      ['geplaatst', 'Geplaatst op', ['geplaatst', 'installatiedatum', 'plaatsingsdatum', 'datum']],
      ['geur', 'Geur', ['geur', 'geurprofiel', 'scent']],
      ['interval', 'Onderhoud elke (maanden)', ['interval', 'onderhoudsinterval', 'onderhoud']],
    ],
    required: ['klant', 'systeem'],
  },
};

let state = { type: 'klanten', headers: [], rows: [], map: {}, fileName: '' };

function readRows(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const nonEmpty = aoa.filter((r) => r.some((c) => String(c).trim()));
  const [head = [], ...rows] = nonEmpty;
  return { headers: head.map((x) => String(x).trim()), rows };
}

async function parseFile(file) {
  if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) return readRows(XLSX.read(await file.arrayBuffer(), { type: 'array' }));
  let text = await file.text();
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const FS = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  return readRows(XLSX.read(text, { type: 'string', FS, raw: true }));
}

function autoMap(type, headers) {
  const map = {};
  for (const [key, , syn] of TYPES[type].fields) {
    const i = headers.findIndex((hd) => syn.includes(norm(hd)));
    const j = i >= 0 ? i : headers.findIndex((hd) => syn.some((x) => norm(hd).includes(x)));
    if (j >= 0) map[key] = String(j);
  }
  return map;
}

const val = (row, map, key) => (map[key] === undefined || map[key] === '' ? '' : String(row[Number(map[key])] ?? '').trim());
const num = (v) => { const n = Number(String(v).replace(/[€\s.]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const date = (v) => (v ? serialToISO(/^\d+(\.\d+)?$/.test(v) ? Number(v) : v) || '' : '');

function findCustomer(ref) {
  const s = store.get();
  if (!ref) return null;
  return s.customers.find((c) => String(c.nr) === String(ref).trim()) || s.customers.find((c) => norm(c.naam) === norm(ref)) || null;
}

function runImport() {
  const { type, rows, map } = state;
  const res = { nieuw: 0, bijgewerkt: 0, overgeslagen: 0, redenen: [] };
  const skip = (i, why) => { res.overgeslagen++; if (res.redenen.length < 8) res.redenen.push(`Regel ${i + 2}: ${why}`); };
  store.update((s) => {
    rows.forEach((row, i) => {
      const g = (k) => val(row, map, k);
      if (type === 'klanten') {
        const naam = g('naam');
        if (!naam) return skip(i, 'geen naam');
        const nrIn = g('nr');
        let c = (nrIn && s.customers.find((x) => String(x.nr) === nrIn)) || s.customers.find((x) => norm(x.naam) === norm(naam) && (!g('plaats') || norm(x.plaats) === norm(g('plaats'))));
        const fields = { naam, adres: g('adres'), postcode: g('postcode'), plaats: g('plaats'), telefoon: g('telefoon') };
        if (c) {
          for (const [k, v] of Object.entries(fields)) if (v) c[k] = v;
          c.dirty = !c.pending;
          res.bijgewerkt++;
        } else {
          const nr = nrIn && !s.customers.some((x) => String(x.nr) === nrIn) && Number(nrIn) ? Number(nrIn) : nextKlantnr();
          const km = kmFor(fields.plaats);
          c = { nr, notitie: '', pending: true, ...fields, km, min: minFor(km) };
          s.customers.push(c);
          res.nieuw++;
        }
        if (g('sector') || g('email')) {
          let p = s.profiles.find((x) => String(x.nr) === String(c.nr));
          if (!p) { p = { id: String(c.nr), nr: c.nr }; s.profiles.push(p); }
          if (g('sector')) p.sector = g('sector');
          if (g('email')) p.email = g('email');
          p.updatedAt = now();
        }
        return;
      }
      const c = findCustomer(g('klant'));
      if (!c) return skip(i, `klant "${g('klant') || '(leeg)'}" niet gevonden`);
      if (type === 'contacten') {
        if (!g('naam')) return skip(i, 'geen naam');
        const ex = s.contacts.find((x) => !x.deleted && String(x.nr) === String(c.nr) && norm(x.naam) === norm(g('naam')));
        const f = { functie: g('functie'), telefoon: g('telefoon'), email: g('email') };
        if (ex) { for (const [k, v] of Object.entries(f)) if (v) ex[k] = v; ex.updatedAt = now(); res.bijgewerkt++; }
        else { s.contacts.push({ id: uid(), nr: c.nr, naam: g('naam'), ...f, primair: !s.contacts.some((x) => !x.deleted && String(x.nr) === String(c.nr)), deleted: false, updatedAt: now() }); res.nieuw++; }
      } else if (type === 'contracten') {
        if (!g('omschrijving')) return skip(i, 'geen omschrijving');
        const soort = ['abonnement', 'lease', 'huur', 'koop'].find((x) => norm(g('soort')).includes(x)) || 'abonnement';
        s.contracts.push({ id: uid(), nr: c.nr, soort, omschrijving: g('omschrijving'), perMaand: num(g('perMaand')), eenmalig: num(g('eenmalig')), start: date(g('start')), eind: date(g('eind')), opzegMnd: 1, status: 'actief', deleted: false, updatedAt: now() });
        res.nieuw++;
      } else if (type === 'systemen') {
        if (!g('systeem')) return skip(i, 'geen systeem');
        const sn = g('serienummer');
        const ex = sn && s.assets.find((a) => !a.deleted && a.serienummer === sn);
        const f = { nr: c.nr, systeem: g('systeem'), serienummer: sn, locatie: g('locatie'), geplaatst: date(g('geplaatst')), geur: g('geur'), interval: num(g('interval')) || null };
        if (ex) { Object.assign(ex, f, { updatedAt: now() }); res.bijgewerkt++; }
        else { s.assets.push({ id: uid(), ...f, laatsteOnderhoud: '', status: 'actief', deleted: false, updatedAt: now() }); res.nieuw++; }
      }
    });
    if (!s.source) s.source = 'app';
  });
  return res;
}

export function viewImport() {
  const t = TYPES[state.type];
  const sel = (key) => `<select data-map="${key}"><option value="">– niet gebruiken –</option>${state.headers.map((hd, i) => `<option value="${i}" ${state.map[key] === String(i) ? 'selected' : ''}>${h(hd || `Kolom ${i + 1}`)}</option>`).join('')}</select>`;
  const preview = state.rows.slice(0, 5);
  return `
    <a class="back" href="#/meer">‹ Meer</a>
    <h1>Importeren uit CSV of Excel</h1>
    <section class="card form">
      <label>Wat wil je importeren?<select id="impType">${Object.entries(TYPES).map(([k, x]) => `<option value="${k}" ${state.type === k ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
      <div class="actions left">
        <label class="btn primary">📂 Bestand kiezen<input type="file" id="impFile" accept=".csv,.txt,.tsv,.xlsx,.xls" hidden></label>
        <button class="btn ghost" id="impTemplate" type="button">Voorbeeldbestand</button>
      </div>
      <p class="muted small">CSV (komma, puntkomma of tab) of Excel, met kolomnamen op de eerste regel. Bijvoorbeeld een export uit je boekhoudpakket.${state.type !== 'klanten' ? ' Koppeling aan de klant gaat via klantnummer of exacte klantnaam; importeer de klanten dus eerst.' : ' Bestaande klanten (zelfde klantnummer, of zelfde naam en plaats) worden bijgewerkt.'}</p>
    </section>
    ${state.headers.length ? `
      <section class="card form">
        <h2>Kolommen koppelen <span class="muted small">${h(state.fileName)} · ${state.rows.length} regels</span></h2>
        ${t.fields.map(([key, label]) => `<label>${h(label)}${sel(key)}</label>`).join('')}
      </section>
      <section class="card">
        <h2>Voorbeeld</h2>
        <div class="table-wrap"><table class="q-table">
          <thead><tr>${t.fields.map(([, label]) => `<th>${h(label.replace(' *', ''))}</th>`).join('')}</tr></thead>
          <tbody>${preview.map((r) => `<tr>${t.fields.map(([key]) => `<td>${h(val(r, state.map, key))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <div class="actions left"><button class="btn primary" id="impRun" ${t.required.every((k) => state.map[k] !== undefined && state.map[k] !== '') ? '' : 'disabled'}>${state.rows.length} regels importeren</button></div>
        ${t.required.every((k) => state.map[k] !== undefined && state.map[k] !== '') ? '' : '<p class="muted small">Koppel eerst de velden met een *.</p>'}
      </section>` : ''}
    <div id="impResult"></div>`;
}

viewImport.after = () => {
  $('#impType').addEventListener('change', (e) => {
    state.type = e.target.value;
    state.map = autoMap(state.type, state.headers);
    hooks.render();
  });
  $('#impFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const { headers, rows } = await parseFile(f);
      state = { ...state, headers, rows, fileName: f.name, map: autoMap(state.type, headers) };
      hooks.render();
    } catch (err) {
      toast('Bestand kon niet worden gelezen: ' + err.message, 5000);
    }
  });
  $$('[data-map]').forEach((s) => s.addEventListener('change', () => { state.map[s.dataset.map] = s.value; hooks.render(); }));
  $('#impTemplate').addEventListener('click', () => {
    const t = TYPES[state.type];
    const csv = '﻿' + t.fields.map(([, label]) => label.replace(' *', '')).join(';') + '\r\n';
    download(`Voorbeeld ${t.label}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  });
  $('#impRun')?.addEventListener('click', () => {
    const r = runImport();
    state = { ...state, headers: [], rows: [], fileName: '', map: {} };
    hooks.render();
    hooks.sync();
    $('#impResult').innerHTML = `<section class="card"><h2>Klaar</h2><p>${r.nieuw} nieuw · ${r.bijgewerkt} bijgewerkt · ${r.overgeslagen} overgeslagen</p>${r.redenen.length ? `<ul class="muted small">${r.redenen.map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : ''}</section>`;
    toast(`Import klaar: ${r.nieuw} nieuw, ${r.bijgewerkt} bijgewerkt`);
    // Afstanden aanvullen voor klanten in plaatsen die nog niet bekend zijn (op de achtergrond, 1 per seconde).
    (async () => {
      for (const c of store.get().customers.filter((x) => (x.km === null || x.km === undefined) && x.plaats)) {
        const km = await distanceFromStart(c.plaats);
        if (km !== null) store.update(() => { c.km = km; c.min = minFor(km); });
        await new Promise((res) => setTimeout(res, 1100));
      }
    })();
  });
};
