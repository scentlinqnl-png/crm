import {
  store, stats, statFor, customer, nextKlantnr, kmFor, minFor, todayISO, daysBetween, fullAddress, knownGeuren,
  uid, now, ACTIVITY_TYPES, openActivities, openDeals, dealsWithoutNextStep, norm,
  profile, saveProfile, ketenLocaties, adviseSystem, refillForecast, refillsDue,
  openTickets, contractsEndingSoon, mrr, contactsFor, createMaintenanceTickets,
} from './store.js';
import { planDay, mapsRouteUrl, mapsRouteUrls, planFromSelection } from './planner.js';
import * as m365 from './graph.js';
import { importWorkbook, exportBackup, exportMyMaps, verbruikTSV, nextVerbruikRow, exportJsonBackup, restoreJsonBackup } from './excel.js';
import { geocodePlaces, missingPlaces, distanceFromStart } from './geo.js';
import { loadDemo } from './demo.js';
import { seedStock } from './stock.js';
import { calcQuote, saveQuote, setQuoteStatus, acceptQuote, QUOTE_STATUS, LEASE_MND } from './quotes.js';
import { shareOrDownloadQuote } from './report.js';
import { viewImport } from './import.js';
import { viewService, ticketItem, bindTicketList, ticketDialog } from './service.js';
import { viewRapport, klantCrmHead, klantCrmSections, bindKlantCrm, crmTimeline } from './crm.js';
import { planWithClaude, klantBriefing, claudeReady, claudeConfigured, pageSample, getClaudeKey, setClaudeKey, resetClaudeClient, CLAUDE_MODEL } from './claude.js';

import {
  $, $$, dialog, h, eur, ml, fmtDate, klassBadge, telHref, navHref, toast, weekStart, nextWorkday,
  klantOptions, formData, openDialog, ask, hooks,
} from './ui.js';

const view = $('#view');

function startDemo() {
  loadDemo();
  seedStock();
  createMaintenanceTickets();
  const today = todayISO();
  const plan = planDay({ datum: today });
  store.update((s) => { s.plans[today] = plan; });
  toast('Voorbeeldgegevens geladen (fictieve klanten)');
  render();
}

// Standalone is de standaard. Alleen na een Excel-import of Microsoft 365-koppeling tonen we Excel-teksten.
const excelMode = () => m365.isSignedIn() || ['import', 'm365'].includes(store.get().source);

// ---------- synchronisatie ----------

let syncing = false;
function pendingCount() {
  const s = store.get();
  return s.visits.filter((v) => v.pending).length + s.customers.filter((c) => c.pending || c.dirty).length;
}

function renderSyncChip() {
  const btn = $('#syncBtn');
  const p = pendingCount();
  btn.hidden = false;
  if (!excelMode()) {
    btn.classList.remove('warn');
    btn.textContent = 'Op dit apparaat';
    return;
  }
  btn.classList.toggle('warn', p > 0);
  if (syncing) btn.textContent = '⟳ Synchroniseren…';
  else if (!navigator.onLine) btn.textContent = `Offline${p ? ` · ${p} wachtend` : ''}`;
  else if (!m365.isSignedIn()) btn.textContent = p ? `${p} lokaal` : 'Lokaal';
  else btn.textContent = p ? `⟳ ${p} te syncen` : '✓ Gesynct';
}

async function runSync({ quiet = false } = {}) {
  if (syncing || !m365.isSignedIn() || !navigator.onLine) return;
  syncing = true;
  renderSyncChip();
  try {
    const n = await m365.sync();
    if (!quiet) toast(n ? `${n} wijziging(en) naar Klantkaart.xlsx geschreven` : 'Bijgewerkt vanuit Klantkaart.xlsx');
  } catch (e) {
    toast('Synchroniseren mislukt: ' + e.message, 5000);
  } finally {
    syncing = false;
    renderSyncChip();
    render();
  }
}

// ---------- thema (per apparaat onthouden) ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#themeBtn');
  if (btn) {
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    btn.setAttribute('aria-label', theme === 'light' ? 'Donker thema' : 'Licht thema');
  }
  $('meta[name=theme-color]')?.setAttribute('content', theme === 'light' ? '#f4f4f3' : '#0d0d0f');
}
let theme = 'dark';
try { theme = localStorage.getItem('klantkaart.theme') || 'dark'; } catch {}
applyTheme(theme);
$('#themeBtn')?.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('klantkaart.theme', theme); } catch {}
  applyTheme(theme);
});

$('#syncBtn').addEventListener('click', () => {
  if (m365.isSignedIn()) runSync();
  else location.hash = '#/meer';
});
window.addEventListener('online', () => { renderSyncChip(); runSync({ quiet: true }); });
window.addEventListener('offline', renderSyncChip);

// ---------- acties ----------

function saveVisit(v) {
  store.update((s) => {
    s.visits.push({ id: uid(), pending: true, ...v, ml: Number(v.ml) || 0 });
    // Een bezoek-activiteit voor deze klant op die dag telt als afgerond.
    s.activities
      .filter((a) => !a.done && a.type === 'bezoek' && String(a.nr) === String(v.nr) && a.datum <= v.datum)
      .forEach((a) => { a.done = true; a.updatedAt = now(); });
  });
  runSync({ quiet: true });
}

function activityDialog(pre = {}) {
  const a = { type: 'bellen', datum: todayISO(), tijd: '', titel: '', notitie: '', ...pre };
  openDialog(`
    <h2>${a.id ? 'Activiteit bewerken' : 'Nieuwe activiteit'}</h2>
    <label>Klant<select name="nr" required>${klantOptions(a.nr)}</select></label>
    <div class="chips-radio">
      ${Object.entries(ACTIVITY_TYPES).map(([k, lbl]) => `<label><input type="radio" name="type" value="${k}" ${a.type === k ? 'checked' : ''}><span>${lbl}</span></label>`).join('')}
    </div>
    <label>Omschrijving<input name="titel" value="${h(a.titel)}" placeholder="bijv. Offerte nabellen"></label>
    <div class="row2">
      <label>Datum<input type="date" name="datum" value="${h(a.datum)}" required></label>
      <label>Tijd<input type="time" name="tijd" value="${h(a.tijd)}"></label>
    </div>
    <label>Notitie<textarea name="notitie" rows="2">${h(a.notitie)}</textarea></label>
    <div class="actions">
      ${a.id ? '<button value="delete" class="btn danger ghost">Verwijderen</button>' : ''}
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Opslaan</button>
    </div>`, (d, action) => {
    store.update((s) => {
      if (a.id) {
        const x = s.activities.find((y) => y.id === a.id);
        if (action === 'delete') x.deleted = true;
        else Object.assign(x, d);
        x.updatedAt = now();
      } else {
        s.activities.push({ id: uid(), done: false, deleted: false, ...d, titel: d.titel || ACTIVITY_TYPES[d.type].replace(/^\S+\s/, ''), updatedAt: now() });
      }
    });
    toast('Activiteit opgeslagen');
    render();
    runSync({ quiet: true });
  });
}

function completeActivity(id) {
  let act;
  store.update((s) => {
    act = s.activities.find((a) => a.id === id);
    act.done = true;
    act.updatedAt = now();
  });
  render();
  runSync({ quiet: true });
  // Proefplaatsing-tracker: na plaatsen automatisch een reminder om feedback op te halen.
  if (act.type === 'demo') {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    store.update((s) => {
      s.activities.push({ id: uid(), nr: act.nr, type: 'followup', titel: 'Feedback proefplaatsing ophalen', datum: todayISO(d), tijd: '', notitie: act.titel, done: false, deleted: false, updatedAt: now() });
    });
    toast('Feedback-reminder over 7 dagen ingepland');
    render();
    return;
  }
  // Pipedrive-principe: na afronden direct de volgende stap plannen als er een open deal is.
  const hasDeal = openDeals().some((d) => String(d.nr) === String(act.nr));
  if (hasDeal && !openActivities(act.nr).length) {
    toast('Plan meteen de volgende stap voor deze deal');
    const d = new Date();
    d.setDate(d.getDate() + 3);
    activityDialog({ nr: act.nr, type: 'followup', datum: todayISO(d) });
  }
}

function dealDialog(pre = {}) {
  const s = store.get();
  const d = { fase: s.settings.fases[0], waarde: '', titel: '', ...pre };
  openDialog(`
    <h2>${d.id ? 'Deal bewerken' : 'Nieuwe deal'}</h2>
    <label>Klant<select name="nr" required>${klantOptions(d.nr)}</select></label>
    <label>Titel<input name="titel" value="${h(d.titel)}" placeholder="bijv. Geurmachine + abonnement" required></label>
    <div class="row2">
      <label>Waarde (€ / jaar)<input name="waarde" type="number" inputmode="decimal" min="0" step="1" value="${h(d.waarde)}"></label>
      <label>Fase<select name="fase">${s.settings.fases.map((f) => `<option ${f === d.fase ? 'selected' : ''}>${h(f)}</option>`).join('')}</select></label>
    </div>
    <div class="actions">
      ${d.id ? '<button value="lost" class="btn ghost danger">Verloren</button><button value="won" class="btn ghost ok">Gewonnen</button>' : ''}
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Opslaan</button>
    </div>`, (f, action) => {
    let nr = f.nr;
    store.update((st) => {
      if (d.id) {
        const x = st.deals.find((y) => y.id === d.id);
        Object.assign(x, f, { waarde: Number(f.waarde) || 0, updatedAt: now() });
        if (action === 'won' || action === 'lost') {
          x.status = action === 'won' ? 'gewonnen' : 'verloren';
          x.gesloten = todayISO();
        }
      } else {
        st.deals.push({ id: uid(), status: 'open', gesloten: '', deleted: false, ...f, waarde: Number(f.waarde) || 0, updatedAt: now() });
      }
    });
    toast(action === 'won' ? '🎉 Deal gewonnen!' : 'Deal opgeslagen');
    render();
    runSync({ quiet: true });
    if (action === 'save' && !openActivities(nr).length) {
      activityDialog({ nr, type: 'followup', titel: 'Volgende stap: ' + f.titel });
    }
  });
}

// ---------- views ----------

function emptyState() {
  return `
    <section class="card empty">
      <h2>Welkom bij Klantkaart</h2>
      <p>Begin met je eerste klant. Alles wordt op dit apparaat bewaard; je hebt geen Excel of ander programma nodig.</p>
      <div class="actions" style="justify-content:center">
        <a class="btn primary" href="#/klant/nieuw">+ Eerste klant toevoegen</a>
        <button class="btn" type="button" data-demo>Bekijk met voorbeeldgegevens</button>
      </div>
      <p class="muted small">Heb je al een klantenlijst? Zet die over via <a href="#/meer">Meer › Gegevens overzetten</a> (Excel of een back-up).</p>
    </section>`;
}

