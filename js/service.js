// Service: tickets, service-agenda en helpdeskroute.
import {
  store, customer, todayISO, daysBetween, fullAddress, knownGeuren, uid, now, statFor, stats,
  TICKET_TYPES, TICKET_PRIO, TICKET_STATUS, TICKET_DUUR, isOpenTicket, openTickets, newTicket, refillsWithoutTicket, assetsFor,
  contactsFor, maintenanceDue, createMaintenanceTickets,
} from './store.js';
import { planFromSelection, mapsRouteUrls } from './planner.js';
import { putBlob, getBlob, deleteBlob, compressImage, signaturePad } from './media.js';
import { shareOrDownloadReport } from './report.js';
import { activatePlannedAssets } from './quotes.js';
import { planServiceWithClaude, claudeReady } from './claude.js';
import { consumeStock, adjustStock, activeStock, lowStock, materialText, seedStock } from './stock.js';
import { $, $$, h, fmtDate, toast, weekStart, openDialog, klantOptions, hooks } from './ui.js';

const prioBadge = (p) => `<span class="badge prio-${h(p)}">${h(TICKET_PRIO[p] || p)}</span>`;
const statusBadge = (s) => `<span class="badge st-${h(s)}">${h(TICKET_STATUS[s] || s)}</span>`;
const typeIcon = (t) => (TICKET_TYPES[t] || '•').split(' ')[0];

function assetOptions(nr, selected) {
  const list = assetsFor(nr);
  return `<option value="">– geen specifiek systeem –</option>${list.map((a) => `<option value="${h(a.id)}" ${a.id === selected ? 'selected' : ''}>${h(a.systeem)}${a.locatie ? ` · ${h(a.locatie)}` : ''}${a.serienummer ? ` · ${h(a.serienummer)}` : ''}</option>`).join('')}`;
}

export function ticketItem(t, { showKlant = true } = {}) {
  const c = customer(t.nr);
  const late = isOpenTicket(t) && t.datum && t.datum < todayISO();
  return `<li class="ticket clickable prio-line-${h(t.prioriteit)}" data-ticket="${h(t.id)}">
    <div class="grow">
      <div class="t"><span class="code">${h(t.code)}</span> ${typeIcon(t.type)} <b>${h(t.titel || TICKET_TYPES[t.type])}</b></div>
      <div class="sub">${showKlant && c ? `${h(c.naam)} · ${h(c.plaats)} · ` : ''}${t.datum ? `<span class="${late ? 'late' : ''}">${fmtDate(t.datum)}${t.tijd ? ' ' + h(t.tijd) : ''}</span>` : 'niet ingepland'}</div>
    </div>
    <div class="ticket-badges">${prioBadge(t.prioriteit)}${statusBadge(t.status)}</div>
  </li>`;
}

export function bindTicketList(root = document) {
  $$('[data-ticket]', root).forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('a,button')) return;
    ticketDialog(store.get().tickets.find((t) => t.id === el.dataset.ticket));
  }));
}

