// Zwevende assistent: Claude met gereedschap om alles in de app op te zoeken (klanten, bezoeken, deals,
// activiteiten, service, contracten, voorraad, planning), schermen te openen en taken of notities toe te voegen.
import {
  store, todayISO, daysBetween, uid, now, customer, stats, statFor, profile, fullAddress, refillForecast, refillsDue,
  openActivities, openDeals, dealsWithoutNextStep, openTickets, activeContracts, mrr, contractsEndingSoon,
  contactsFor, assetsFor, klantStatus, ACTIVITY_TYPES, norm,
} from './store.js';
import { lowStock } from './stock.js';
import { $, h, toast } from './ui.js';
import { claudeClient, claudeConfigured, CLAUDE_MODEL } from './claude.js';
import * as db from './sync.js';

const HISTORY_KEY = 'klantkaart.assistent';
const MAX_ROUNDS = 12;

// ---------- gereedschap ----------

const clip = (arr, n = 40) => ({ totaal: arr.length, ...(arr.length > n ? { getoond: n } : {}), items: arr.slice(0, n) });
const klantKort = (c, all = stats()) => {
  const st = statFor(all, c.nr);
  const p = profile(c.nr);
  return { nr: c.nr, naam: c.naam, plaats: c.plaats, sector: p.sector || '', status: klantStatus(c.nr), laatsteBezoek: st.laatste, bezoeken: st.bezoeken, classificatie: st.classificatie || '', km: c.km };
};
const naam = (nr) => customer(nr)?.naam || `klant ${nr}`;