function activityItem(a, { showKlant = true } = {}) {
  const c = customer(a.nr);
  const late = a.datum < todayISO();
  return `
    <li class="act ${late ? 'late' : ''}">
      <button class="check" data-done="${h(a.id)}" aria-label="Afronden"></button>
      <div class="grow" data-edit-act="${h(a.id)}">
        <div class="t">${h(ACTIVITY_TYPES[a.type]?.split(' ')[0] || '•')} ${h(a.titel)}</div>
        <div class="sub">${showKlant && c ? `<a href="#/klant/${h(c.nr)}">${h(c.naam)}</a> · ` : ''}${late ? 'te laat · ' : ''}${fmtDate(a.datum)}${a.tijd ? ' ' + h(a.tijd) : ''}</div>
      </div>
    </li>`;
}

function bindActivityList(root) {
  $$('[data-done]', root).forEach((b) => b.addEventListener('click', () => completeActivity(b.dataset.done)));
  $$('[data-edit-act]', root).forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const a = store.get().activities.find((x) => x.id === el.dataset.editAct);
    activityDialog(a);
  }));
}

function viewVandaag() {
  const s = store.get();
  if (!s.customers.length) return emptyState();
  const all = stats();
  const today = todayISO();
  const ws = weekStart();
  const month = today.slice(0, 7);
  const weekVisits = s.visits.filter((v) => v.datum >= ws && v.datum <= today).length;
  const monthMl = s.visits.filter((v) => v.datum.startsWith(month)).reduce((t, v) => t + (Number(v.ml) || 0), 0);
  const pipeline = openDeals().reduce((t, d) => t + (d.waarde || 0), 0);
  const won = s.deals.filter((d) => d.status === 'gewonnen' && (d.gesloten || '').startsWith(month) && !d.deleted);
  const acts = openActivities();
  const late = acts.filter((a) => a.datum < today);
  const todays = acts.filter((a) => a.datum === today);
  const soon = acts.filter((a) => a.datum > today).slice(0, 8);
  const noStep = dealsWithoutNextStep();
  const plan = s.plans[today];
  const loggedToday = new Set(s.visits.filter((v) => v.datum === today).map((v) => String(v.nr)));
  const pct = (a, b) => Math.min(100, Math.round((a / (b || 1)) * 100));

  return `
    <h1>Goedendag 👋 <small>${fmtDate(today)}</small></h1>
    <section class="kpis">
      <div class="kpi"><span>Bezoeken deze week</span><b>${weekVisits}<small>/${s.settings.doelBezoekenWeek}</small></b><i style="--p:${pct(weekVisits, s.settings.doelBezoekenWeek)}%"></i></div>
      <div class="kpi"><span>Verbruik deze maand</span><b>${ml(monthMl)}</b><i style="--p:${pct(monthMl, s.settings.doelVerbruikMaand)}%"></i></div>
      <div class="kpi"><span>Open pipeline</span><b>${eur(pipeline)}</b><small>${openDeals().length} deals · <a href="#/rapport">MRR ${eur(mrr())}</a></small></div>
      <div class="kpi"><span>Gewonnen deze maand</span><b>${eur(won.reduce((t, d) => t + d.waarde, 0))}</b><small>${won.length} deals</small></div>
    </section>

    ${!excelMode() && s.source !== 'demo' && s.customers.length && (!s.lastBackup || daysBetween(s.lastBackup.slice(0, 10), today) > 7) ? `<a class="alert" href="#/meer">💾 ${s.lastBackup ? `Laatste back-up is ${daysBetween(s.lastBackup.slice(0, 10), today)} dagen oud` : 'Je hebt nog geen back-up gemaakt'}. Maak er een via Meer.</a>` : ''}
    ${noStep.length ? `<a class="alert" href="#/pipeline">⚠️ ${noStep.length} open deal(s) zonder volgende activiteit — plan een vervolgstap.</a>` : ''}

    <section class="card">
      <div class="card-head"><h2>Route vandaag</h2><a class="btn small" href="#/planning">${plan ? 'Wijzigen' : 'Plan dag'}</a></div>
      ${plan ? `
        <ol class="route">
          ${plan.stops.map((st) => {
            const c = customer(st.nr);
            if (!c) return '';
            const done = loggedToday.has(String(c.nr));
            return `<li class="${done ? 'done' : ''}">
              <time>${h(st.aankomst)}</time>
              <div class="grow"><a href="#/klant/${h(c.nr)}"><b>${h(c.naam)}</b></a><div class="sub">${h(fullAddress(c))}</div></div>
              ${done ? '<span class="badge k-normaal">✓ gelogd</span>' : `<a class="btn small" href="#/bezoek?nr=${h(c.nr)}">Log</a>`}
            </li>`;
          }).join('')}
        </ol>
        <div class="actions left">
          <a class="btn" href="${h(mapsRouteUrl(plan))}" target="_blank" rel="noopener">🧭 Navigeer route</a>
          <a class="btn primary" href="#/dag">Dag afsluiten</a>
        </div>` : '<p class="muted">Nog geen route voor vandaag.</p>'}
    </section>

    ${(() => {
      const open = openTickets();
      const vandaag = open.filter((t) => t.datum === today);
      const spoed = open.filter((t) => t.prioriteit === 'spoed');
      if (!open.length) return '';
      return `<section class="card">
        <div class="card-head"><h2>🔧 Service</h2><a class="btn small" href="#/service?tab=route&d=${today}">Route vandaag</a></div>
        <p class="muted small">${open.length} open tickets · ${vandaag.length} vandaag · ${spoed.length} spoed</p>
        <ul class="list tickets">${[...spoed, ...vandaag.filter((t) => t.prioriteit !== 'spoed')].slice(0, 5).map((t) => ticketItem(t)).join('')}</ul>
      </section>`;
    })()}
    ${(() => {
      const ending = contractsEndingSoon(30);
      return ending.length ? `<a class="alert" href="#/rapport">📄 ${ending.length} contract(en) lopen binnen 30 dagen af — tijd om te verlengen.</a>` : '';
    })()}

    <section class="card">
      <div class="card-head"><h2>Activiteiten</h2><button class="btn small" id="newAct">+ Activiteit</button></div>
      ${!acts.length ? '<p class="muted">Geen openstaande activiteiten.</p>' : ''}
      ${late.length ? `<h3 class="late-h">Te laat (${late.length})</h3><ul class="acts">${late.map((a) => activityItem(a)).join('')}</ul>` : ''}
      ${todays.length ? `<h3>Vandaag</h3><ul class="acts">${todays.map((a) => activityItem(a)).join('')}</ul>` : ''}
      ${soon.length ? `<h3>Binnenkort</h3><ul class="acts">${soon.map((a) => activityItem(a)).join('')}</ul>` : ''}
    </section>

    ${(() => {
      const due = refillsDue();
      if (!due.length) return '';
      return `<section class="card">
        <div class="card-head"><h2>🧴 Navullen binnenkort</h2><a class="btn small" href="#/planning">Inplannen</a></div>
        <ul class="list compact">${due.slice(0, 8).map(({ c, f }) => `<li><a href="#/klant/${h(c.nr)}"><b>${h(c.naam)}</b><span class="sub">${h(c.plaats)} · ${f.dagenResterend < 0 ? `waarschijnlijk leeg sinds ${-f.dagenResterend} d` : `leeg rond ${fmtDate(f.leeg)}`} · ${Math.round(f.perDag)} ml/dag</span></a><span class="badge ${f.dagenResterend < 0 ? 'k-weinig' : 'k-veel'}">${f.dagenResterend < 0 ? 'leeg' : f.dagenResterend + ' d'}</span></li>`).join('')}</ul>
      </section>`;
    })()}

    <section class="card">
      <h2>Aandacht nodig</h2>
      <ul class="list compact">
        ${s.customers
          .map((c) => ({ c, st: statFor(all, c.nr) }))
          .filter((x) => x.st.bezoeken && (x.st.classificatie === 'Weinig' || daysBetween(x.st.laatste, today) > 60))
          .sort((a, b) => a.st.laatste.localeCompare(b.st.laatste))
          .slice(0, 6)
          .map(({ c, st }) => `<li><a href="#/klant/${h(c.nr)}"><b>${h(c.naam)}</b><span class="sub">${h(c.plaats)} · ${daysBetween(st.laatste, today)} dagen geleden</span></a>${klassBadge(st.classificatie)}</li>`)
          .join('') || '<li class="muted">Niets bijzonders — alle bezochte klanten zijn recent gezien.</li>'}
      </ul>
    </section>`;
}
viewVandaag.after = () => {
  $('#newAct')?.addEventListener('click', () => activityDialog());
  bindTicketList(view);
  bindActivityList(view);
};

