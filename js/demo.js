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
    s.plans = {};
    s.pinned = [];
    s.source = 'demo';
    s.lastSync = now();
  });
}
