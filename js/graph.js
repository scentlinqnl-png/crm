// Microsoft 365-koppeling: aanmelden (OAuth2 + PKCE, zonder extra libraries) en
// Klantkaart.xlsx in SharePoint lezen/bijwerken via de Microsoft Graph Excel-API.

import { store, parseBlad1, parseVerbruik, parseAfstanden, mergeWorkbook, isoToSerial, mergeById, CRM_SHEETS, crmFromRows } from './store.js';

const TOKEN_KEY = 'klantkaart.token';
const PKCE_KEY = 'klantkaart.pkce';
const SCOPES = 'openid profile offline_access User.Read Files.ReadWrite.All Sites.ReadWrite.All';

const cfg = () => store.get().settings.m365;
export const authRedirectUri = () => new URL('auth.html', location.href).href.split('?')[0];
const authority = () => `https://login.microsoftonline.com/${cfg().tenant || 'organizations'}/oauth2/v2.0`;

export const inTeams = () => {
  try { return window.self !== window.top; } catch { return true; }
};

// ---------- tokens ----------

function readToken() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; }
}
export function saveToken(t) {
  const tok = { ...t, expires_at: Date.now() + (t.expires_in - 60) * 1000 };
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(tok)); } catch {}
  return tok;
}
export function signOut() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}
export const isSignedIn = () => !!readToken();

async function refresh(tok) {
  const body = new URLSearchParams({
    client_id: cfg().clientId,
    grant_type: 'refresh_token',
    refresh_token: tok.refresh_token,
    scope: SCOPES,
  });
  const r = await fetch(`${authority()}/token`, { method: 'POST', body });
  if (!r.ok) { signOut(); throw new Error('Sessie verlopen, meld opnieuw aan.'); }
  return saveToken(await r.json());
}

async function accessToken() {
  let tok = readToken();
  if (!tok) throw new Error('Niet aangemeld bij Microsoft 365.');
  if (Date.now() > tok.expires_at) tok = await refresh(tok);
  return tok.access_token;
}

// ---------- PKCE ----------

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n = 64) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function buildAuthorizeUrl(clientId = cfg().clientId, tenant = cfg().tenant || 'organizations') {
  if (!clientId) throw new Error('Vul eerst de Client ID in (Instellingen → Microsoft 365).');
  const verifier = randomString();
  const state = randomString(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, clientId, tenant }));
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: authRedirectUri(),
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${p}`;
}

// Wordt aangeroepen op auth.html na terugkomst van de Microsoft-aanmeldpagina.
export async function exchangeCode(params) {
  const pk = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null');
  if (!pk || pk.state !== params.get('state')) throw new Error('Ongeldige aanmeldstatus, probeer opnieuw.');
  const body = new URLSearchParams({
    client_id: pk.clientId,
    grant_type: 'authorization_code',
    code: params.get('code'),
    redirect_uri: authRedirectUri(),
    code_verifier: pk.verifier,
    scope: SCOPES,
  });
  const r = await fetch(`https://login.microsoftonline.com/${pk.tenant || 'organizations'}/oauth2/v2.0/token`, { method: 'POST', body });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error_description || 'Aanmelden mislukt');
  localStorage.removeItem(PKCE_KEY);
  return json;
}

// In de browser: volledige redirect. In Teams: Teams opent een eigen aanmeldvenster.
export async function signIn() {
  if (inTeams() && window.microsoftTeams) {
    await window.microsoftTeams.app.initialize();
    const url = new URL('auth.html?start=1', location.href);
    url.searchParams.set('cid', cfg().clientId);
    url.searchParams.set('tenant', cfg().tenant || 'organizations');
    const result = await window.microsoftTeams.authentication.authenticate({ url: url.href, width: 600, height: 640 });
    saveToken(JSON.parse(result));
    return;
  }
  sessionStorage.setItem('klantkaart.returnTo', location.hash || '#/instellingen');
  location.href = await buildAuthorizeUrl();
}

// ---------- Graph ----------

