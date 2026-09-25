// Import van Klantkaart.xlsx en exports (Verbruik-regels, back-up, Google My Maps).
/* global XLSX */
import { store, parseBlad1, parseVerbruik, parseAfstanden, mergeWorkbook, customer, fullAddress, isoToSerial, CRM_SHEETS, crmFromRows, mergeById } from './store.js';

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true, defval: '' });
}

export async function importWorkbook(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  if (!wb.Sheets.Blad1) throw new Error('Tabblad "Blad1" (klantenlijst) niet gevonden in dit bestand.');
  const customers = parseBlad1(sheetRows(wb, 'Blad1'));
  const visits = parseVerbruik(sheetRows(wb, 'Verbruik'));
  const afstanden = parseAfstanden(sheetRows(wb, 'Afstanden'));
  mergeWorkbook({ customers, visits, afstanden }, 'import');
  store.update((s) => {
    for (const [key, def] of Object.entries(CRM_SHEETS)) {
      if (wb.Sheets[def.name]) s[key] = mergeById(s[key], crmFromRows(key, sheetRows(wb, def.name)));
    }
  });
  return { klanten: customers.length, bezoeken: visits.length };
}

// Eerstvolgende vrije regel in Verbruik (zoals Voorblad!B18: COUNTA(B4:B1000)+4)
export function nextVerbruikRow() {
  return store.get().visits.filter((v) => !v.pending).length + 4;
}

export function verbruikTSV(visits) {
  return visits
    .map((v) => [v.datum, v.nr, customer(v.nr)?.naam || '', v.ml, v.opmerking || '', v.geur || '', v.instellingen || ''].join('\t'))
    .join('\n');
}

export async function download(name, blob) {
  // Op claude.ai (voorbeeldweergave) lopen downloads via de pagina zelf.
  if (typeof window.claude?.use === 'function') {
    const dl = await window.claude.use('downloads').catch(() => null);
    if (dl) { await dl.save({ filename: name, data: blob }).catch(() => {}); return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Back-up met dezelfde tabbladindeling als Klantkaart.xlsx, zodat hij ook weer te importeren is.
export function exportBackup() {
  const s = store.get();
  const wb = XLSX.utils.book_new();
  const blad1 = [['Klantenlijst – back-up uit Klantkaart-app'], [],
    ['Klantnr.', 'Klantnaam', 'Adres', 'Postcode', 'Plaats', 'Telefoon', 'Afstand (km)', 'Reistijd (min, ca.)', 'Notitie']]
    .concat(s.customers.map((c) => [c.nr, c.naam, c.adres, c.postcode, c.plaats, c.telefoon, c.km ?? '', c.min ?? '', c.notitie || '']));
  const verbruik = [['Verbruik per bezoek'], [], ['Datum', 'Klantnr.', 'Klantnaam', 'Verbruik (ml)', 'Opmerking', 'Geur', 'Instellingen']]
    .concat(s.visits.map((v) => [isoToSerial(v.datum), v.nr, customer(v.nr)?.naam || '', v.ml, v.opmerking, v.geur, v.instellingen]));
  const wsV = XLSX.utils.aoa_to_sheet(verbruik);
  for (let r = 3; r < verbruik.length; r++) {
    const cell = wsV[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell) cell.z = 'yyyy-mm-dd';
  }
  const afst = [['Plaats', 'Afstand vanaf ' + s.settings.startPlaats + ' (km)']].concat(Object.entries(s.afstanden));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(blad1), 'Blad1');
  XLSX.utils.book_append_sheet(wb, wsV, 'Verbruik');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(afst), 'Afstanden');
  for (const [key, def] of Object.entries(CRM_SHEETS)) {
    const rows = [def.cols, ...s[key].map((o) => def.cols.map((c) => o[c] ?? ''))];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), def.name);
  }
  XLSX.writeFile(wb, `Klantkaart-backup-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportMyMaps(plan) {
  const rows = [['Naam', 'Volledig adres', 'Tijdstip', 'Opmerking']];
  for (const stop of plan.stops) {
    const c = customer(stop.nr);
    if (!c) continue;
    const land = /^\d{4}$/.test(String(c.postcode).trim()) ? 'België' : 'Nederland';
    rows.push([c.naam, `${fullAddress(c)}, ${land}`, `${stop.aankomst}–${stop.vertrek}`, stop.reden || '']);
  }
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  download(`Dagplanning_MyMaps_${plan.datum}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

// ---------- standalone back-up (JSON, geen Excel nodig) ----------

const BACKUP_KEYS = ['customers', 'visits', 'afstanden', 'coords', 'plans', 'deals', 'activities', 'profiles', 'pinned', 'tickets', 'ticketSeq', 'contacts', 'contracts', 'assets', 'serviceRoutes', 'settings'];

export function exportJsonBackup() {
  const s = store.get();
  const data = { app: 'klantkaart', versie: 1, gemaakt: new Date().toISOString(), ...Object.fromEntries(BACKUP_KEYS.map((k) => [k, s[k]])) };
  // Microsoft- en Claude-sleutels horen niet in een back-upbestand.
  data.settings = { ...data.settings, m365: { ...data.settings.m365, clientId: '' } };
  download(`Klantkaart-backup-${todayStamp()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
  store.update((st) => { st.lastBackup = new Date().toISOString(); });
}

export async function restoreJsonBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'klantkaart' || !Array.isArray(data.customers)) throw new Error('Dit is geen Klantkaart-back-up.');
  store.update((s) => {
    for (const k of BACKUP_KEYS) if (data[k] !== undefined) s[k] = k === 'settings' ? { ...s.settings, ...data.settings, m365: s.settings.m365 } : data[k];
    s.source = 'app';
    s.lastBackup = data.gemaakt || null;
  });
  return { klanten: data.customers.length, bezoeken: (data.visits || []).length };
}

const todayStamp = () => new Date().toISOString().slice(0, 10);
