// Fictieve voorbeeldgegevens om de app te bekijken zonder eigen werkboek.
import { store, todayISO, uid, now } from './store.js';

const PLAATSEN = [
  ['Bergen op Zoom', 0, 51.495, 4.291], ['Roosendaal', 14, 51.531, 4.465], ['Breda', 45, 51.589, 4.776],
  ['Antwerpen', 40, 51.219, 4.402], ['Rotterdam', 75, 51.924, 4.478], ['Middelburg', 65, 51.499, 3.61],
  ['Terneuzen', 88, 51.336, 3.828], ['Dordrecht', 55, 51.813, 4.69], ['Eindhoven', 105, 51.441, 5.47],
  ['Tilburg', 70, 51.555, 5.091], ['Goes', 45, 51.504, 3.889], ['Mortsel', 45, 51.17, 4.456],
];
const NAMEN = [
  ['Hotel De Zeeuwse Stroom', 'Hospitality & Hotels', 'Zeeuwse Stroom Hotels'], ['Zonnestudio Solaris', 'Beauty & Wellness', ''],
  ['Showroom Van Dijk Interieur', 'Retail & Showrooms', ''], ['Brasserie Het Anker', 'Hospitality & Hotels', ''],
  ['Kliniek Oosterpark', 'Zorg & Luchtvaart', ''], ['Autohuis Brabant', 'Automotive', 'Autohuis Brabant'],
  ['Boutique Lina', 'Retail & Showrooms', ''], ['Wellness Aqua Vita', 'Beauty & Wellness', ''],
  ['Hotel Scheldezicht', 'Hospitality & Hotels', 'Zeeuwse Stroom Hotels'], ['Kapsalon Knip & Co', 'Beauty & Wellness', ''],
  ['Juwelier Goudhaan', 'Retail & Showrooms', ''], ['Tandartspraktijk De Linde', 'Zorg & Luchtvaart', ''],
  ['Autohuis Brabant Breda', 'Automotive', 'Autohuis Brabant'], ['Fitness Pulse', 'Kantoor & Overig', ''],
  ['Hotel Zeeuwse Stroom Goes', 'Hospitality & Hotels', 'Zeeuwse Stroom Hotels'], ['Lounge Bar Nova', 'Hospitality & Hotels', ''],
  ['Opticien Helder', 'Retail & Showrooms', ''], ['Zonnestudio Tropicana', 'Beauty & Wellness', ''],
];
const GEUREN = ['Ocean Breeze', 'Green Tea & Lemongrass', 'White Tea', 'Amber Wood', 'Fresh Linen'];
const INST = ['30 sec. ON / 3 min. OFF', '20 sec. ON / 4 min. OFF', '45 sec. ON / 2 min. OFF'];

