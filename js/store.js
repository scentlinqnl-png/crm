// Lokale opslag + afgeleide cijfers (bezoeken, verbruik, classificatie) zoals in Klantkaart.xlsx.

const KEY = 'klantkaart.v1';

export const DEFAULT_SETTINGS = {
  startPlaats: 'Bergen op Zoom',
  startTijd: '09:00',
  eindTijd: '18:00',
  bezoekDuur: 45,
  minStops: 4,
  maxStops: 6,
  snelheid: 80,          // km/u, zoals Blad1!O1
  weinigPct: 0.8,        // Blad1 "Grens 'Weinig'"
  veelPct: 1.2,          // Blad1 "Grens 'Veel'"
  minDagenTussen: 14,    // klant niet opnieuw voorstellen binnen zoveel dagen
  maxKm: 250,            // klanten verder dan dit niet automatisch inplannen
  fases: ['Lead', 'Contact gelegd', 'Proefplaatsing', 'Offerte', 'Onderhandeling'],
  sectoren: ['Hospitality & Hotels', 'Retail & Showrooms', 'Zorg & Luchtvaart', 'Beauty & Wellness', 'Automotive', 'Kantoor & Overig'],
  flaconMl: 500,         // standaard inhoud geurpatroon/flacon voor de navulvoorspelling
  navulDagen: 14,        // "bijna leeg" = binnen zoveel dagen
  // Adviesregels ruimtecalculator (vervang door de echte Scentlinq-productspecificaties)
  systemen: [
    { naam: 'Scent Compact', totM3: 150, prijs: 395, abonnement: 39 },
    { naam: 'Scent Medium', totM3: 500, prijs: 895, abonnement: 69 },
    { naam: 'Scent Pro', totM3: 1500, prijs: 1895, abonnement: 129 },
    { naam: 'Scent HVAC', totM3: 999999, prijs: 3950, abonnement: 249 },
  ],
  claudeProxy: '',        // optioneel: eigen proxy voor de Anthropic API
  doelBezoekenWeek: 15,
  doelVerbruikMaand: 5000,
  m365: {
    clientId: '',
    tenant: 'organizations',
    host: 'scentlinqprobenelux.sharepoint.com',
    sitePath: '/sites/Sales',
    filePath: 'Prospects/Klantkaart.xlsx',
  },
};

const empty = () => ({
  customers: [],     // {nr, naam, adres, postcode, plaats, telefoon, km, min, notitie, pending}
  visits: [],        // {id, datum, nr, ml, opmerking, geur, instellingen, pending, row}
  afstanden: {},     // plaats(lowercase) -> km vanaf startplaats
  coords: {},        // plaats(lowercase) -> {lat, lon} | null
  plans: {},         // datum -> {datum, stops:[...], terug, totaalReis}
  deals: [],         // {id, nr, titel, fase, waarde, status:'open'|'gewonnen'|'verloren', gesloten, updatedAt}
  activities: [],    // {id, nr, type, titel, datum, tijd, notitie, done, updatedAt}
  profiles: [],      // {id: klantnr, nr, sector, keten, contactpersoon, email, geurprofiel, sfeer, m3, circulatie, systeem, aantal, flaconMl, updatedAt}
  pinned: [],        // klantnrs die handmatig in de volgende planning moeten
  settings: structuredClone(DEFAULT_SETTINGS),
  lastSync: null,
  source: null,      // 'import' | 'm365'
});

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const s = { ...empty(), ...JSON.parse(raw) };
    s.settings = { ...DEFAULT_SETTINGS, ...s.settings, m365: { ...DEFAULT_SETTINGS.m365, ...(s.settings?.m365 || {}) } };
    return s;
  } catch {
    return empty();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Opslaan mislukt', e);
  }
  listeners.forEach((fn) => fn(state));
}

export const store = {
  get: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  update(fn) { fn(state); save(); },
  reset() { state = empty(); save(); },
};

// ---------- helpers ----------

export const norm = (s) => String(s ?? '').trim().toLowerCase();

