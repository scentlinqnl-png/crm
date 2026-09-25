// Offertes: opslaan, als PDF versturen en bij akkoord omzetten naar contract, systemen en installatieticket.
import { store, uid, now, todayISO, customer, profile, saveProfile, newTicket, TICKET_DUUR } from './store.js';

export const QUOTE_STATUS = { concept: 'Concept', verstuurd: 'Verstuurd', geaccepteerd: 'Geaccepteerd', afgewezen: 'Afgewezen' };
export const LEASE_MND = 36;

export function calcQuote({ systeem, aantal, model }) {
  const sys = store.get().settings.systemen.find((x) => x.naam === systeem) || store.get().settings.systemen[0];
  const n = Number(aantal) || 1;
  const eenmalig = model === 'koop' ? sys.prijs * n : 0;
  const leasePerMaand = model === 'lease' ? Math.round((sys.prijs * n * 1.15) / LEASE_MND) : 0;
  const abo = sys.abonnement * n;
  const perMaand = leasePerMaand + abo;
  return { sys, n, eenmalig, leasePerMaand, abo, perMaand, jaar: perMaand * 12, waarde: perMaand * 12 + eenmalig };
}

export const quotesFor = (nr) => store.get().quotes.filter((q) => !q.deleted && String(q.nr) === String(nr)).sort((a, b) => b.datum.localeCompare(a.datum));

// Slaat een offerte op en houdt de bijbehorende deal in de pipeline bij.
export function saveQuote(fields) {
  const s = store.get();
  const calc = calcQuote(fields);
  const fase = s.settings.fases.find((x) => /offerte/i.test(x)) || s.settings.fases[0];
  let q;
  store.update((st) => {
    q = fields.id && st.quotes.find((x) => x.id === fields.id);
    if (!q) {
      st.quoteSeq = (st.quoteSeq || 0) + 1;
      q = { id: uid(), code: `O-${String(st.quoteSeq).padStart(4, '0')}`, status: 'concept', datum: todayISO(), dealId: '', deleted: false };
      st.quotes.push(q);
    }
    Object.assign(q, {
      nr: Number(fields.nr), systeem: calc.sys.naam, aantal: calc.n, model: fields.model, geur: fields.geur || '', notitie: fields.notitie || '',
      eenmalig: calc.eenmalig, perMaand: calc.perMaand, updatedAt: now(),
    });
    const titel = `${q.code}: ${calc.n}× ${calc.sys.naam} + abonnement`;
    let deal = q.dealId && st.deals.find((d) => d.id === q.dealId);
    if (!deal) {
      deal = { id: uid(), nr: q.nr, status: 'open', gesloten: '', deleted: false, fase };
      st.deals.push(deal);
      q.dealId = deal.id;
    }
    if (deal.status === 'open') Object.assign(deal, { titel, waarde: calc.waarde, fase: deal.fase || fase, updatedAt: now() });
  });
  return q;
}

export function setQuoteStatus(id, status) {
  store.update((s) => {
    const q = s.quotes.find((x) => x.id === id);
    q.status = status;
    q.updatedAt = now();
    const deal = s.deals.find((d) => d.id === q.dealId);
    if (deal && status === 'afgewezen') Object.assign(deal, { status: 'verloren', gesloten: todayISO(), updatedAt: now() });
  });
}

// Akkoord: contract, geplande systemen, installatieticket, deal gewonnen, klantstatus Klant.
export function acceptQuote(id, { installatieDatum = '' } = {}) {
  const q = store.get().quotes.find((x) => x.id === id);
  const today = todayISO();
  const eind = new Date(today + 'T12:00:00');
  eind.setMonth(eind.getMonth() + (q.model === 'lease' ? LEASE_MND : 12));
  eind.setDate(eind.getDate() - 1);
  const assetIds = [];
  store.update((s) => {
    Object.assign(q, { status: 'geaccepteerd', geaccepteerd: today, updatedAt: now() });
    s.contracts.push({
      id: uid(), nr: q.nr, soort: q.model === 'lease' ? 'lease' : 'abonnement', omschrijving: `${q.aantal}× ${q.systeem} + serviceabonnement (${q.code})`,
      perMaand: q.perMaand, eenmalig: q.eenmalig, start: today, eind: todayISO(eind), opzegMnd: q.model === 'lease' ? 3 : 1, status: 'actief', deleted: false, updatedAt: now(),
    });
    for (let i = 0; i < q.aantal; i++) {
      const aid = uid();
      assetIds.push(aid);
      s.assets.push({ id: aid, nr: q.nr, systeem: q.systeem, serienummer: '', locatie: '', geplaatst: '', geur: q.geur, laatsteOnderhoud: '', interval: 6, status: 'gepland', deleted: false, updatedAt: now() });
    }
    const deal = s.deals.find((d) => d.id === q.dealId);
    if (deal) Object.assign(deal, { status: 'gewonnen', gesloten: today, updatedAt: now() });
  });
  saveProfile(q.nr, { status: 'Klant', systeem: q.systeem, aantal: q.aantal, geurprofiel: profile(q.nr).geurprofiel || q.geur });
  const ticket = newTicket({
    nr: q.nr, assetId: assetIds[0] || '', type: 'installatie', prioriteit: 'normaal', datum: installatieDatum,
    titel: `Installatie ${q.aantal}× ${q.systeem}`, omschrijving: `Volgens offerte ${q.code}. Geur: ${q.geur || 'nog kiezen'}.`,
    melder: customer(q.nr)?.naam || '', duur: TICKET_DUUR.installatie * Math.max(1, Math.ceil(q.aantal / 2)),
  });
  return { ticket, assets: assetIds.length };
}

// Na afronden van een installatieticket: geplande systemen van de klant worden actief.
export function activatePlannedAssets(nr) {
  store.update((s) => {
    s.assets.filter((a) => !a.deleted && String(a.nr) === String(nr) && a.status === 'gepland').forEach((a) => {
      Object.assign(a, { status: 'actief', geplaatst: todayISO(), laatsteOnderhoud: todayISO(), updatedAt: now() });
    });
  });
}
