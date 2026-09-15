// Conexión WebSocket: manda input, bufferea los últimos 2 snapshots para interpolar.
export function connect({ name, onWelcome }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  // Buffer de snapshots (guardamos ~0.5s de historia para interpolar suave).
  const buffer = []; // [{ recvAt, state }]
  let myId = null;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ t: 'join', name }));
  });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === 'welcome') {
      myId = msg.id;
      onWelcome?.(msg);
    } else if (msg.t === 'state') {
      buffer.push({ recvAt: performance.now(), state: msg });
      if (buffer.length > 16) buffer.shift();
    }
  });

  function sendInput(mx, mz, kick, sprint) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'input', mx, mz, kick, sprint }));
  }

  function start() {
    if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'start' }));
  }

  function ready(v) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ready', ready: v }));
  }

  return {
    get myId() { return myId; },
    get buffer() { return buffer; },
    sendInput,
    start,
    ready,
  };
}
