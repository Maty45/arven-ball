// Un solo proceso: sirve el cliente estático (dist/) + WebSocket + game loop 30Hz.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createGame, addPlayer, removePlayer, setInput, setReady, tryStart, tick, snapshot } from './game.js';
import { RULES } from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'dist')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const game = createGame();
let nextId = 1;

wss.on('connection', (ws) => {
  const id = String(nextId++);
  let joined = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'join' && !joined) {
      joined = true;
      addPlayer(game, id, msg.name);
      ws.send(JSON.stringify({ t: 'welcome', id, rules: RULES }));
    } else if (msg.t === 'input') {
      setInput(game, id, msg);
    } else if (msg.t === 'ready') {
      setReady(game, id, msg.ready);
    } else if (msg.t === 'start') {
      tryStart(game, id); // sólo el anfitrión y con todos listos
    }
  });

  ws.on('close', () => removePlayer(game, id));
  ws.on('error', () => {}); // ponytail: ignorar; el close limpia igual
});

// Loop autoritativo: simula y hace broadcast del snapshot.
setInterval(() => {
  tick(game, Date.now());
  const payload = JSON.stringify(snapshot(game));
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}, 1000 / RULES.TICK_HZ);

server.listen(PORT, () => console.log(`Arven Ball en http://localhost:${PORT}`));
