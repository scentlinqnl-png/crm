// Voorraadbeheer: artikelen met voorraad per locatie (magazijn, bus), mutaties en inkooporders.
import { store, uid, now, todayISO } from './store.js';

export const CATEGORIEEN = ['Geur', 'Onderdeel', 'Systeem', 'Verbruiksmateriaal', 'Overig'];
export const MOVE_TYPES = { ontvangst: 'Ontvangst', verbruik: 'Verbruik', overboeking: 'Overboeking', correctie: 'Correctie', retour: 'Retour' };
export const ORDER_STATUS = { concept: 'Concept', besteld: 'Besteld', ontvangen: 'Ontvangen' };

export const locaties = () => store.get().settings.voorraadLocaties;
export const magazijn = () => locaties()[0];
// De locatie van dit apparaat (de bus van de monteur): daar wordt verbruik bij tickets van afgeboekt.
export const mijnLocatie = () => (locaties().includes(store.get().settings.mijnLocatie) ? store.get().settings.mijnLocatie : locaties()[locaties().length - 1]);

// Oude voorraad (één getal) omzetten naar voorraad per locatie.
function ensureQty(it) {
  if (!it.qty || typeof it.qty !== 'object') {
    it.qty = { [mijnLocatie()]: Number(it.voorraad) || 0 };
    delete it.voorraad;
  }
  return it.qty;
}
export function migrateStock() {
  if (!store.get().stock.some((it) => !it.qty || typeof it.qty !== 'object')) return;
  store.update((s) => s.stock.forEach(ensureQty));
}

export const qty = (it, loc) => Number((it.qty || { [mijnLocatie()]: it.voorraad })[loc] || 0);
export const total = (it) => locaties().reduce((t, l) => t + qty(it, l), 0);

export const activeStock = () => store.get().stock.filter((x) => !x.deleted).sort((a, b) => (a.categorie || '').localeCompare(b.categorie || '') || a.naam.localeCompare(b.naam));
export const lowStock = () => activeStock().filter((x) => total(x) <= Number(x.minimum || 0));
export const stockValue = () => activeStock().reduce((t, it) => t + total(it) * (Number(it.inkoop) || 0), 0);

// Artikelen waarvan de bus onder het busminimum zit en het magazijn nog heeft.
export function busRefills(loc = mijnLocatie()) {
  const mag = magazijn();
  if (loc === mag) return [];
  return activeStock()
    .filter((it) => Number(it.minBus) > 0 && qty(it, loc) < Number(it.minBus) && qty(it, mag) > 0)
    .map((it) => ({ it, n: Math.min(Number(it.minBus) - qty(it, loc), qty(it, mag)) }));
}

// Bestelvoorstel: totaal op of onder minimum, per leverancier.
export function orderSuggestions() {
  const openOrdered = new Map();
  for (const o of store.get().orders.filter((x) => !x.deleted && x.status !== 'ontvangen')) {
    for (const r of o.regels || []) openOrdered.set(r.itemId, (openOrdered.get(r.itemId) || 0) + Number(r.n));
  }
  const bySupplier = new Map();
  for (const it of lowStock()) {
    const onderweg = openOrdered.get(it.id) || 0;
    const tekort = Number(it.minimum || 0) * 2 - total(it) - onderweg;
    const n = Math.max(Number(it.bestelAantal) || 0, tekort);
    if (n <= 0) continue;
    const lev = it.leverancier || 'Onbekende leverancier';
    bySupplier.set(lev, [...(bySupplier.get(lev) || []), { it, n, onderweg }]);
  }
  return bySupplier;
}

function move(s, { itemId, n, locatie, type, naar = '', reden = '', ref = '' }) {
  const it = s.stock.find((x) => x.id === itemId);
  if (!it || !n) return;
  const q = ensureQty(it);
  q[locatie] = Number(q[locatie] || 0) + n;
  it.updatedAt = now();
  s.stockMoves.push({ id: uid(), itemId, n, locatie, type, naar, reden, ref, datum: todayISO(), updatedAt: now() });
}

// Verbruik bij een ticket: van de locatie van dit apparaat.
export function consumeStock(items = [], ref = '') {
  if (!Array.isArray(items) || !items.length) return;
  const loc = mijnLocatie();
  store.update((s) => items.forEach(({ id, n }) => move(s, { itemId: id, n: -n, locatie: loc, type: 'verbruik', reden: ref ? `Ticket ${ref}` : 'Verbruik', ref })));
}

export function bookMove({ itemId, n, locatie, type, reden = '' }) {
  store.update((s) => move(s, { itemId, n, locatie, type, reden }));
}

export function transfer(itemId, n, van, naar, reden = 'Overboeking') {
  if (!n || van === naar) return;
  store.update((s) => {
    move(s, { itemId, n: -n, locatie: van, type: 'overboeking', naar, reden });
    move(s, { itemId, n, locatie: naar, type: 'overboeking', naar: van, reden });
  });
}

