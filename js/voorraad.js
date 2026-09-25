// Scherm voorraadbeheer: overzicht, bestellen, bus aanvullen, mutaties en telling.
import { store, uid, now, norm } from './store.js';
import {
  CATEGORIEEN, MOVE_TYPES, ORDER_STATUS, locaties, magazijn, mijnLocatie, qty, total, activeStock, lowStock, stockValue,
  busRefills, orderSuggestions, bookMove, transfer, processCount, createOrder, orderTotal, setOrderStatus, seedStock, migrateStock,
} from './stock.js';
import { shareOrDownloadOrder } from './report.js';
import { $, $$, h, eur, fmtDate, toast, openDialog, ask, hooks, formData } from './ui.js';

let filter = { q: '', cat: '' };
const done = (msg) => { if (msg) toast(msg); hooks.render(); hooks.sync(); };
const itemById = (id) => store.get().stock.find((x) => x.id === id);

function tabs(active) {
  return `<nav class="segmented" aria-label="Voorraad">
    ${[['overzicht', 'Overzicht'], ['bestellen', 'Bestellen'], ['aanvullen', 'Bus aanvullen'], ['mutaties', 'Mutaties'], ['telling', 'Telling']]
      .map(([k, l]) => `<a href="#/voorraad?tab=${k}" class="${active === k ? 'on' : ''}">${l}</a>`).join('')}
  </nav>`;
}

export function viewVoorraad(params) {
  migrateStock();
  const tab = params.get('tab') || 'overzicht';
  const s = store.get();
  if (!s.stock.filter((x) => !x.deleted).length) {
    return `<a class="back" href="#/service">‹ Service</a><h1>Voorraad</h1>
      <section class="card empty"><h2>Nog geen artikelen</h2><p>Voeg je geurpatronen, onderdelen en systemen toe, of begin met een standaardlijst die je daarna aanpast.</p>
      <div class="actions" style="justify-content:center"><button class="btn primary" id="newItem">+ Artikel</button><button class="btn" id="seedStock">Standaardlijst gebruiken</button></div></section>`;
  }
  const body = { bestellen, aanvullen, mutaties, telling }[tab]?.() ?? overzicht();
  return `<div class="card-head"><h1>Voorraad</h1><button class="btn primary small" id="newItem">+ Artikel</button></div>${tabs(tab)}${body}`;
}

