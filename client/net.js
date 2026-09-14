// Conexión WebSocket: manda input, bufferea los últimos 2 snapshots para interpolar.
export function connect({ name, onWelcome }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  // Buffer de snapshots (guardamos 2 para interpolar entre ellos).
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
      if (buffer.length > 2) buffer.shift();
    }
  });

  function sendInput(mx, mz, kick) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'input', mx, mz, kick }));
  }

  return {
    get myId() { return myId; },
    get buffer() { return buffer; },
    sendInput,
  };
}
