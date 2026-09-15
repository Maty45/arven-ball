// Self-check del sprint con stamina. Corre: `node server/stamina.test.js`.
import assert from 'node:assert';
import { createGame, addPlayer, setInput, tick } from './game.js';
import { PLAYER, STAMINA, TICK_DT } from './constants.js';

const game = createGame();
game.started = true; // saltear el lobby
const p = addPlayer(game, 'p1', 'test');

// Esprintando en movimiento: la stamina baja y el tope efectivo sube.
setInput(game, 'p1', { mx: 1, mz: 0, kick: false, sprint: true });
const before = p.stamina;
for (let i = 0; i < 30; i++) tick(game, i * 16); // ~1s a 30Hz
assert(p.sprinting, 'debería estar esprintando con stamina y movimiento');
assert(p.stamina < before, 'la stamina se drena al esprintar');
const speed = Math.hypot(p.vx, p.vz);
assert(speed > PLAYER.MAX_SPEED + 0.01, `debería superar el tope normal esprintando (v=${speed.toFixed(1)})`);

// Sin sprint pero en movimiento: la stamina se recupera.
const low = p.stamina;
setInput(game, 'p1', { mx: 1, mz: 0, kick: false, sprint: false });
for (let i = 0; i < 30; i++) tick(game, (30 + i) * 16);
assert(!p.sprinting, 'no esprinta sin el flag');
assert(p.stamina > low, 'la stamina se recupera sin esprintar');

// Autoritativo: con la stamina en 0, aunque el cliente pida sprint, no da velocidad extra.
p.stamina = 0;
setInput(game, 'p1', { mx: 1, mz: 0, kick: false, sprint: true });
tick(game, 9999);
assert(!p.sprinting, 'con stamina 0 no arranca a esprintar aunque se pida');

// Histéresis: apenas por debajo de MIN_TO_START no vuelve a esprintar.
p.stamina = STAMINA.MIN_TO_START - 1;
p.sprinting = false;
setInput(game, 'p1', { mx: 1, mz: 0, kick: false, sprint: true });
tick(game, 10000);
assert(!p.sprinting, 'no re-arranca por debajo de MIN_TO_START (sin parpadeo)');

console.log('stamina.test OK — drena, regenera, autoritativo, histéresis');
