// Gedeelde database (api/ op dezelfde server): elk record apart synchroniseren, offline eerst.
// Wijzigingen worden herkend door per record een hash te vergelijken met de laatst gesynchroniseerde versie,
// zodat de rest van de app gewoon store.update() blijft gebruiken.
import { store } from './store.js';

const API = 'api/index.php';
const TOKEN_KEY = 'klantkaart.db.token';
const STATE_KEY = 'klantkaart.db.state';

// Lijsten met hun sleutelveld; kaarten (object per sleutel); losse instellingen onder 'meta'.
const ARRAYS = {
  customers: 'nr', visits: 'id', deals: 'id', activities: 'id', profiles: 'id', tickets: 'id', contacts: 'id',
  contracts: 'id', assets: 'id', stock: 'id', orders: 'id', quotes: 'id', stockMoves: 'id',
};
const MAPS = ['afstanden', 'coords', 'plans', 'serviceRoutes'];
const SEQS = ['ticketSeq', 'orderSeq', 'quoteSeq'];
const DEVICE_SETTINGS = ['m365', 'mijnLocatie']; // per apparaat, niet delen

const status = { syncing: false, error: '', lastSync: null, pending: 0 };
let listeners = [];
let timer = null;
let again = false;

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let dbState = read(STATE_KEY, { cursor: 0, user: '', hashes: {} });
const saveState = () => write(STATE_KEY, dbState);

export const isSignedIn = () => !!token();
export const needsFirstSync = () => isSignedIn() && !!dbState.setup;
export const user = () => dbState.user;
export const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
// Heeft de server een Anthropic-sleutel? Dan werkt Claude zonder eigen sleutel.
export const serverClaude = () => isSignedIn() && !!dbState.claude;
export const isAdmin = () => isSignedIn() && !!dbState.admin;
// Ingelogd met een tijdelijke pincode: vraag om een eigen wachtwoord (mag per sessie worden overgeslagen).
export const mustChangePassword = () => isSignedIn() && !!dbState.mustChange && !skipPw();
const skipPw = () => { try { return sessionStorage.getItem('klantkaart.pwLater') === '1'; } catch { return false; } };
export const usesTempPin = () => isSignedIn() && !!dbState.mustChange;
export function passwordLater() { try { sessionStorage.setItem('klantkaart.pwLater', '1'); } catch {} }

// Gebruikersbeheer en wachtwoord (api/index.php).
export const users = () => call('users');
export const addUser = (username, password, admin) => call('user_add', { username, password, admin });
export const resetPin = (id) => call('user_update', { id, pin: true });
export const updateUser = (id, fields) => call('user_update', { id, ...fields });
export const deleteUser = (id) => call('user_delete', { id });
export async function changePassword(old, nw) {
  const r = await call('password', { old, new: nw });
  delete dbState.mustChange;
  saveState();
  return r;
}
export const getStatus = () => ({ ...status, pending: pendingCount() });
export function onStatus(fn) { listeners.push(fn); }
const receivers = [];
export function onReceive(fn) { receivers.push(fn); }
const emit = () => listeners.forEach((fn) => fn(getStatus()));

// cyrb53: snelle 53-bit hash, ruim voldoende om wijzigingen te herkennen.
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const K = (c, id) => `${c}\u0001${id}`;

function sharedSettings(settings) {
  const out = { ...settings };
  for (const k of DEVICE_SETTINGS) delete out[k];
  return out;
}

// Alle records van de huidige toestand als Map sleutel -> {c, id, d}.
function snapshot(s = store.get()) {
  const m = new Map();
  const put = (c, id, v) => { if (id !== undefined && id !== null && id !== '') m.set(K(c, String(id)), { c, id: String(id), d: JSON.stringify(v ?? null) }); };
  for (const [c, key] of Object.entries(ARRAYS)) for (const r of s[c] || []) put(c, r[key] ?? (c === 'profiles' ? r.nr : undefined), r);
  for (const c of MAPS) for (const [id, v] of Object.entries(s[c] || {})) put(c, id, v);
  put('meta', 'settings', sharedSettings(s.settings));
  put('meta', 'pinned', s.pinned || []);
  for (const k of SEQS) put('meta', k, s[k] || 0);
  return m;
}

function diff(snap = snapshot()) {
  const changes = [];
  for (const [k, r] of snap) if (dbState.hashes[k] !== hash(r.d)) changes.push({ ...r, h: hash(r.d) });
  for (const k of Object.keys(dbState.hashes)) if (!snap.has(k)) { const [c, id] = k.split('\u0001'); changes.push({ c, id, del: true }); }
  return changes;
}

function pendingCount() {
  return isSignedIn() ? diff().length : 0;
}