async function graph(path, opts = {}) {
  const token = await accessToken();
  const r = await fetch(path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { msg = (await r.json()).error?.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}

export async function me() {
  return graph('/me?$select=displayName,mail,userPrincipalName');
}

let itemCache = null;
async function workbookBase() {
  const c = cfg();
  const key = `${c.host}|${c.sitePath}|${c.filePath}`;
  if (itemCache?.key === key) return itemCache.base;
  const site = await graph(`/sites/${c.host}:${c.sitePath}?$select=id`);
  const path = c.filePath.split('/').map(encodeURIComponent).join('/');
  const item = await graph(`/sites/${site.id}/drive/root:/${path}?$select=id,parentReference`);
  const base = `/drives/${item.parentReference.driveId}/items/${item.id}/workbook`;
  itemCache = { key, base };
  return base;
}

const ws = (name) => `/worksheets('${encodeURIComponent(name)}')`;

async function usedValues(base, sheet) {
  try {
    const r = await graph(`${base}${ws(sheet)}/usedRange(valuesOnly=true)?$select=address,values`);
    // usedRange begint niet altijd op A1: vul aan tot absolute rijen/kolommen
    const m = r.address.split('!')[1].match(/^\$?([A-Z]+)\$?(\d+)/);
    const rowOff = m ? Number(m[2]) - 1 : 0;
    const colOff = m ? m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : 0;
    return [...Array(rowOff).fill([]), ...r.values.map((row) => [...Array(colOff).fill(''), ...row])];
  } catch (e) {
    if (sheet === 'Afstanden') return [];
    throw e;
  }
}

export async function pull() {
  const base = await workbookBase();
  const [b1, vb, af] = await Promise.all([usedValues(base, 'Blad1'), usedValues(base, 'Verbruik'), usedValues(base, 'Afstanden')]);
  mergeWorkbook({ customers: parseBlad1(b1), visits: parseVerbruik(vb), afstanden: parseAfstanden(af) }, 'm365');
}

async function firstEmptyRow(base, sheet, col, from, to) {
  const r = await graph(`${base}${ws(sheet)}/range(address='${col}${from}:${col}${to}')?$select=values`);
  const idx = r.values.findIndex((row) => row[0] === '' || row[0] === null);
  if (idx === -1) throw new Error(`Geen vrije regel meer in ${sheet}!${col}${from}:${col}${to}`);
  return from + idx;
}

// Schrijft alle lokale, nog niet gesynchroniseerde klanten en bezoeken weg.
export async function push() {
  const s = store.get();
  const base = await workbookBase();
  let done = 0;

  for (const c of s.customers.filter((x) => x.pending)) {
    const row = await firstEmptyRow(base, 'Blad1', 'B', 4, 172);
    await graph(`${base}${ws('Blad1')}/range(address='A${row}:F${row}')`, {
      method: 'PATCH',
      body: JSON.stringify({ values: [[c.nr, c.naam, c.adres, c.postcode, c.plaats, c.telefoon]] }),
    });
    store.update(() => { c.pending = false; c.row = row; });
    done++;
  }

  for (const c of s.customers.filter((x) => x.dirty && !x.pending && x.row)) {
    await graph(`${base}${ws('Blad1')}/range(address='B${c.row}:F${c.row}')`, {
      method: 'PATCH',
      body: JSON.stringify({ values: [[c.naam, c.adres, c.postcode, c.plaats, c.telefoon]] }),
    });
    store.update(() => { c.dirty = false; });
    done++;
  }

  for (const v of s.visits.filter((x) => x.pending)) {
    const row = await firstEmptyRow(base, 'Verbruik', 'B', 4, 1000);
    // Kolom C (Klantnaam) is een formule; null laat die cel ongemoeid.
    await graph(`${base}${ws('Verbruik')}/range(address='A${row}:G${row}')`, {
      method: 'PATCH',
      body: JSON.stringify({ values: [[isoToSerial(v.datum), v.nr, null, Number(v.ml) || 0, v.opmerking || '', v.geur || '', v.instellingen || '']] }),
    });
    await graph(`${base}${ws('Verbruik')}/range(address='A${row}')`, {
      method: 'PATCH',
      body: JSON.stringify({ numberFormat: [['yyyy-mm-dd']] }),
    });
    store.update(() => { v.pending = false; v.row = row; v.id = 'row' + row; });
    done++;
  }
  return done;
}

// ---------- pipeline & activiteiten in extra tabbladen ----------

const colLetter = (n) => String.fromCharCode(64 + n);

async function ensureSheet(base, name) {
  try {
    await graph(`${base}${ws(name)}?$select=name`);
  } catch {
    await graph(`${base}/worksheets/add`, { method: 'POST', body: JSON.stringify({ name }) });
  }
}

async function syncCrm(base) {
  for (const [key, def] of Object.entries(CRM_SHEETS)) {
    await ensureSheet(base, def.name);
    const rows = await usedValues(base, def.name);
    const remote = crmFromRows(key, rows);
    const merged = mergeById(store.get()[key], remote);
    store.update((s) => {
      s[key] = merged;
      // Ticketnummers blijven uniek over apparaten heen.
      if (key === 'quotes') s.quoteSeq = Math.max(s.quoteSeq || 0, ...merged.map((q) => parseInt(String(q.code || '').slice(2), 10) || 0));
      if (key === 'tickets') s.ticketSeq = Math.max(s.ticketSeq || 0, ...merged.map((t) => parseInt(String(t.code || '').slice(2), 10) || 0));
    });
    const values = [def.cols, ...merged.map((o) => def.cols.map((c) => (o[c] === null || o[c] === undefined ? '' : Array.isArray(o[c]) ? o[c].join(',') : o[c])))];
    const addr = `A1:${colLetter(def.cols.length)}${values.length}`;
    // Datum/tijd als tekst bewaren zodat Excel ze niet omzet.
    await graph(`${base}${ws(def.name)}/range(address='${addr}')`, {
      method: 'PATCH',
      body: JSON.stringify({ numberFormat: values.map((r) => r.map(() => '@')), values }),
    });
  }
}

export async function sync() {
  const pushed = await push();
  await pull();
  await syncCrm(await workbookBase());
  return pushed;
}