let klantFilter = { q: '', filter: 'alle', sort: 'naam', sector: '' };
function viewKlanten() {
  const s = store.get();
  if (!s.customers.length) return emptyState();
  return `
    <div class="searchbar">
      <input type="search" id="q" placeholder="Zoek op naam, plaats, postcode…" value="${h(klantFilter.q)}" autocomplete="off">
      <select id="sort" aria-label="Sorteren">
        ${[['naam', 'Naam'], ['afstand', 'Afstand'], ['laatste', 'Langst niet bezocht'], ['verbruik', 'Verbruik']].map(([k, l]) => `<option value="${k}" ${klantFilter.sort === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <select id="sector" class="sector-filter" aria-label="Sector">
      <option value="">Alle sectoren</option>${s.settings.sectoren.map((x) => `<option ${klantFilter.sector === x ? 'selected' : ''}>${h(x)}</option>`).join('')}<option value="-" ${klantFilter.sector === '-' ? 'selected' : ''}>Zonder sector</option>
    </select>
    <div class="chips" id="filters">
      ${[['alle', 'Alle'], ['nooit', 'Nooit bezocht'], ['navullen', 'Navullen'], ['weinig', 'Weinig'], ['normaal', 'Normaal'], ['veel', 'Veel'], ['deal', 'Met open deal']].map(([k, l]) => `<button class="chip ${klantFilter.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
    </div>
    <ul class="list" id="klantList"></ul>
    <a class="fab" href="#/klant/nieuw" aria-label="Nieuwe klant">+</a>`;
}
viewKlanten.after = () => {
  const all = stats();
  const today = todayISO();
  const dealNrs = new Set(openDeals().map((d) => String(d.nr)));
  const draw = () => {
    const q = norm(klantFilter.q);
    let rows = store.get().customers.map((c) => ({ c, st: statFor(all, c.nr), p: profile(c.nr) }));
    if (q) rows = rows.filter(({ c, p }) => [c.naam, c.plaats, c.postcode, c.adres, c.nr, p.keten, p.contactpersoon, p.geurprofiel, p.labels, ...contactsFor(c.nr).map((x) => x.naam)].some((f) => norm(f).includes(q)));
    if (klantFilter.sector === '-') rows = rows.filter((x) => !x.p.sector);
    else if (klantFilter.sector) rows = rows.filter((x) => x.p.sector === klantFilter.sector);
    const f = klantFilter.filter;
    const due = f === 'navullen' ? new Set(refillsDue().map((x) => String(x.c.nr))) : null;
    if (f === 'nooit') rows = rows.filter((x) => !x.st.bezoeken);
    else if (due) rows = rows.filter((x) => due.has(String(x.c.nr)));
    else if (f === 'deal') rows = rows.filter((x) => dealNrs.has(String(x.c.nr)));
    else if (f !== 'alle') rows = rows.filter((x) => norm(x.st.classificatie) === f);
    const sorters = {
      naam: (a, b) => a.c.naam.localeCompare(b.c.naam),
      afstand: (a, b) => (a.c.km ?? 9999) - (b.c.km ?? 9999),
      laatste: (a, b) => (a.st.laatste || '0000').localeCompare(b.st.laatste || '0000'),
      verbruik: (a, b) => (b.st.gem ?? -1) - (a.st.gem ?? -1),
    };
    rows.sort(sorters[klantFilter.sort]);
    $('#klantList').innerHTML = rows.slice(0, 300).map(({ c, st, p }) => `
      <li><a href="#/klant/${h(c.nr)}">
        <b>${h(c.naam)} ${c.pending ? '<span class="badge">nieuw</span>' : ''}</b>
        <span class="sub">${p.sector ? `${h(p.sector)} · ` : ''}${p.keten ? `🏢 ${h(p.keten)} · ` : ''}${h(c.plaats || '–')}${c.km !== null && c.km !== undefined ? ` · ${h(c.km)} km` : ''} · ${st.laatste ? `${daysBetween(st.laatste, today)} d geleden` : 'nooit bezocht'}</span>
      </a>${dealNrs.has(String(c.nr)) ? '<span class="badge deal">deal</span>' : ''}${klassBadge(st.classificatie)}</li>`).join('') || '<li class="muted">Geen klanten gevonden.</li>';
  };
  draw();
  $('#q').addEventListener('input', (e) => { klantFilter.q = e.target.value; draw(); });
  $('#sort').addEventListener('change', (e) => { klantFilter.sort = e.target.value; draw(); });
  $('#sector').addEventListener('change', (e) => { klantFilter.sector = e.target.value; draw(); });
  $$('#filters .chip').forEach((b) => b.addEventListener('click', () => {
    klantFilter.filter = b.dataset.f;
    $$('#filters .chip').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
};

function viewKlant(nr) {
  const c = customer(nr);
  if (!c) return '<p class="card">Klant niet gevonden.</p>';
  const s = store.get();
  const all = stats();
  const st = statFor(all, nr);
  const visits = s.visits.filter((v) => String(v.nr) === String(nr));
  const deals = s.deals.filter((d) => String(d.nr) === String(nr) && !d.deleted);
  const acts = s.activities.filter((a) => String(a.nr) === String(nr) && !a.deleted);
  const tel = telHref(c.telefoon);
  const p = profile(nr);
  const adv = adviseSystem(p);
  const fc = refillForecast(nr);
  const locaties = ketenLocaties(nr);

  const timeline = [
    ...visits.map((v) => ({ d: v.datum, html: `🌸 <b>Bezoek</b> · ${ml(v.ml)}${v.geur ? ` · ${h(v.geur)}` : ''}${v.instellingen ? ` · ${h(v.instellingen)}` : ''}${v.opmerking ? `<div class="sub">${h(v.opmerking)}</div>` : ''}${v.pending && excelMode() ? ' <span class="badge">nog niet in Excel</span>' : ''}` })),
    ...acts.filter((a) => a.done).map((a) => ({ d: a.datum, html: `${h(ACTIVITY_TYPES[a.type]?.split(' ')[0] || '✅')} ${h(a.titel)}${a.notitie ? `<div class="sub">${h(a.notitie)}</div>` : ''}` })),
    ...crmTimeline(nr),
    ...deals.filter((d) => d.gesloten).map((d) => ({ d: d.gesloten, html: `${d.status === 'gewonnen' ? '🏆' : '✖️'} Deal ${h(d.status)}: ${h(d.titel)} (${eur(d.waarde)})` })),
  ].sort((a, b) => b.d.localeCompare(a.d));

  return `
    <a class="back" href="#/klanten">‹ Klanten</a>
    <section class="card hero">
      <div class="card-head"><div><h1>${h(c.naam)}</h1><div class="sub">Klantnr. ${h(c.nr)} · ${h(c.plaats)}</div></div>${klassBadge(st.classificatie)}</div>
      ${klantCrmHead(nr)}
      <div class="quick">
        ${tel ? `<a class="btn" href="${h(tel)}">📞 Bellen</a>` : ''}
        <a class="btn" href="${h(navHref(c))}" target="_blank" rel="noopener">🧭 Route</a>
        <a class="btn primary" href="#/bezoek?nr=${h(c.nr)}">+ Bezoek</a>
        ${claudeReady() ? '<button class="btn" id="briefing">✨ Briefing</button>' : ''}
        <button class="btn" id="pin">${s.pinned.map(String).includes(String(c.nr)) ? '📌 Ingepland' : '📌 Inplannen'}</button>
      </div>
      <dl class="details">
        <dt>Adres</dt><dd>${h(c.adres) || '–'}<br>${h(c.postcode)} ${h(c.plaats)}</dd>
        <dt>Telefoon</dt><dd>${h(c.telefoon) || '–'}</dd>
        <dt>Afstand</dt><dd>${c.km ?? '–'} km · ca. ${c.min ?? '–'} min</dd>
      </dl>
    </section>

    <section class="kpis">
      <div class="kpi"><span>Bezoeken</span><b>${st.bezoeken}</b></div>
      <div class="kpi"><span>Totaal verbruik</span><b>${ml(st.totaal)}</b></div>
      <div class="kpi"><span>Gem. per bezoek</span><b>${ml(st.gem)}</b><small>alle klanten: ${ml(all.gemAlle)}</small></div>
      <div class="kpi"><span>Laatste bezoek</span><b>${st.laatste ? fmtDate(st.laatste) : 'nooit'}</b><small>${h(st.laatsteGeur)} ${h(st.laatsteInstellingen)}</small></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Profiel & geur-DNA</h2><button class="btn small" id="editProfile">Bewerken</button></div>
      <dl class="details">
        <dt>Sector</dt><dd>${h(p.sector) || '–'}</dd>
        <dt>Contact</dt><dd>${h(p.contactpersoon) || '–'}${p.email ? ` · <a href="mailto:${h(p.email)}">${h(p.email)}</a>` : ''}</dd>
        <dt>Geurprofiel</dt><dd>${h(p.geurprofiel) || h(st.laatsteGeur) || '–'}${p.sfeer ? ` <span class="sub">(${h(p.sfeer)})</span>` : ''}</dd>
        <dt>Ruimte</dt><dd>${p.m3 ? `${h(p.m3)} m³ · circulatie ${h(p.circulatie || 'normaal')}` : '–'}</dd>
        <dt>Systeem</dt><dd>${p.systeem ? `${p.aantal > 1 ? `${h(p.aantal)}× ` : ''}${h(p.systeem)}` : '–'}${adv && adv.systeem !== p.systeem ? `<div class="sub">Advies: ${h(adv.systeem)} · intensiteit ${h(adv.intensiteit)}</div>` : ''}</dd>
        <dt>Navullen</dt><dd>${fc ? `${Math.round(fc.perDag)} ml/dag · flacon ${h(fc.inhoud)} ml · <b class="${fc.dagenResterend < 0 ? 'late' : ''}">${fc.dagenResterend < 0 ? 'waarschijnlijk leeg' : 'leeg rond'} ${fmtDate(fc.leeg)}</b>` : '<span class="sub">voorspelling na 2 bezoeken met verbruik</span>'}</dd>
        ${p.keten ? `<dt>Keten</dt><dd>🏢 ${h(p.keten)}${locaties.length ? `<div class="sub">Andere locaties: ${locaties.map((l) => `<a href="#/klant/${h(l.nr)}">${h(l.naam)} (${h(l.plaats)})</a>`).join(', ')}</div>` : ''}</dd>` : ''}
      </dl>
      <div class="actions left"><a class="btn" href="#/offerte?nr=${h(c.nr)}">📄 Offerte maken</a><button class="btn" id="proef">🌸 Proefplaatsing</button></div>
    </section>

    ${klantCrmSections(nr)}

    <section class="card">
      <div class="card-head"><h2>Deals</h2><button class="btn small" id="newDeal">+ Deal</button></div>
      <ul class="list compact">
        ${deals.map((d) => `<li data-deal="${h(d.id)}" class="clickable"><div><b>${h(d.titel)}</b><span class="sub">${h(d.status === 'open' ? d.fase : d.status)} · ${eur(d.waarde)}</span></div></li>`).join('') || '<li class="muted">Geen deals.</li>'}
      </ul>
    </section>

    <section class="card">
      <div class="card-head"><h2>Volgende stappen</h2><button class="btn small" id="newAct">+ Activiteit</button></div>
      <ul class="acts">${openActivities(nr).map((a) => activityItem(a, { showKlant: false })).join('') || '<li class="muted">Geen geplande activiteiten.</li>'}</ul>
    </section>

    <section class="card">
      <h2>Notitie</h2>
      <textarea id="notitie" rows="3" placeholder="Contactpersoon, machine, bijzonderheden…">${h(c.notitie)}</textarea>
    </section>

    <section class="card">
      <h2>Tijdlijn</h2>
      <ul class="timeline">${timeline.map((t) => `<li><time>${fmtDate(t.d)}</time><div>${t.html}</div></li>`).join('') || '<li class="muted">Nog geen historie.</li>'}</ul>
    </section>

    <div class="actions left"><a class="btn ghost" href="#/klant/${h(c.nr)}/bewerk">Gegevens bewerken</a></div>`;
}
viewKlant.after = (nr) => {
  $('#newAct')?.addEventListener('click', () => activityDialog({ nr }));
  $('#newDeal')?.addEventListener('click', () => dealDialog({ nr }));
  $$('[data-deal]').forEach((el) => el.addEventListener('click', () => dealDialog(store.get().deals.find((d) => d.id === el.dataset.deal))));
  bindActivityList(view);
  $('#editProfile')?.addEventListener('click', () => profileDialog(nr));
  $('#briefing')?.addEventListener('click', () => briefingDialog(nr));
  bindKlantCrm(nr);
  $('#proef')?.addEventListener('click', () => activityDialog({ nr, type: 'demo', titel: 'Proefplaatsing ' + (profile(nr).geurprofiel || 'geursample') }));
  $('#pin')?.addEventListener('click', () => {
    store.update((s) => {
      const k = String(nr);
      s.pinned = s.pinned.map(String).includes(k) ? s.pinned.filter((x) => String(x) !== k) : [...s.pinned, k];
    });
    toast(store.get().pinned.map(String).includes(String(nr)) ? 'Komt mee in de volgende dagplanning' : 'Uit planning gehaald');
    render();
  });
  $('#notitie')?.addEventListener('change', (e) => {
    store.update(() => { customer(nr).notitie = e.target.value; });
    toast('Notitie opgeslagen');
  });
};

function viewKlantForm(nr) {
  const c = nr ? customer(nr) : { nr: nextKlantnr(), naam: '', adres: '', postcode: '', plaats: '', telefoon: '' };
  if (!c) return '<p class="card">Klant niet gevonden.</p>';
  const plaatsen = Object.keys(store.get().afstanden);
  return `
    <a class="back" href="${nr ? `#/klant/${h(nr)}` : '#/klanten'}">‹ Terug</a>
    <form class="card form" id="klantForm">
      <h1>${nr ? 'Klant bewerken' : 'Nieuwe klant'}</h1>
      <label>Klantnaam<input name="naam" required value="${h(c.naam)}"></label>
      <label>Adres<input name="adres" value="${h(c.adres)}" autocomplete="street-address"></label>
      <div class="row2">
        <label>Postcode<input name="postcode" value="${h(c.postcode)}"></label>
        <label>Plaats<input name="plaats" list="plaatsen" value="${h(c.plaats)}" required></label>
      </div>
      <datalist id="plaatsen">${plaatsen.map((p) => `<option value="${h(p.replace(/(^|\s|-)\S/g, (x) => x.toUpperCase()))}">`).join('')}</datalist>
      <label>Telefoon<input name="telefoon" type="tel" value="${h(c.telefoon)}"></label>
      <label>Afstand vanaf ${h(store.get().settings.startPlaats)} (km)<input name="km" type="number" inputmode="numeric" value="${h(c.km ?? '')}" placeholder="wordt automatisch berekend"></label>
      <p class="muted small">Klantnr. ${h(c.nr)}${m365.isSignedIn() ? ' · wordt bij synchroniseren in Blad1 van Klantkaart.xlsx gezet' : ''}</p>
      <div class="actions"><button class="btn primary">Opslaan</button></div>
    </form>`;
}
viewKlantForm.after = (nr) => {
  $('#klantForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const km = d.km !== '' ? Number(d.km) : kmFor(d.plaats);
    const fields = { naam: d.naam.trim(), adres: d.adres.trim(), postcode: d.postcode.trim(), plaats: d.plaats.trim(), telefoon: d.telefoon.trim(), km, min: minFor(km) };
    let target = nr;
    store.update((s) => {
      if (nr) {
        const c = customer(nr);
        Object.assign(c, fields);
        if (!c.pending) c.dirty = true;
      } else {
        target = nextKlantnr();
        s.customers.push({ nr: target, notitie: '', pending: true, ...fields });
      }
    });
    toast('Klant opgeslagen');
    location.hash = `#/klant/${target}`;
    runSync({ quiet: true });
    // Geen afstand bekend (geen Excel-tabel Afstanden): zelf uitrekenen via de plaatsnaam.
    if (fields.km === null || fields.km === undefined || Number.isNaN(fields.km)) {
      distanceFromStart(fields.plaats).then((km) => {
        if (km === null) return;
        store.update(() => { const c = customer(target); c.km = km; c.min = minFor(km); });
        toast(`Afstand berekend: ca. ${km} km vanaf ${store.get().settings.startPlaats}`);
        render();
      });
    }
  });
};

function viewBezoek(params) {
  const s = store.get();
  const nr = params.get('nr');
  const st = nr ? statFor(stats(), nr) : null;
  return `
    <a class="back" href="${nr ? `#/klant/${h(nr)}` : '#/vandaag'}">‹ Terug</a>
    <form class="card form" id="bezoekForm">
      <h1>Bezoek vastleggen</h1>
      <label>Klant<select name="nr" required>${nr ? '' : '<option value="">Kies klant…</option>'}${klantOptions(nr)}</select></label>
      <label>Datum<input type="date" name="datum" value="${h(params.get('d') || todayISO())}" required></label>
      <label>Verbruik (ml)<input name="ml" type="number" inputmode="numeric" min="0" step="1" required autofocus></label>
      <label>Geur<input name="geur" list="geuren" value="${h(st?.laatsteGeur || '')}"></label>
      <datalist id="geuren">${knownGeuren().map((g) => `<option value="${h(g)}">`).join('')}</datalist>
      <label>Instellingen<input name="instellingen" value="${h(st?.laatsteInstellingen || '')}" placeholder="bijv. 30 sec. ON / 3 min. OFF"></label>
      <label>Opmerking<textarea name="opmerking" rows="2"></textarea></label>
      <label class="inline"><input type="checkbox" name="vervolg" checked> Direct een vervolgbezoek plannen</label>
      <div class="actions"><button class="btn primary">Opslaan</button></div>
      <p class="muted small">${m365.isSignedIn() ? 'Wordt automatisch in het tabblad Verbruik van Klantkaart.xlsx gezet.' : excelMode() ? 'Wordt op dit apparaat bewaard. Kopieer de regels naar Excel via “Dag afsluiten”.' : 'Wordt op dit apparaat bewaard.'}</p>
    </form>`;
}
viewBezoek.after = () => {
  $('#bezoekForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    saveVisit({ datum: d.datum, nr: Number(d.nr), ml: d.ml, geur: d.geur.trim(), instellingen: d.instellingen.trim(), opmerking: d.opmerking.trim() });
    toast('Bezoek opgeslagen');
    location.hash = `#/klant/${d.nr}`;
    if (d.vervolg) {
      const next = new Date(d.datum + 'T12:00:00');
      next.setDate(next.getDate() + 28);
      setTimeout(() => activityDialog({ nr: d.nr, type: 'bezoek', titel: 'Vervolgbezoek / bijvullen', datum: todayISO(next) }), 50);
    }
  });
};

let dragId = null;
let pipeSector = '';
function viewPipeline() {
  const s = store.get();
  if (!s.customers.length) return emptyState();
  const deals = openDeals().filter((d) => !pipeSector || profile(d.nr).sector === pipeSector);
  const noStep = new Set(dealsWithoutNextStep().map((d) => d.id));
  const nextAct = (nr) => openActivities(nr)[0];
  const closed = s.deals.filter((d) => d.status !== 'open' && !d.deleted).sort((a, b) => (b.gesloten || '').localeCompare(a.gesloten || '')).slice(0, 10);
  return `
    <div class="card-head"><h1>Pipeline</h1><button class="btn primary small" id="newDeal">+ Deal</button></div>
    <select id="pipeSector" class="sector-filter" aria-label="Sector"><option value="">Alle sectoren</option>${s.settings.sectoren.map((x) => `<option ${pipeSector === x ? 'selected' : ''}>${h(x)}</option>`).join('')}</select>
    <div class="board">
      ${s.settings.fases.map((f) => {
        const list = deals.filter((d) => d.fase === f);
        return `<section class="col" data-fase="${h(f)}">
          <header><b>${h(f)}</b><span>${eur(list.reduce((t, d) => t + d.waarde, 0))} · ${list.length}</span></header>
          ${list.map((d) => {
            const c = customer(d.nr);
            const a = nextAct(d.nr);
            return `<article class="deal" draggable="true" data-id="${h(d.id)}">
              <b>${h(d.titel)}</b>
              <div class="sub">${h(c?.naam || 'Onbekende klant')}</div>
              <div class="deal-foot"><span>${eur(d.waarde)}</span>${noStep.has(d.id) ? '<span class="warn-dot" title="Geen volgende activiteit">⚠️</span>' : a ? `<span class="${a.datum < todayISO() ? 'late' : ''}">${h(ACTIVITY_TYPES[a.type]?.split(' ')[0])} ${fmtDate(a.datum)}</span>` : ''}</div>
            </article>`;
          }).join('')}
        </section>`;
      }).join('')}
    </div>
    <p class="muted small">Sleep kaarten naar een andere fase, of tik op een kaart om te bewerken, te winnen of te verliezen. ⚠️ = geen volgende activiteit gepland.</p>
    ${closed.length ? `<section class="card"><h2>Recent gesloten</h2><ul class="list compact">${closed.map((d) => `<li data-deal="${h(d.id)}" class="clickable"><div><b>${d.status === 'gewonnen' ? '🏆' : '✖️'} ${h(d.titel)}</b><span class="sub">${h(customer(d.nr)?.naam || '')} · ${fmtDate(d.gesloten)} · ${eur(d.waarde)}</span></div></li>`).join('')}</ul></section>` : ''}`;
}
viewPipeline.after = () => {
  $('#newDeal')?.addEventListener('click', () => dealDialog());
  $('#pipeSector')?.addEventListener('change', (e) => { pipeSector = e.target.value; render(); });
  const findDeal = (id) => store.get().deals.find((d) => d.id === id);
  $$('.deal').forEach((el) => {
    el.addEventListener('click', () => dealDialog(findDeal(el.dataset.id)));
    el.addEventListener('dragstart', (e) => { dragId = el.dataset.id; e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });
  $$('[data-deal]').forEach((el) => el.addEventListener('click', () => dealDialog(findDeal(el.dataset.deal))));
  $$('.col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const d = findDeal(dragId);
      if (!d || d.fase === col.dataset.fase) return;
      store.update(() => { d.fase = col.dataset.fase; d.updatedAt = now(); });
      toast(`Naar ${col.dataset.fase}`);
      render();
      runSync({ quiet: true });
    });
  });
};

let draftPlan = null;
let claudeAsk = '';
let claudeBusy = false;
let claudeStatus = '';
let claudeCtl = null;
let pageClaude = false;
pageSample().then((smp) => { if (smp) { pageClaude = true; render(); } });
function viewPlanning(params) {
  const s = store.get();
  if (!s.customers.length) return emptyState();
  const datum = params.get('d') || draftPlan?.datum || (new Date().getHours() >= 12 ? nextWorkday() : todayISO());
  const saved = s.plans[datum];
  const plan = draftPlan?.datum === datum ? draftPlan : saved;
  const upcoming = Object.values(s.plans).filter((p) => p.datum >= todayISO()).sort((a, b) => a.datum.localeCompare(b.datum));
  return `
    <h1>Dagplanning</h1>
    <section class="card form">
      <div class="row2">
        <label>Datum<input type="date" id="planDate" value="${h(datum)}"></label>
        <label>&nbsp;<button class="btn primary" id="suggest" type="button">${plan ? 'Opnieuw voorstellen' : 'Stel dag voor'}</button></label>
      </div>
      ${plan ? '' : '<div class="actions left"><button class="btn" id="manualDay" type="button">✍️ Zelf samenstellen</button></div>'}
      <p class="muted small">Start ${h(s.settings.startPlaats)} ${h(s.settings.startTijd)} · ${s.settings.minStops}–${s.settings.maxStops} bezoeken van ${s.settings.bezoekDuur} min · terug vóór ${h(s.settings.eindTijd)}${s.pinned.length ? ` · ${s.pinned.length} handmatig ingepland` : ''}</p>
    </section>
    <section class="card form claude-card">
      <h2>✨ Plan met Claude</h2>
      ${claudeConfigured() || pageClaude ? `
        <label>Wat wil je deze dag?<textarea id="claudeAsk" rows="3" placeholder="bijv. Richting Rotterdam, eerste afspraak niet vóór 10:00, Hotel Scheldezicht moet erin, liefst klanten met een open deal">${h(claudeAsk)}</textarea></label>
        <div class="actions left">
          <button class="btn primary" id="claudePlan" type="button" ${claudeBusy ? 'disabled' : ''}>${claudeBusy ? 'Claude plant…' : 'Laat Claude plannen'}</button>
          ${claudeBusy ? '<button class="btn ghost" id="claudeStop" type="button">Stop</button>' : ''}
        </div>
        <p class="muted small" id="claudeStatus">${h(claudeStatus)}</p>`
      : `<p class="muted">Laat Claude een dag samenstellen op basis van je klanten, navulmomenten, deals en je eigen wensen in gewone taal.</p>
        <a class="btn" href="#/meer">Claude koppelen</a>`}
    </section>
    ${plan ? `
      <section class="card">
        <div class="card-head"><h2>${fmtDate(plan.datum)} ${saved && plan === saved ? '<span class="badge k-normaal">opgeslagen</span>' : '<span class="badge">voorstel</span>'}${plan.door === 'claude' ? ' <span class="badge deal">✨ Claude</span>' : plan.door === 'handmatig' ? ' <span class="badge">✍️ zelf</span>' : ''}</h2></div>
        ${plan.toelichting ? `<p class="claude-note">${h(plan.toelichting)}</p>` : ''}
        <ol class="route">
          <li class="depot"><time><input type="time" id="planStart" class="time-inline" value="${h(plan.startTijd || s.settings.startTijd)}" aria-label="Vertrektijd"></time><div class="grow">Vertrek ${h(s.settings.startPlaats)}</div></li>
          ${plan.stops.map((st) => {
            const c = customer(st.nr);
            if (!c) return '';
            return `<li>
              <time>${h(st.aankomst)}<small>${h(st.vertrek)}</small></time>
              <div class="grow">
                <a href="#/klant/${h(c.nr)}"><b>${h(c.naam)}</b></a>
                <div class="sub">${h(fullAddress(c))}${c.telefoon ? ` · ${h(c.telefoon)}` : ''}</div>
                <div class="sub">🚗 ${st.reis} min · ${h(st.reden)}</div>
              </div>
              <div class="stop-tools">
                <button class="icon" data-up="${h(c.nr)}" aria-label="Eerder">▲</button>
                <button class="icon" data-down="${h(c.nr)}" aria-label="Later">▼</button>
                <button class="icon" data-remove="${h(c.nr)}" aria-label="Verwijder uit planning">✕</button>
              </div>
            </li>`;
          }).join('')}
          <li class="depot"><time>${h(plan.terug)}</time><div class="grow">Terug in ${h(s.settings.startPlaats)} (${plan.terugReis} min)</div></li>
        </ol>
        <div class="add-stop">
          <select id="addStop" aria-label="Klant toevoegen"><option value="">+ Klant toevoegen…</option>${klantOptions()}</select>
          ${plan.stops.length > 2 ? '<button class="btn small" id="optimize" type="button">🔀 Volgorde optimaliseren</button>' : ''}
        </div>
        <p class="muted small">Totale reistijd ca. ${Math.floor(plan.totaalReis / 60)} u ${plan.totaalReis % 60} min. ${h(plan.schatting)}${plan.teLaat ? ' ⚠️ Deze dag loopt uit na de eindtijd.' : ''}</p>
        ${plan.door !== 'claude' && plan.stops.length < s.settings.minStops ? `<p class="alert">Er vielen maar ${plan.stops.length} klanten binnen de criteria (${plan.kandidaten} klanten met adres). Verruim eventueel de instellingen.</p>` : ''}
        <div class="actions left">
          ${plan !== saved ? '<button class="btn primary" id="savePlan">Opslaan</button>' : ''}
          ${mapsRouteUrls(plan).map((u, i, all) => `<a class="btn" href="${h(u)}" target="_blank" rel="noopener">🧭 Google Maps${all.length > 1 ? ` deel ${i + 1}/${all.length}` : ''}</a>`).join('')}
          ${plan.stops.length ? '<button class="btn" id="myMaps">⬇️ My Maps CSV</button>' : ''}
          ${saved ? '<button class="btn ghost danger" id="delPlan">Planning wissen</button>' : ''}
        </div>
      </section>` : ''}
    ${upcoming.length ? `<section class="card"><h2>Geplande dagen</h2><ul class="list compact">${upcoming.map((p) => `<li><a href="#/planning?d=${h(p.datum)}"><b>${fmtDate(p.datum)}</b><span class="sub">${p.stops.length} bezoeken · terug ${h(p.terug)}</span></a></li>`).join('')}</ul></section>` : ''}`;
}
viewPlanning.after = (params) => {
  const s = store.get();
  const dateEl = $('#planDate');
  let exclude = [];
  const suggest = (extraExclude = []) => {
    exclude = [...new Set([...exclude, ...extraExclude])];
    const current = draftPlan?.datum === dateEl.value ? draftPlan : s.plans[dateEl.value];
    const keep = extraExclude.length && current ? current.stops.map((x) => x.nr).filter((n) => !extraExclude.map(String).includes(String(n))) : [];
    draftPlan = planDay({ datum: dateEl.value, include: [...new Set([...s.pinned, ...keep])], exclude });
    render();
  };
  $('#claudeAsk')?.addEventListener('input', (e) => { claudeAsk = e.target.value; });
  $('#claudeStop')?.addEventListener('click', () => claudeCtl?.abort());
  $('#claudePlan')?.addEventListener('click', async () => {
    claudeBusy = true;
    claudeStatus = 'Claude bekijkt je klanten en stelt een dag samen. Dit duurt meestal 20 tot 60 seconden.';
    claudeCtl = new AbortController();
    render();
    try {
      draftPlan = await planWithClaude({ datum: dateEl.value, opdracht: claudeAsk, signal: claudeCtl.signal });
      claudeStatus = '';
      toast('Claude heeft een dag voorgesteld. Controleer en sla op.');
    } catch (e) {
      claudeStatus = e.name === 'AbortError' ? 'Gestopt.' : e.message;
    } finally {
      claudeBusy = false;
      claudeCtl = null;
      render();
    }
  });
  $('#suggest')?.addEventListener('click', () => {
    const cur = draftPlan?.datum === dateEl.value ? draftPlan : null;
    // Bij "opnieuw": sla de eerste stop van het vorige voorstel over voor een andere route.
    suggest(cur?.stops.length ? [cur.stops[0].nr] : []);
  });
  dateEl?.addEventListener('change', () => { location.hash = `#/planning?d=${dateEl.value}`; });
  // Zelf aanpassen: stops toevoegen, verwijderen, verschuiven of de starttijd wijzigen.
  const current = () => (draftPlan?.datum === dateEl.value ? draftPlan : s.plans[dateEl.value]);
  const rebuild = (nrs, { optimize = false, startTijd } = {}) => {
    const cur = current();
    const redenen = Object.fromEntries(cur.stops.map((x) => [String(x.nr), x.reden]));
    draftPlan = planFromSelection({
      datum: cur.datum,
      nrs,
      redenen: Object.fromEntries(nrs.map((n) => [String(n), redenen[String(n)] || 'zelf toegevoegd'])),
      startTijd: startTijd || cur.startTijd,
      toelichting: cur.toelichting,
      door: cur.door === 'claude' ? 'claude' : 'handmatig',
      optimize,
    });
    render();
  };
  const order = () => current().stops.map((x) => x.nr);
  $('#manualDay')?.addEventListener('click', () => {
    draftPlan = planFromSelection({ datum: dateEl.value, nrs: [...s.pinned], redenen: {}, door: 'handmatig', optimize: true });
    render();
  });
  $$('[data-remove]').forEach((b) => b.addEventListener('click', () => rebuild(order().filter((n) => String(n) !== b.dataset.remove))));
  const move = (nr, delta) => {
    const o = order();
    const i = o.findIndex((n) => String(n) === nr);
    const j = i + delta;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    rebuild(o);
  };
  $$('[data-up]').forEach((b) => b.addEventListener('click', () => move(b.dataset.up, -1)));
  $$('[data-down]').forEach((b) => b.addEventListener('click', () => move(b.dataset.down, 1)));
  $('#addStop')?.addEventListener('change', (e) => {
    const nr = e.target.value;
    if (!nr || order().some((n) => String(n) === nr)) return;
    rebuild([...order(), Number(nr)]);
  });
  $('#optimize')?.addEventListener('click', () => rebuild(order(), { optimize: true }));
  $('#planStart')?.addEventListener('change', (e) => rebuild(order(), { startTijd: e.target.value }));
  $('#savePlan')?.addEventListener('click', () => {
    const p = draftPlan;
    store.update((st) => {
      st.plans[p.datum] = p;
      st.pinned = [];
      // Elke geplande stop wordt een bezoek-activiteit (zichtbaar in Vandaag en op de klantkaart).
      for (const stop of p.stops) {
        const exists = st.activities.some((a) => !a.deleted && a.type === 'bezoek' && a.datum === p.datum && String(a.nr) === String(stop.nr));
        if (!exists) st.activities.push({ id: uid(), nr: stop.nr, type: 'bezoek', titel: 'Klantbezoek', datum: p.datum, tijd: stop.aankomst, notitie: stop.reden, done: false, deleted: false, updatedAt: now() });
      }
    });
    draftPlan = null;
    toast('Planning opgeslagen');
    render();
    runSync({ quiet: true });
  });
  $('#delPlan')?.addEventListener('click', async () => {
    if (!(await ask('Deze dagplanning wissen?', 'Wissen'))) return;
    const d = dateEl.value;
    store.update((st) => {
      delete st.plans[d];
      st.activities.filter((a) => a.type === 'bezoek' && a.datum === d && !a.done).forEach((a) => { a.deleted = true; a.updatedAt = now(); });
    });
    draftPlan = null;
    render();
  });
  $('#myMaps')?.addEventListener('click', () => {
    const p = draftPlan?.datum === dateEl.value ? draftPlan : s.plans[dateEl.value];
    exportMyMaps(p);
    toast('CSV gedownload — importeer in Google My Maps als nieuwe laag');
  });
};

function viewDag(params) {
  const s = store.get();
  const datum = params.get('d') || todayISO();
  const plan = s.plans[datum];
  const logged = s.visits.filter((v) => v.datum === datum);
  const loggedNrs = new Set(logged.map((v) => String(v.nr)));
  const todo = (plan?.stops || []).map((x) => customer(x.nr)).filter((c) => c && !loggedNrs.has(String(c.nr)));
  const all = stats();
  const pending = s.visits.filter((v) => v.pending);
  return `
    <h1>Dag afsluiten</h1>
    <section class="card form">
      <label>Datum<input type="date" id="dagDate" value="${h(datum)}"></label>
      ${plan ? '' : '<p class="muted small">Geen planning voor deze dag — voeg hieronder de bezochte klanten toe.</p>'}
    </section>
    <form class="card" id="dagForm">
      <h2>Welke klanten heb je bezocht?</h2>
      <div id="dagRows">
        ${todo.map((c) => dagRow(c, statFor(all, c.nr), true)).join('')}
      </div>
      <select id="extraKlant" aria-label="Extra klant"><option value="">+ Extra klant toevoegen…</option>${klantOptions()}</select>
      <p class="muted small">Klanten zonder verbruik (afwezig, 0 ml) worden niet als bezoek vastgelegd.</p>
      <div class="actions"><button class="btn primary">Bezoeken opslaan</button></div>
    </form>
    <datalist id="geuren">${knownGeuren().map((g) => `<option value="${h(g)}">`).join('')}</datalist>
    ${logged.length ? `
      <section class="card">
        <h2>Vastgelegd op ${fmtDate(datum)}</h2>
        <ul class="list compact">${logged.map((v) => `<li><div><b>${h(customer(v.nr)?.naam || v.nr)}</b><span class="sub">${ml(v.ml)} · ${h(v.geur || '–')} · ${h(v.instellingen || '–')}${v.pending && excelMode() ? ' · nog niet in Excel' : ''}</span></div>${v.pending || !excelMode() ? `<button class="icon" data-del-visit="${h(v.id)}" aria-label="Verwijderen">✕</button>` : ''}</li>`).join('')}</ul>
      </section>` : ''}
    ${pending.length && excelMode() ? `
      <section class="card">
        <h2>Nog niet in Klantkaart.xlsx (${pending.length})</h2>
        ${m365.isSignedIn() ? '<p>Deze regels worden weggeschreven zodra je online bent.</p><button class="btn primary" id="syncNow">Nu synchroniseren</button>' : `
          <p>Plak deze regels in het tabblad <b>Verbruik</b> vanaf <code>Verbruik!A${nextVerbruikRow()}</code> (kolom C/Klantnaam wordt door de formule gevuld, je mag hem overschrijven).</p>
          <pre class="tsv">${h(verbruikTSV(pending))}</pre>
          <div class="actions left"><button class="btn primary" id="copyTsv">📋 Kopieer regels</button><button class="btn ghost" id="markDone">Gemarkeerd als geplakt</button></div>`}
      </section>` : ''}`;
}
function dagRow(c, st, checked) {
  return `<fieldset class="dagrow" data-nr="${h(c.nr)}">
    <legend><label class="inline"><input type="checkbox" name="bezocht" ${checked ? 'checked' : ''}> <b>${h(c.naam)}</b> <span class="sub">${h(c.plaats)}</span></label></legend>
    <div class="row3">
      <label>ml<input name="ml" type="number" inputmode="numeric" min="0"></label>
      <label>Geur<input name="geur" list="geuren" value="${h(st.laatsteGeur)}"></label>
      <label>Instellingen<input name="instellingen" value="${h(st.laatsteInstellingen)}"></label>
    </div>
    <label>Opmerking<input name="opmerking"></label>
  </fieldset>`;
}
viewDag.after = () => {
  const dateEl = $('#dagDate');
  dateEl.addEventListener('change', () => { location.hash = `#/dag?d=${dateEl.value}`; });
  $('#extraKlant').addEventListener('change', (e) => {
    const c = customer(e.target.value);
    if (c && !$(`.dagrow[data-nr="${c.nr}"]`)) $('#dagRows').insertAdjacentHTML('beforeend', dagRow(c, statFor(stats(), c.nr), true));
    e.target.value = '';
  });
  $('#dagForm').addEventListener('submit', (e) => {
    e.preventDefault();
    let n = 0;
    for (const fs of $$('.dagrow')) {
      if (!$('[name=bezocht]', fs).checked) continue;
      const mlv = Number($('[name=ml]', fs).value);
      if (!mlv) continue;
      saveVisit({
        datum: dateEl.value,
        nr: Number(fs.dataset.nr),
        ml: mlv,
        geur: $('[name=geur]', fs).value.trim(),
        instellingen: $('[name=instellingen]', fs).value.trim(),
        opmerking: $('[name=opmerking]', fs).value.trim(),
      });
      n++;
    }
    toast(n ? `${n} bezoek(en) opgeslagen` : 'Geen bezoeken met verbruik ingevuld');
    render();
  });
  $$('[data-del-visit]').forEach((b) => b.addEventListener('click', () => {
    store.update((s) => { s.visits = s.visits.filter((v) => v.id !== b.dataset.delVisit); });
    render();
  }));
  $('#syncNow')?.addEventListener('click', () => runSync());
  $('#copyTsv')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(verbruikTSV(store.get().visits.filter((v) => v.pending)));
      toast('Gekopieerd — plak in Excel');
    } catch {
      toast('Kopiëren niet toegestaan; selecteer de tekst handmatig');
    }
  });
  $('#markDone')?.addEventListener('click', async () => {
    if (!(await ask('Zijn deze regels in Klantkaart.xlsx geplakt? Ze worden dan niet meer als wachtend getoond.', 'Ja, geplakt'))) return;
    store.update((s) => s.visits.filter((v) => v.pending).forEach((v) => { v.pending = false; }));
    render();
  });
};

