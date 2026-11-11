/* Tex 2.1.40 — versioned registration; no application asset cache. */
/* Service worker: folosit DOAR pentru descărcarea în flux (streaming) a fișierelor P2P
   direct pe disc, fără a le ține în memorie -> fără limită de mărime (Firefox/Safari/Chrome). */
const streams = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'ping') { e.source && e.source.postMessage({ type: 'pong' }); return; }
  if (d.type !== 'stream' || !e.ports[0]) return;
  const port = e.ports[0];
  let controller;
  const stream = new ReadableStream({
    start(c) { controller = c; },
    cancel() { port.postMessage({ type: 'cancelled' }); streams.delete(d.id); }
  }, { highWaterMark: 32, size: () => 1 });
  port.onmessage = ev => {
    const m = ev.data;
    if (m === 'end') { try { controller.close(); } catch (_) {} streams.delete(d.id); return; }
    if (m === 'abort') { try { controller.error(new Error('aborted')); } catch (_) {} streams.delete(d.id); return; }
    if (m instanceof ArrayBuffer || ArrayBuffer.isView(m)) controller.enqueue(new Uint8Array(m.buffer || m));
  };
  streams.set(d.id, { stream, name: d.name, size: d.size, mime: d.mime });
  port.postMessage({ type: 'ready' });
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const m = url.pathname.match(/\/p2p-dl\/([A-Za-z0-9_-]+)/);
  if (!m) return; // restul cererilor merg normal la rețea
  const s = streams.get(m[1]);
  if (!s) { e.respondWith(new Response('Transfer inexistent', { status: 404 })); return; }
  const enc = encodeURIComponent(s.name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': "attachment; filename*=UTF-8''" + enc,
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff'
  });
  if (s.size) headers.set('Content-Length', String(s.size));
  e.respondWith(new Response(s.stream, { headers }));
});