export function ticketDialog(pre = {}) {
  const isNew = !pre.id;
  const t = { type: 'storing', prioriteit: 'normaal', status: 'nieuw', titel: '', omschrijving: '', melder: '', datum: '', tijd: '', duur: '', assetId: '', ...pre };
  const form = openDialog(`
    <h2>${isNew ? 'Nieuw ticket' : `Ticket ${h(t.code)}`}</h2>
    <label>Klant<select name="nr" required>${isNew && !t.nr ? '<option value="">Kies klant…</option>' : ''}${klantOptions(t.nr)}</select></label>
    <label>Systeem<select name="assetId">${t.nr ? assetOptions(t.nr, t.assetId) : '<option value="">– kies eerst een klant –</option>'}</select></label>
    <div class="chips-radio">
      ${Object.entries(TICKET_TYPES).map(([k, l]) => `<label><input type="radio" name="type" value="${k}" ${t.type === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </div>
    <label>Korte omschrijving<input name="titel" value="${h(t.titel)}" placeholder="bijv. Machine verneveld niet meer" required></label>
    <label>Details<textarea name="omschrijving" rows="2">${h(t.omschrijving)}</textarea></label>
    <div class="row2">
      <label>Prioriteit<select name="prioriteit">${Object.entries(TICKET_PRIO).map(([k, l]) => `<option value="${k}" ${t.prioriteit === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Gemeld door<input name="melder" value="${h(t.melder)}" placeholder="naam / telefoon"></label>
    </div>
    <div class="row3">
      <label>Datum<input type="date" name="datum" value="${h(t.datum)}"></label>
      <label>Tijd<input type="time" name="tijd" value="${h(t.tijd)}"></label>
      <label>Duur (min)<input type="number" name="duur" min="5" step="5" value="${h(t.duur || TICKET_DUUR[t.type])}"></label>
    </div>
    ${isNew ? '' : `<label>Status<select name="status">${Object.entries(TICKET_STATUS).map(([k, l]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
    ${t.oplossing ? `<p class="claude-note"><b>Oplossing:</b> ${h(t.oplossing)}${t.materiaal ? `<br><b>Materiaal:</b> ${h(t.materiaal)}` : ''}</p>` : ''}
    ${isNew ? '' : `<div class="ticket-media"></div>${isOpenTicket(t) ? `<fieldset><legend>Foto's bij de melding</legend>${photoField}</fieldset>` : ''}`}
    <div class="actions">
      ${isNew ? '' : '<button value="delete" class="btn ghost danger" formnovalidate>Verwijderen</button>'}
      ${!isNew && isOpenTicket(t) ? '<button value="close" class="btn ghost ok">Afronden…</button>' : ''}
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Opslaan</button>
    </div>`, (d, action) => {
    const fields = { ...d, nr: Number(d.nr), duur: Number(d.duur) || TICKET_DUUR[d.type] };
    if (picker) fields.fotos = picker.ids;
    if (isNew) {
      const created = newTicket(fields);
      toast(`Ticket ${created.code} aangemaakt`);
    } else {
      store.update((s) => {
        const x = s.tickets.find((y) => y.id === t.id);
        if (action === 'delete') x.deleted = true;
        else {
          Object.assign(x, fields);
          if (x.status === 'nieuw' && x.datum) x.status = 'ingepland';
        }
        x.updatedAt = now();
      });
      toast(action === 'delete' ? 'Ticket verwijderd' : 'Ticket opgeslagen');
    }
    hooks.render();
    hooks.sync();
    if (action === 'close') closeTicketDialog(store.get().tickets.find((y) => y.id === t.id));
  });
  const picker = !isNew && isOpenTicket(t) ? photoPicker($('.photos', form).parentElement, t.fotos || []) : null;
  if (!isNew) fillTicketMedia(form, t);
  // Systemenlijst en standaardduur volgen de gekozen klant en het type.
  form.nr.addEventListener('change', () => { form.assetId.innerHTML = assetOptions(form.nr.value, ''); });
  $$('input[name=type]', form).forEach((r) => r.addEventListener('change', () => { if (isNew) form.duur.value = TICKET_DUUR[r.value]; }));
}

// Foto's kiezen of maken: verkleind opgeslagen, als miniatuur getoond, verwijderbaar vóór opslaan.
function photoPicker(root, initial = []) {
  const ids = [...initial];
  const fresh = new Set();
  const grid = $('.photo-grid', root);
  const draw = async () => {
    grid.innerHTML = '';
    for (const id of ids) {
      const blob = await getBlob(id);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      grid.insertAdjacentHTML('beforeend', `<figure class="thumb"><img src="${url}" alt="Foto"><button type="button" class="icon" data-rm="${h(id)}" aria-label="Foto verwijderen">✕</button></figure>`);
    }
    $$('[data-rm]', grid).forEach((b) => b.addEventListener('click', () => {
      ids.splice(ids.indexOf(b.dataset.rm), 1);
      if (fresh.has(b.dataset.rm)) deleteBlob(b.dataset.rm);
      draw();
    }));
  };
  $('input[type=file]', root).addEventListener('change', async (e) => {
    for (const f of e.target.files) {
      try {
        const blob = await compressImage(f);
        const id = await putBlob(blob);
        ids.push(id);
        fresh.add(id);
      } catch {
        toast('Deze foto kon niet worden gelezen.');
      }
    }
    e.target.value = '';
    draw();
  });
  draw();
  return { ids, discard: () => fresh.forEach((id) => deleteBlob(id)) };
}

const photoField = `<div class="photos"><div class="photo-grid"></div><label class="btn small">📷 Foto toevoegen<input type="file" accept="image/*" capture="environment" multiple hidden></label></div>`;

export function closeTicketDialog(t) {
  const s0 = store.get();
  const st = statFor(stats(), t.nr);
  const logsVisit = ['navulling', 'onderhoud', 'installatie'].includes(t.type);
  const primary = contactsFor(t.nr)[0];
  let saved = false;
  const form = openDialog(`
    <h2>${h(t.code)} afronden</h2>
    <p class="muted">${h(customer(t.nr)?.naam || '')} · ${h(t.titel)}</p>
    <label>Wat is er gedaan?<textarea name="oplossing" rows="3" required placeholder="bijv. Pomp vervangen, geur bijgevuld, instellingen aangepast"></textarea></label>
    <fieldset>
      <legend>Gebruikt materiaal</legend>
      ${activeStock().length ? `<div class="stock-pick">${activeStock().map((it) => `<label class="stock-row"><span>${h(it.naam)} <span class="sub">${h(it.voorraad)} ${h(it.eenheid || '')} in de bus</span></span><input type="number" name="stock_${h(it.id)}" min="0" step="1" inputmode="numeric" placeholder="0"></label>`).join('')}</div>` : ''}
      <label>Overig materiaal<input name="materiaal" placeholder="bijv. kabelgoot 1 m"></label>
    </fieldset>
    ${logsVisit ? `
      <fieldset>
        <legend>Verbruik vastleggen (optioneel)</legend>
        <div class="row3">
          <label>ml<input name="ml" type="number" min="0" inputmode="numeric"></label>
          <label>Geur<input name="geur" list="geurenT" value="${h(st.laatsteGeur)}"></label>
          <label>Instellingen<input name="instellingen" value="${h(st.laatsteInstellingen)}"></label>
        </div>
        <datalist id="geurenT">${knownGeuren().map((g) => `<option value="${h(g)}">`).join('')}</datalist>
      </fieldset>` : ''}
    <fieldset><legend>Foto's</legend>${photoField}</fieldset>
    <fieldset>
      <legend>Handtekening klant</legend>
      <canvas class="sig" aria-label="Handtekeningveld"></canvas>
      <div class="row2">
        <label>Naam ondertekenaar<input name="getekendDoor" value="${h(primary?.naam || '')}"></label>
        <label>&nbsp;<button type="button" class="btn small ghost" id="sigClear">Wissen</button></label>
      </div>
    </fieldset>
    <div class="row2">
      <label>Monteur<input name="monteur" value="${h(s0.settings.monteur)}"></label>
      <label class="inline"><input type="checkbox" name="rapport" checked> PDF-rapport maken</label>
    </div>
    <div class="actions">
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Afronden</button>
    </div>`, async (d) => {
    saved = true;
    const today = todayISO();
    const tijd = new Date().toTimeString().slice(0, 5);
    const sigId = pad.isEmpty() ? '' : await putBlob(await pad.toBlob());
    const used = Object.entries(d).filter(([k, v]) => k.startsWith('stock_') && Number(v) > 0).map(([k, v]) => ({ id: k.slice(6), n: Number(v) }));
    const materiaal = [materialText(used), d.materiaal.trim()].filter(Boolean).join(', ');
    store.update((s) => {
      const x = s.tickets.find((y) => y.id === t.id);
      Object.assign(x, {
        status: 'opgelost', oplossing: d.oplossing.trim(), materiaal, gesloten: today, geslotenTijd: tijd,
        monteur: d.monteur.trim(), fotos: photos.ids, handtekening: sigId || x.handtekening || '', getekendDoor: d.getekendDoor.trim(), updatedAt: now(),
      });
      if (d.monteur.trim()) s.settings.monteur = d.monteur.trim();
      if (x.assetId && ['onderhoud', 'storing', 'navulling'].includes(x.type)) {
        const a = s.assets.find((y) => y.id === x.assetId);
        if (a) { a.laatsteOnderhoud = today; a.updatedAt = now(); }
      }
      if (Number(d.ml)) {
        s.visits.push({ id: uid(), datum: today, nr: x.nr, ml: Number(d.ml), geur: (d.geur || '').trim(), instellingen: (d.instellingen || '').trim(), opmerking: `${x.code}: ${d.oplossing.trim()}`, pending: true });
      }
    });
    consumeStock(used, t.code);
    if (t.type === 'installatie') activatePlannedAssets(t.nr);
    toast(`${t.code} afgerond${Number(d.ml) ? ' en verbruik vastgelegd' : ''}`);
    hooks.render();
    hooks.sync();
    if (d.rapport) {
      try {
        const how = await shareOrDownloadReport(store.get().tickets.find((y) => y.id === t.id));
        if (how !== 'geannuleerd') toast(`Servicerapport ${how}`);
      } catch (e) {
        toast('Rapport maken mislukt: ' + e.message, 5000);
      }
    }
  });
  const photos = photoPicker(form, t.fotos || []);
  const pad = signaturePad($('canvas.sig', form));
  $('#sigClear', form).addEventListener('click', () => pad.clear());
  $('#dialog').addEventListener('close', () => { if (!saved) photos.discard(); }, { once: true });
}

// Foto's, handtekening en rapportknop in het ticketvenster.
async function fillTicketMedia(form, t) {
  const box = $('.ticket-media', form);
  if (!box) return;
  const fotos = (t.fotos || []).filter(Boolean);
  const urls = [];
  for (const id of fotos) { const b = await getBlob(id); if (b) urls.push(URL.createObjectURL(b)); }
  const sig = t.handtekening ? await getBlob(t.handtekening) : null;
  box.innerHTML = `${urls.length ? `<div class="photo-grid">${urls.map((u) => `<figure class="thumb"><img src="${u}" alt="Foto"></figure>`).join('')}</div>` : ''}
    ${sig ? `<p class="muted small">Getekend door ${h(t.getekendDoor || 'klant')}</p><img class="sig-img" src="${URL.createObjectURL(sig)}" alt="Handtekening">` : ''}
    ${t.gesloten ? '<button type="button" class="btn" id="mkReport">📄 Servicerapport (PDF)</button>' : ''}`;
  $('#mkReport', box)?.addEventListener('click', async () => {
    try {
      const how = await shareOrDownloadReport(t);
      if (how !== 'geannuleerd') toast(`Servicerapport ${how}`);
    } catch (e) {
      toast('Rapport maken mislukt: ' + e.message, 5000);
    }
  });
}

// ---------- scherm ----------

let ticketFilter = { status: 'open', type: '' };

function tabsNav(active, extra = '') {
  return `<nav class="segmented" aria-label="Service">
    ${[['tickets', 'Tickets'], ['agenda', 'Agenda'], ['route', 'Route'], ['voorraad', 'Voorraad']].map(([k, l]) => `<a href="#/service?tab=${k}${extra}" class="${active === k ? 'on' : ''}">${l}</a>`).join('')}
  </nav>`;
}

export function viewService(params) {
  const tab = params.get('tab') || 'tickets';
  const body = tab === 'agenda' ? agenda(params) : tab === 'route' ? route(params) : tab === 'voorraad' ? voorraad() : tickets();
  return `<div class="card-head"><h1>Service</h1><button class="btn primary small" id="newTicket">+ Ticket</button></div>${tabsNav(tab)}${body}`;
}

function tickets() {
  const s = store.get();
  const today = todayISO();
  const open = openTickets();
  const ws = weekStart();
  const solvedWeek = s.tickets.filter((t) => !t.deleted && t.gesloten && t.gesloten >= ws).length;
  const suggest = refillsWithoutTicket();
  let list = ticketFilter.status === 'open' ? open : s.tickets.filter((t) => !t.deleted).sort((a, b) => b.gemeld.localeCompare(a.gemeld));
  if (ticketFilter.status !== 'open' && ticketFilter.status !== 'alle') list = list.filter((t) => t.status === ticketFilter.status);
  if (ticketFilter.type) list = list.filter((t) => t.type === ticketFilter.type);
  return `
    <section class="kpis">
      <div class="kpi"><span>Open tickets</span><b>${open.length}</b></div>
      <div class="kpi"><span>Spoed / hoog</span><b>${open.filter((t) => ['spoed', 'hoog'].includes(t.prioriteit)).length}</b></div>
      <div class="kpi"><span>Vandaag ingepland</span><b>${open.filter((t) => t.datum === today).length}</b></div>
      <div class="kpi"><span>Opgelost deze week</span><b>${solvedWeek}</b></div>
    </section>
    ${maintenanceDue().length ? `<section class="card">
      <div class="card-head"><h2>🔧 Onderhoud gepland</h2><button class="btn small" id="mkMaint">Maak ${maintenanceDue().length} onderhoudsticket${maintenanceDue().length > 1 ? 's' : ''}</button></div>
      <p class="muted small">Systemen met een onderhoudsinterval die binnen ${store.get().settings.onderhoudVooruit} dagen aan de beurt zijn.</p>
    </section>` : ''}
    ${suggest.length ? `<section class="card">
      <div class="card-head"><h2>🧴 Navulling voorspeld</h2><button class="btn small" id="mkRefills">Maak ${suggest.length} navulticket${suggest.length > 1 ? 's' : ''}</button></div>
      <p class="muted small">Deze klanten zijn volgens hun verbruik binnenkort leeg en hebben nog geen open navulticket: ${suggest.slice(0, 6).map((x) => h(x.c.naam)).join(', ')}${suggest.length > 6 ? ' …' : ''}.</p>
    </section>` : ''}
    <div class="searchbar">
      <select id="tStatus" aria-label="Status">
        ${[['open', 'Open tickets'], ['alle', 'Alle tickets'], ...Object.entries(TICKET_STATUS)].map(([k, l]) => `<option value="${k}" ${ticketFilter.status === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select id="tType" aria-label="Type"><option value="">Alle typen</option>${Object.entries(TICKET_TYPES).map(([k, l]) => `<option value="${k}" ${ticketFilter.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <ul class="list tickets">${list.map((t) => ticketItem(t)).join('') || '<li class="muted">Geen tickets.</li>'}</ul>`;
}

function agenda(params) {
  const s = store.get();
  const start = params.get('w') || weekStart();
  const shift = (n) => { const d = new Date(start + 'T12:00:00'); d.setDate(d.getDate() + n); return todayISO(d); };
  const days = [...Array(7)].map((_, i) => shift(i));
  const unplanned = openTickets().filter((t) => !t.datum);
  return `
    <div class="week-nav">
      <a class="btn small" href="#/service?tab=agenda&w=${shift(-7)}">‹ Vorige</a>
      <b>Week van ${fmtDate(start)}</b>
      <a class="btn small" href="#/service?tab=agenda&w=${shift(7)}">Volgende ›</a>
    </div>
    <div class="agenda">
      ${days.map((d) => {
        const list = s.tickets.filter((t) => !t.deleted && t.datum === d).sort((a, b) => (a.tijd || '99').localeCompare(b.tijd || '99'));
        const sales = s.plans[d]?.stops.length || 0;
        const minuten = list.filter(isOpenTicket).reduce((m, t) => m + (Number(t.duur) || 0), 0);
        return `<section class="day ${d === todayISO() ? 'today' : ''}">
          <header><b>${fmtDate(d)}</b><span class="muted small">${list.length ? `${list.length} ticket${list.length > 1 ? 's' : ''} · ${Math.round(minuten / 6) / 10} u werk` : 'vrij'}${sales ? ` · ${sales} salesbezoeken` : ''}</span></header>
          <ul class="list compact">${list.map((t) => ticketItem(t)).join('')}</ul>
          ${list.some(isOpenTicket) ? `<a class="btn small" href="#/service?tab=route&d=${d}">🗺️ Route</a>` : ''}
        </section>`;
      }).join('')}
    </div>
    <section class="card">
      <h2>Nog niet ingepland (${unplanned.length})</h2>
      <ul class="list tickets">${unplanned.map((t) => ticketItem(t)).join('') || '<li class="muted">Alles is ingepland.</li>'}</ul>
    </section>`;
}

function voorraad() {
  const s = store.get();
  const items = activeStock();
  const low = new Set(lowStock().map((x) => x.id));
  const moves = s.stockMoves.slice(-12).reverse();
  return `
    ${low.size ? `<p class="alert">⚠️ ${low.size} artikel(en) op of onder het minimum. Bijbestellen of aanvullen.</p>` : ''}
    <section class="card">
      <div class="card-head"><h2>Voorraad in de bus</h2><button class="btn small" id="newStock">+ Artikel</button></div>
      ${items.length ? `<ul class="list stock">${items.map((it) => `<li>
        <div class="grow" data-stock="${h(it.id)}"><b>${h(it.naam)}</b><span class="sub">minimum ${h(it.minimum ?? 0)} ${h(it.eenheid || '')}</span></div>
        <button class="icon" data-dec="${h(it.id)}" aria-label="Eén minder">−</button>
        <b class="stock-n ${low.has(it.id) ? 'late' : ''}">${h(it.voorraad)}</b>
        <button class="icon" data-inc="${h(it.id)}" aria-label="Eén meer">+</button>
      </li>`).join('')}</ul>` : `<p class="muted">Nog geen artikelen.</p><button class="btn" id="seedStock">Standaardlijst gebruiken (geurpatronen en onderdelen)</button>`}
    </section>
    ${moves.length ? `<section class="card"><h2>Laatste mutaties</h2><ul class="list compact">${moves.map((m) => `<li><div><b>${m.n > 0 ? '+' : ''}${h(m.n)} ${h(s.stock.find((x) => x.id === m.itemId)?.naam || '')}</b><span class="sub">${fmtDate(m.datum)} · ${h(m.reden)}</span></div></li>`).join('')}</ul></section>` : ''}`;
}

function stockDialog(pre = {}) {
  const it = { naam: '', eenheid: 'st', voorraad: 0, minimum: 1, ...pre };
  openDialog(`
    <h2>${it.id ? 'Artikel bewerken' : 'Nieuw artikel'}</h2>
    <label>Naam<input name="naam" value="${h(it.naam)}" required></label>
    <div class="row3">
      <label>Eenheid<input name="eenheid" value="${h(it.eenheid)}"></label>
      <label>Voorraad<input name="voorraad" type="number" step="1" value="${h(it.voorraad)}"></label>
      <label>Minimum<input name="minimum" type="number" step="1" value="${h(it.minimum)}"></label>
    </div>
    <div class="actions">
      ${it.id ? '<button value="delete" class="btn ghost danger" formnovalidate>Verwijderen</button>' : ''}
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Opslaan</button>
    </div>`, (d, action) => {
    store.update((s) => {
      if (it.id) {
        const x = s.stock.find((y) => y.id === it.id);
        if (action === 'delete') x.deleted = true;
        else Object.assign(x, { naam: d.naam.trim(), eenheid: d.eenheid.trim(), voorraad: Number(d.voorraad) || 0, minimum: Number(d.minimum) || 0 });
        x.updatedAt = now();
      } else {
        s.stock.push({ id: uid(), naam: d.naam.trim(), eenheid: d.eenheid.trim(), voorraad: Number(d.voorraad) || 0, minimum: Number(d.minimum) || 0, deleted: false, updatedAt: now() });
      }
    });
    toast('Voorraad opgeslagen');
    hooks.render();
    hooks.sync();
  });
}

// Route voor één dag: tickets per klant samengevoegd, volgorde geoptimaliseerd, spoed eerst waar mogelijk.
function buildRoute(datum) {
  const list = openTickets().filter((t) => t.datum === datum);
  const perKlant = new Map();
  for (const t of list) {
    const k = String(t.nr);
    perKlant.set(k, [...(perKlant.get(k) || []), t]);
  }
  if (!perKlant.size) return { plan: null, perKlant };
  const duur = Object.fromEntries([...perKlant].map(([k, ts]) => [k, ts.reduce((m, t) => m + (Number(t.duur) || 30), 0)]));
  const redenen = Object.fromEntries([...perKlant].map(([k, ts]) => [k, ts.map((t) => `${t.code} ${TICKET_TYPES[t.type].split(' ').slice(1).join(' ')}${t.prioriteit === 'spoed' ? ' (SPOED)' : ''}`).join(', ')]));
  const plan = planFromSelection({ datum, nrs: [...perKlant.keys()], redenen, door: 'service', duur });
  return { plan, perKlant };
}

let svcAsk = '';
let svcBusy = false;
let svcStatus = '';
let svcProposal = null;
let svcCtl = null;

function claudeServiceCard(datum) {
  if (!claudeReady()) return '';
  const prop = svcProposal?.datum === datum ? svcProposal : null;
  const byCode = new Map(store.get().tickets.map((t) => [t.code, t]));
  return `<section class="card form claude-card">
    <h2>✨ Helpdeskdag met Claude</h2>
    <label>Wensen voor deze dag<textarea id="svcAsk" rows="2" placeholder="bijv. Eerst de spoedstoring, daarna alles in Zeeland, om 15:00 terug">${h(svcAsk)}</textarea></label>
    <div class="actions left">
      <button class="btn primary" id="svcPlan" type="button" ${svcBusy ? 'disabled' : ''}>${svcBusy ? 'Claude plant…' : 'Laat Claude kiezen'}</button>
      ${svcBusy ? '<button class="btn ghost" id="svcStop" type="button">Stop</button>' : ''}
    </div>
    <p class="muted small">${h(svcStatus)}</p>
    ${prop ? `<p class="claude-note">${h(prop.toelichting)}</p>
      <ul class="list tickets">${prop.tickets.map((x) => { const t = byCode.get(x.code); return t ? `<li><label class="inline grow"><input type="checkbox" data-prop="${h(t.id)}" checked> <span><span class="code">${h(t.code)}</span> ${typeIcon(t.type)} ${h(t.titel)} <span class="sub">${h(customer(t.nr)?.naam || '')} · ${h(x.reden)}</span></span></label>${prioBadge(t.prioriteit)}</li>` : ''; }).join('')}</ul>
      <div class="actions left"><button class="btn primary" id="svcApply">Inplannen op ${fmtDate(datum)}</button></div>` : ''}
  </section>`;
}

function route(params) {
  const s = store.get();
  const datum = params.get('d') || todayISO();
  const { plan, perKlant } = buildRoute(datum);
  const unplanned = openTickets().filter((t) => !t.datum);
  return `
    <section class="card form">
      <label>Datum<input type="date" id="routeDate" value="${h(datum)}"></label>
    </section>
    ${claudeServiceCard(datum)}
    ${plan ? `
      <section class="card">
        <h2>Helpdeskroute ${fmtDate(datum)}</h2>
        <ol class="route">
          <li class="depot"><time>${h(plan.startTijd)}</time><div class="grow">Vertrek ${h(s.settings.startPlaats)}</div></li>
          ${plan.stops.map((st) => {
            const c = customer(st.nr);
            const ts = perKlant.get(String(st.nr)) || [];
            return `<li>
              <time>${h(st.aankomst)}<small>${h(st.vertrek)}</small></time>
              <div class="grow">
                <a href="#/klant/${h(c.nr)}"><b>${h(c.naam)}</b></a>
                <div class="sub">${h(fullAddress(c))}</div>
                <div class="sub">🚗 ${st.reis} min</div>
                <ul class="list compact">${ts.map((t) => ticketItem(t, { showKlant: false })).join('')}</ul>
                <div class="actions left">${ts.map((t) => `${t.status !== 'onderweg' ? `<button class="btn small" data-onderweg="${h(t.id)}">Onderweg</button>` : ''}<button class="btn small primary" data-close="${h(t.id)}">${h(t.code)} afronden</button>`).join('')}</div>
              </div>
            </li>`;
          }).join('')}
          <li class="depot"><time>${h(plan.terug)}</time><div class="grow">Terug in ${h(s.settings.startPlaats)} (${plan.terugReis} min)</div></li>
        </ol>
        <p class="muted small">Totale reistijd ca. ${Math.floor(plan.totaalReis / 60)} u ${plan.totaalReis % 60} min. Reistijden zijn een schatting.${plan.teLaat ? ' ⚠️ Deze dag loopt uit na de eindtijd.' : ''}</p>
        <div class="actions left">
          ${mapsRouteUrls(plan).map((u, i, all) => `<a class="btn" href="${h(u)}" target="_blank" rel="noopener">🧭 Google Maps${all.length > 1 ? ` deel ${i + 1}/${all.length}` : ''}</a>`).join('')}
          <button class="btn" id="setTimes">Tijden in tickets zetten</button>
        </div>
      </section>` : '<p class="card muted">Geen open tickets op deze dag.</p>'}
    ${unplanned.length ? `
      <section class="card">
        <h2>Toevoegen aan deze dag</h2>
        <ul class="list tickets">${unplanned.map((t) => `<li><label class="inline grow"><input type="checkbox" data-add="${h(t.id)}"> <span><span class="code">${h(t.code)}</span> ${typeIcon(t.type)} ${h(t.titel)} <span class="sub">${h(customer(t.nr)?.naam || '')} · ${h(customer(t.nr)?.plaats || '')}</span></span></label>${prioBadge(t.prioriteit)}</li>`).join('')}</ul>
        <div class="actions left"><button class="btn primary" id="addToDay">Inplannen op ${fmtDate(datum)}</button></div>
      </section>` : ''}`;
}

viewService.after = (params) => {
  const tab = params.get('tab') || 'tickets';
  $('#newTicket')?.addEventListener('click', () => ticketDialog({ datum: tab === 'route' ? params.get('d') || todayISO() : '' }));
  bindTicketList();
  $('#tStatus')?.addEventListener('change', (e) => { ticketFilter.status = e.target.value; hooks.render(); });
  $('#tType')?.addEventListener('change', (e) => { ticketFilter.type = e.target.value; hooks.render(); });
  $('#mkMaint')?.addEventListener('click', () => {
    const n = createMaintenanceTickets();
    toast(`${n} onderhoudsticket(s) aangemaakt`);
    hooks.render();
    hooks.sync();
  });
  $('#mkRefills')?.addEventListener('click', () => {
    const list = refillsWithoutTicket();
    for (const { c, f } of list) {
      newTicket({
        nr: c.nr, type: 'navulling', prioriteit: f.dagenResterend < 0 ? 'hoog' : 'normaal',
        titel: f.dagenResterend < 0 ? 'Geur waarschijnlijk op — navullen' : `Navullen vóór ${fmtDate(f.leeg)}`,
        omschrijving: `Voorspeld verbruik ${Math.round(f.perDag)} ml/dag, flacon ${f.inhoud} ml.`, melder: 'Navulvoorspelling',
      });
    }
    toast(`${list.length} navulticket(s) aangemaakt`);
    hooks.render();
    hooks.sync();
  });
  $('#newStock')?.addEventListener('click', () => stockDialog());
  $('#seedStock')?.addEventListener('click', () => { seedStock(); hooks.render(); hooks.sync(); });
  $$('[data-stock]').forEach((el) => el.addEventListener('click', () => stockDialog(store.get().stock.find((x) => x.id === el.dataset.stock))));
  $$('[data-inc]').forEach((b) => b.addEventListener('click', () => { adjustStock(b.dataset.inc, 1, 'Aangevuld'); hooks.render(); hooks.sync(); }));
  $$('[data-dec]').forEach((b) => b.addEventListener('click', () => { adjustStock(b.dataset.dec, -1, 'Handmatig afgeboekt'); hooks.render(); hooks.sync(); }));
  const dateEl = $('#routeDate');
  dateEl?.addEventListener('change', () => { location.hash = `#/service?tab=route&d=${dateEl.value}`; });
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeTicketDialog(store.get().tickets.find((t) => t.id === b.dataset.close))));
  $$('[data-onderweg]').forEach((b) => b.addEventListener('click', () => {
    store.update((s) => { const t = s.tickets.find((x) => x.id === b.dataset.onderweg); t.status = 'onderweg'; t.updatedAt = now(); });
    hooks.render();
    hooks.sync();
  }));
  $('#setTimes')?.addEventListener('click', () => {
    const { plan, perKlant } = buildRoute(dateEl.value);
    store.update(() => {
      for (const st of plan.stops) for (const t of perKlant.get(String(st.nr)) || []) { t.tijd = st.aankomst; t.updatedAt = now(); }
    });
    toast('Tijden bijgewerkt in de tickets');
    hooks.render();
    hooks.sync();
  });
  $('#svcAsk')?.addEventListener('input', (e) => { svcAsk = e.target.value; });
  $('#svcStop')?.addEventListener('click', () => svcCtl?.abort());
  $('#svcPlan')?.addEventListener('click', async () => {
    svcBusy = true;
    svcStatus = 'Claude bekijkt de open tickets. Dit duurt meestal 20 tot 60 seconden.';
    svcCtl = new AbortController();
    hooks.render();
    try {
      svcProposal = await planServiceWithClaude({ datum: dateEl.value, opdracht: svcAsk, signal: svcCtl.signal });
      svcStatus = '';
    } catch (e) {
      svcStatus = e.name === 'AbortError' ? 'Gestopt.' : e.message;
    } finally {
      svcBusy = false;
      svcCtl = null;
      hooks.render();
    }
  });
  $('#svcApply')?.addEventListener('click', () => {
    const ids = $$('[data-prop]').filter((c) => c.checked).map((c) => c.dataset.prop);
    store.update((s) => s.tickets.filter((t) => ids.includes(t.id)).forEach((t) => { t.datum = dateEl.value; t.status = t.status === 'nieuw' ? 'ingepland' : t.status; t.updatedAt = now(); }));
    svcProposal = null;
    toast(`${ids.length} ticket(s) ingepland`);
    hooks.render();
    hooks.sync();
  });
  $('#addToDay')?.addEventListener('click', () => {
    const ids = $$('[data-add]').filter((c) => c.checked).map((c) => c.dataset.add);
    if (!ids.length) return toast('Vink eerst tickets aan');
    store.update((s) => s.tickets.filter((t) => ids.includes(t.id)).forEach((t) => { t.datum = dateEl.value; t.status = 'ingepland'; t.updatedAt = now(); }));
    toast(`${ids.length} ticket(s) ingepland`);
    hooks.render();
    hooks.sync();
  });
};
