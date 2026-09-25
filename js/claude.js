// Dagplanning door Claude (Anthropic API) op basis van de klantenlijst en een vrije opdracht.
import { store, todayISO } from './store.js';
import { candidateSummary, planFromSelection } from './planner.js';

const KEY_STORAGE = 'klantkaart.claudeKey';
export const CLAUDE_MODEL = 'claude-opus-5';

export function getClaudeKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
export function setClaudeKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {}
}

// Koppeling is actief met een eigen API-sleutel, of via een proxy-URL (sleutel blijft dan op de server).
export const claudeConfigured = () => !!(getClaudeKey() || store.get().settings.claudeProxy);

// Op claude.ai (voorbeeldweergave) kan de pagina Claude zelf vragen, zonder API-sleutel.
let pageSamplePromise = null;
export function pageSample() {
  if (typeof window.claude?.use !== 'function') return Promise.resolve(null);
  pageSamplePromise ||= window.claude.use('sample').catch(() => null);
  return pageSamplePromise;
}

let pageOk = false;
pageSample().then((x) => { pageOk = !!x; });
// Is Claude bruikbaar in deze weergave (eigen sleutel/proxy of via claude.ai)?
export const claudeReady = () => claudeConfigured() || pageOk;

const SAMPLE_ERRORS = {
  not_granted: 'Je hebt deze pagina geen toestemming gegeven om Claude te gebruiken.',
  sampling_disabled: 'Claude is niet beschikbaar voor dit account.',
  rate_limited: 'Even te veel verzoeken. Probeer het over een paar minuten opnieuw.',
  session_expired: 'Je sessie is verlopen. Log opnieuw in bij claude.ai.',
  refused: 'Claude kon deze planning niet maken. Pas de opdracht aan.',
  prompt_too_large: 'De klantenlijst is te groot voor deze weergave.',
  invalid_json: 'Claude gaf geen bruikbare planning terug. Probeer het opnieuw.',
};

let clientPromise = null;
async function client() {
  if (!clientPromise) {
    clientPromise = import('../vendor/anthropic-sdk.mjs').then(({ default: Anthropic }) => {
      const proxy = store.get().settings.claudeProxy;
      return new Anthropic({
        apiKey: getClaudeKey() || 'via-proxy',
        ...(proxy ? { baseURL: proxy } : {}),
        dangerouslyAllowBrowser: true,
      });
    });
  }
  return clientPromise;
}
export function resetClaudeClient() { clientPromise = null; }

const SCHEMA = {
  type: 'object',
  properties: {
    startTijd: { type: 'string', description: 'Vertrektijd vanaf de startplaats, HH:MM' },
    stops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nr: { type: 'integer', description: 'Klantnr. uit de lijst' },
          reden: { type: 'string', description: 'Korte reden (max. 15 woorden) waarom deze klant nu aan de beurt is' },
        },
        required: ['nr', 'reden'],
        additionalProperties: false,
      },
    },
    toelichting: { type: 'string', description: 'Twee of drie zinnen over de keuze en de route' },
  },
  required: ['startTijd', 'stops', 'toelichting'],
  additionalProperties: false,
};

function systemPrompt() {
  const st = store.get().settings;
  return `Je bent de planningsassistent van een buitendienstmedewerker van Scentlinq Pro Benelux (geurmarketing: geurmachines plaatsen, navullen en onderhouden bij zakelijke klanten).
Stel één werkdag met klantbezoeken samen uit de meegegeven klantenlijst.

Standaardregels, tenzij de opdracht van de gebruiker iets anders zegt:
- Start en eindpunt: ${st.startPlaats}. Werktijd ${st.startTijd}–${st.eindTijd}. Bezoekduur ${st.bezoekDuur} minuten.
- ${st.minStops} tot ${st.maxStops} bezoeken.
- Prioriteit is een mix van: navulling bijna nodig (dagen_tot_navullen laag of negatief), lang niet of nooit bezocht, classificatie "Weinig", open deals of open activiteiten, en handmatig ingeplande klanten (altijd meenemen).
- Groepeer klanten die geografisch dicht bij elkaar liggen (zelfde plaats of regio) zodat de route logisch is. km_vanaf_start en reistijd_min gaan over de afstand vanaf ${st.startPlaats}.
- Klanten verder dan ${st.maxKm} km niet inplannen tenzij gevraagd.
- Gebruik alleen klantnummers uit de lijst. Verzin geen klanten.
De app berekent zelf de volgorde en tijden; jij kiest de klanten, de vertrektijd en de reden per klant.`;
}

