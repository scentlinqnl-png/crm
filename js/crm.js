// Uitgebreide CRM: contactpersonen, contracten/abonnementen, geïnstalleerde systemen, klantstatus en rapportage.
import {
  store, customer, todayISO, daysBetween, profile, saveProfile, stats, statFor, openDeals,
  CONTRACT_SOORTEN, KLANT_STATUS, activeContracts, mrr, contractsEndingSoon, contactsFor, assetsFor, klantStatus,
  upsert, softDelete, openTickets, TICKET_TYPES, isOpenTicket,
} from './store.js';
import { $, $$, h, eur, ml, fmtDate, toast, openDialog, telHref, hooks } from './ui.js';
import { ticketItem, bindTicketList, ticketDialog } from './service.js';
import { quotesFor, QUOTE_STATUS } from './quotes.js';

const done = (msg) => { toast(msg); hooks.render(); hooks.sync(); };

// ---------- dialogen ----------

export function contactDialog(nr, pre = {}) {
  const c = { naam: '', functie: '', telefoon: '', email: '', primair: !contactsFor(nr).length, ...pre };
  openDialog(`
    <h2>${c.id ? 'Contactpersoon bewerken' : 'Nieuwe contactpersoon'}</h2>
    <label>Naam<input name="naam" value="${h(c.naam)}" required></label>
    <label>Functie<input name="functie" value="${h(c.functie)}" placeholder="bijv. Hotelmanager, Inkoop"></label>
    <div class="row2">
      <label>Telefoon<input name="telefoon" type="tel" value="${h(c.telefoon)}"></label>
      <label>E-mail<input name="email" type="email" value="${h(c.email)}"></label>
    </div>
    <label class="inline"><input type="checkbox" name="primair" ${c.primair ? 'checked' : ''}> Primair aanspreekpunt</label>
    <div class="actions">
      ${c.id ? '<button value="delete" class="btn ghost danger" formnovalidate>Verwijderen</button>' : ''}
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Opslaan</button>
    </div>`, (d, action) => {
    if (action === 'delete') { softDelete('contacts', c.id); return done('Contactpersoon verwijderd'); }
    const primair = !!d.primair;
    if (primair) store.update((s) => s.contacts.filter((x) => String(x.nr) === String(nr)).forEach((x) => { x.primair = false; }));
    upsert('contacts', { id: c.id, nr: Number(nr), naam: d.naam.trim(), functie: d.functie.trim(), telefoon: d.telefoon.trim(), email: d.email.trim(), primair });
    done('Contactpersoon opgeslagen');
  });
}

