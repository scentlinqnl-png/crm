// Voorraad in de bus: geurpatronen, onderdelen en systemen. Afboeken bij tickets, aanvullen in het Service-scherm.
import { store, uid, now, todayISO } from './store.js';

export const activeStock = () => store.get().stock.filter((x) => !x.deleted).sort((a, b) => a.naam.localeCompare(b.naam));
export const lowStock = () => activeStock().filter((x) => Number(x.voorraad) <= Number(x.minimum || 0));

// items: [{id, n}] — trekt af van de voorraad en schrijft een mutatie weg.
export function consumeStock(items = [], reden = '') {
  if (!Array.isArray(items) || !items.length) return;
  store.update((s) => {
    for (const { id, n } of items) {
      const it = s.stock.find((x) => x.id === id);
      if (!it || !n) continue;
      it.voorraad = Number(it.voorraad || 0) - n;
      it.updatedAt = now();
      s.stockMoves.push({ id: uid(), itemId: id, n: -n, reden, datum: todayISO(), updatedAt: now() });
    }
  });
}

export function adjustStock(id, n, reden = 'Aangevuld') {
  store.update((s) => {
    const it = s.stock.find((x) => x.id === id);
    if (!it) return;
    it.voorraad = Number(it.voorraad || 0) + n;
    it.updatedAt = now();
    s.stockMoves.push({ id: uid(), itemId: id, n, reden, datum: todayISO(), updatedAt: now() });
  });
}

// Tekst voor op het rapport: "2× Geurpatroon Ocean Breeze 500 ml, 1× Pomp".
export const materialText = (items) => items.filter((x) => x.n).map((x) => `${x.n}× ${store.get().stock.find((s) => s.id === x.id)?.naam || '?'}`).join(', ');

export const DEFAULT_STOCK = [
  ['Geurpatroon Ocean Breeze 500 ml', 'st', 6, 2], ['Geurpatroon White Tea 500 ml', 'st', 6, 2], ['Geurpatroon Amber Wood 500 ml', 'st', 4, 2],
  ['Geurpatroon Green Tea & Lemongrass 500 ml', 'st', 4, 2], ['Geurpatroon Fresh Linen 500 ml', 'st', 4, 2],
  ['Pomp / vernevelaar', 'st', 3, 1], ['Voeding 12V', 'st', 2, 1], ['Slang + koppeling', 'st', 5, 2], ['Scent Compact', 'st', 2, 1], ['Scent Medium', 'st', 1, 1],
];
export function seedStock() {
  store.update((s) => {
    if (s.stock.length) return;
    s.stock = DEFAULT_STOCK.map(([naam, eenheid, voorraad, minimum]) => ({ id: uid(), naam, eenheid, voorraad, minimum, deleted: false, updatedAt: now() }));
  });
}