function userPrompt(datum, opdracht) {
  const d = new Date(datum + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `Datum: ${d} (${datum}). Vandaag is ${todayISO()}.
Opdracht van de gebruiker: ${opdracht?.trim() || 'Stel een goede dag voor volgens de standaardregels.'}

Klantenlijst (JSON):
${JSON.stringify(candidateSummary(datum))}`;
}

function parseAnswer(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude gaf geen bruikbare planning terug.');
  return JSON.parse(m[0]);
}

function toPlan(datum, answer) {
  const known = new Set(store.get().customers.map((c) => String(c.nr)));
  const stops = (answer.stops || []).filter((x) => known.has(String(x.nr)));
  if (!stops.length) throw new Error('Claude koos geen bestaande klanten. Probeer een andere opdracht.');
  return planFromSelection({
    datum,
    nrs: stops.map((x) => x.nr),
    redenen: Object.fromEntries(stops.map((x) => [String(x.nr), x.reden])),
    startTijd: answer.startTijd,
    toelichting: answer.toelichting || '',
  });
}

// Eén vraag aan Claude met een vast JSON-antwoordformaat: via de API (sleutel/proxy) of, op claude.ai, via de pagina.
async function askClaude({ system, user, schema, example, signal, effort = 'medium' }) {
  const sample = claudeConfigured() ? null : await pageSample();
  if (sample) {
    try {
      return await sample.json(
        `${system}\n\nAntwoord uitsluitend met één JSON-object volgens dit schema: ${JSON.stringify(schema)}${example ? `\nVoorbeeld: ${example}` : ''}\n\n${user}`,
        { modelTier: 'complex', cache: false, signal }
      );
    } catch (e) {
      if (e?.code === 'cancelled') throw new Error('Gestopt.');
      throw new Error(SAMPLE_ERRORS[e?.code] || e?.message || 'Claude is nu niet bereikbaar. Probeer het later opnieuw.');
    }
  }
  if (!claudeConfigured()) throw new Error('Koppel Claude eerst via Meer › Claude (API-sleutel of proxy).');

  const anthropic = await client();
  const response = await anthropic.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
  }, { signal });
  if (response.stop_reason === 'refusal') throw new Error('Claude kon hier geen antwoord op geven. Pas de vraag aan.');
  if (response.stop_reason === 'max_tokens') throw new Error('Het antwoord van Claude was te lang. Probeer het opnieuw.');
  return parseAnswer(response.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

export async function planWithClaude({ datum, opdracht, signal }) {
  const answer = await askClaude({
    system: systemPrompt(),
    user: userPrompt(datum, opdracht),
    schema: SCHEMA,
    example: '{"startTijd":"09:00","stops":[{"nr":12,"reden":"navulling nodig binnen 3 dagen"}],"toelichting":"..."}',
    signal,
  });
  return toPlan(datum, answer);
}

// ---------- helpdeskdag plannen ----------

const SERVICE_SCHEMA = {
  type: 'object',
  properties: {
    tickets: {
      type: 'array',
      items: {
        type: 'object',
        properties: { code: { type: 'string' }, reden: { type: 'string', description: 'Korte reden, max. 12 woorden' } },
        required: ['code', 'reden'],
        additionalProperties: false,
      },
    },
    toelichting: { type: 'string', description: 'Twee of drie zinnen over de keuze en de route' },
  },
  required: ['tickets', 'toelichting'],
  additionalProperties: false,
};

export async function planServiceWithClaude({ datum, opdracht, signal }) {
  const s = store.get();
  const st = s.settings;
  const open = s.tickets.filter((t) => !t.deleted && !['opgelost', 'gesloten'].includes(t.status) && (!t.datum || t.datum === datum || t.datum < datum));
  if (!open.length) throw new Error('Er zijn geen open tickets om in te plannen.');
  const rows = open.map((t) => {
    const c = s.customers.find((x) => String(x.nr) === String(t.nr)) || {};
    return { code: t.code, klant: c.naam, plaats: c.plaats, km_vanaf_start: c.km, type: t.type, prioriteit: t.prioriteit, duur_min: t.duur, gemeld: t.gemeld, al_ingepland_op: t.datum || undefined, titel: t.titel };
  });
  const system = `Je bent de planner van de helpdesk/buitendienst van Scentlinq Pro Benelux (geurmachines: storingen, navullingen, onderhoud, installaties).
Kies uit de open tickets een haalbare werkdag.
- Start en eindpunt ${st.startPlaats}. Werktijd ${st.startTijd}–${st.eindTijd}. Tel de duur van elk ticket plus reistijd (ca. ${st.snelheid} km/u).
- Spoed eerst, dan hoog, dan tickets die al lang open staan. Tickets die al op deze datum staan horen erbij tenzij het niet past.
- Groepeer op plaats/regio zodat de route logisch is; meerdere tickets bij dezelfde klant samen.
- Gebruik alleen ticketcodes uit de lijst.
De app berekent zelf de volgorde en de tijden.`;
  const d = new Date(datum + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  const answer = await askClaude({
    system,
    user: `Datum: ${d} (${datum}). Opdracht: ${opdracht?.trim() || 'Stel de beste helpdeskdag samen.'}\n\nOpen tickets (JSON):\n${JSON.stringify(rows)}`,
    schema: SERVICE_SCHEMA,
    example: '{"tickets":[{"code":"T-0012","reden":"spoed, zelfde regio"}],"toelichting":"..."}',
    signal,
  });
  const codes = new Set(open.map((t) => t.code));
  const tickets = (answer.tickets || []).filter((x) => codes.has(x.code));
  if (!tickets.length) throw new Error('Claude koos geen bestaande tickets. Probeer het opnieuw.');
  return { datum, tickets, toelichting: answer.toelichting || '' };
}

// ---------- briefing vóór een klantbezoek ----------

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    samenvatting: { type: 'string', description: 'Drie tot vijf zinnen: wie is deze klant en hoe staat de relatie ervoor' },
    aandachtspunten: { type: 'array', items: { type: 'string' }, description: 'Maximaal 5 concrete punten voor dit bezoek' },
    gespreksonderwerpen: { type: 'array', items: { type: 'string' }, description: 'Maximaal 4 kansen of vragen om te bespreken' },
  },
  required: ['samenvatting', 'aandachtspunten', 'gespreksonderwerpen'],
  additionalProperties: false,
};

