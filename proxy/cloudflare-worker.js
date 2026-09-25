// Minimale proxy voor de Anthropic API, zodat de API-sleutel niet op de telefoons staat.
// Cloudflare Worker: zet de sleutel als secret ANTHROPIC_API_KEY en ALLOWED_ORIGIN op de URL van de app
// (bijv. https://scentlinqnl-png.github.io). Vul daarna de Worker-URL in bij Meer › Claude › proxy-URL.
export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'content-type, anthropic-version, anthropic-beta, x-stainless-arch, x-stainless-lang, x-stainless-os, x-stainless-package-version, x-stainless-retry-count, x-stainless-runtime, x-stainless-runtime-version, x-stainless-timeout, anthropic-dangerous-direct-browser-access, x-api-key',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/messages' || request.headers.get('Origin') !== env.ALLOWED_ORIGIN) {
      return new Response('Niet toegestaan', { status: 403, headers: cors });
    }
    const headers = new Headers(request.headers);
    headers.set('x-api-key', env.ANTHROPIC_API_KEY);
    headers.delete('anthropic-dangerous-direct-browser-access');
    const upstream = await fetch('https://api.anthropic.com' + url.pathname + url.search, { method: 'POST', headers, body: request.body });
    const res = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};