let installPrompt = null;
let persisted = null;
// Vraag de browser de gegevens niet automatisch op te ruimen (belangrijk nu de app zelfstandig is).
navigator.storage?.persist?.().then((ok) => { persisted = ok; }).catch(() => {});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

function viewMeer() {
  const s = store.get();
  const c = s.settings.m365;
  const signed = m365.isSignedIn();
  const missing = missingPlaces().length;
  return `
    <h1>Meer</h1>
    <a class="card nav-card" href="#/import"><b>📥 Importeren uit CSV of Excel</b><span class="sub">Klanten, contactpersonen, contracten en systemen, bijvoorbeeld uit je boekhoudpakket</span></a>
    <a class="card nav-card" href="#/rapport"><b>📈 Rapportage</b><span class="sub">MRR, contracten, pipelineconversie, verbruik per sector en servicecijfers</span></a>
    <section class="card">
      <h2>Gegevens</h2>
      <p>${s.customers.length} klanten · ${s.visits.length} bezoeken · ${openDeals().length} open deals<br>
      <span class="muted small">Opgeslagen op dit apparaat${persisted === true ? ' (beschermd tegen automatisch opruimen)' : ''}. Laatste back-up: ${s.lastBackup ? new Date(s.lastBackup).toLocaleDateString('nl-NL') : 'nog nooit'}.</span></p>
      <div class="actions left">
        <button class="btn primary" id="backupJson">⬇️ Back-up maken</button>
        <label class="btn">📂 Back-up terugzetten<input type="file" id="restoreFile" accept=".json,application/json" hidden></label>
        ${s.customers.length ? '' : '<button class="btn" id="demoBtn">Voorbeeldgegevens</button>'}
      </div>
      <p class="muted small">Maak regelmatig een back-up en bewaar die bijvoorbeeld in OneDrive. Met hetzelfde bestand zet je je gegevens over naar een nieuwe telefoon of computer.</p>
    </section>

    <details class="card optional">
      <summary><b>Gegevens overzetten uit Excel</b> <span class="muted small">(optioneel)</span></summary>
      <p class="muted small">Eenmalig je bestaande Klantkaart.xlsx inlezen (tabbladen Blad1, Verbruik en Afstanden). Daarna werkt de app zonder Excel verder.</p>
      <div class="actions left">
        <label class="btn">📂 Klantkaart.xlsx inlezen<input type="file" id="importFile" accept=".xlsx,.xlsm" hidden></label>
        <button class="btn" id="backup">⬇️ Exporteren naar Excel</button>
      </div>
    </details>

    <details class="card form optional" ${signed ? 'open' : ''}>
      <summary><b>Koppeling met Microsoft 365</b> <span class="muted small">(optioneel)</span></summary>
      <p class="muted small">Leest en schrijft rechtstreeks in Klantkaart.xlsx: klanten uit <b>Blad1</b>, bezoeken naar <b>Verbruik</b>, pipeline, activiteiten en klantprofielen naar de tabbladen <b>CRM_Deals</b>, <b>CRM_Activiteiten</b> en <b>CRM_Klantprofiel</b>. Zie README voor het registreren van de app in Entra ID.</p>
      <form id="m365Form">
        <label>Application (client) ID<input name="clientId" value="${h(c.clientId)}" placeholder="00000000-0000-0000-0000-000000000000"></label>
        <label>Tenant<input name="tenant" value="${h(c.tenant)}"></label>
        <div class="row2">
          <label>SharePoint-host<input name="host" value="${h(c.host)}"></label>
          <label>Site<input name="sitePath" value="${h(c.sitePath)}"></label>
        </div>
        <label>Bestand (in Gedeelde documenten)<input name="filePath" value="${h(c.filePath)}"></label>
        <p class="muted small">Redirect URI voor de app-registratie (type “Single-page application”): <code>${h(m365.authRedirectUri())}</code></p>
        <div class="actions left">
          <button class="btn" value="save">Opslaan</button>
          ${signed ? '<button class="btn primary" type="button" id="syncNow">⟳ Nu synchroniseren</button><button class="btn ghost" type="button" id="signOut">Afmelden</button>' : '<button class="btn primary" type="button" id="signIn">Aanmelden bij Microsoft</button>'}
        </div>
        <p id="who" class="muted small"></p>
      </form>
    </details>

    <section class="card form">
      <h2>Service & servicerapport</h2>
      <form id="bedrijfForm">
        <label>Bedrijfsnaam<input name="naam" value="${h(s.settings.bedrijf.naam)}"></label>
        <label>Adres<input name="adres" value="${h(s.settings.bedrijf.adres)}" placeholder="Straat 1, 4611 AA Bergen op Zoom"></label>
        <div class="row2">
          <label>Telefoon<input name="telefoon" value="${h(s.settings.bedrijf.telefoon)}"></label>
          <label>E-mail<input name="email" type="email" value="${h(s.settings.bedrijf.email)}"></label>
        </div>
        <label>KvK / btw<input name="kvk" value="${h(s.settings.bedrijf.kvk)}"></label>
        <label>Naam monteur (dit apparaat)<input name="monteur" value="${h(s.settings.monteur)}"></label>
        <label class="inline"><input type="checkbox" name="autoOnderhoud" ${s.settings.autoOnderhoud ? 'checked' : ''}> Onderhoudstickets automatisch aanmaken (${h(s.settings.onderhoudVooruit)} dagen vooruit)</label>
        <div class="actions left"><button class="btn primary">Opslaan</button></div>
      </form>
    </section>

    <section class="card form">
      <h2>Claude</h2>
      <p class="muted small">Met Claude kun je in Planning een dag laten samenstellen in gewone taal. Claude krijgt daarvoor per klant naam, plaats, afstand, bezoekhistorie, classificatie, navulmoment, sector en open deals/activiteiten mee. Model: <code>${h(CLAUDE_MODEL)}</code>.</p>
      <form id="claudeForm">
        <label>Anthropic API-sleutel<input name="key" type="password" autocomplete="off" value="${h(getClaudeKey())}" placeholder="sk-ant-…"></label>
        <label>Of: proxy-URL (sleutel blijft op je eigen server)<input name="proxy" type="url" value="${h(s.settings.claudeProxy || '')}" placeholder="https://…"></label>
        <p class="muted small">De sleutel wordt alleen op dit apparaat bewaard. Gebruik voor meerdere collega's liever een proxy (zie README), zodat de sleutel niet op elke telefoon staat. Kosten per planning: enkele centen.</p>
        <div class="actions left">
          <button class="btn primary">Opslaan</button>
          ${claudeConfigured() ? '<button class="btn ghost danger" type="button" id="claudeRemove">Ontkoppelen</button>' : ''}
        </div>
      </form>
    </section>

    <section class="card form">
      <h2>Planning & doelen</h2>
      <form id="prefForm">
        <div class="row2">
          <label>Startplaats<input name="startPlaats" value="${h(s.settings.startPlaats)}"></label>
          <label>Bezoekduur (min)<input name="bezoekDuur" type="number" value="${h(s.settings.bezoekDuur)}"></label>
        </div>
        <div class="row2">
          <label>Starttijd<input name="startTijd" type="time" value="${h(s.settings.startTijd)}"></label>
          <label>Eindtijd<input name="eindTijd" type="time" value="${h(s.settings.eindTijd)}"></label>
        </div>
        <div class="row2">
          <label>Min. bezoeken<input name="minStops" type="number" value="${h(s.settings.minStops)}"></label>
          <label>Max. bezoeken<input name="maxStops" type="number" value="${h(s.settings.maxStops)}"></label>
        </div>
        <div class="row2">
          <label>Niet opnieuw binnen (dagen)<input name="minDagenTussen" type="number" value="${h(s.settings.minDagenTussen)}"></label>
          <label>Max. afstand (km)<input name="maxKm" type="number" value="${h(s.settings.maxKm)}"></label>
        </div>
        <div class="row2">
          <label>Doel bezoeken / week<input name="doelBezoekenWeek" type="number" value="${h(s.settings.doelBezoekenWeek)}"></label>
          <label>Doel verbruik / maand (ml)<input name="doelVerbruikMaand" type="number" value="${h(s.settings.doelVerbruikMaand)}"></label>
        </div>
        <label>Pipeline-fases (één per regel)<textarea name="fases" rows="5">${h(s.settings.fases.join('\n'))}</textarea></label>
        <label>Sectoren (één per regel)<textarea name="sectoren" rows="4">${h(s.settings.sectoren.join('\n'))}</textarea></label>
        <div class="row2">
          <label>Standaard flaconinhoud (ml)<input name="flaconMl" type="number" value="${h(s.settings.flaconMl)}"></label>
          <label>Navulmelding binnen (dagen)<input name="navulDagen" type="number" value="${h(s.settings.navulDagen)}"></label>
        </div>
        <label>Systemen — naam; tot m³; prijs €; abonnement €/mnd<textarea name="systemen" rows="4">${h(s.settings.systemen.map((x) => [x.naam, x.totM3, x.prijs, x.abonnement].join('; ')).join('\n'))}</textarea></label>
        <div class="actions left"><button class="btn primary">Opslaan</button></div>
      </form>
      <hr>
      <p>Betere routes: haal coördinaten per plaats op (OpenStreetMap). ${missing ? `${missing} plaats(en) nog zonder coördinaten, duurt ca. ${Math.ceil(missing * 1.1)} s.` : 'Alle plaatsen hebben coördinaten.'}</p>
      ${missing ? '<button class="btn" id="geocode">📍 Coördinaten ophalen</button>' : ''}
      <p id="geoProgress" class="muted small"></p>
    </section>

    <section class="card">
      <h2>App</h2>
      <div class="actions left">
        ${installPrompt ? '<button class="btn primary" id="install">📲 Installeren</button>' : ''}
        <button class="btn ghost danger" id="reset">Lokale gegevens wissen</button>
      </div>
      <p class="muted small">Op iPhone: deel-knop → “Zet op beginscherm”. In Teams: voeg de app toe als tabblad in Sales › Prospects (zie map <code>teams/</code>).</p>
    </section>`;
}
viewMeer.after = async () => {
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await importWorkbook(f);
      toast(`${r.klanten} klanten en ${r.bezoeken} bezoeken geïmporteerd`);
      render();
    } catch (err) {
      toast('Import mislukt: ' + err.message, 5000);
    }
  });
  $('#backup').addEventListener('click', exportBackup);
  $('#backupJson').addEventListener('click', async () => {
    await exportJsonBackup();
    toast('Back-up gemaakt');
    render();
  });
  $('#restoreFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await ask('Alle gegevens op dit apparaat vervangen door deze back-up?', 'Terugzetten'))) return;
    try {
      const r = await restoreJsonBackup(f);
      toast(`${r.klanten} klanten en ${r.bezoeken} bezoeken teruggezet`);
      render();
    } catch (err) {
      toast('Terugzetten mislukt: ' + err.message, 5000);
    }
  });
  $('#m365Form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    store.update((s) => { Object.assign(s.settings.m365, Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim()]))); });
    toast('Opgeslagen');
  });
  $('#signIn')?.addEventListener('click', async () => {
    $('#m365Form').requestSubmit();
    try {
      await m365.signIn();
      toast('Aangemeld');
      render();
      runSync();
    } catch (err) {
      toast(err.message, 5000);
    }
  });
  $('#signOut')?.addEventListener('click', () => { m365.signOut(); render(); });
  $('#bedrijfForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    store.update((s) => {
      s.settings.bedrijf = { naam: d.naam.trim(), adres: d.adres.trim(), telefoon: d.telefoon.trim(), email: d.email.trim(), kvk: d.kvk.trim() };
      s.settings.monteur = d.monteur.trim();
      s.settings.autoOnderhoud = !!d.autoOnderhoud;
    });
    toast('Opgeslagen');
  });
  $('#claudeForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    setClaudeKey(d.key.trim());
    store.update((s) => { s.settings.claudeProxy = d.proxy.trim(); });
    resetClaudeClient();
    toast(claudeConfigured() ? 'Claude gekoppeld' : 'Opgeslagen');
    render();
  });
  $('#claudeRemove')?.addEventListener('click', () => {
    setClaudeKey('');
    store.update((s) => { s.settings.claudeProxy = ''; });
    resetClaudeClient();
    toast('Claude ontkoppeld');
    render();
  });
  $('#syncNow')?.addEventListener('click', () => runSync());
  $('#prefForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    store.update((s) => {
      for (const [k, v] of Object.entries(d)) {
        if (k === 'fases' || k === 'sectoren') s.settings[k] = v.split('\n').map((x) => x.trim()).filter(Boolean);
        else if (k === 'systemen') {
          s.settings.systemen = v.split('\n').map((line) => line.split(';').map((x) => x.trim())).filter((x) => x[0])
            .map(([naam, totM3, prijs, abonnement]) => ({ naam, totM3: Number(totM3) || 999999, prijs: Number(prijs) || 0, abonnement: Number(abonnement) || 0 }));
        }
        else s.settings[k] = typeof s.settings[k] === 'number' ? Number(v) : v;
      }
    });
    toast('Voorkeuren opgeslagen');
  });
  $('#geocode')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    await geocodePlaces((i, n, p) => { $('#geoProgress').textContent = `${i}/${n} · ${p}`; });
    toast('Coördinaten opgehaald');
    render();
  });
  $('#install')?.addEventListener('click', async () => { await installPrompt.prompt(); installPrompt = null; render(); });
  $('#reset').addEventListener('click', async () => {
    if (await ask('Alle lokale gegevens (inclusief niet-gesynchroniseerde bezoeken) wissen?', 'Wissen')) { store.reset(); m365.signOut(); render(); }
  });
  $('#demoBtn')?.addEventListener('click', startDemo);
  if (m365.isSignedIn() && navigator.onLine) {
    try {
      const u = await m365.me();
      const who = $('#who');
      if (who) who.textContent = `Aangemeld als ${u.displayName} (${u.mail || u.userPrincipalName})`;
    } catch {}
  }
};

