// PDF-servicerapport (jsPDF) met klant, systeem, werkzaamheden, verbruik, foto's en handtekening.
import { store, customer, fullAddress, contactsFor, profile, TICKET_TYPES, TICKET_PRIO } from './store.js';
import { calcQuote, LEASE_MND } from './quotes.js';
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

// ---------- offerte als PDF ----------

const eurPdf = (n) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0).replace(/\u00a0/g, ' ');

export async function buildQuotePdf(q) {
  const JsPDF = await loadJsPDF();
  const s = store.get();
  const b = s.settings.bedrijf || {};
  const c = customer(q.nr) || {};
  const contact = contactsFor(q.nr)[0];
  const calc = calcQuote(q);
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18;
  const gold = [176, 138, 62];
  let y = M;
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(20).text(b.naam || 'Scentlinq Pro Benelux', M, y + 4);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110);
  [b.adres, [b.telefoon, b.email].filter(Boolean).join(' · '), b.kvk].filter(Boolean).forEach((l, i) => doc.text(l, M, y + 10 + i * 4.2));
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...gold).text('Offerte', W - M, y + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40).text(`${q.code} · ${nlDate(q.datum)}`, W - M, y + 10, { align: 'right' });
  y += 32;
  doc.setFontSize(10).setTextColor(30);
  [c.naam, contact ? `t.a.v. ${contact.naam}` : '', c.adres, [c.postcode, c.plaats].filter(Boolean).join(' ')].filter(Boolean).forEach((l, i) => doc.text(l, M, y + i * 5));
  y += 28;
  const p = profile(q.nr);
  doc.setFontSize(10).setTextColor(40);
  const intro = `Hartelijk dank voor uw interesse in geurmarketing van ${b.naam || 'Scentlinq Pro'}. Op basis van ${p.m3 ? `een ruimte van ${p.m3} m³` : 'uw ruimte'}${q.geur ? ` en het geurprofiel ${q.geur}` : ''} bieden wij u het volgende aan.`;
  const lines = doc.splitTextToSize(intro, W - 2 * M);
  doc.text(lines, M, y);
  y += lines.length * 5 + 6;

  // tabel
  const col = [M, W - M - 60, W - M];
  const row = (a, n, bedrag, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setTextColor(30);
    const t = doc.splitTextToSize(a, col[1] - M - 6);
    doc.text(t, M, y);
    doc.text(n, col[1], y);
    doc.text(bedrag, col[2], y, { align: 'right' });
    y += t.length * 5 + 3;
  };
  doc.setDrawColor(...gold).setLineWidth(0.4).line(M, y - 4, W - M, y - 4);
  doc.setFontSize(9).setTextColor(110).text('OMSCHRIJVING', M, y).text('AANTAL', col[1], y).text('BEDRAG', col[2], y, { align: 'right' });
  y += 7;
  doc.setFontSize(10);
  if (q.model === 'koop') row(`${calc.sys.naam} geurverspreidingssysteem, eenmalige aanschaf incl. installatie`, String(calc.n), eurPdf(calc.eenmalig));
  else row(`${calc.sys.naam} geurverspreidingssysteem, lease ${LEASE_MND} maanden incl. installatie`, String(calc.n), `${eurPdf(calc.leasePerMaand)} /mnd`);
  row(`Serviceabonnement: periodieke navulling, onderhoud en storingsdienst${q.geur ? ` (geur: ${q.geur})` : ''}`, String(calc.n), `${eurPdf(calc.abo)} /mnd`);
  doc.setDrawColor(200).setLineWidth(0.2).line(M, y - 2, W - M, y - 2);
  y += 3;
  row('Totaal per maand', '', eurPdf(calc.perMaand), true);
  if (calc.eenmalig) row('Eenmalig', '', eurPdf(calc.eenmalig), true);
  row('Totaal eerste jaar', '', eurPdf(calc.jaar + calc.eenmalig), true);
  y += 4;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90);
  const cond = [q.notitie, 'Alle bedragen zijn exclusief btw. Deze offerte is 30 dagen geldig.', 'Veiligheidsbladen (SDS) en certificaten van de geuren worden op verzoek meegestuurd.'].filter(Boolean).join('\n');
  const cl = doc.splitTextToSize(cond, W - 2 * M);
  doc.text(cl, M, y);
  y += cl.length * 4.5 + 16;
  doc.setFontSize(10).setTextColor(40).text('Voor akkoord', M, y);
  doc.setDrawColor(180).line(M, y + 18, M + 70, y + 18);
  doc.text('Naam, datum en handtekening', M, y + 23);
  doc.setFontSize(8).setTextColor(140).text(`${b.naam || 'Scentlinq Pro Benelux'} · ${q.code}`, M, 290);
  return doc.output('blob');
}

export async function shareOrDownloadQuote(q) {
  const blob = await buildQuotePdf(q);
  const name = `Offerte ${q.code} ${(customer(q.nr)?.naam || '').replace(/[^\w\- ]+/g, '')}.pdf`;
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'gedeeld'; } catch (e) { if (e?.name === 'AbortError') return 'geannuleerd'; }
  }
  await download(name, blob);
  return 'gedownload';
}

// ---------- bestelbon (inkooporder) ----------

