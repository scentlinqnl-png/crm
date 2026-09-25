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

async function geocode(plaats) {
  const key = norm(plaats);
  const s = store.get();
  if (s.coords[key]) return s.coords[key];
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl,be,de,fr,gb,pt&q=${encodeURIComponent(plaats)}`;
    const j = await (await fetch(url, { headers: { 'Accept-Language': 'nl' } })).json();
    if (!j[0]) return null;
    const val = { lat: Number(j[0].lat), lon: Number(j[0].lon) };
    store.update((st) => { st.coords[key] = val; });
    return val;
  } catch {
    return null; // offline: later opnieuw via Meer › Coördinaten ophalen
  }
}

// Afstand over de weg vanaf de startplaats, geschat als hemelsbreed × 1,3 en afgerond op 5 km.
export async function distanceFromStart(plaats) {
  if (!plaats) return null;
  const start = await geocode(store.get().settings.startPlaats);
  const doel = await geocode(plaats);
  if (!start || !doel) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(doel.lat - start.lat) / 2) ** 2 + Math.cos(rad(start.lat)) * Math.cos(rad(doel.lat)) * Math.sin(rad(doel.lon - start.lon) / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.3;
  return Math.round(km / 5) * 5;
}
