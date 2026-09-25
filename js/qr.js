// QR-codes voor de meldpagina per systeem (link met alle gegevens erin; geen server nodig).
import qrcode from '../vendor/qrcode.mjs';
import { store, customer } from './store.js';

export function meldUrl(asset) {
  const s = store.get().settings;
  const base = (s.publiekeUrl || new URL('melden.html', location.href).href.split('?')[0].split('#')[0]).replace(/index\.html$/, '');
  const url = new URL(base.endsWith('melden.html') ? base : new URL('melden.html', base.endsWith('/') ? base : base + '/').href);
  const c = customer(asset.nr);
  const p = { sn: asset.serienummer, sys: asset.systeem, loc: asset.locatie, k: asset.nr, kn: c?.naam, b: s.bedrijf?.naam, wa: s.helpdeskWhatsapp, m: s.helpdeskEmail };
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  return url.href;
}

export function qrMatrix(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return { n, dark: (r, c) => qr.isDark(r, c) };
}

// Als SVG voor op het scherm.
export function qrSvg(text, size = 160) {
  const { n, dark } = qrMatrix(text);
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" width="${size}" height="${size}" role="img" aria-label="QR-code"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
