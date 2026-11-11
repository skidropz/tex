/* Tex 2.1.17: pure timestamp policy shared by UI, tabs and regression tests. */
window.TexPresence = (() => {
  const IDLE = 300, OFFLINE = 1800;
  function effective(p, now = Date.now() / 1000) {
    if (!p || ['invisible', 'offline'].includes(p.manual)) return { status: 'offline', online: false, idle: false };
    const age = Math.max(0, now - (+p.last_activity || 0));
    const online = !!p.last_activity && age < OFFLINE;
    return { status: !online ? 'offline' : age >= IDLE ? 'away' : (p.manual || 'available'), online, idle: online && age >= IDLE };
  }
  function latest(local, shared) { return Math.max(0, Number(local) || 0, Number(shared) || 0); }
  return { IDLE, OFFLINE, effective, latest };
})();