const TOOLS = [
  {
    name: 'overzicht',
    description: 'Actueel overzicht van het bedrijf: aantallen klanten, bezoeken deze week, open deals en waarde, deals zonder volgende stap, activiteiten die te laat of vandaag zijn, klanten die binnenkort moeten navullen, open servicetickets, aflopende contracten, maandomzet (MRR) en voorraad onder minimum. Gebruik dit voor algemene vragen als "hoe staan we ervoor" of "wat moet ik vandaag doen".',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      const s = store.get();
      const today = todayISO();
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const acts = openActivities();
      const deals = openDeals();
      return {
        vandaag: today,
        klanten: s.customers.length,
        bezoekenAfgelopen7Dagen: s.visits.filter((v) => v.datum >= todayISO(weekAgo)).length,
        openDeals: { aantal: deals.length, waarde: deals.reduce((t, d) => t + (Number(d.waarde) || 0), 0) },
        dealsZonderVolgendeStap: dealsWithoutNextStep().map((d) => ({ klant: naam(d.nr), nr: d.nr, titel: d.titel })).slice(0, 15),
        activiteitenTeLaat: acts.filter((a) => a.datum < today).map((a) => ({ klant: naam(a.nr), nr: a.nr, titel: a.titel, datum: a.datum })).slice(0, 20),
        activiteitenVandaag: acts.filter((a) => a.datum === today).map((a) => ({ klant: naam(a.nr), nr: a.nr, titel: a.titel, tijd: a.tijd })),
        binnenkortNavullen: refillsDue().map(({ c, f }) => ({ klant: c.naam, nr: c.nr, plaats: c.plaats, leegOp: f.leeg, dagenResterend: f.dagenResterend })).slice(0, 20),
        openTickets: openTickets().map((t) => ({ code: t.code, klant: naam(t.nr), nr: t.nr, titel: t.titel, prioriteit: t.prioriteit, status: t.status })).slice(0, 20),
        contractenAflopend60Dagen: contractsEndingSoon(60).map((c) => ({ klant: naam(c.nr), nr: c.nr, omschrijving: c.omschrijving, eind: c.eind })),
        mrrTotaal: mrr(),
        voorraadOnderMinimum: lowStock().map((x) => x.naam || x.item?.naam || x).slice(0, 20),
      };
    },
  },
  {
    name: 'zoek_klanten',
    description: 'Zoek klanten op naam, plaats, adres, e-mail of telefoon, en/of filter op plaats, sector of status (Prospect, Proefplaatsing, Klant, Oud-klant). Zonder zoekterm krijg je alle klanten (met filters). Sorteer optioneel op langst niet bezocht of afstand.',
    input_schema: {
      type: 'object',
      properties: {
        zoekterm: { type: 'string', description: 'Deel van naam, plaats, adres, e-mail of telefoon' },
        plaats: { type: 'string' },
        sector: { type: 'string' },
        status: { type: 'string' },
        nooitBezocht: { type: 'boolean' },
        sorteer: { type: 'string', enum: ['naam', 'langst_niet_bezocht', 'afstand'] },
        limiet: { type: 'integer', description: 'Max. aantal resultaten (standaard 40)' },
      },
      additionalProperties: false,
    },
    run({ zoekterm = '', plaats = '', sector = '', status = '', nooitBezocht = false, sorteer = 'naam', limiet = 40 }) {
      const all = stats();
      const q = norm(zoekterm);
      let list = store.get().customers.filter((c) => {
        const p = profile(c.nr);
        if (q && ![c.naam, c.plaats, c.adres, c.telefoon, p.email, c.postcode].some((x) => norm(x).includes(q))) return false;
        if (plaats && !norm(c.plaats).includes(norm(plaats))) return false;
        if (sector && !norm(p.sector).includes(norm(sector))) return false;
        if (status && norm(klantStatus(c.nr)) !== norm(status)) return false;
        if (nooitBezocht && statFor(all, c.nr).bezoeken) return false;
        return true;
      }).map((c) => klantKort(c, all));
      if (sorteer === 'langst_niet_bezocht') list.sort((a, b) => (a.laatsteBezoek || '').localeCompare(b.laatsteBezoek || ''));
      else if (sorteer === 'afstand') list.sort((a, b) => (a.km ?? 9999) - (b.km ?? 9999));
      else list.sort((a, b) => a.naam.localeCompare(b.naam));
      return clip(list, Math.min(limiet, 100));
    },
  },
  {
    name: 'klant_details',
    description: 'Alles over één klant: adres, telefoon, profiel en geur-DNA, contactpersonen, contracten, geplaatste systemen, bezoekhistorie en verbruik, navulvoorspelling, deals, open activiteiten, servicetickets en offertes.',
    input_schema: { type: 'object', properties: { nr: { type: 'integer', description: 'Klantnummer' } }, required: ['nr'], additionalProperties: false },
    run({ nr }) {
      const c = customer(nr);
      if (!c) return { fout: `Geen klant met nummer ${nr}. Zoek eerst met zoek_klanten.` };
      const s = store.get();
      const st = statFor(stats(), nr);
      return {
        klant: { ...c, volledigAdres: fullAddress(c), status: klantStatus(nr) },
        profiel: profile(nr),
        statistiek: st,
        navulvoorspelling: refillForecast(nr),
        contactpersonen: contactsFor(nr),
        contracten: activeContracts(nr),
        mrr: mrr(nr),
        systemen: assetsFor(nr),
        bezoeken: s.visits.filter((v) => String(v.nr) === String(nr)).sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 15),
        deals: s.deals.filter((d) => !d.deleted && String(d.nr) === String(nr)),
        openActiviteiten: openActivities(nr),
        tickets: s.tickets.filter((t) => !t.deleted && String(t.nr) === String(nr)).slice(-10),
        offertes: s.quotes.filter((q) => !q.deleted && String(q.nr) === String(nr)),
      };
    },
  },
  {
    name: 'lijst',
    description: 'Lijst uit een onderdeel van de app, optioneel gefilterd op tekst en datum. Soorten: deals, activiteiten, bezoeken, tickets, contracten, offertes, voorraad, planning (opgeslagen dagplanningen).',
    input_schema: {
      type: 'object',
      properties: {
        soort: { type: 'string', enum: ['deals', 'activiteiten', 'bezoeken', 'tickets', 'contracten', 'offertes', 'voorraad', 'planning'] },
        tekst: { type: 'string', description: 'Filter op tekst (klantnaam, titel, omschrijving, …)' },
        van: { type: 'string', description: 'Vanaf datum JJJJ-MM-DD' },
        tot: { type: 'string', description: 'Tot en met datum JJJJ-MM-DD' },
        alleenOpen: { type: 'boolean', description: 'Alleen open deals, open activiteiten of open tickets' },
        limiet: { type: 'integer' },
      },
      required: ['soort'],
      additionalProperties: false,
    },
    run({ soort, tekst = '', van = '', tot = '', alleenOpen = false, limiet = 50 }) {
      const s = store.get();
      const q = norm(tekst);
      const withName = (x) => ({ ...x, klant: x.nr !== undefined ? naam(x.nr) : undefined });
      const src = {
        deals: () => (alleenOpen ? openDeals() : s.deals.filter((d) => !d.deleted)),
        activiteiten: () => (alleenOpen ? openActivities() : s.activities.filter((a) => !a.deleted)),
        bezoeken: () => s.visits.slice().sort((a, b) => b.datum.localeCompare(a.datum)),
        tickets: () => (alleenOpen ? openTickets() : s.tickets.filter((t) => !t.deleted)),
        contracten: () => s.contracts.filter((c) => !c.deleted),
        offertes: () => s.quotes.filter((x) => !x.deleted),
        voorraad: () => s.stock.filter((x) => !x.deleted),
        planning: () => Object.values(s.plans).sort((a, b) => b.datum.localeCompare(a.datum)).map((p) => ({ datum: p.datum, door: p.door, stops: (p.stops || []).map((x) => ({ nr: x.nr, naam: naam(x.nr), aankomst: x.aankomst })) })),
      }[soort];
      if (!src) return { fout: 'Onbekende soort' };
      let list = src().map(withName);
      const datumVan = (x) => x.datum || x.gemeld || x.start || '';
      if (van) list = list.filter((x) => datumVan(x) >= van);
      if (tot) list = list.filter((x) => datumVan(x) && datumVan(x).slice(0, 10) <= tot);
      if (q) list = list.filter((x) => norm(JSON.stringify(x)).includes(q));
      return clip(list, Math.min(limiet, 100));
    },
  },
  {
    name: 'open_scherm',
    description: 'Open een scherm in de app voor de gebruiker. Paden: #/vandaag, #/klanten, #/klant/NR, #/klant/nieuw, #/pipeline, #/planning, #/service, #/voorraad, #/rapport, #/import, #/meer, #/offerte?nr=NR, #/bezoek?nr=NR.',
    input_schema: { type: 'object', properties: { pad: { type: 'string' } }, required: ['pad'], additionalProperties: false },
    run({ pad }) {
      if (!/^#\/[\w/?=&.-]*$/.test(pad)) return { fout: 'Ongeldig pad' };
      location.hash = pad;
      return { geopend: pad };
    },
  },
  {
    name: 'activiteit_toevoegen',
    description: 'Voeg een activiteit (taak, herinnering, belafspraak, bezoek, e-mail, follow-up of proefplaatsing) toe aan een klant. Alleen gebruiken als de gebruiker daar duidelijk om vraagt.',
    input_schema: {
      type: 'object',
      properties: {
        nr: { type: 'integer' },
        type: { type: 'string', enum: Object.keys(ACTIVITY_TYPES) },
        titel: { type: 'string' },
        datum: { type: 'string', description: 'JJJJ-MM-DD' },
        tijd: { type: 'string', description: 'HH:MM, optioneel' },
        notitie: { type: 'string' },
      },
      required: ['nr', 'type', 'titel', 'datum'],
      additionalProperties: false,
    },
    write: true,
    run({ nr, type, titel, datum, tijd = '', notitie = '' }) {
      if (!customer(nr)) return { fout: `Geen klant met nummer ${nr}` };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return { fout: 'Datum moet JJJJ-MM-DD zijn' };
      const id = uid();
      store.update((s) => { s.activities.push({ id, nr, type, titel, datum, tijd, notitie, done: false, deleted: false, updatedAt: now() }); });
      return {
        result: { toegevoegd: true, id, klant: naam(nr) },
        label: `${ACTIVITY_TYPES[type]} “${titel}” bij ${naam(nr)} op ${datum}${tijd ? ' ' + tijd : ''}`,
        undo: () => store.update((s) => { const a = s.activities.find((x) => x.id === id); if (a) { a.deleted = true; a.updatedAt = now(); } }),
      };
    },
  },
  {
    name: 'notitie_toevoegen',
    description: 'Zet een korte notitie (met datum) bij de klant, onder de bestaande notities. Alleen gebruiken als de gebruiker daar duidelijk om vraagt.',
    input_schema: { type: 'object', properties: { nr: { type: 'integer' }, tekst: { type: 'string' } }, required: ['nr', 'tekst'], additionalProperties: false },
    write: true,
    run({ nr, tekst }) {
      const c = customer(nr);
      if (!c) return { fout: `Geen klant met nummer ${nr}` };
      const before = c.notitie || '';
      const line = `${todayISO()}: ${tekst.trim()}`;
      store.update((s) => { const x = s.customers.find((k) => String(k.nr) === String(nr)); x.notitie = before ? `${before}\n${line}` : line; x.dirty = !x.pending; });
      return {
        result: { toegevoegd: true, klant: c.naam },
        label: `Notitie bij ${c.naam}: “${tekst.trim()}”`,
        undo: () => store.update((s) => { const x = s.customers.find((k) => String(k.nr) === String(nr)); if (x) x.notitie = before; }),
      };
    },
  },
];