function overzicht() {
  const locs = locaties();
  const low = new Set(lowStock().map((x) => x.id));
  const q = norm(filter.q);
  const items = activeStock().filter((it) => (!filter.cat || it.categorie === filter.cat) && (!q || [it.naam, it.artikelnr, it.leverancier].some((f) => norm(f).includes(q))));
  const refills = busRefills();
  return `
    <section class="kpis">
      <div class="kpi"><span>Artikelen</span><b>${activeStock().length}</b></div>
      <div class="kpi"><span>Voorraadwaarde (inkoop)</span><b>${eur(stockValue())}</b></div>
      <div class="kpi"><span>Op of onder minimum</span><b class="${low.size ? 'late' : ''}">${low.size}</b><small><a href="#/voorraad?tab=bestellen">bestellen</a></small></div>
      <div class="kpi"><span>${h(mijnLocatie())} aanvullen</span><b>${refills.length}</b><small><a href="#/voorraad?tab=aanvullen">overboeken</a></small></div>
    </section>
    <div class="searchbar">
      <input type="search" id="vq" placeholder="Zoek artikel, nummer of leverancier…" value="${h(filter.q)}">
      <select id="vcat" aria-label="Categorie"><option value="">Alle categorieën</option>${CATEGORIEEN.map((c) => `<option ${filter.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
    </div>
    <div class="table-wrap card stock-table">
      <table class="q-table">
        <thead><tr><th>Artikel</th>${locs.map((l) => `<th class="num">${h(l)}</th>`).join('')}<th class="num">Totaal</th><th class="num col-min">Min.</th></tr></thead>
        <tbody>${items.map((it) => `<tr class="clickable" data-item="${h(it.id)}">
          <td><b>${h(it.naam)}</b><span class="sub">${[it.artikelnr, it.categorie, it.leverancier].filter(Boolean).map(h).join(' · ')}</span></td>
          ${locs.map((l) => `<td class="num">${qty(it, l)}</td>`).join('')}
          <td class="num"><b class="${low.has(it.id) ? 'late' : ''}">${total(it)}</b></td>
          <td class="num muted col-min">${h(it.minimum ?? 0)}</td>
        </tr>`).join('') || `<tr><td colspan="${locs.length + 3}" class="muted">Geen artikelen gevonden.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="muted small">Tik op een artikel om te ontvangen, over te boeken of te corrigeren. Verbruik bij tickets wordt afgeboekt van <b>${h(mijnLocatie())}</b> (instelbaar onder Meer).</p>`;
}

function bestellen() {
  const sug = orderSuggestions();
  const orders = store.get().orders.filter((o) => !o.deleted).sort((a, b) => b.datum.localeCompare(a.datum));
  return `
    <section class="card">
      <h2>Bestelvoorstel</h2>
      ${sug.size ? [...sug].map(([lev, rows]) => `
        <div class="supplier" data-supplier="${h(lev)}">
          <h3>${h(lev)}</h3>
          <ul class="list compact">${rows.map(({ it, n, onderweg }) => `<li>
            <label class="inline grow"><input type="checkbox" data-sug="${h(it.id)}" checked> <span><b>${h(it.naam)}</b><span class="sub">voorraad ${total(it)} · minimum ${h(it.minimum)}${onderweg ? ` · ${onderweg} onderweg` : ''}</span></span></label>
            <input type="number" class="qty-input" min="1" value="${n}" data-sugn="${h(it.id)}" aria-label="Aantal">
          </li>`).join('')}</ul>
          <div class="actions left"><button class="btn primary small" data-mkorder="${h(lev)}">Bestelling maken</button></div>
        </div>`).join('') : '<p class="muted">Alles is op voorraad. Artikelen komen hier zodra ze op of onder hun minimum zitten.</p>'}
    </section>
    <section class="card">
      <h2>Inkooporders</h2>
      <ul class="list compact">${orders.map((o) => `<li class="clickable" data-order="${h(o.id)}"><div><b>${h(o.code)} · ${h(o.leverancier)}</b><span class="sub">${fmtDate(o.datum)} · ${o.regels.length} regels · ${eur(orderTotal(o))}</span></div><span class="badge ${o.status === 'ontvangen' ? 'k-normaal' : o.status === 'besteld' ? 'k-veel' : ''}">${h(ORDER_STATUS[o.status])}</span></li>`).join('') || '<li class="muted">Nog geen inkooporders.</li>'}</ul>
    </section>`;
}

function aanvullen() {
  const loc = mijnLocatie();
  const rows = busRefills(loc);
  return `<section class="card">
    <h2>${h(magazijn())} → ${h(loc)}</h2>
    ${loc === magazijn() ? '<p class="muted">Dit apparaat staat op het magazijn. Kies onder Meer je bus als eigen locatie.</p>' : rows.length ? `
      <ul class="list compact">${rows.map(({ it, n }) => `<li>
        <label class="inline grow"><input type="checkbox" data-ref="${h(it.id)}" checked> <span><b>${h(it.naam)}</b><span class="sub">${h(loc)}: ${qty(it, loc)} (min. ${h(it.minBus)}) · ${h(magazijn())}: ${qty(it, magazijn())}</span></span></label>
        <input type="number" class="qty-input" min="1" max="${qty(it, magazijn())}" value="${n}" data-refn="${h(it.id)}" aria-label="Aantal">
      </li>`).join('')}</ul>
      <div class="actions left"><button class="btn primary" id="doRefill">Overboeken naar ${h(loc)}</button></div>` : `<p class="muted">De ${h(loc)} is op peil.</p>`}
    <p class="muted small">Stel per artikel een busminimum in; de app stelt voor wat je uit het magazijn meeneemt.</p>
  </section>`;
}

function mutaties() {
  const s = store.get();
  const moves = s.stockMoves.slice().reverse().slice(0, 100);
  return `<section class="card"><h2>Laatste mutaties</h2>
    <ul class="list compact">${moves.map((m) => `<li><div><b>${m.n > 0 ? '+' : ''}${h(m.n)} ${h(itemById(m.itemId)?.naam || '?')}</b><span class="sub">${fmtDate(m.datum)} · ${h(MOVE_TYPES[m.type] || m.type || '')} · ${h(m.locatie || '')}${m.naar ? ` ↔ ${h(m.naar)}` : ''}${m.reden ? ` · ${h(m.reden)}` : ''}</span></div></li>`).join('') || '<li class="muted">Nog geen mutaties.</li>'}</ul>
  </section>`;
}

let countLoc = null;
function telling() {
  const loc = countLoc && locaties().includes(countLoc) ? countLoc : mijnLocatie();
  return `<section class="card form">
    <h2>Voorraadtelling</h2>
    <label>Locatie<select id="countLoc">${locaties().map((l) => `<option ${l === loc ? 'selected' : ''}>${h(l)}</option>`).join('')}</select></label>
    <p class="muted small">Vul in wat je werkelijk telt. Alleen afwijkingen worden als correctie geboekt.</p>
    <form id="countForm">
      <div class="stock-pick tall">${activeStock().map((it) => `<label class="stock-row"><span>${h(it.naam)} <span class="sub">systeem: ${qty(it, loc)}</span></span><input type="number" name="${h(it.id)}" min="0" step="1" inputmode="numeric" value="${qty(it, loc)}"></label>`).join('')}</div>
      <div class="actions left"><button class="btn primary">Telling verwerken</button></div>
    </form>
  </section>`;
}

// ---------- dialogen ----------

function itemDialog(pre = {}) {
  const s = store.get();
  const it = { artikelnr: '', naam: '', categorie: 'Geur', eenheid: 'st', inkoop: '', verkoop: '', leverancier: '', minimum: 2, minBus: 1, bestelAantal: '', ...pre };
  const locs = locaties();
  const suppliers = [...new Set(s.stock.map((x) => x.leverancier).filter(Boolean))];
  const form = openDialog(`
    <h2>${it.id ? h(it.naam) : 'Nieuw artikel'}</h2>
    ${it.id ? `<div class="loc-qty">${locs.map((l) => `<div><span class="sub">${h(l)}</span><b>${qty(it, l)}</b></div>`).join('')}<div><span class="sub">Totaal</span><b>${total(it)}</b></div></div>
      <fieldset>
        <legend>Voorraad boeken</legend>
        <div class="row3">
          <label>Soort<select name="mtype"><option value="">–</option><option value="ontvangst">Ontvangst</option><option value="overboeking">Overboeking</option><option value="correctie">Correctie (+/−)</option><option value="retour">Retour (af)</option></select></label>
          <label>Aantal<input name="mn" type="number" step="1" inputmode="numeric"></label>
          <label>Locatie<select name="mloc">${locs.map((l) => `<option>${h(l)}</option>`).join('')}</select></label>
        </div>
        <label class="naar-row" hidden>Naar<select name="mnaar">${locs.map((l, i) => `<option ${i === locs.length - 1 ? 'selected' : ''}>${h(l)}</option>`).join('')}</select></label>
        <label>Opmerking<input name="mreden" placeholder="bijv. pakbon 12345"></label>
      </fieldset>` : ''}
    <div class="row2">
      <label>Naam<input name="naam" value="${h(it.naam)}" required></label>
      <label>Artikelnummer<input name="artikelnr" value="${h(it.artikelnr)}"></label>
    </div>
    <div class="row2">
      <label>Categorie<select name="categorie">${CATEGORIEEN.map((c) => `<option ${it.categorie === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label>Leverancier<input name="leverancier" list="suppliers" value="${h(it.leverancier)}"></label>
    </div>
    <datalist id="suppliers">${suppliers.map((x) => `<option value="${h(x)}">`).join('')}</datalist>
    <div class="row3">
      <label>Eenheid<input name="eenheid" value="${h(it.eenheid)}"></label>
      <label>Inkoop (€)<input name="inkoop" type="number" step="0.01" min="0" value="${h(it.inkoop)}"></label>
      <label>Verkoop (€)<input name="verkoop" type="number" step="0.01" min="0" value="${h(it.verkoop)}"></label>
    </div>
    <div class="row3">
      <label>Minimum totaal<input name="minimum" type="number" min="0" value="${h(it.minimum)}"></label>
      <label>Minimum bus<input name="minBus" type="number" min="0" value="${h(it.minBus)}"></label>
      <label>Bestelaantal<input name="bestelAantal" type="number" min="0" value="${h(it.bestelAantal)}"></label>
    </div>
    ${it.id ? '' : `<label>Beginvoorraad ${h(locs[0])}<input name="begin" type="number" min="0" value="0"></label>`}
    <div class="actions">
      ${it.id ? '<button value="delete" class="btn ghost danger" formnovalidate>Verwijderen</button>' : ''}
      <button value="cancel" class="btn ghost" formnovalidate>Annuleren</button>
      <button value="save" class="btn primary">Opslaan</button>
    </div>`, async (d, action) => {
    if (action === 'delete') {
      if (!(await ask(`${it.naam} verwijderen?`, 'Verwijderen'))) return;
      store.update((st) => { const x = st.stock.find((y) => y.id === it.id); x.deleted = true; x.updatedAt = now(); });
      return done('Artikel verwijderd');
    }
    const fields = {
      naam: d.naam.trim(), artikelnr: d.artikelnr.trim(), categorie: d.categorie, leverancier: d.leverancier.trim(), eenheid: d.eenheid.trim() || 'st',
      inkoop: Number(d.inkoop) || 0, verkoop: Number(d.verkoop) || 0, minimum: Number(d.minimum) || 0, minBus: Number(d.minBus) || 0, bestelAantal: Number(d.bestelAantal) || 0,
    };
    let id = it.id;
    store.update((st) => {
      if (id) Object.assign(st.stock.find((y) => y.id === id), fields, { updatedAt: now() });
      else { id = uid(); st.stock.push({ id, ...fields, qty: {}, deleted: false, updatedAt: now() }); }
    });
    if (!it.id && Number(d.begin)) bookMove({ itemId: id, n: Number(d.begin), locatie: locs[0], type: 'correctie', reden: 'Beginvoorraad' });
    const n = Number(d.mn);
    if (it.id && d.mtype && n) {
      if (d.mtype === 'overboeking') transfer(id, Math.abs(n), d.mloc, d.mnaar);
      else bookMove({ itemId: id, n: d.mtype === 'retour' ? -Math.abs(n) : d.mtype === 'ontvangst' ? Math.abs(n) : n, locatie: d.mloc, type: d.mtype, reden: d.mreden.trim() });
    }
    done(it.id && d.mtype && n ? 'Voorraad geboekt' : 'Artikel opgeslagen');
  });
  form.mtype?.addEventListener('change', () => { $('.naar-row', form).hidden = form.mtype.value !== 'overboeking'; });
}

function orderDialog(o) {
  const locked = o.status === 'ontvangen';
  openDialog(`
    <h2>${h(o.code)} · ${h(o.leverancier)}</h2>
    <p class="muted small">${h(ORDER_STATUS[o.status])} · aangemaakt ${fmtDate(o.datum)}${o.besteldOp ? ` · besteld ${fmtDate(o.besteldOp)}` : ''}${o.ontvangenOp ? ` · ontvangen ${fmtDate(o.ontvangenOp)}` : ''}</p>
    <div class="stock-pick tall">${o.regels.map((r, i) => `<label class="stock-row"><span>${h(itemById(r.itemId)?.naam || '?')} <span class="sub">${eur(r.prijs)} per stuk</span></span><input type="number" name="r${i}" min="0" value="${h(r.n)}" ${locked ? 'disabled' : ''}></label>`).join('')}</div>
    <p><b>Totaal ${eur(orderTotal(o))}</b> <span class="muted small">excl. btw</span></p>
    ${locked ? '' : `<label>Ontvangen op locatie<select name="locatie">${locaties().map((l) => `<option ${l === (o.locatie || magazijn()) ? 'selected' : ''}>${h(l)}</option>`).join('')}</select></label>`}
    <div class="actions">
      ${o.status === 'concept' ? '<button value="delete" class="btn ghost danger" formnovalidate>Verwijderen</button>' : ''}
      <button value="pdf" class="btn">📄 Bestelbon</button>
      ${o.status === 'concept' ? '<button value="besteld" class="btn">Markeer besteld</button>' : ''}
      ${!locked ? '<button value="ontvangen" class="btn primary">Ontvangen → inboeken</button>' : '<button value="cancel" class="btn primary" formnovalidate>Sluiten</button>'}
    </div>`, async (d, action) => {
    if (!locked) {
      store.update((s) => {
        const x = s.orders.find((y) => y.id === o.id);
        x.regels = x.regels.map((r, i) => ({ ...r, n: Number(d[`r${i}`]) || 0 })).filter((r) => r.n > 0);
        if (d.locatie) x.locatie = d.locatie;
        x.updatedAt = now();
      });
    }
    const cur = store.get().orders.find((y) => y.id === o.id);
    if (action === 'delete') {
      store.update((s) => { const x = s.orders.find((y) => y.id === o.id); x.deleted = true; x.updatedAt = now(); });
      return done('Bestelling verwijderd');
    }
    if (action === 'pdf') {
      try { const how = await shareOrDownloadOrder(cur); if (how !== 'geannuleerd') toast(`Bestelbon ${how}`); } catch (e) { toast('PDF maken mislukt: ' + e.message, 5000); }
      if (cur.status === 'concept') setOrderStatus(cur.id, 'besteld');
      return done();
    }
    if (action === 'besteld') { setOrderStatus(cur.id, 'besteld'); return done('Gemarkeerd als besteld'); }
    if (action === 'ontvangen') { setOrderStatus(cur.id, 'ontvangen'); return done(`${cur.code} ontvangen en ingeboekt op ${cur.locatie || magazijn()}`); }
    done();
  });
}

viewVoorraad.after = () => {
  $('#newItem')?.addEventListener('click', () => itemDialog());
  $('#seedStock')?.addEventListener('click', () => { seedStock(); done('Standaardlijst toegevoegd'); });
  $('#vq')?.addEventListener('input', (e) => {
    filter.q = e.target.value;
    const pos = e.target.selectionStart;
    hooks.render();
    const el = $('#vq');
    el.focus();
    el.setSelectionRange(pos, pos);
  });
  $('#vcat')?.addEventListener('change', (e) => { filter.cat = e.target.value; hooks.render(); });
  $$('[data-item]').forEach((el) => el.addEventListener('click', () => itemDialog(itemById(el.dataset.item))));
  $$('[data-order]').forEach((el) => el.addEventListener('click', () => orderDialog(store.get().orders.find((o) => o.id === el.dataset.order))));
  $$('[data-mkorder]').forEach((b) => b.addEventListener('click', () => {
    const box = b.closest('[data-supplier]');
    const regels = $$('[data-sug]', box).filter((c) => c.checked).map((c) => ({ it: itemById(c.dataset.sug), n: Number($(`[data-sugn="${c.dataset.sug}"]`, box).value) || 0 })).filter((r) => r.n > 0);
    if (!regels.length) return toast('Vink eerst artikelen aan');
    const o = createOrder(b.dataset.mkorder, regels);
    done(`Bestelling ${o.code} aangemaakt`);
    orderDialog(o);
  }));
  $('#doRefill')?.addEventListener('click', () => {
    const loc = mijnLocatie();
    const rows = $$('[data-ref]').filter((c) => c.checked).map((c) => ({ id: c.dataset.ref, n: Number($(`[data-refn="${c.dataset.ref}"]`).value) || 0 }));
    rows.forEach((r) => transfer(r.id, r.n, magazijn(), loc, 'Bus aanvullen'));
    done(`${rows.length} artikel(en) overgeboekt naar ${loc}`);
  });
  $('#countLoc')?.addEventListener('change', (e) => { countLoc = e.target.value; hooks.render(); });
  $('#countForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const loc = $('#countLoc').value;
    const n = processCount(loc, formData(e.target));
    done(n ? `${n} correctie(s) geboekt op ${loc}` : 'Telling klopt, geen correcties');
  });
};