function applyRemote(s, ch) {
  const val = ch.del ? undefined : JSON.parse(ch.d);
  if (ARRAYS[ch.c]) {
    const key = ARRAYS[ch.c];
    const arr = s[ch.c] || (s[ch.c] = []);
    const i = arr.findIndex((r) => String(r[key] ?? (ch.c === 'profiles' ? r.nr : '')) === ch.id);
    if (ch.del) { if (i >= 0) arr.splice(i, 1); } else if (i >= 0) arr[i] = val; else arr.push(val);
  } else if (MAPS.includes(ch.c)) {
    s[ch.c] = s[ch.c] || {};
    if (ch.del) delete s[ch.c][ch.id]; else s[ch.c][ch.id] = val;
  } else if (ch.c === 'meta' && !ch.del) {
    if (ch.id === 'settings') {
      const keep = Object.fromEntries(DEVICE_SETTINGS.map((k) => [k, s.settings[k]]));
      s.settings = { ...s.settings, ...val, ...keep };
    } else if (ch.id === 'pinned') s.pinned = val;
    else if (SEQS.includes(ch.id)) s[ch.id] = Math.max(Number(s[ch.id]) || 0, Number(val) || 0);
  }
}

async function call(action, body = {}) {
  const res = await fetch(`${API}?a=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token() ? { 'x-auth-token': token() } : {}) },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && action !== 'login') { signOutLocal(); throw new Error(data.error || 'Niet aangemeld'); }
  if (!res.ok) throw new Error(data.error || `Server gaf ${res.status}`);
  return data;
}

// Eén synchronisatieronde: eerst eigen wijzigingen versturen, dan die van anderen ophalen (in delen).
export async function syncNow({ pullOnly = false, first = false } = {}) {
  if (!isSignedIn() || !navigator.onLine) return 0;
  if (dbState.setup && !first) return 0; // eerst kiezen: vervangen of samenvoegen
  if (status.syncing) { again = true; return 0; }
  status.syncing = true;
  status.error = '';
  emit();
  let received = 0;
  try {
    let changes = pullOnly ? [] : diff();
    do {
      const r = await call('sync', { cursor: dbState.cursor, changes: changes.map(({ c, id, d, del }) => (del ? { c, id, del: true } : { c, id, d })) });
      for (const ch of changes) { const k = K(ch.c, ch.id); if (ch.del) delete dbState.hashes[k]; else dbState.hashes[k] = ch.h; }
      if (r.changes.length) {
        store.update((s) => { for (const ch of r.changes) applyRemote(s, ch); });
        // Hash van de versie zoals die nu lokaal staat, zodat binnengekomen records niet terug worden gestuurd.
        const snap = snapshot();
        for (const ch of r.changes) {
          const k = K(ch.c, ch.id);
          const cur = snap.get(k);
          if (ch.del && !cur) delete dbState.hashes[k];
          else if (cur) dbState.hashes[k] = hash(cur.d);
        }
        received += r.changes.length;
      }
      dbState.cursor = r.cursor;
      dbState.claude = !!r.claude;
      saveState();
      changes = [];
      if (!r.more) break;
    } while (true);
    status.lastSync = new Date();
    if (received) receivers.forEach((fn) => fn(received));
  } catch (e) {
    status.error = e.message;
    throw e;
  } finally {
    status.syncing = false;
    emit();
    if (again) { again = false; schedule(500); }
  }
  return received;
}

function schedule(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), ms);
}

export async function login(username, password) {
  const r = await call('login', { username, password });
  try { localStorage.setItem(TOKEN_KEY, r.token); } catch {}
  dbState = { cursor: 0, user: r.user, hashes: {}, setup: true, mustChange: !!r.mustChange };
  saveState();
  const me = await call('me');
  dbState.claude = !!me.claude;
  dbState.admin = !!me.admin;
  saveState();
  return me;
}

function clearLocalData() {
  store.update((s) => {
    for (const c of Object.keys(ARRAYS)) s[c] = [];
    for (const c of MAPS) s[c] = {};
    s.pinned = [];
  });
}

// Na het aanmelden: gegevens van de server overnemen (lokaal vervangen) of samenvoegen.
export async function firstSync(mode) {
  if (mode === 'replace') clearLocalData();
  await syncNow({ pullOnly: true, first: true }); // bij gelijke sleutel wint de server
  delete dbState.setup;
  saveState();
  return syncNow(); // daarna alleen wat lokaal nieuw is naar de server
}

function signOutLocal() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  dbState = { cursor: 0, user: '', hashes: {} };
  saveState();
  emit();
}

// Afmelden: eerst versturen wat nog openstaat, dan de klantgegevens van dit apparaat wissen
// (de server heeft ze), zodat de volgende gebruiker opnieuw moet inloggen.
export async function logout({ keepData = false } = {}) {
  if (!dbState.setup) { try { await syncNow(); } catch {} }
  // Niet-verzonden wijzigingen (bv. offline) nooit weggooien: dan blijven de gegevens staan.
  const unsent = dbState.setup ? 0 : pendingCount();
  try { await call('logout'); } catch {}
  signOutLocal();
  if (!keepData && !unsent) clearLocalData();
  return { unsent };
}

// Automatisch: kort na elke wijziging, elke minuut, bij online komen en bij terugkeren naar de app.
export function start() {
  store.subscribe(() => { if (isSignedIn()) { emit(); schedule(); } });
  setInterval(() => syncNow().catch(() => {}), 60000);
  window.addEventListener('online', () => schedule(200));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(200); });
  if (isSignedIn()) schedule(300);
}

export { signOutLocal };
