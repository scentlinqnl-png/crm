// PDF-servicerapport (jsPDF) met klant, systeem, werkzaamheden, verbruik, foto's en handtekening.
import { store, customer, fullAddress, contactsFor, TICKET_TYPES, TICKET_PRIO } from './store.js';
import { getBlob, blobToDataURL } from './media.js';
import { download } from './excel.js';

async function loadJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;
    s.onload = resolve;
    s.onerror = () => reject(new Error('PDF-bibliotheek kon niet laden.'));
    document.head.appendChild(s);
  });
  return window.jspdf.jsPDF;
}

const nlDate = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : '–');

async function imageInfo(blob) {
  const url = await blobToDataURL(blob);
  const dims = await new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve([i.naturalWidth, i.naturalHeight]);
    i.onerror = () => resolve([4, 3]);
    i.src = url;
  });
  return { url, w: dims[0], h: dims[1], fmt: blob.type.includes('png') ? 'PNG' : 'JPEG' };
}

export async function buildServiceReport(ticket) {
  const JsPDF = await loadJsPDF();
  const s = store.get();
  const b = s.settings.bedrijf || {};
  const c = customer(ticket.nr) || {};
  const asset = s.assets.find((a) => a.id === ticket.assetId);
  const contact = contactsFor(ticket.nr)[0];
  const visit = s.visits.find((v) => (v.opmerking || '').startsWith(ticket.code + ':'));
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 16;
  const gold = [176, 138, 62];
  let y = M;

  const ensure = (need) => { if (y + need > 297 - 20) { doc.addPage(); y = M; } };
  const heading = (text) => {
    ensure(14);
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(20);
    doc.text(text.toUpperCase(), M, y);
    doc.setDrawColor(...gold).setLineWidth(0.4).line(M, y + 1.5, W - M, y + 1.5);
    y += 7;
  };
  const para = (text) => {
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40);
    for (const line of doc.splitTextToSize(text || '–', W - 2 * M)) { ensure(5); doc.text(line, M, y); y += 5; }
  };
  const rows = (pairs) => {
    doc.setFontSize(10);
    for (const [k, v] of pairs) {
      if (!v) continue;
      const lines = doc.splitTextToSize(String(v), W - 2 * M - 45);
      ensure(lines.length * 5);
      doc.setFont('helvetica', 'normal').setTextColor(110).text(k, M, y);
      doc.setTextColor(30).text(lines, M + 45, y);
      y += lines.length * 5;
    }
  };

  // Kop
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(20).text(b.naam || 'Scentlinq Pro Benelux', M, y + 4);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110);
  [b.adres, [b.telefoon, b.email].filter(Boolean).join(' · '), b.kvk].filter(Boolean).forEach((l, i) => doc.text(l, M, y + 10 + i * 4.2));
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...gold).text('Servicerapport', W - M, y + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40).text(`${ticket.code} · ${nlDate(ticket.gesloten || ticket.datum)}`, W - M, y + 10, { align: 'right' });
  y += 26;

  heading('Klant');
  rows([
    ['Naam', c.naam],
    ['Adres', fullAddress(c)],
    ['Contactpersoon', contact ? [contact.naam, contact.functie, contact.telefoon].filter(Boolean).join(' · ') : ''],
    ['Klantnummer', String(c.nr ?? '')],
  ]);

  heading('Opdracht');
  rows([
    ['Soort', (TICKET_TYPES[ticket.type] || ticket.type).split(' ').slice(1).join(' ')],
    ['Prioriteit', TICKET_PRIO[ticket.prioriteit]],
    ['Gemeld', `${nlDate(ticket.gemeld)}${ticket.melder ? ` door ${ticket.melder}` : ''}`],
    ['Uitgevoerd', `${nlDate(ticket.gesloten)}${ticket.geslotenTijd ? ` om ${ticket.geslotenTijd}` : ''}`],
    ['Monteur', ticket.monteur || s.settings.monteur],
    ['Systeem', asset ? [asset.systeem, asset.serienummer && `SN ${asset.serienummer}`, asset.locatie].filter(Boolean).join(' · ') : ''],
  ]);

  heading('Melding');
  para([ticket.titel, ticket.omschrijving].filter(Boolean).join('\n'));

  heading('Uitgevoerde werkzaamheden');
  para(ticket.oplossing);
  if (ticket.materiaal) { y += 2; rows([['Gebruikt materiaal', ticket.materiaal]]); }

  if (visit) {
    heading('Verbruik en instellingen');
    rows([['Verbruik', `${visit.ml} ml`], ['Geur', visit.geur], ['Instellingen', visit.instellingen]]);
  }

  const fotos = (ticket.fotos || []).filter(Boolean);
  if (fotos.length) {
    heading(`Foto's (${fotos.length})`);
    const colW = (W - 2 * M - 8) / 3;
    const boxH = colW * 0.75;
    let col = 0;
    for (const id of fotos) {
      const blob = await getBlob(id);
      if (!blob) continue;
      const img = await imageInfo(blob);
      if (col === 0) ensure(boxH + 4);
      const scale = Math.min(colW / img.w, boxH / img.h);
      const w = img.w * scale;
      const hh = img.h * scale;
      const x = M + col * (colW + 4) + (colW - w) / 2;
      doc.addImage(img.url, img.fmt, x, y + (boxH - hh) / 2, w, hh);
      col = (col + 1) % 3;
      if (col === 0) y += boxH + 4;
    }
    if (col !== 0) y += boxH + 4;
  }

  heading('Voor akkoord');
  const sig = ticket.handtekening ? await getBlob(ticket.handtekening) : null;
  if (sig) {
    const img = await imageInfo(sig);
    const w = 70;
    const hh = Math.min(30, (img.h / img.w) * w);
    ensure(hh + 12);
    doc.addImage(img.url, 'PNG', M, y, w, hh);
    y += hh + 2;
  } else {
    ensure(20);
    doc.setDrawColor(180).line(M, y + 14, M + 70, y + 14);
    y += 16;
  }
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40).text(`${ticket.getekendDoor || 'Naam klant'} · ${nlDate(ticket.gesloten)}`, M, y + 4);

  // Voettekst op elke pagina
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8).setTextColor(140);
    doc.text(`${b.naam || 'Scentlinq Pro Benelux'} · ${ticket.code}`, M, 290);
    doc.text(`Pagina ${i} van ${pages}`, W - M, 290, { align: 'right' });
  }
  return doc.output('blob');
}

// Delen via het deelmenu van de telefoon (mail, WhatsApp, Teams), anders downloaden.
export async function shareOrDownloadReport(ticket) {
  const blob = await buildServiceReport(ticket);
  const name = `Servicerapport ${ticket.code} ${(customer(ticket.nr)?.naam || '').replace(/[^\w\- ]+/g, '')}.pdf`;
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'gedeeld';
    } catch (e) {
      if (e?.name === 'AbortError') return 'geannuleerd';
    }
  }
  await download(name, blob);
  return 'gedownload';
}
