// Dagplanner: dezelfde regels als de klantbezoek-planner skill.
// Mix van geografische clustering, tijd sinds laatste bezoek en classificatie "Weinig".

import { store, stats, statFor, norm, todayISO, daysBetween, fullAddress, refillForecast } from './store.js';

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const fmtTime = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Reistijd (min) tussen twee punten. Een punt is een klant of het startpunt {start:true}.
// Met coördinaten: hemelsbreed × 1,3 (wegennet). Zonder: schatting op basis van afstand vanaf de start.
export function travelMin(a, b) {
  const s = store.get();
  const speed = s.settings.snelheid;
  if (a === b) return 0;
  const startKey = norm(s.settings.startPlaats);
  const keyA = a.start ? startKey : norm(a.plaats);
  const keyB = b.start ? startKey : norm(b.plaats);
  const ca = s.coords[keyA];
  const cb = s.coords[keyB];
  if (ca && cb) {
    if (keyA === keyB) return 10;
    return Math.max(10, Math.round(((haversineKm(ca, cb) * 1.3) / speed) * 60));
  }
  if (a.start) return b.min ?? Math.round(((b.km ?? 60) / speed) * 60);
  if (b.start) return a.min ?? Math.round(((a.km ?? 60) / speed) * 60);
  if (keyA === keyB) return 10;
  const ka = a.km ?? 60;
  const kb = b.km ?? 60;
  const km = Math.abs(ka - kb) + 0.35 * Math.min(ka, kb);
  return Math.max(15, Math.round((km / speed) * 60));
}