export function loadDemo() {
  const today = new Date();
  const dayISO = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return todayISO(d); };
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

  store.update((s) => {
    s.customers = NAMEN.map(([naam], i) => {
      const [plaats, km] = PLAATSEN[(i % (PLAATSEN.length - 1)) + 1];
      return { nr: i + 1, naam, adres: `Voorbeeldstraat ${i + 3}`, postcode: '', plaats, telefoon: i % 3 ? '' : '0612345678', km, min: Math.round((km / 80) * 60), notitie: '' };
    });
    s.afstanden = Object.fromEntries(PLAATSEN.map(([p, km]) => [p.toLowerCase(), km]));
    s.coords = Object.fromEntries(PLAATSEN.map(([p, , lat, lon]) => [p.toLowerCase(), { lat, lon }]));
    s.visits = [];
    s.customers.forEach((c, i) => {
      if (i % 5 === 4) return; // een paar klanten nooit bezocht
      const geur = GEUREN[i % GEUREN.length];
      const n = 2 + (i % 3);
      const interval = 25 + (i % 4) * 7;
      for (let k = n; k >= 1; k--) {
        const base = i % 4 === 0 ? 90 : i % 4 === 1 ? 260 : 170;
        s.visits.push({ id: uid(), datum: dayISO(-k * interval - (i % 6)), nr: c.nr, ml: Math.round(base + rnd() * 60), opmerking: '', geur, instellingen: INST[i % INST.length], pending: false });
      }
    });
    // Twee recente bezoeken zodat de week- en maandcijfers niet leeg zijn.
    for (const nr of [2, 8]) s.visits.push({ id: uid(), datum: dayISO(-1), nr, ml: 240, opmerking: '', geur: GEUREN[nr % GEUREN.length], instellingen: INST[0], pending: false });
    s.profiles = s.customers.map((c, i) => ({
      id: String(c.nr), nr: c.nr, sector: NAMEN[i][1], keten: NAMEN[i][2], contactpersoon: '', email: '',
      geurprofiel: GEUREN[i % GEUREN.length], sfeer: NAMEN[i][1].startsWith('Hosp') ? 'luxueus, warm' : '', m3: 150 + (i % 5) * 180,
      circulatie: 'normaal', systeem: '', aantal: null, flaconMl: 500, updatedAt: now(),
    }));
    const fases = s.settings.fases;
    s.deals = [
      [3, 'Showroom beleving 2× Medium', 2600, fases[3]], [5, 'Kliniek wachtruimtes', 1800, fases[2]],
      [11, 'Signature scent winkel', 1400, fases[1]], [14, 'Lounge + terras', 2100, fases[0]], [17, 'Opticien 1× Compact', 900, fases[4] || fases[0]],
    ].map(([nr, titel, waarde, fase]) => ({ id: uid(), nr, titel, waarde, fase, status: 'open', gesloten: '', deleted: false, updatedAt: now() }));
    s.deals.push({ id: uid(), nr: 1, titel: 'Hotel lobby HVAC', waarde: 4800, fase: fases[3], status: 'gewonnen', gesloten: dayISO(-6), deleted: false, updatedAt: now() });
    s.activities = [
      { nr: 3, type: 'bellen', titel: 'Offerte nabellen', datum: dayISO(-1), tijd: '10:00' },
      { nr: 5, type: 'demo', titel: 'Proefplaatsing White Tea', datum: dayISO(0), tijd: '14:00' },
      { nr: 11, type: 'email', titel: 'Geurmonsters sturen', datum: dayISO(2), tijd: '' },
    ].map((a) => ({ id: uid(), notitie: '', done: false, deleted: false, updatedAt: now(), ...a }));
    // Contactpersonen, contracten, geplaatste systemen en tickets (allemaal fictief).
    const CONTACTS = [[1, 'Sanne de Wit', 'Hotelmanager'], [1, 'Mark Jansen', 'Technische dienst'], [3, 'Peter van Dijk', 'Eigenaar'], [5, 'Dr. L. Bakker', 'Praktijkmanager'], [9, 'Eva Martens', 'Front office'], [15, 'Tom Verhoeven', 'Operations']];
    s.contacts = CONTACTS.map(([nr, naam, functie], i) => ({ id: uid(), nr, naam, functie, telefoon: '0612345678', email: `${naam.split(' ')[0].toLowerCase().replace(/\W/g, '')}@voorbeeld.nl`, primair: i === 0 || CONTACTS[i - 1][0] !== nr, deleted: false, updatedAt: now() }));
    const addMonths = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + n); return todayISO(d); };
    s.contracts = [
      [1, 'lease', 'Scent HVAC lobby + navulservice', 249, 0, dayISO(-340), 12],
      [9, 'abonnement', '2× Scent Medium + navulservice', 138, 1790, dayISO(-200), 24],
      [15, 'abonnement', 'Scent Pro restaurant', 129, 1895, dayISO(-700), 24],
      [2, 'abonnement', 'Scent Compact + geurpatronen', 39, 395, dayISO(-120), 12],
      [8, 'huur', 'Scent Medium wellness', 89, 0, dayISO(-60), 36],
      [6, 'abonnement', 'Showroom 2× Scent Pro', 258, 3790, dayISO(-330), 12],
    ].map(([nr, soort, omschrijving, perMaand, eenmalig, start, mnd]) => ({ id: uid(), nr, soort, omschrijving, perMaand, eenmalig, start, eind: addMonths(start, mnd), opzegMnd: 1, status: 'actief', deleted: false, updatedAt: now() }));
    s.assets = [
      [1, 'Scent HVAC', 'Lobby'], [9, 'Scent Medium', 'Receptie'], [9, 'Scent Medium', 'Ontbijtzaal'], [15, 'Scent Pro', 'Restaurant'],
      [2, 'Scent Compact', 'Cabines'], [8, 'Scent Medium', 'Spa'], [6, 'Scent Pro', 'Showroom'], [6, 'Scent Pro', 'Werkplaats-ontvangst'],
    ].map(([nr, systeem, locatie], i) => ({ id: uid(), nr, systeem, serienummer: `SLQ-${2400 + i * 17}`, locatie, geplaatst: dayISO(-300 + i * 20), geur: GEUREN[nr % GEUREN.length], laatsteOnderhoud: dayISO(-40 - i * 9), status: i === 3 ? 'defect' : 'actief', deleted: false, updatedAt: now() }));
    const T = [
      [15, 3, 'storing', 'spoed', 'Machine verneveld niet meer', 0],
      [9, 1, 'onderhoud', 'normaal', 'Halfjaarlijks onderhoud receptie', 0],
      [6, 6, 'navulling', 'normaal', 'Patronen vervangen showroom', 0],
      [2, 4, 'vraag', 'laag', 'Andere geur voor cabines?', 1],
      [8, 5, 'storing', 'hoog', 'Timer loopt niet goed', 2],
      [1, 0, 'onderhoud', 'normaal', 'Filter HVAC-unit vervangen', null],
      [14, null, 'installatie', 'normaal', 'Proefplaatsing lounge', null],
    ];
    s.tickets = T.map(([nr, ai, type, prioriteit, titel, dag], i) => ({
      id: uid(), code: `T-${String(i + 1).padStart(4, '0')}`, nr, assetId: ai === null ? '' : s.assets[ai].id, type, prioriteit,
      status: dag === null ? 'nieuw' : 'ingepland', titel, omschrijving: '', melder: s.contacts.find((c) => c.nr === nr)?.naam || '', gemeld: dayISO(-2 - i),
      datum: dag === null ? '' : dayISO(dag), tijd: '', duur: { storing: 45, navulling: 20, onderhoud: 45, installatie: 90, vraag: 15 }[type], oplossing: '', gesloten: '', deleted: false, updatedAt: now(),
    }));
    s.tickets.push({ id: uid(), code: 'T-0008', nr: 1, assetId: s.assets[0].id, type: 'storing', prioriteit: 'hoog', status: 'opgelost', titel: 'Lekkage bij aansluiting', omschrijving: '', melder: 'Mark Jansen', gemeld: dayISO(-12), datum: dayISO(-11), tijd: '10:00', duur: 45, oplossing: 'Koppeling vervangen en getest.', gesloten: dayISO(-11), deleted: false, updatedAt: now() });
    s.ticketSeq = 8;
    s.assets.forEach((a, i) => { a.interval = [6, 6, 12, 6, 12, 6, 6, 12][i] || 6; });
    s.stock = [];
    s.stockMoves = [];
    s.profiles.forEach((p) => { if ([1, 2, 6, 8, 9, 15].includes(Number(p.nr))) p.status = 'Klant'; });
    s.serviceRoutes = {};
    s.plans = {};
    s.pinned = [];
    s.source = 'demo';
    s.lastSync = now();
  });
}