function systemPrompt() {
  const s = store.get();
  return `Je bent de assistent in Klantkaart, de sales- en service-app van ${s.settings.bedrijf?.naam || 'Scentlinq Pro Benelux'} (geurmarketing: geursystemen, navullingen, serviceabonnementen in de Benelux).
Je praat met ${db.user() || 'een medewerker'}. Vandaag is ${new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${todayISO()}).

Je kent de hele app via je gereedschap. Zoek altijd op in plaats van te gokken, en verzin nooit klanten, cijfers of datums. Als iets niet in de gegevens staat, zeg dat.

De app:
- Vandaag: KPI's, route van vandaag, activiteiten (te laat/vandaag/binnenkort), klanten die bijna moeten navullen of aandacht nodig hebben.
- Klanten en de klantkaart: bellen, navigeren, bezoek loggen (datum, verbruik in ml, geur, instellingen), profiel en geur-DNA, keten/multi-locatie, navulvoorspelling, deals, volgende stappen, tijdlijn, contactpersonen, contracten, geplaatste systemen.
- Pipeline: deals per fase (${s.settings.fases.join(', ')}), gewonnen/verloren; elke open deal hoort een volgende activiteit te hebben.
- Planning: dagvoorstel met 4–6 bezoeken vanaf ${s.settings.startPlaats}, of laten plannen door Claude; export naar Google Maps.
- Service: tickets (storing, navulling, onderhoud, installatie), servicerapporten met handtekening, QR-stickers waarmee klanten zelf een melding doen, voorraad in magazijn en bus.
- Offerte: systeem kopen of leasen plus serviceabonnement, als PDF.
- Meer: importeren uit Excel/CSV, back-up, account en gebruikers, Claude, instellingen. Rapportage: MRR, contracten, conversie, verbruik per sector.
Alle gegevens worden gedeeld met collega's via de gedeelde database.

Stijl: Nederlands, kort en praktisch, zoals een collega. Gebruik korte opsommingen waar dat helpt. Verwijs naar een klant als link: [Klantnaam](#/klant/NR). Voor andere schermen kun je ook linken, bv. [Planning](#/planning).
Wijzigingen (activiteit of notitie toevoegen) doe je alleen als de gebruiker daar duidelijk om vraagt; zeg daarna in één zin wat je hebt gedaan. Voor andere wijzigingen leg je uit waar dat in de app kan.`;
}