function priority(c, st, today) {
  let score = 0;
  const reasons = [];
  if (!st.laatste) {
    score += 120;
    reasons.push('nog nooit bezocht');
  } else {
    const d = daysBetween(st.laatste, today);
    score += Math.min(d, 120);
    reasons.push(`${d} dagen niet bezocht`);
  }
  const f = refillForecast(c.nr);
  if (f) {
    const dagenTotLeeg = daysBetween(today, f.leeg);
    if (dagenTotLeeg <= store.get().settings.navulDagen) {
      score += 150 - Math.max(-30, dagenTotLeeg) * 3;
      reasons.unshift(dagenTotLeeg < 0 ? `geurpatroon waarschijnlijk leeg sinds ${-dagenTotLeeg} dagen` : `navulling nodig binnen ${dagenTotLeeg} dagen`);
    }
  }
  if (st.classificatie === 'Weinig') {
    score += 60;
    reasons.push('classificatie Weinig');
  }
  return { score, reasons };
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((x, i) => {
    for (const p of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

// Beste volgorde (start -> stops -> start). Voor ≤7 stops exact, anders nearest-neighbour.
function bestOrder(stops) {
  const start = { start: true };
  const cost = (order) => {
    let t = 0;
    let prev = start;
    for (const c of order) { t += travelMin(prev, c); prev = c; }
    return t + travelMin(prev, start);
  };
  if (stops.length <= 7) {
    let best = stops;
    let bestCost = Infinity;
    for (const p of permutations(stops)) {
      const c = cost(p);
      if (c < bestCost) { bestCost = c; best = p; }
    }
    return { order: best, travel: bestCost };
  }
  const rest = [...stops];
  const order = [];
  let prev = start;
  while (rest.length) {
    rest.sort((x, y) => travelMin(prev, x) - travelMin(prev, y));
    prev = rest.shift();
    order.push(prev);
  }
  return { order, travel: cost(order) };
}

function schedule(order, s, startTijd = s.settings.startTijd, duur = {}) {
  let t = toMin(startTijd);
  let prev = { start: true };
  const stops = [];
  for (const c of order) {
    const reis = travelMin(prev, c);
    t += reis;
    const aankomst = t;
    t += duur[String(c.nr)] ?? s.settings.bezoekDuur;
    stops.push({ nr: c.nr, reis, aankomst: fmtTime(aankomst), vertrek: fmtTime(t) });
    prev = c;
  }
  const terugReis = travelMin(prev, { start: true });
  return { stops, terugReis, terug: t + terugReis };
}

// options: { datum, include: [nr], exclude: [nr] }
export function planDay({ datum = todayISO(), include = [], exclude = [] } = {}) {
  const s = store.get();
  const all = stats();
  const eind = toMin(s.settings.eindTijd);
  const plannedElsewhere = new Set(
    Object.values(s.plans).filter((p) => p.datum !== datum && p.datum >= todayISO()).flatMap((p) => p.stops.map((x) => String(x.nr)))
  );

  const scored = s.customers
    .filter((c) => c.naam && c.adres && c.plaats)
    .map((c) => ({ c, st: statFor(all, c.nr), ...priority(c, statFor(all, c.nr), datum) }));

  const forced = scored.filter((x) => include.map(String).includes(String(x.c.nr)));
  const pool = scored.filter((x) => {
    const nr = String(x.c.nr);
    if (include.map(String).includes(nr) || exclude.map(String).includes(nr)) return false;
    if (plannedElsewhere.has(nr)) return false;
    if ((x.c.km ?? 0) > s.settings.maxKm) return false;
    if (x.st.laatste && daysBetween(x.st.laatste, datum) < s.settings.minDagenTussen) return false;
    return true;
  });
  pool.sort((a, b) => b.score - a.score);

  const chosen = [...forced];
  if (!chosen.length && pool.length) chosen.push(pool.shift());

  const fits = (list) => schedule(bestOrder(list.map((x) => x.c)).order, s).terug <= eind;

  while (chosen.length < s.settings.maxStops && pool.length) {
    // Kandidaat met de beste mix van prioriteit en nabijheid tot de al gekozen stops.
    let best = null;
    let bestVal = -Infinity;
    for (const x of pool.slice(0, 80)) {
      const near = Math.min(...chosen.map((y) => travelMin(y.c, x.c)));
      const val = x.score - 2.5 * near;
      if (val > bestVal) { bestVal = val; best = x; }
    }
    if (!best) break;
    pool.splice(pool.indexOf(best), 1);
    if (fits([...chosen, best])) {
      chosen.push(best);
    } else if (chosen.length >= s.settings.minStops) {
      break;
    }
  }

  const { order } = bestOrder(chosen.map((x) => x.c));
  const sched = schedule(order, s);
  const byNr = new Map(chosen.map((x) => [String(x.c.nr), x]));
  sched.stops.forEach((stop, i) => {
    const x = byNr.get(String(stop.nr));
    const reasons = [...x.reasons];
    if (forced.includes(x)) reasons.unshift('handmatig toegevoegd');
    if (i > 0 && stop.reis <= 20) reasons.push(`ligt op de route (${stop.reis} min vanaf vorige)`);
    stop.reden = reasons.join(', ');
  });

  const totaalReis = sched.stops.reduce((t, x) => t + x.reis, 0) + sched.terugReis;
  const usedCoords = Object.keys(s.coords).length > 0;
  return {
    datum,
    stops: sched.stops,
    terugReis: sched.terugReis,
    terug: fmtTime(sched.terug),
    totaalReis,
    teLaat: sched.terug > eind,
    schatting: usedCoords ? 'Reistijden op basis van coördinaten × 1,3 (wegennet), geen exacte route.' : 'Reistijden tussen klanten zijn geschat op basis van afstand vanaf de startplaats. Haal coördinaten op (Instellingen) voor een betere route.',
    kandidaten: scored.length,
  };
}

// Compacte klantenlijst als context voor Claude (alleen wat nodig is om te kiezen).
export function candidateSummary(datum = todayISO()) {
  const s = store.get();
  const all = stats();
  const openDealNrs = new Set(s.deals.filter((d) => d.status === 'open' && !d.deleted).map((d) => String(d.nr)));
  const pinned = new Set(s.pinned.map(String));
  return s.customers
    .filter((c) => c.naam && c.adres && c.plaats)
    .filter((c) => (c.km ?? 0) <= s.settings.maxKm || pinned.has(String(c.nr)))
    .map((c) => {
      const st = statFor(all, c.nr);
      const f = refillForecast(c.nr);
      const p = s.profiles.find((x) => String(x.nr) === String(c.nr));
      const acts = s.activities.filter((a) => !a.done && !a.deleted && String(a.nr) === String(c.nr)).map((a) => `${a.type} ${a.datum}: ${a.titel}`);
      return {
        nr: c.nr,
        naam: c.naam,
        plaats: c.plaats,
        km_vanaf_start: c.km,
        reistijd_min: c.min,
        dagen_sinds_bezoek: st.laatste ? daysBetween(st.laatste, datum) : null,
        bezoeken: st.bezoeken,
        classificatie: st.classificatie || null,
        dagen_tot_navullen: f ? daysBetween(datum, f.leeg) : null,
        sector: p?.sector || null,
        open_deal: openDealNrs.has(String(c.nr)),
        open_activiteiten: acts.length ? acts : undefined,
        handmatig_ingepland: pinned.has(String(c.nr)) || undefined,
      };
    })
    // Lege velden weglaten: houdt de vraag aan Claude klein.
    .map((row) => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '')));
}

// Maakt een planning van een door Claude (of de gebruiker) gekozen lijst klanten.
export function planFromSelection({ datum, nrs, redenen = {}, startTijd, toelichting = '', optimize = true, door = 'claude', duur = {} }) {
  const s = store.get();
  const chosen = nrs.map((nr) => s.customers.find((c) => String(c.nr) === String(nr))).filter(Boolean);
  const order = optimize ? bestOrder(chosen).order : chosen;
  const start = /^\d{1,2}:\d{2}$/.test(startTijd || '') ? startTijd : s.settings.startTijd;
  const sched = schedule(order, s, start, duur);
  sched.stops.forEach((stop) => { stop.reden = redenen[String(stop.nr)] || ''; });
  const totaalReis = sched.stops.reduce((t, x) => t + x.reis, 0) + sched.terugReis;
  return {
    datum,
    stops: sched.stops,
    terugReis: sched.terugReis,
    terug: fmtTime(sched.terug),
    totaalReis,
    teLaat: sched.terug > toMin(s.settings.eindTijd),
    schatting: door === 'claude' ? 'Klanten gekozen door Claude; volgorde en tijden berekend door de app.' : 'Reistijden zijn een schatting, geen exacte route.',
    duur,
    kandidaten: s.customers.length,
    door,
    toelichting,
    startTijd: start,
  };
}

export function mapsRouteUrl(plan) {
  const s = store.get();
  const addr = plan.stops.map((x) => {
    const c = s.customers.find((k) => String(k.nr) === String(x.nr));
    return c ? fullAddress(c) : '';
  }).filter(Boolean);
  const p = new URLSearchParams({
    api: '1',
    origin: s.settings.startPlaats,
    destination: s.settings.startPlaats,
    travelmode: 'driving',
  });
  if (addr.length) p.set('waypoints', addr.join('|'));
  return 'https://www.google.com/maps/dir/?' + p.toString();
}
