/* Tex — refracție reală pentru tema „Liquid Glass”.
   Pentru fiecare element de sticlă se generează o hartă de deplasare (bizuită pe forma lui: colțuri
   rotunjite + muchie bombată) și un filtru SVG cu feDisplacementMap, aplicat prin backdrop-filter.
   Canalele R, G și B se deplasează cu valori ușor diferite, ceea ce dă aberația cromatică de pe margini.
   Merge în Chromium; în rest tema folosește estompare + saturație (vezi liquid-glass.css). */
(function () {
  const SEL = '.sidebar, .th-head, .composer, .modal-card, .popover, .as-panel, .jump-btn';
  const root = document.documentElement;
  const NS = 'http://www.w3.org/2000/svg';
  const chromium = /Chrome\//.test(navigator.userAgent) && !/CriOS|FxiOS|OPT\//.test(navigator.userAgent);
  let svg = null, ro = null, seq = 0, active = false;
  const ids = new WeakMap();
  const timers = new WeakMap();

  function wanted() {
    return chromium && (root.dataset.wall || '').indexOf('liquidGlass') === 0 && innerWidth > 900 &&
      !root.classList.contains('mq-narrow') && !root.classList.contains('mobile-ui') &&
      !matchMedia('(prefers-reduced-transparency: reduce)').matches;
  }

  // Harta de deplasare: la muchie, pixelii „se uită” spre interior; în centru nu se deplasează nimic.
  function makeMap(w, h, radius, bezel) {
    const sw = Math.max(2, Math.round(w / 2)), sh = Math.max(2, Math.round(h / 2)), k = sw / w;
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(sw, sh), d = img.data;
    const hx = sw / 2, hy = sh / 2, R = Math.min(radius * k, hx, hy), B = Math.max(2, bezel * k);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const px = x + .5 - hx, py = y + .5 - hy;
        const qx = Math.abs(px) - (hx - R), qy = Math.abs(py) - (hy - R);
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0), len = Math.hypot(ox, oy);
        const dist = -(len + Math.min(Math.max(qx, qy), 0) - R);
        let nx, ny;
        if (len > 0) { nx = ox / len * Math.sign(px); ny = oy / len * Math.sign(py); }
        else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
        let m = 0;
        if (dist < B) { const t = Math.max(0, dist) / B; m = Math.pow(1 - t, 2.2); }
        const i = (y * sw + x) * 4;
        d[i] = 128 - nx * m * 127; d[i + 1] = 128 - ny * m * 127; d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function build(target) {
    const r = target.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 24 || h < 24) { target.style.removeProperty('--lg-filter'); return; }
    let id = ids.get(target);
    if (!id) { id = 'lg-' + (++seq); ids.set(target, id); }
    const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 24;
    const bezel = Math.min(40, Math.min(w, h) * .45);
    const scale = Math.min(34, bezel * 1.15);
    const href = makeMap(w, h, radius, bezel);
    let f = svg.querySelector('#' + id);
    if (f) f.remove();
    f = el('filter', { id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
    f.appendChild(el('feImage', { href, x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' }));
    [['R', 1.07, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
     ['G', 1.00, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
     ['B', .93, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0']].forEach(([ch, mul, matrix]) => {
      f.appendChild(el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: (scale * mul).toFixed(2), xChannelSelector: 'R', yChannelSelector: 'G', result: 'd' + ch }));
      f.appendChild(el('feColorMatrix', { in: 'd' + ch, type: 'matrix', values: matrix, result: ch }));
    });
    f.appendChild(el('feBlend', { in: 'R', in2: 'G', mode: 'screen', result: 'RG' }));
    f.appendChild(el('feBlend', { in: 'RG', in2: 'B', mode: 'screen' }));
    svg.appendChild(f);
    const soft = target.matches('.popover, .modal-card, .as-panel'); // ferestrele sunt mult mai estompate
    target.style.setProperty('--lg-filter', soft ? `url(#${id}) blur(30px) saturate(1.7)` : `url(#${id}) blur(1.2px) saturate(1.8) brightness(1.06)`);
  }

  function schedule(target) {
    clearTimeout(timers.get(target));
    timers.set(target, setTimeout(() => { if (active) build(target); }, 90));
  }

  function start() {
    if (active) return;
    active = true;
    svg = el('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' });
    svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    document.body.appendChild(svg);
    root.classList.add('lg-real');
    ro = new ResizeObserver(entries => entries.forEach(e => schedule(e.target)));
    document.querySelectorAll(SEL).forEach(t => ro.observe(t));
  }
  function stop() {
    if (!active) return;
    active = false;
    root.classList.remove('lg-real');
    if (ro) ro.disconnect();
    document.querySelectorAll(SEL).forEach(t => t.style.removeProperty('--lg-filter'));
    if (svg) svg.remove();
    svg = null; ro = null;
  }
  function sync() { wanted() ? start() : stop(); }

  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-wall', 'class'] });
  addEventListener('resize', sync);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();
