/* Tex — formule de plural pentru limba română.
   1 mesaj · 2 mesaje · 19 mesaje · 20 de mesaje · 101 mesaje · 120 de mesaje */
(function () {
  window.roCount = function roCount(n, one, many) {
    const k = Math.abs(Math.trunc(Number(n) || 0));
    const r = k % 100;
    const de = k > 0 && (r === 0 || r >= 20);
    return k.toLocaleString('ro-RO') + (k === 1 ? ' ' + one : ' ' + (de ? 'de ' : '') + many);
  };
})();
