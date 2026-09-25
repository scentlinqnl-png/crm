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

export async function planWithClaude({ datum, opdracht, signal }) {
  // Voorbeeldweergave op claude.ai: vraag het aan Claude via de pagina zelf.
  const sample = claudeConfigured() ? null : await pageSample();
  if (sample) {
    try {
      const answer = await sample.json(
        `${systemPrompt()}\n\nAntwoord uitsluitend met één JSON-object volgens dit schema: ${JSON.stringify(SCHEMA)}\nVoorbeeld: {"startTijd":"09:00","stops":[{"nr":12,"reden":"navulling nodig binnen 3 dagen"}],"toelichting":"..."}\n\n${userPrompt(datum, opdracht)}`,
        { modelTier: 'complex', cache: false, signal }
      );
      return toPlan(datum, answer);
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
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: systemPrompt(),
    messages: [{ role: 'user', content: userPrompt(datum, opdracht) }],
  }, { signal });
  if (response.stop_reason === 'refusal') throw new Error('Claude kon deze planning niet maken. Pas de opdracht aan.');
  if (response.stop_reason === 'max_tokens') throw new Error('Het antwoord van Claude was te lang. Probeer het opnieuw.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return toPlan(datum, parseAnswer(text));
}