export function todayISO(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function daysBetween(isoA, isoB) {
  return Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const now = () => new Date().toISOString();

export function customer(nr) {
  return state.customers.find((c) => String(c.nr) === String(nr));
}

export function nextKlantnr() {
  return state.customers.reduce((m, c) => Math.max(m, Number(c.nr) || 0), 0) + 1;
}

export function kmFor(plaats) {
  const v = state.afstanden[norm(plaats)];
  return v === undefined ? null : v;
}

export function minFor(km) {
  if (km === null || km === undefined || km === '') return null;
  return Math.round((km / state.settings.snelheid) * 60);
}

// ---------- statistieken (Blad1 kolommen I t/m L) ----------

export function stats() {
  const per = new Map();
  let totaal = 0;
  let n = 0;
  for (const v of state.visits) {
    const k = String(v.nr);
    const s = per.get(k) || { bezoeken: 0, totaal: 0, laatste: null, laatsteGeur: '', laatsteInstellingen: '' };
    s.bezoeken++;
    s.totaal += Number(v.ml) || 0;
    if (!s.laatste || v.datum >= s.laatste) {
      s.laatste = v.datum;
      if (v.geur) s.laatsteGeur = v.geur;
      if (v.instellingen) s.laatsteInstellingen = v.instellingen;
    }
    per.set(k, s);
    totaal += Number(v.ml) || 0;
    n++;
  }
  const gemAlle = n ? totaal / n : null;
  const onder = gemAlle === null ? null : gemAlle * state.settings.weinigPct;
  const boven = gemAlle === null ? null : gemAlle * state.settings.veelPct;
  for (const s of per.values()) {
    s.gem = s.bezoeken ? s.totaal / s.bezoeken : null;
    s.classificatie = s.gem === null || onder === null ? '' : s.gem < onder ? 'Weinig' : s.gem > boven ? 'Veel' : 'Normaal';
  }
  return { per, gemAlle, onder, boven, aantalBezoeken: n };
}

export function statFor(allStats, nr) {
  return allStats.per.get(String(nr)) || { bezoeken: 0, totaal: 0, gem: null, classificatie: '', laatste: null, laatsteGeur: '', laatsteInstellingen: '' };
}

export function knownGeuren() {
  return [...new Set(state.visits.map((v) => v.geur).filter(Boolean))].sort();
}

export function fullAddress(c) {
  return [c.adres, [c.postcode, c.plaats].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// Excel-serienummer <-> ISO-datum
export function serialToISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (v instanceof Date) return todayISO(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function isoToSerial(iso) {
  return Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000) + 25569;
}

// ---------- werkboek -> state (gedeeld door Excel-import en Microsoft 365) ----------

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

// rows = 2D-array van een tabblad, vanaf rij 1 (index 0)
export function parseBlad1(rows) {
  const out = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] || [];
    const nr = num(r[0]);
    const naam = str(r[1]);
    if (nr === null || !naam) continue;
    out.push({
      nr,
      naam,
      adres: str(r[2]),
      postcode: str(r[3]),
      plaats: str(r[4]),
      telefoon: str(r[5]),
      km: num(r[6]),
      min: num(r[7]),
      notitie: '',
      row: i + 1,
    });
  }
  return out;
}

export function parseVerbruik(rows) {
  const out = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] || [];
    const nr = num(r[1]);
    if (nr === null) continue;
    out.push({
      id: 'row' + (i + 1),
      row: i + 1,
      datum: serialToISO(r[0]) || '',
      nr,
      ml: num(r[3]) ?? 0,
      opmerking: str(r[4]),
      geur: str(r[5]),
      instellingen: str(r[6]),
      pending: false,
    });
  }
  return out;
}

export function parseAfstanden(rows) {
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const p = norm(r[0]);
    const km = num(r[1]);
    if (p && km !== null) out[p] = km;
  }
  return out;
}