export function contractDialog(nr, pre = {}) {
  const c = { soort: 'abonnement', omschrijving: '', perMaand: '', eenmalig: '', start: todayISO(), eind: '', opzegMnd: 1, status: 'actief', ...pre };
  openDialog(`
    <h2>${c.id ? 'Contract bewerken' : 'Nieuw contract'}</h2>
    <label>Soort<select name="soort">${Object.entries(CONTRACT_SOORTEN).map(([k, l]) => `<option value="${k}" ${c.soort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Omschrijving<input name="omschrijving" value="${h(c.omschrijving)}" placeholder="bijv. 2× Scent Medium + navulservice" required></label>
    <div class="row2">
      <label>Per maand (€)<input name="perMaand" type="number" min="0" step="1" value="${h(c.perMaand ?? '')}"></label>
      <label>Eenmalig (€)<input name="eenmalig" type="number" min="0" step="1" value="${h(c.eenmalig ?? '')}"></label>
    </div>
    <div class="row3">
      <label>Start<input name="start" type="date" value="${h(c.start)}"></label>
      <label>Einde<input name="eind" type="date" value="${h(c.eind)}"></label>
      <label>Opzeg (mnd)<input name="opzegMnd" type="number" min="0" value="${h(c.opzegMnd ?? '')}"></label>
    </div>
    <div class="row2">
      <label>Looptijd invullen<select id="looptijd"><option value="">–</option><option value="12">12 maanden</option><option value="24">24 maanden</option><option value="36">36 maanden</option><option value="60">60 maanden</option></select></label>
      <label>Status<select name="status"><option value="actief" ${c.status === 'actief' ? 'selected' : ''}>Actief</option><option value="beëindigd" ${c.status === 'beëindigd' ? 'selected' : ''}>Beëindigd</option></select></label>
    </div>
    <div class="actions">
      ${c.id ? '<button value="delete" class="btn ghost danger" formnovalidate>Verwijderen</button>' : ''}
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Opslaan</button>
    </div>`, (d, action) => {
    if (action === 'delete') { softDelete('contracts', c.id); return done('Contract verwijderd'); }
    upsert('contracts', { id: c.id, nr: Number(nr), soort: d.soort, omschrijving: d.omschrijving.trim(), perMaand: Number(d.perMaand) || 0, eenmalig: Number(d.eenmalig) || 0, start: d.start, eind: d.eind, opzegMnd: Number(d.opzegMnd) || 0, status: d.status });
    if (klantStatus(nr) === 'Prospect' || klantStatus(nr) === 'Proefplaatsing') saveProfile(nr, { status: 'Klant' });
    done('Contract opgeslagen');
  });
  const form = $('#dialog form');
  $('#looptijd', form).addEventListener('change', (e) => {
    if (!e.target.value || !form.start.value) return;
    const d = new Date(form.start.value + 'T12:00:00');
    d.setMonth(d.getMonth() + Number(e.target.value));
    d.setDate(d.getDate() - 1);
    form.eind.value = todayISO(d);
  });
}

export function assetDialog(nr, pre = {}) {
  const s = store.get();
  const a = { systeem: profile(nr).systeem || s.settings.systemen[0]?.naam || '', serienummer: '', locatie: '', geplaatst: todayISO(), geur: profile(nr).geurprofiel || '', laatsteOnderhoud: '', status: 'actief', ...pre };
  openDialog(`
    <h2>${a.id ? 'Systeem bewerken' : 'Geplaatst systeem'}</h2>
    <div class="row2">
      <label>Systeem<select name="systeem">${s.settings.systemen.map((x) => `<option ${x.naam === a.systeem ? 'selected' : ''}>${h(x.naam)}</option>`).join('')}</select></label>
      <label>Serienummer<input name="serienummer" value="${h(a.serienummer)}"></label>
    </div>
    <label>Plek in het pand<input name="locatie" value="${h(a.locatie)}" placeholder="bijv. Lobby, Showroom begane grond"></label>
    <div class="row2">
      <label>Geplaatst op<input name="geplaatst" type="date" value="${h(a.geplaatst)}"></label>
      <label>Laatste onderhoud<input name="laatsteOnderhoud" type="date" value="${h(a.laatsteOnderhoud)}"></label>
    </div>
    <div class="row2">
      <label>Geur<input name="geur" value="${h(a.geur)}"></label>
      <label>Status<select name="status">${['gepland', 'actief', 'proef', 'defect', 'verwijderd'].map((x) => `<option ${a.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    </div>
    <label>Onderhoud elke<select name="interval">${[['', 'geen vast schema'], ['3', '3 maanden'], ['6', '6 maanden'], ['12', '12 maanden']].map(([v, l]) => `<option value="${v}" ${String(a.interval || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="actions">
      ${a.id ? '<button value="ticket" class="btn ghost" formnovalidate>+ Ticket</button><button value="delete" class="btn ghost danger" formnovalidate>Verwijderen</button>' : ''}
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Opslaan</button>
    </div>`, (d, action) => {
    if (action === 'delete') { softDelete('assets', a.id); return done('Systeem verwijderd'); }
    if (action === 'ticket') return ticketDialog({ nr, assetId: a.id });
    upsert('assets', { id: a.id, nr: Number(nr), ...d, interval: Number(d.interval) || null });
    done('Systeem opgeslagen');
  });
}

function statusDialog(nr) {
  const p = profile(nr);
  openDialog(`
    <h2>Status & labels</h2>
    <label>Status<select name="status"><option value="">Automatisch (${h(klantStatus(nr))})</option>${KLANT_STATUS.map((x) => `<option ${p.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label>Labels (komma-gescheiden)<input name="labels" value="${h(p.labels || '')}" placeholder="bijv. VIP, keten, jaarcontract"></label>
    <div class="actions">
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Opslaan</button>
    </div>`, (d) => {
    saveProfile(nr, { status: d.status, labels: d.labels.split(',').map((x) => x.trim()).filter(Boolean).join(', ') });
    done('Opgeslagen');
  });
}

// ---------- klantkaart-secties ----------

export function klantCrmHead(nr) {
  const p = profile(nr);
  const labels = (p.labels || '').split(',').map((x) => x.trim()).filter(Boolean);
  return `<div class="crm-head">
    <button class="badge status-badge" id="editStatus" title="Status en labels wijzigen">${h(klantStatus(nr))} ✎</button>
    ${labels.map((l) => `<span class="badge">${h(l)}</span>`).join('')}
    ${mrr(nr) ? `<span class="badge deal">${eur(mrr(nr))} /mnd</span>` : ''}
  </div>`;
}

export function klantCrmSections(nr) {
  const contacts = contactsFor(nr);
  const contracts = store.get().contracts.filter((c) => !c.deleted && String(c.nr) === String(nr)).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  const assets = assetsFor(nr);
  const tickets = store.get().tickets.filter((t) => !t.deleted && String(t.nr) === String(nr));
  const open = tickets.filter(isOpenTicket);
  const today = todayISO();
  return `
    <section class="card">
      <div class="card-head"><h2>Contactpersonen</h2><button class="btn small" id="newContact">+ Contact</button></div>
      <ul class="list compact">${contacts.map((c) => `<li class="clickable" data-contact="${h(c.id)}"><div><b>${h(c.naam)}</b>${c.primair ? ' <span class="badge k-normaal">primair</span>' : ''}<span class="sub">${[c.functie, c.telefoon, c.email].filter(Boolean).map(h).join(' · ') || '–'}</span></div>${c.telefoon ? `<a class="btn small" href="${h(telHref(c.telefoon))}">📞</a>` : ''}${c.email ? `<a class="btn small" href="mailto:${h(c.email)}">✉️</a>` : ''}</li>`).join('') || '<li class="muted">Nog geen contactpersonen.</li>'}</ul>
    </section>

    <section class="card">
      <div class="card-head"><h2>Offertes</h2><a class="btn small" href="#/offerte?nr=${h(nr)}">+ Offerte</a></div>
      <ul class="list compact">${quotesFor(nr).map((q) => `<li><a href="#/offerte?nr=${h(nr)}&id=${h(q.id)}"><b>${h(q.code)} · ${h(q.aantal)}× ${h(q.systeem)}</b><span class="sub">${fmtDate(q.datum)} · ${eur(q.perMaand)} /mnd${q.eenmalig ? ` + ${eur(q.eenmalig)}` : ''}</span></a><span class="badge ${q.status === 'geaccepteerd' ? 'k-normaal' : q.status === 'afgewezen' ? 'k-weinig' : ''}">${h(QUOTE_STATUS[q.status])}</span></li>`).join('') || '<li class="muted">Nog geen offertes.</li>'}</ul>
    </section>

    <section class="card">
      <div class="card-head"><h2>Contracten</h2><button class="btn small" id="newContract">+ Contract</button></div>
      <ul class="list compact">${contracts.map((c) => {
        const ended = c.status === 'beëindigd' || (c.eind && c.eind < today);
        const soon = !ended && c.eind && daysBetween(today, c.eind) <= 60;
        return `<li class="clickable" data-contract="${h(c.id)}"><div><b>${h(c.omschrijving)}</b><span class="sub">${h(CONTRACT_SOORTEN[c.soort] || c.soort)} · ${c.perMaand ? `${eur(c.perMaand)} /mnd` : ''}${c.eenmalig ? ` · ${eur(c.eenmalig)} eenmalig` : ''} · ${fmtDate(c.start)} – ${c.eind ? fmtDate(c.eind) : 'doorlopend'}</span></div>${ended ? '<span class="badge">beëindigd</span>' : soon ? '<span class="badge k-weinig">loopt af</span>' : '<span class="badge k-normaal">actief</span>'}</li>`;
      }).join('') || '<li class="muted">Geen contracten.</li>'}</ul>
    </section>

    <section class="card">
      <div class="card-head"><h2>Geplaatste systemen</h2><button class="btn small" id="newAsset">+ Systeem</button></div>
      <ul class="list compact">${assets.map((a) => `<li class="clickable" data-asset="${h(a.id)}"><div><b>${h(a.systeem)}</b>${a.locatie ? ` · ${h(a.locatie)}` : ''}<span class="sub">${a.serienummer ? `SN ${h(a.serienummer)} · ` : ''}geplaatst ${fmtDate(a.geplaatst)}${a.laatsteOnderhoud ? ` · onderhoud ${fmtDate(a.laatsteOnderhoud)}` : ''}${a.interval ? ` · elke ${h(a.interval)} mnd` : ''}${a.geur ? ` · ${h(a.geur)}` : ''}</span></div><span class="badge ${a.status === 'defect' ? 'k-weinig' : a.status === 'actief' ? 'k-normaal' : ''}">${h(a.status)}</span></li>`).join('') || '<li class="muted">Nog geen systemen geregistreerd.</li>'}</ul>
    </section>

    <section class="card">
      <div class="card-head"><h2>Service</h2><button class="btn small" id="newTicketK">+ Ticket</button></div>
      <ul class="list tickets">${open.map((t) => ticketItem(t, { showKlant: false })).join('') || '<li class="muted">Geen open tickets.</li>'}</ul>
      ${tickets.length > open.length ? `<p class="muted small">${tickets.length - open.length} afgeronde ticket(s) staan in de tijdlijn.</p>` : ''}
    </section>`;
}

export function bindKlantCrm(nr) {
  const s = store.get();
  $('#editStatus')?.addEventListener('click', () => statusDialog(nr));
  $('#newContact')?.addEventListener('click', () => contactDialog(nr));
  $('#newContract')?.addEventListener('click', () => contractDialog(nr));
  $('#newAsset')?.addEventListener('click', () => assetDialog(nr));
  $('#newTicketK')?.addEventListener('click', () => ticketDialog({ nr }));
  $$('[data-contact]').forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('a')) contactDialog(nr, s.contacts.find((x) => x.id === el.dataset.contact)); }));
  $$('[data-contract]').forEach((el) => el.addEventListener('click', () => contractDialog(nr, s.contracts.find((x) => x.id === el.dataset.contract))));
  $$('[data-asset]').forEach((el) => el.addEventListener('click', () => assetDialog(nr, s.assets.find((x) => x.id === el.dataset.asset))));
  bindTicketList();
}

// Afgeronde tickets voor de tijdlijn op de klantkaart.
export function crmTimeline(nr) {
  return store.get().tickets
    .filter((t) => !t.deleted && String(t.nr) === String(nr) && t.gesloten)
    .map((t) => ({ d: t.gesloten, html: `${(TICKET_TYPES[t.type] || '🔧').split(' ')[0]} <b>${h(t.code)}</b> ${h(t.titel)}${t.oplossing ? `<div class="sub">${h(t.oplossing)}</div>` : ''}` }));
}

// ---------- rapportage ----------

function bars(rows, fmt) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bars" role="table">${rows.map((r) => `
    <div class="bar-row" role="row" title="${h(r.label)}: ${h(fmt(r.value))}">
      <span class="bar-label" role="cell">${h(r.label)}</span>
      <span class="bar-track" role="cell"><span class="bar" style="width:${Math.max(r.value ? 2 : 0, (r.value / max) * 100)}%"></span></span>
      <span class="bar-value" role="cell">${h(fmt(r.value))}</span>
    </div>`).join('')}</div>`;
}

function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setMonth(d.getMonth() - i);
    out.push({ key: todayISO(x).slice(0, 7), label: x.toLocaleDateString('nl-NL', { month: 'short' }) });
  }
  return out;
}