export async function klantBriefing(nr, { signal } = {}) {
  const s = store.get();
  const eq = (x) => String(x.nr) === String(nr) && !x.deleted;
  const c = s.customers.find((x) => String(x.nr) === String(nr));
  const p = s.profiles.find((x) => String(x.nr) === String(nr)) || {};
  const data = {
    klant: { naam: c.naam, plaats: c.plaats, km_vanaf_start: c.km, notitie: c.notitie || undefined },
    profiel: { sector: p.sector, keten: p.keten, status: p.status, labels: p.labels, geurprofiel: p.geurprofiel, sfeer: p.sfeer, ruimte_m3: p.m3, systeem: p.systeem },
    contactpersonen: s.contacts.filter(eq).map((x) => ({ naam: x.naam, functie: x.functie, primair: x.primair })),
    bezoeken: s.visits.filter((v) => String(v.nr) === String(nr)).sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 10).map((v) => ({ datum: v.datum, ml: v.ml, geur: v.geur, instellingen: v.instellingen, opmerking: v.opmerking })),
    contracten: s.contracts.filter(eq).map((x) => ({ soort: x.soort, omschrijving: x.omschrijving, per_maand: x.perMaand, start: x.start, eind: x.eind, status: x.status })),
    systemen: s.assets.filter(eq).map((a) => ({ systeem: a.systeem, locatie: a.locatie, status: a.status, laatste_onderhoud: a.laatsteOnderhoud })),
    tickets: s.tickets.filter(eq).slice(-8).map((t) => ({ code: t.code, type: t.type, status: t.status, titel: t.titel, oplossing: t.oplossing, gemeld: t.gemeld })),
    deals: s.deals.filter(eq).map((d) => ({ titel: d.titel, fase: d.fase, status: d.status, waarde: d.waarde })),
    offertes: (s.quotes || []).filter(eq).map((q) => ({ code: q.code, status: q.status, per_maand: q.perMaand, datum: q.datum })),
    open_activiteiten: s.activities.filter((a) => eq(a) && !a.done).map((a) => ({ type: a.type, titel: a.titel, datum: a.datum })),
  };
  return askClaude({
    system: 'Je bereidt een buitendienstmedewerker van Scentlinq Pro Benelux (geurmarketing) voor op een klantbezoek. Schrijf in het Nederlands, zakelijk en concreet. Baseer je alleen op de gegevens; verzin niets.',
    user: `Vandaag is ${todayISO()}. Klantgegevens (JSON):\n${JSON.stringify(data)}`,
    schema: BRIEF_SCHEMA,
    example: '{"samenvatting":"...","aandachtspunten":["..."],"gespreksonderwerpen":["..."]}',
    effort: 'low',
    signal,
  });
}