// Vervangt klanten/bezoeken met de werkboekversie, maar houdt lokale nog-niet-gesynchroniseerde wijzigingen.
export function mergeWorkbook({ customers, visits, afstanden }, source) {
  store.update((s) => {
    const pendingCustomers = s.customers.filter((c) => c.pending && !customers.some((x) => String(x.nr) === String(c.nr)));
    const local = new Map(s.customers.map((c) => [String(c.nr), c]));
    s.customers = [
      ...customers.map((c) => {
        const l = local.get(String(c.nr));
        if (l?.dirty) return { ...l, row: c.row };
        return { ...c, notitie: l?.notitie || '' };
      }),
      ...pendingCustomers,
    ];
    s.visits = [...visits, ...s.visits.filter((v) => v.pending)];
    if (afstanden && Object.keys(afstanden).length) s.afstanden = afstanden;
    s.lastSync = new Date().toISOString();
    s.source = source;
  });
}

// ---------- CRM (pipeline + activiteiten) ----------

export const ACTIVITY_TYPES = {
  bellen: '📞 Bellen',
  bezoek: '🚗 Bezoek',
  email: '✉️ E-mail',
  followup: '🔁 Follow-up',
  demo: '🌸 Proefplaatsing',
  taak: '✅ Taak',
};

export function openActivities(nr) {
  return state.activities
    .filter((a) => !a.done && !a.deleted && (nr === undefined || String(a.nr) === String(nr)))
    .sort((a, b) => (a.datum + (a.tijd || '')).localeCompare(b.datum + (b.tijd || '')));
}

export function openDeals() {
  return state.deals.filter((d) => d.status === 'open' && !d.deleted);
}

// Pipedrive-regel: elke open deal hoort een volgende activiteit te hebben.
export function dealsWithoutNextStep() {
  const withAct = new Set(openActivities().map((a) => String(a.nr)));
  return openDeals().filter((d) => !withAct.has(String(d.nr)));
}

// Samenvoegen op id, nieuwste updatedAt wint (voor synchronisatie via Excel).
export function mergeById(local, remote) {
  const map = new Map(local.map((x) => [x.id, x]));
  for (const r of remote) {
    const l = map.get(r.id);
    if (!l || (r.updatedAt || '') > (l.updatedAt || '')) map.set(r.id, r);
  }
  return [...map.values()];
}

export const CRM_SHEETS = {
  deals: { name: 'CRM_Deals', cols: ['id', 'nr', 'titel', 'fase', 'waarde', 'status', 'gesloten', 'updatedAt', 'deleted'] },
  activities: { name: 'CRM_Activiteiten', cols: ['id', 'nr', 'type', 'titel', 'datum', 'tijd', 'notitie', 'done', 'updatedAt', 'deleted'] },
  profiles: { name: 'CRM_Klantprofiel', cols: ['id', 'nr', 'sector', 'keten', 'contactpersoon', 'email', 'geurprofiel', 'sfeer', 'm3', 'circulatie', 'systeem', 'aantal', 'flaconMl', 'updatedAt'] },
};


function fromRow(cols, row) {
  const o = {};
  cols.forEach((c, i) => { o[c] = row[i] === '' ? null : row[i]; });
  o.done = o.done === true || o.done === 'TRUE' || o.done === 1;
  o.deleted = o.deleted === true || o.deleted === 'TRUE' || o.deleted === 1;
  if (o.waarde !== undefined) o.waarde = Number(o.waarde) || 0;
  for (const k of ['m3', 'aantal', 'flaconMl']) if (k in o) o[k] = o[k] === null ? null : Number(o[k]) || null;
  for (const k of ['id', 'datum', 'tijd', 'gesloten', 'titel', 'notitie', 'type', 'fase', 'status', 'updatedAt', 'sector', 'keten', 'contactpersoon', 'email', 'geurprofiel', 'sfeer', 'circulatie', 'systeem']) {
    if (k in o && o[k] !== null) o[k] = String(o[k]);
  }
  return o;
}