// ---------- gesprek ----------

let messages = [];
try { messages = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); } catch {}
let busy = false;
let ctl = null;
const undoers = new Map();
let open = false;

const saveHistory = () => { try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages)); } catch {} };

// Veilige mini-opmaak: HTML escapen, dan **vet**, `code`, lijstjes en interne links (#/…).
function format(text) {
  let t = h(text);
  t = t.replace(/\[([^\]]+)\]\((#\/[\w/?=&.-]*)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = t.split('\n');
  let out = '', inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*[-*•]\s+(.*)$/) || line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${m[1]}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    out += line.trim() ? `<p>${line.replace(/^#+\s*/, '')}</p>` : '';
  }
  return out + (inList ? '</ul>' : '');
}

const TOOL_LABEL = {
  overzicht: 'Overzicht bekijken', zoek_klanten: 'Klanten zoeken', klant_details: 'Klantkaart lezen', lijst: 'Gegevens doorzoeken',
  open_scherm: 'Scherm openen', activiteit_toevoegen: 'Activiteit toevoegen', notitie_toevoegen: 'Notitie toevoegen',
};

function renderLog(status = '') {
  const log = $('#asLog');
  if (!log) return;
  const parts = [];
  for (const m of messages) {
    if (m.role === 'user' && typeof m.content === 'string') parts.push(`<div class="as-msg me">${h(m.content)}</div>`);
    if (m.role === 'assistant') {
      const text = (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) parts.push(`<div class="as-msg bot">${format(text)}</div>`);
    }
    if (m.actions) for (const a of m.actions) parts.push(`<div class="as-action">✓ ${h(a.label)} ${undoers.has(a.id) ? `<button class="btn small ghost" data-undo="${a.id}">Ongedaan maken</button>` : ''}</div>`);
  }
  if (!messages.length) {
    parts.push(`<div class="as-empty">
      <p><b>Hoi${db.user() ? ' ' + h(db.user()) : ''}!</b> Ik ken alle klanten, bezoeken, deals, service en voorraad in de app. Vraag maar raak.</p>
      ${['Wat moet ik vandaag doen?', 'Welke klanten moeten binnenkort navullen?', 'Welke deals hebben geen volgende stap?', 'Welke klanten in Rotterdam zijn nooit bezocht?'].map((q) => `<button class="chip" data-ask="${h(q)}">${h(q)}</button>`).join('')}
    </div>`);
  }
  if (status) parts.push(`<div class="as-status"><span class="as-dots"></span> ${h(status)}</div>`);
  log.innerHTML = parts.join('');
  log.scrollTop = log.scrollHeight;
  $('#asSend').textContent = busy ? 'Stop' : 'Stuur';
}

