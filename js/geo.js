// Coördinaten per plaats ophalen (OpenStreetMap Nominatim, max. 1 verzoek per seconde).
import { store, norm } from './store.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function missingPlaces() {
  const s = store.get();
  const places = new Map();
  const add = (p) => { if (p && !(norm(p) in s.coords)) places.set(norm(p), p); };
  add(s.settings.startPlaats);
  s.customers.forEach((c) => add(c.plaats));
  return [...places.values()];
}

export async function geocodePlaces(onProgress) {
  const todo = missingPlaces();
  let i = 0;
  for (const plaats of todo) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl,be,de,fr,gb,pt&q=${encodeURIComponent(plaats)}`;
    let val = null;
    try {
      const r = await fetch(url, { headers: { 'Accept-Language': 'nl' } });
      const j = await r.json();
      if (j[0]) val = { lat: Number(j[0].lat), lon: Number(j[0].lon) };
    } catch {
      // offline of geblokkeerd: sla over, volgende keer opnieuw
      onProgress?.(++i, todo.length, plaats);
      await wait(1100);
      continue;
    }
    store.update((s) => { s.coords[norm(plaats)] = val; });
    onProgress?.(++i, todo.length, plaats);
    await wait(1100);
  }
  return todo.length;
}