function briefingDialog(nr) {
  const ctl = new AbortController();
  openDialog(`
    <h2>✨ Briefing: ${h(customer(nr).naam)}</h2>
    <div id="briefBody"><p class="muted">Claude leest de klantkaart… (meestal 10–30 seconden)</p></div>
    <div class="actions"><button value="cancel" class="btn primary" formnovalidate>Sluiten</button></div>`, () => {});
  dialog.addEventListener('close', () => ctl.abort(), { once: true });
  klantBriefing(nr, { signal: ctl.signal }).then((b) => {
    const el = $('#briefBody');
    if (!el) return;
    el.innerHTML = `<p>${h(b.samenvatting)}</p>
      ${b.aandachtspunten?.length ? `<h3>Aandachtspunten</h3><ul>${b.aandachtspunten.map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
      ${b.gespreksonderwerpen?.length ? `<h3>Om te bespreken</h3><ul>${b.gespreksonderwerpen.map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
      <p class="muted small">Gemaakt door Claude op basis van de klantkaart. Controleer belangrijke details.</p>`;
  }).catch((e) => {
    const el = $('#briefBody');
    if (el && e.name !== 'AbortError') el.innerHTML = `<p class="alert">${h(e.message)}</p>`;
  });
}

function profileDialog(nr) {
  const s = store.get();
  const p = profile(nr);
  const form = openDialog(`
    <h2>Profiel & geur-DNA</h2>
    <div class="row2">
      <label>Sector<select name="sector"><option value="">–</option>${s.settings.sectoren.map((x) => `<option ${p.sector === x ? 'selected' : ''}>${h(x)}</option>`).join('')}</select></label>
      <label>Keten / hoofdaccount<input name="keten" value="${h(p.keten)}" list="ketens" placeholder="bijv. Sun City"></label>
    </div>
    <datalist id="ketens">${[...new Set(s.profiles.map((x) => x.keten).filter(Boolean))].map((k) => `<option value="${h(k)}">`).join('')}</datalist>
    <div class="row2">
      <label>Contactpersoon<input name="contactpersoon" value="${h(p.contactpersoon)}"></label>
      <label>E-mail<input name="email" type="email" value="${h(p.email)}"></label>
    </div>
    <div class="row2">
      <label>Geurprofiel<input name="geurprofiel" value="${h(p.geurprofiel)}" list="geuren" placeholder="bijv. Green Tea & Lemongrass"></label>
      <label>Gewenste sfeer<input name="sfeer" value="${h(p.sfeer)}" placeholder="rustgevend, luxueus, fris…"></label>
    </div>
    <datalist id="geuren">${knownGeuren().map((g) => `<option value="${h(g)}">`).join('')}</datalist>
    <fieldset class="calc">
      <legend>Ruimte- & systeemcalculator</legend>
      <div class="row3">
        <label>Lengte (m)<input name="l" type="number" step="0.1" inputmode="decimal"></label>
        <label>Breedte (m)<input name="b" type="number" step="0.1" inputmode="decimal"></label>
        <label>Hoogte (m)<input name="hgt" type="number" step="0.1" inputmode="decimal" value="3"></label>
      </div>
      <div class="row2">
        <label>Volume (m³)<input name="m3" type="number" value="${h(p.m3 ?? '')}"></label>
        <label>Luchtcirculatie<select name="circulatie">${['laag', 'normaal', 'hoog'].map((x) => `<option ${(p.circulatie || 'normaal') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      </div>
      <p class="advies" id="advies"></p>
      <div class="row2">
        <label>Geplaatst systeem<select name="systeem"><option value="">–</option>${s.settings.systemen.map((x) => `<option ${p.systeem === x.naam ? 'selected' : ''}>${h(x.naam)}</option>`).join('')}</select></label>
        <label>Aantal<input name="aantal" type="number" min="1" value="${h(p.aantal ?? 1)}"></label>
      </div>
      <label>Inhoud flacon/patroon (ml)<input name="flaconMl" type="number" value="${h(p.flaconMl ?? '')}" placeholder="standaard ${h(s.settings.flaconMl)}"></label>
    </fieldset>
    <div class="actions">
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Opslaan</button>
    </div>`, (d) => {
    saveProfile(nr, {
      sector: d.sector, keten: d.keten.trim(), contactpersoon: d.contactpersoon.trim(), email: d.email.trim(),
      geurprofiel: d.geurprofiel.trim(), sfeer: d.sfeer.trim(), m3: Number(d.m3) || null, circulatie: d.circulatie,
      systeem: d.systeem, aantal: Number(d.aantal) || null, flaconMl: Number(d.flaconMl) || null,
    });
    toast('Profiel opgeslagen');
    render();
    runSync({ quiet: true });
  });
  const upd = () => {
    const f = formData(form);
    if (f.l && f.b && f.hgt) form.m3.value = Math.round(f.l * f.b * f.hgt);
    const a = adviseSystem({ m3: form.m3.value, circulatie: form.circulatie.value, sector: form.sector.value });
    $('#advies').innerHTML = a
      ? `💡 Effectief ${a.effectief} m³ → <b>${h(a.systeem)}</b>, intensiteit ${h(a.intensiteit)}${a.alternatief ? ` <span class="sub">(alternatief: ${a.alternatief.aantal}× ${h(a.alternatief.systeem)})</span>` : ''} <button type="button" class="btn small" id="useAdv">Gebruik</button>`
      : '<span class="sub">Vul afmetingen of volume in voor een systeemadvies.</span>';
    $('#useAdv')?.addEventListener('click', () => { form.systeem.value = a.systeem; form.aantal.value = a.aantal; });
  };
  form.addEventListener('input', upd);
  upd();
}

function viewOfferte(params) {
  const s = store.get();
  const nr = params.get('nr');
  const c = customer(nr);
  if (!c) return '<p class="card">Klant niet gevonden.</p>';
  const q = params.get('id') ? s.quotes.find((x) => x.id === params.get('id')) : null;
  const p = profile(nr);
  const sysNaam = q?.systeem || (s.settings.systemen.find((x) => x.naam === (p.systeem || adviseSystem(p)?.systeem)) || s.settings.systemen[0]).naam;
  const locked = q && ['geaccepteerd', 'afgewezen'].includes(q.status);
  return `
    <a class="back" href="#/klant/${h(nr)}">‹ ${h(c.naam)}</a>
    <form class="card form" id="offForm">
      <div class="card-head"><h1>${q ? `Offerte ${h(q.code)}` : 'Nieuwe offerte'}</h1>${q ? `<span class="badge ${q.status === 'geaccepteerd' ? 'k-normaal' : q.status === 'afgewezen' ? 'k-weinig' : ''}">${h(QUOTE_STATUS[q.status])}</span>` : ''}</div>
      <fieldset ${locked ? 'disabled' : ''}>
        <div class="row2">
          <label>Systeem<select name="systeem">${s.settings.systemen.map((x) => `<option ${x.naam === sysNaam ? 'selected' : ''}>${h(x.naam)}</option>`).join('')}</select></label>
          <label>Aantal<input name="aantal" type="number" min="1" value="${h(q?.aantal || p.aantal || 1)}"></label>
        </div>
        <div class="row2">
          <label>Model<select name="model"><option value="koop" ${q?.model === 'koop' ? 'selected' : ''}>Eenmalige aanschaf</option><option value="lease" ${q?.model === 'lease' ? 'selected' : ''}>Lease (${LEASE_MND} mnd)</option></select></label>
          <label>Geurprofiel<input name="geur" value="${h(q?.geur ?? (p.geurprofiel || statFor(stats(), nr).laatsteGeur))}"></label>
        </div>
        <label>Opmerking / voorwaarden<textarea name="notitie" rows="2">${h(q?.notitie ?? 'Inclusief installatie, periodieke navulling en onderhoud.')}</textarea></label>
      </fieldset>
      <div class="actions left">
        ${locked ? '' : '<button type="button" class="btn primary" id="saveQuote">Opslaan</button>'}
        <button type="button" class="btn" id="quotePdf">📄 PDF delen</button>
        ${q && !locked ? '<button type="button" class="btn ok" id="acceptQuote">✅ Akkoord → contract</button><button type="button" class="btn ghost danger" id="rejectQuote">Afgewezen</button>' : ''}
      </div>
      <p class="muted small">Opslaan zet de offerte ook als deal in de pipeline (fase Offerte). Bij akkoord maakt de app automatisch het contract, de systemen en een installatieticket aan.</p>
    </form>
    <article class="card quote" id="quote"></article>`;
}
viewOfferte.after = (params) => {
  const nr = params.get('nr');
  const c = customer(nr);
  if (!c) return;
  let id = params.get('id');
  const form = $('#offForm');
  const fields = () => ({ ...formData(form), nr, id });
  const draw = () => {
    const f = fields();
    const k = calcQuote(f);
    $('#quote').innerHTML = `
      <table class="q-table">
        <thead><tr><th>Omschrijving</th><th>Aantal</th><th>Bedrag</th></tr></thead>
        <tbody>
          <tr><td>${h(k.sys.naam)} — ${f.model === 'koop' ? 'eenmalige aanschaf' : `lease ${LEASE_MND} mnd`}</td><td>${k.n}</td><td>${f.model === 'koop' ? eur(k.eenmalig) : `${eur(k.leasePerMaand)} /mnd`}</td></tr>
          <tr><td>Serviceabonnement${f.geur ? ` — ${h(f.geur)}` : ''}</td><td>${k.n}</td><td>${eur(k.abo)} /mnd</td></tr>
        </tbody>
        <tfoot><tr><td colspan="2">Per maand</td><td>${eur(k.perMaand)}</td></tr>${k.eenmalig ? `<tr><td colspan="2">Eenmalig</td><td>${eur(k.eenmalig)}</td></tr>` : ''}<tr><td colspan="2">Eerste jaar</td><td>${eur(k.jaar + k.eenmalig)}</td></tr></tfoot>
      </table>
      <p class="sub">Excl. btw. Prijzen per systeem pas je aan in Meer → Systemen.</p>`;
  };
  form.addEventListener('input', draw);
  draw();
  const save = () => {
    const q = saveQuote(fields());
    id = q.id;
    return q;
  };
  $('#saveQuote')?.addEventListener('click', () => {
    const q = save();
    toast(`Offerte ${q.code} opgeslagen en in de pipeline gezet`);
    location.hash = `#/offerte?nr=${nr}&id=${q.id}`;
    runSync({ quiet: true });
  });
  $('#quotePdf').addEventListener('click', async () => {
    const q = $('#saveQuote') ? save() : store.get().quotes.find((x) => x.id === id);
    if (q.status === 'concept') setQuoteStatus(q.id, 'verstuurd');
    try {
      const how = await shareOrDownloadQuote(store.get().quotes.find((x) => x.id === q.id));
      if (how !== 'geannuleerd') toast(`Offerte ${how}`);
    } catch (e) {
      toast('PDF maken mislukt: ' + e.message, 5000);
    }
    render();
    runSync({ quiet: true });
  });
  $('#rejectQuote')?.addEventListener('click', async () => {
    if (!(await ask('Offerte als afgewezen markeren? De deal gaat naar verloren.', 'Afgewezen'))) return;
    setQuoteStatus(id, 'afgewezen');
    toast('Offerte afgewezen');
    render();
    runSync({ quiet: true });
  });
  $('#acceptQuote')?.addEventListener('click', () => {
    save();
    openDialog(`
      <h2>Akkoord verwerken</h2>
      <p>Dit maakt aan: een actief contract, de systemen (status gepland), een installatieticket, en zet de deal op gewonnen.</p>
      <label>Installatiedatum (optioneel)<input type="date" name="datum"></label>
      <div class="actions"><button value="cancel" class="btn ghost" formnovalidate>Annuleren</button><button value="ok" class="btn primary">Verwerken</button></div>`, (d) => {
      const r = acceptQuote(id, { installatieDatum: d.datum });
      toast(`🎉 Contract aangemaakt, ${r.assets} systeem/systemen gepland, installatieticket ${r.ticket.code}`);
      location.hash = `#/klant/${nr}`;
      runSync({ quiet: true });
    });
  });
};

// ---------- router ----------

const routes = [
  [/^\/vandaag$/, viewVandaag, 'vandaag'],
  [/^\/klanten$/, viewKlanten, 'klanten'],
  [/^\/klant\/nieuw$/, viewKlantForm, 'klanten'],
  [/^\/klant\/([^/]+)\/bewerk$/, viewKlantForm, 'klanten'],
  [/^\/klant\/([^/]+)$/, viewKlant, 'klanten'],
  [/^\/bezoek$/, viewBezoek, 'vandaag', true],
  [/^\/pipeline$/, viewPipeline, 'pipeline'],
  [/^\/planning$/, viewPlanning, 'planning', true],
  [/^\/dag$/, viewDag, 'vandaag', true],
  [/^\/offerte$/, viewOfferte, 'klanten', true],
  [/^\/service$/, viewService, 'service', true],
  [/^\/rapport$/, viewRapport, 'meer'],
  [/^\/import$/, viewImport, 'meer'],
  [/^\/meer$/, viewMeer, 'meer'],
];

let lastRoute = '';
function render() {
  const [path, query = ''] = (location.hash.slice(1) || '/vandaag').split('?');
  const params = new URLSearchParams(query);
  const found = routes.find(([re]) => re.test(path)) || routes[0];
  const [re, fn, tab, usesParams] = found;
  const arg = usesParams ? params : path.match(re)?.[1];
  const scrollY = lastRoute === location.hash ? window.scrollY : 0;
  // Op brede schermen tonen deze overzichten hun kaarten in twee kolommen (alleen via CSS min-width).
  view.classList.toggle('wide-grid', [viewVandaag, viewKlant, viewRapport, viewMeer].includes(fn));
  view.innerHTML = fn(arg);
  fn.after?.(arg);
  $$('[data-demo]', view).forEach((b) => b.addEventListener('click', startDemo));
  $$('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  renderSyncChip();
  if (lastRoute !== location.hash) view.focus({ preventScroll: true });
  window.scrollTo(0, scrollY);
  lastRoute = location.hash;
}

// Terugkerend onderhoud: tickets aanmaken voor systemen die binnenkort aan de beurt zijn.
if (store.get().settings.autoOnderhoud && store.get().assets.length) {
  const n = createMaintenanceTickets();
  if (n) setTimeout(() => toast(`${n} onderhoudsticket(s) aangemaakt volgens schema`), 600);
}
hooks.render = render;
hooks.sync = () => runSync({ quiet: true });
window.addEventListener('hashchange', render);
// Voorbeeldweergave: laad voorbeeldgegevens bij een lege app, of ververs oudere voorbeeldgegevens zonder service/CRM.
if (window.KLANTKAART_DEMO && (!store.get().customers.length || (store.get().source === 'demo' && !store.get().tickets.length))) startDemo();
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (m365.inTeams() && window.microsoftTeams) {
  window.microsoftTeams.app.initialize().then(() => window.microsoftTeams.app.notifySuccess?.()).catch(() => {});
}

if (sessionStorage.getItem('klantkaart.syncAfterLogin')) {
  sessionStorage.removeItem('klantkaart.syncAfterLogin');
  runSync();
} else {
  runSync({ quiet: true });
}