// Telling verwerken: verschillen worden correcties.
export function processCount(loc, counts) {
  let n = 0;
  store.update((s) => {
    for (const [itemId, geteld] of Object.entries(counts)) {
      const it = s.stock.find((x) => x.id === itemId);
      if (!it || geteld === '' || geteld === null) continue;
      const diff = Number(geteld) - qty(it, loc);
      if (diff) { move(s, { itemId, n: diff, locatie: loc, type: 'correctie', reden: `Telling ${todayISO()}` }); n++; }
    }
  });
  return n;
}

// ---------- inkooporders ----------

export function createOrder(leverancier, regels) {
  let o;
  store.update((s) => {
    s.orderSeq = (s.orderSeq || 0) + 1;
    o = {
      id: uid(), code: `B-${String(s.orderSeq).padStart(4, '0')}`, leverancier, status: 'concept', datum: todayISO(), besteldOp: '', ontvangenOp: '',
      locatie: magazijn(), notitie: '', deleted: false, updatedAt: now(),
      regels: regels.map(({ it, n }) => ({ itemId: it.id, n: Number(n), prijs: Number(it.inkoop) || 0 })),
    };
    s.orders.push(o);
  });
  return o;
}

export const orderTotal = (o) => (o.regels || []).reduce((t, r) => t + Number(r.n) * Number(r.prijs || 0), 0);

export function setOrderStatus(id, status) {
  store.update((s) => {
    const o = s.orders.find((x) => x.id === id);
    if (!o) return;
    if (status === 'besteld') o.besteldOp = todayISO();
    if (status === 'ontvangen' && o.status !== 'ontvangen') {
      o.ontvangenOp = todayISO();
      for (const r of o.regels) move(s, { itemId: r.itemId, n: Number(r.n), locatie: o.locatie || magazijn(), type: 'ontvangst', reden: `Bestelling ${o.code}`, ref: o.code });
    }
    o.status = status;
    o.updatedAt = now();
  });
}

// Tekst voor op het rapport: "2× Geurpatroon Ocean Breeze 500 ml, 1× Pomp".
export const materialText = (items) => items.filter((x) => x.n).map((x) => `${x.n}× ${store.get().stock.find((s) => s.id === x.id)?.naam || '?'}`).join(', ');

export const DEFAULT_STOCK = [
  ['GP-OB500', 'Geurpatroon Ocean Breeze 500 ml', 'Geur', 18.5, 39, 'Scentlinq Parfums', 12, 3, 4, 8],
  ['GP-WT500', 'Geurpatroon White Tea 500 ml', 'Geur', 18.5, 39, 'Scentlinq Parfums', 10, 4, 4, 8],
  ['GP-AW500', 'Geurpatroon Amber Wood 500 ml', 'Geur', 19.5, 42, 'Scentlinq Parfums', 8, 2, 4, 8],
  ['GP-GT500', 'Geurpatroon Green Tea & Lemongrass 500 ml', 'Geur', 18.5, 39, 'Scentlinq Parfums', 3, 1, 4, 8],
  ['GP-FL500', 'Geurpatroon Fresh Linen 500 ml', 'Geur', 18.5, 39, 'Scentlinq Parfums', 6, 2, 4, 8],
  ['OND-POMP', 'Pomp / vernevelaar', 'Onderdeel', 24, 65, 'Aroma Tech Parts', 4, 1, 3, 5],
  ['OND-12V', 'Voeding 12V', 'Onderdeel', 9.5, 29, 'Aroma Tech Parts', 5, 2, 3, 5],
  ['OND-SLANG', 'Slang + koppeling', 'Verbruiksmateriaal', 3.2, 12, 'Aroma Tech Parts', 20, 5, 10, 20],
  ['SYS-COMP', 'Scent Compact', 'Systeem', 180, 395, 'Scentlinq Devices', 3, 1, 2, 3],
  ['SYS-MED', 'Scent Medium', 'Systeem', 420, 895, 'Scentlinq Devices', 1, 0, 2, 2],
];
export function seedStock() {
  store.update((s) => {
    if (s.stock.length) return;
    const [mag, bus] = [s.settings.voorraadLocaties[0], s.settings.voorraadLocaties[1] || s.settings.voorraadLocaties[0]];
    s.stock = DEFAULT_STOCK.map(([artikelnr, naam, categorie, inkoop, verkoop, leverancier, qMag, qBus, minimum, bestelAantal]) => ({
      id: uid(), artikelnr, naam, categorie, eenheid: 'st', inkoop, verkoop, leverancier, minimum, minBus: Math.max(1, Math.ceil(minimum / 2)), bestelAantal,
      qty: { [mag]: qMag, [bus]: qBus }, deleted: false, updatedAt: now(),
    }));
  });
}