async function ask(question) {
  if (busy || !question.trim()) return;
  if (!claudeConfigured()) { renderLog(); return; }
  busy = true;
  ctl = new AbortController();
  const start = messages.length;
  messages.push({ role: 'user', content: question.trim() });
  renderLog('Even kijken…');
  try {
    const anthropic = await claudeClient();
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await anthropic.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: systemPrompt(),
        tools: TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
        // Alleen rol en inhoud meesturen (acties zijn voor de weergave).
        messages: messages.map(({ role, content }) => ({ role, content })),
      }, { signal: ctl.signal });
      if (response.stop_reason === 'refusal') { messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Daar kan ik je helaas niet mee helpen.' }] }); break; }
      messages.push({ role: 'assistant', content: response.content });
      if (response.stop_reason !== 'tool_use') break;

      const results = [];
      const actions = [];
      for (const b of response.content.filter((x) => x.type === 'tool_use')) {
        const tool = TOOLS.find((t) => t.name === b.name);
        renderLog(`${TOOL_LABEL[b.name] || b.name}…`);
        try {
          if (!tool) throw new Error('Onbekend gereedschap');
          const out = tool.run(b.input || {});
          if (tool.write && out.result) {
            const id = uid();
            undoers.set(id, out.undo);
            actions.push({ id, label: out.label });
            results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out.result) });
          } else {
            results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out), ...(out?.fout ? { is_error: true } : {}) });
          }
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: b.id, content: e.message, is_error: true });
        }
      }
      messages.push({ role: 'user', content: results, ...(actions.length ? { actions } : {}) });
      renderLog('Even kijken…');
    }
  } catch (e) {
    const aborted = e?.name === 'AbortError' || /abort/i.test(e?.message || '');
    // Onvolledige ronde weghalen zodat het gesprek geldig blijft voor de volgende vraag
    // (acties die al zijn uitgevoerd blijven zichtbaar, met hun knop Ongedaan maken).
    const done = messages.slice(start).flatMap((m) => m.actions || []);
    messages.length = start;
    messages.push({ role: 'user', content: question.trim() });
    messages.push({ role: 'assistant', content: [{ type: 'text', text: aborted ? 'Gestopt.' : `Dat lukte niet: ${e.message}` }], ...(done.length ? { actions: done } : {}) });
  } finally {
    busy = false;
    ctl = null;
    saveHistory();
    renderLog();
  }
}