export async function buildOrderPdf(o) {
  const JsPDF = await loadJsPDF();
  const s = store.get();
  const b = s.settings.bedrijf || {};
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18;
  const gold = [176, 138, 62];
  let y = M;
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(20).text(b.naam || 'Scentlinq Pro Benelux', M, y + 4);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110);
  [b.adres, [b.telefoon, b.email].filter(Boolean).join(' · '), b.kvk].filter(Boolean).forEach((l, i) => doc.text(l, M, y + 10 + i * 4.2));
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...gold).text('Bestelling', W - M, y + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40).text(`${o.code} · ${nlDate(o.besteldOp || o.datum)}`, W - M, y + 10, { align: 'right' });
  y += 32;
  doc.setFontSize(10).setTextColor(30).text(`Aan: ${o.leverancier}`, M, y);
  doc.text(`Afleveren: ${b.adres || (o.locatie || 'magazijn')}`, M, y + 5);
  y += 16;
  doc.setDrawColor(...gold).setLineWidth(0.4).line(M, y - 4, W - M, y - 4);
  doc.setFontSize(9).setTextColor(110).text('ARTIKELNR.', M, y).text('OMSCHRIJVING', M + 32, y).text('AANTAL', 140, y, { align: 'right' }).text('PRIJS', 165, y, { align: 'right' }).text('TOTAAL', W - M, y, { align: 'right' });
  y += 7;
  doc.setFontSize(10).setTextColor(30);
  let tot = 0;
  for (const r of o.regels) {
    const it = s.stock.find((x) => x.id === r.itemId) || {};
    const lines = doc.splitTextToSize(it.naam || '?', 140 - M - 32 - 14);
    const regel = Number(r.n) * Number(r.prijs || 0);
    tot += regel;
    doc.text(it.artikelnr || '', M, y);
    doc.text(lines, M + 32, y);
    doc.text(String(r.n), 140, y, { align: 'right' });
    doc.text(eurPdf(r.prijs), 165, y, { align: 'right' });
    doc.text(eurPdf(regel), W - M, y, { align: 'right' });
    y += lines.length * 5 + 2;
  }
  doc.setDrawColor(200).setLineWidth(0.2).line(M, y, W - M, y);
  y += 6;
  doc.setFont('helvetica', 'bold').text('Totaal excl. btw', 140, y, { align: 'right' }).text(eurPdf(tot), W - M, y, { align: 'right' });
  if (o.notitie) { y += 12; doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90).text(doc.splitTextToSize(o.notitie, W - 2 * M), M, y); }
  doc.setFontSize(8).setTextColor(140).text(`${b.naam || 'Scentlinq Pro Benelux'} · ${o.code}`, M, 290);
  return doc.output('blob');
}

export async function shareOrDownloadOrder(o) {
  const blob = await buildOrderPdf(o);
  const name = `Bestelling ${o.code} ${o.leverancier.replace(/[^\w\- ]+/g, '')}.pdf`;
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'gedeeld'; } catch (e) { if (e?.name === 'AbortError') return 'geannuleerd'; }
  }
  await download(name, blob);
  return 'gedownload';
}

// ---------- QR-stickers (A4, 3 × 7 etiketten van 63,5 × 38,1 mm, bv. Avery L7160) ----------

export async function buildStickersPdf(assets) {
  const JsPDF = await loadJsPDF();
  const { qrMatrix, meldUrl } = await import('./qr.js');
  const s = store.get();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const [cols, rows, w, hh, left, top, gapX] = [3, 7, 63.5, 38.1, 7.2, 15.1, 2.5];
  assets.forEach((a, i) => {
    const slot = i % (cols * rows);
    if (i && slot === 0) doc.addPage();
    const x = left + (slot % cols) * (w + gapX);
    const y = top + Math.floor(slot / cols) * hh;
    const { n, dark } = qrMatrix(meldUrl(a));
    const qs = 28;
    const cell = qs / n;
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) doc.rect(x + 3 + c * cell, y + 5 + r * cell, cell + 0.02, cell + 0.02, 'F');
    const tx = x + 3 + qs + 2.5;
    const tw = w - qs - 7.5;
    let ty = y + 7;
    const put = (text, size, style, color, gap = 0.4, max = 2) => {
      doc.setFont('helvetica', style).setFontSize(size).setTextColor(...color);
      const lines = doc.splitTextToSize(text, tw).slice(0, max);
      doc.text(lines, tx, ty);
      ty += lines.length * size * 0.3528 * 1.15 + gap;
    };
    put('Geur op of storing?', 8.5, 'bold', [20, 20, 20], 0.6);
    put('Scan de code en meld het direct.', 7, 'normal', [60, 60, 60], 1.6);
    if (a.systeem) put(a.systeem, 6.5, 'normal', [90, 90, 90], 0, 1);
    if (a.serienummer) put(`SN ${a.serienummer}`, 6.5, 'normal', [90, 90, 90], 0, 1);
    if (customer(a.nr)?.naam) put(customer(a.nr).naam, 6.5, 'normal', [90, 90, 90], 0, 2);
    if (s.settings.helpdeskWhatsapp) put(`WhatsApp +${s.settings.helpdeskWhatsapp}`, 6.5, 'normal', [90, 90, 90], 0, 1);
    doc.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(176, 138, 62).text(doc.splitTextToSize(s.settings.bedrijf?.naam || 'Scentlinq Pro', tw)[0], tx, y + hh - 3.5);
  });
  return doc.output('blob');
}

export async function downloadStickers(assets, naam = 'QR-stickers') {
  const blob = await buildStickersPdf(assets);
  await download(`${naam}.pdf`, blob);
}