export function crmFromRows(key, rows) {
  const def = CRM_SHEETS[key];
  return rows.slice(1).filter((r) => r && r[0]).map((r) => fromRow(def.cols, r));
}

// ---------- klantprofiel (sector, keten, geur-DNA, ruimte) ----------

export function profile(nr) {
  return state.profiles.find((p) => String(p.nr) === String(nr)) || { id: String(nr), nr, sector: '', keten: '', contactpersoon: '', email: '', geurprofiel: '', sfeer: '', m3: null, circulatie: 'normaal', systeem: '', aantal: null, flaconMl: null };
}

export function saveProfile(nr, fields) {
  store.update((s) => {
    let p = s.profiles.find((x) => String(x.nr) === String(nr));
    if (!p) { p = { id: String(nr), nr }; s.profiles.push(p); }
    Object.assign(p, fields, { updatedAt: now() });
  });
}

export function ketenLocaties(nr) {
  const k = norm(profile(nr).keten);
  if (!k) return [];
  return state.profiles.filter((p) => norm(p.keten) === k && String(p.nr) !== String(nr)).map((p) => customer(p.nr)).filter(Boolean);
}

// Ruimte- & systeemcalculator: benodigd volume -> systeem + intensiteit.
const CIRC = { laag: 0.8, normaal: 1, hoog: 1.4 };
const SECTOR_INTENSITEIT = { 'Hospitality & Hotels': 'medium', 'Retail & Showrooms': 'medium-hoog', 'Zorg & Luchtvaart': 'laag (fris & neutraal)', 'Beauty & Wellness': 'medium' };
export function adviseSystem({ m3, circulatie = 'normaal', sector = '' }) {
  const v = Number(m3);
  if (!v) return null;
  const effectief = Math.round(v * (CIRC[circulatie] || 1));
  const sys = state.settings.systemen.slice().sort((a, b) => a.totM3 - b.totM3);
  const top = sys[sys.length - 1];
  let keuze = sys.find((x) => effectief <= x.totM3) || top;
  let aantal = 1;
  // Groot volume zonder HVAC: meerdere units van het grootste losse systeem als alternatief.
  const grootsteLos = sys[sys.length - 2] || top;
  const alternatief = keuze === top && sys.length > 1 ? { systeem: grootsteLos.naam, aantal: Math.ceil(effectief / grootsteLos.totM3) } : null;
  return { effectief, systeem: keuze.naam, aantal, intensiteit: SECTOR_INTENSITEIT[sector] || 'medium', alternatief, prijs: keuze.prijs, abonnement: keuze.abonnement };
}

// ---------- voorspellend navulbeheer ----------
// Verbruik per dag = ml tussen eerste en laatste bezoek / aantal dagen. Leeg-datum = laatste bezoek + inhoud / verbruik per dag.
export function refillForecast(nr) {
  const v = state.visits.filter((x) => String(x.nr) === String(nr) && x.datum).sort((a, b) => a.datum.localeCompare(b.datum));
  if (v.length < 2) return null;
  const dagen = daysBetween(v[0].datum, v[v.length - 1].datum);
  if (dagen <= 0) return null;
  const ml = v.slice(1).reduce((t, x) => t + (Number(x.ml) || 0), 0);
  const perDag = ml / dagen;
  if (!perDag) return null;
  const inhoud = profile(nr).flaconMl || state.settings.flaconMl;
  const dagenTotLeeg = Math.round(inhoud / perDag);
  const leeg = new Date(v[v.length - 1].datum + 'T12:00:00');
  leeg.setDate(leeg.getDate() + dagenTotLeeg);
  const leegISO = todayISO(leeg);
  return { perDag, inhoud, leeg: leegISO, dagenResterend: daysBetween(todayISO(), leegISO) };
}

export function refillsDue(withinDays = state.settings.navulDagen) {
  return state.customers
    .map((c) => ({ c, f: refillForecast(c.nr) }))
    .filter((x) => x.f && x.f.dagenResterend <= withinDays)
    .sort((a, b) => a.f.leeg.localeCompare(b.f.leeg));
}