export function viewRapport() {
  const s = store.get();
  const today = todayISO();
  const all = stats();
  const totalMrr = mrr();
  const ending = contractsEndingSoon(60);
  const d90 = (iso) => iso && daysBetween(iso, today) <= 90;
  const closed = s.deals.filter((d) => !d.deleted && d.status !== 'open' && d90(d.gesloten));
  const won = closed.filter((d) => d.status === 'gewonnen');
  const conv = closed.length ? Math.round((won.length / closed.length) * 100) : null;
  const months = lastMonths(6);
  const wonPerMonth = months.map((m) => ({ label: m.label, value: s.deals.filter((d) => !d.deleted && d.status === 'gewonnen' && (d.gesloten || '').startsWith(m.key)).reduce((t, d) => t + (d.waarde || 0), 0) }));
  const mlPerMonth = months.map((m) => ({ label: m.label, value: s.visits.filter((v) => v.datum.startsWith(m.key)).reduce((t, v) => t + (Number(v.ml) || 0), 0) }));
  const ticketsPerMonth = months.map((m) => ({ label: m.label, value: s.tickets.filter((t) => !t.deleted && (t.gemeld || '').startsWith(m.key)).length }));
  const sectors = [...s.settings.sectoren, ''].map((sec) => {
    const nrs = s.customers.filter((c) => (profile(c.nr).sector || '') === sec).map((c) => c.nr);
    return { label: sec || 'Zonder sector', klanten: nrs.length, mrr: nrs.reduce((t, nr) => t + mrr(nr), 0), ml: nrs.reduce((t, nr) => t + statFor(all, nr).totaal, 0) };
  }).filter((x) => x.klanten);
  const statusCount = KLANT_STATUS.map((st) => ({ label: st, value: s.customers.filter((c) => klantStatus(c.nr) === st).length }));
  const solved = s.tickets.filter((t) => !t.deleted && t.gesloten && d90(t.gesloten));
  const avgDays = solved.length ? Math.round((solved.reduce((t, x) => t + Math.max(0, daysBetween(x.gemeld, x.gesloten)), 0) / solved.length) * 10) / 10 : null;
  const openByType = Object.entries(TICKET_TYPES).map(([k, l]) => ({ label: l.split(' ').slice(1).join(' '), value: openTickets().filter((t) => t.type === k).length })).filter((x) => x.value);
  const top = s.customers.map((c) => ({ c, st: statFor(all, c.nr) })).filter((x) => x.st.totaal).sort((a, b) => b.st.totaal - a.st.totaal).slice(0, 8);

  return `
    <a class="back" href="#/meer">‹ Meer</a>
    <h1>Rapportage</h1>
    <section class="kpis">
      <div class="kpi"><span>Terugkerend per maand (MRR)</span><b>${eur(totalMrr)}</b><small>${activeContracts().length} actieve contracten</small></div>
      <div class="kpi"><span>Per jaar (ARR)</span><b>${eur(totalMrr * 12)}</b></div>
      <div class="kpi"><span>Open pipeline</span><b>${eur(openDeals().reduce((t, d) => t + d.waarde, 0))}</b><small>${openDeals().length} deals</small></div>
      <div class="kpi"><span>Conversie (90 dagen)</span><b>${conv === null ? '–' : conv + '%'}</b><small>${won.length} gewonnen / ${closed.length} gesloten</small></div>
    </section>

    ${ending.length ? `<section class="card"><h2>Contracten die binnen 60 dagen aflopen</h2><ul class="list compact">${ending.map((c) => `<li><a href="#/klant/${h(c.nr)}"><b>${h(customer(c.nr)?.naam || c.nr)}</b><span class="sub">${h(c.omschrijving)} · ${eur(c.perMaand)} /mnd</span></a><span class="badge k-weinig">${fmtDate(c.eind)}</span></li>`).join('')}</ul></section>` : ''}

    <section class="card"><h2>Gewonnen dealwaarde per maand</h2>${bars(wonPerMonth, eur)}</section>
    <section class="card"><h2>Verbruik per maand</h2>${bars(mlPerMonth, ml)}</section>

    <section class="card">
      <h2>Per sector</h2>
      <div class="table-wrap"><table class="q-table">
        <thead><tr><th>Sector</th><th>Klanten</th><th>MRR</th><th>Verbruik</th></tr></thead>
        <tbody>${sectors.map((x) => `<tr><td>${h(x.label)}</td><td>${x.klanten}</td><td>${eur(x.mrr)}</td><td>${ml(x.ml)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    <section class="card"><h2>Klanten per status</h2>${bars(statusCount, String)}</section>

    <section class="card">
      <h2>Service</h2>
      <p>${openTickets().length} open tickets · gemiddeld ${avgDays === null ? '–' : `${avgDays} dagen`} van melding tot oplossing (90 dagen)</p>
      ${openByType.length ? `<h3>Open tickets per type</h3>${bars(openByType, String)}` : ''}
      <h3>Nieuwe tickets per maand</h3>${bars(ticketsPerMonth, String)}
    </section>

    <section class="card">
      <h2>Top klanten op verbruik</h2>
      <ul class="list compact">${top.map(({ c, st }) => `<li><a href="#/klant/${h(c.nr)}"><b>${h(c.naam)}</b><span class="sub">${h(c.plaats)} · ${st.bezoeken} bezoeken</span></a><b>${ml(st.totaal)}</b></li>`).join('') || '<li class="muted">Nog geen verbruik vastgelegd.</li>'}</ul>
    </section>`;
}