// ---------- knop en paneel ----------

const SPARKLE = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11l.95 2.55L22.5 16.5l-2.55.95L19 20l-.95-2.55L15.5 16.5l2.55-.95L19 13zM5 14l.7 1.8L7.5 16.5l-1.8.7L5 19l-.7-1.8L2.5 16.5l1.8-.7L5 14z"/></svg>';

function panelHtml() {
  if (!claudeConfigured()) {
    return `<div class="as-empty"><p><b>De assistent gebruikt Claude.</b></p><p class="muted">Claude is op dit apparaat nog niet gekoppeld. Een beheerder zet de API-sleutel in <code>api/config.php</code>, of je koppelt Claude zelf via <a href="#/meer">Meer › Claude</a>.</p></div>`;
  }
  return '';
}

export function initAssistant() {
  document.body.insertAdjacentHTML('beforeend', `
    <button id="asFab" class="as-fab" type="button" aria-label="Assistent openen" aria-expanded="false" aria-controls="asPanel">${SPARKLE}</button>
    <section id="asPanel" class="as-panel" role="dialog" aria-label="Assistent" hidden>
      <header class="as-head">
        <b>✨ Assistent</b>
        <span class="as-actions">
          <button class="btn small ghost" id="asNew" type="button">Nieuw gesprek</button>
          <button class="btn small ghost" id="asClose" type="button" aria-label="Sluiten">✕</button>
        </span>
      </header>
      <div id="asLog" class="as-log" aria-live="polite"></div>
      <form id="asForm" class="as-form">
        <textarea id="asInput" rows="1" placeholder="Vraag de assistent…" aria-label="Vraag aan de assistent"></textarea>
        <button id="asSend" class="btn primary" type="submit">Stuur</button>
      </form>
    </section>`);
  const panel = $('#asPanel');
  const fab = $('#asFab');
  const input = $('#asInput');
  const setOpen = (v) => {
    open = v;
    panel.hidden = !v;
    fab.setAttribute('aria-expanded', String(v));
    document.body.classList.toggle('as-open', v);
    if (v) {
      const note = panelHtml();
      if (note) $('#asLog').innerHTML = note; else renderLog(busy ? 'Even kijken…' : '');
      setTimeout(() => input.focus(), 50);
    }
  };
  fab.addEventListener('click', () => setOpen(!open));
  $('#asClose').addEventListener('click', () => setOpen(false));
  $('#asNew').addEventListener('click', () => { if (busy) ctl?.abort(); messages = []; undoers.clear(); saveHistory(); renderLog(); });
  $('#asForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) { ctl?.abort(); return; }
    const q = input.value;
    input.value = '';
    input.style.height = '';
    ask(q);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#asForm').requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; });
  panel.addEventListener('click', (e) => {
    const q = e.target.closest('[data-ask]');
    if (q) { ask(q.dataset.ask); return; }
    const u = e.target.closest('[data-undo]');
    if (u) {
      undoers.get(u.dataset.undo)?.();
      undoers.delete(u.dataset.undo);
      toast('Ongedaan gemaakt');
      renderLog();
      return;
    }
    // Op de telefoon sluit het paneel na het volgen van een link, zodat je het scherm ziet.
    if (e.target.closest('a[href^="#/"]') && matchMedia('(max-width: 699px)').matches) setOpen(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(false); });
}
