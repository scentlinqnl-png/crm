// Meldingen van buiten (WhatsApp, e-mail, plakken) omzetten naar een ticket, zonder server.
// De meldpagina zet onderaan een vaste regel: [SLQ sn=… k=… t=…]. Zonder die regel zoekt de app zelf.

export const TYPE_LABELS = { navulling: 'Geur is op', storing: 'Storing', onderhoud: 'Onderhoud', vraag: 'Vraag' };

export function buildMessage({ type, sn, sys, loc, k, kn, omschrijving, naam, telefoon }) {
  const lines = [
    `Melding: ${TYPE_LABELS[type] || type}`,
    kn && `Locatie: ${kn}${loc ? ` (${loc})` : ''}`,
    sys && `Systeem: ${sys}`,
    sn && `Serienummer: ${sn}`,
    omschrijving && `Toelichting: ${omschrijving}`,
    (naam || telefoon) && `Contact: ${[naam, telefoon].filter(Boolean).join(', ')}`,
  ].filter(Boolean);
  const tag = ['sn', sn, 'k', k, 't', type].reduce((a, v, i, arr) => (i % 2 === 0 && arr[i + 1] ? `${a} ${v}=${String(arr[i + 1]).replace(/[\s\]]/g, '_')}` : a), '');
  return `${lines.join('\n')}\n\n[SLQ${tag}]`;
}

const KEYWORDS = [
  ['navulling', /geur (is )?op|leeg|bijvul|navul|ruik(t)? niets|geen geur|patroon|flacon/i],
  ['storing', /storing|kapot|werkt niet|defect|lekt|lekkage|foutmelding|error|stroom|piept|geluid/i],
  ['onderhoud', /onderhoud|schoonma|filter|service/i],
];

// Geeft velden terug voor een nieuw ticket. `data` is de app-state (klanten, systemen, contacten).
export function parseMelding(text, data) {
  const t = String(text || '');
  const out = { type: 'vraag', prioriteit: 'normaal', nr: '', assetId: '', titel: '', omschrijving: '', melder: '' };
  const tag = t.match(/\[SLQ([^\]]*)\]/);
  const kv = Object.fromEntries((tag?.[1] || '').trim().split(/\s+/).filter(Boolean).map((p) => p.split('=')).map(([k, v]) => [k, (v || '').replace(/_/g, ' ')]));

  if (kv.t) out.type = kv.t;
  else for (const [type, re] of KEYWORDS) if (re.test(t)) { out.type = type; break; }

  const assets = (data.assets || []).filter((a) => !a.deleted);
  const sn = kv.sn || assets.find((a) => a.serienummer && t.toLowerCase().includes(a.serienummer.toLowerCase()))?.serienummer;
  const asset = sn && assets.find((a) => (a.serienummer || '').toLowerCase() === sn.toLowerCase());
  if (asset) { out.assetId = asset.id; out.nr = asset.nr; }
  if (!out.nr && kv.k && (data.customers || []).some((c) => String(c.nr) === kv.k)) out.nr = Number(kv.k);

  // Zonder code: herken de klant aan telefoonnummer, e-mail of naam van een contactpersoon of klant.
  if (!out.nr) {
    const digits = t.replace(/\D/g, '');
    const phoneHit = (x) => { const d = String(x || '').replace(/\D/g, '').replace(/^(0031|31|0)/, ''); return d.length >= 8 && digits.includes(d); };
    const low = t.toLowerCase();
    const contact = (data.contacts || []).find((c) => !c.deleted && (phoneHit(c.telefoon) || (c.email && low.includes(c.email.toLowerCase()))));
    const klant = contact ? null : (data.customers || []).find((c) => phoneHit(c.telefoon) || (c.naam.length > 4 && low.includes(c.naam.toLowerCase())));
    out.nr = contact?.nr ?? klant?.nr ?? '';
    if (contact) out.melder = contact.naam;
  }

  const field = (label) => t.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || '';
  const toel = field('Toelichting');
  const contactLine = field('Contact');
  if (contactLine) out.melder = contactLine;
  out.prioriteit = out.type === 'storing' ? 'hoog' : 'normaal';
  if (/spoed|dringend|asap|vandaag nog|urgent/i.test(t)) out.prioriteit = 'spoed';
  const firstLine = toel || t.replace(/\[SLQ[^\]]*\]/, '').split('\n').map((x) => x.trim()).find((x) => x && !/^melding:/i.test(x)) || '';
  out.titel = `${TYPE_LABELS[out.type] || 'Melding'}${firstLine && toel ? `: ${firstLine}` : ''}`.slice(0, 80);
  out.omschrijving = t.replace(/\n*\[SLQ[^\]]*\]\s*$/, '').trim();
  return out;
}
