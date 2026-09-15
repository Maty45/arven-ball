// Self-check: `node server/game.test.js`. Falla (throw) si la lógica se rompe.
import assert from 'node:assert';
import { createGame, addPlayer, setInput, setReady, tryStart, tick, snapshot } from './game.js';
import { FIELD, BALL, RULES, TICK_DT } from './constants.js';

const HALF_L = FIELD.LENGTH / 2;

// 1) Gol: pelota lanzada hacia el arco derecho suma a 'red' y resetea al centro.
{
  const g = createGame(); g.started = true;
  g.ball.x = HALF_L - 3;
  g.ball.z = 0; // dentro de la boca del arco
  g.ball.vx = 40; // hacia +X
  let scored = false;
  for (let i = 0; i < 100 && !scored; i++) {
    tick(g, i * 1000 * TICK_DT);
    if (g.score.red === 1) scored = true;
  }
  assert.strictEqual(g.score.red, 1, 'debería haber gol de red');
  assert.ok(Math.abs(g.ball.x) < 0.001 && Math.abs(g.ball.z) < 0.001, 'pelota reseteada al centro tras gol');
  assert.strictEqual(g.phase, 'goal', 'gol común entra en fase de cooldown/festejo');
  assert.strictEqual(g.scorer, 'red', 'scorer marcado para el banner');
  // Durante el cooldown está congelado; al vencer vuelve a 'play'.
  tick(g, g.goalUntil + 1);
  assert.strictEqual(g.phase, 'play', 'tras el cooldown vuelve a jugar');
  assert.strictEqual(g.scorer, null, 'scorer se limpia al reanudar');
}

// 2) Tiro al palo (fuera de la boca) NO es gol: rebota.
{
  const g = createGame(); g.started = true;
  g.ball.x = HALF_L - 3;
  g.ball.z = FIELD.WIDTH / 2 - 1; // pegado al lateral, fuera del arco
  g.ball.vx = 40;
  for (let i = 0; i < 60; i++) tick(g, i * 1000 * TICK_DT);
  assert.strictEqual(g.score.red, 0, 'no debería ser gol fuera de la boca');
}

// 3) Patada: jugador junto a la pelota con kick la mueve hacia donde mira.
{
  const g = createGame(); g.started = true;
  const p = addPlayer(g, 'p1', 'tester'); // team red, mira a +X (facing 0)
  p.x = 0; p.z = 0; p.vx = 0; p.vz = 0;
  g.ball.x = BALL.RADIUS + 1; g.ball.z = 0; g.ball.vx = 0; g.ball.vz = 0;
  setInput(g, 'p1', { mx: 0, mz: 0, kick: true });
  tick(g, 0);
  assert.ok(g.ball.vx > 10, 'la patada debe empujar la pelota en +X');
}

// 4) Fin de partido al llegar a GOALS_TO_WIN -> phase 'result' con ganador.
{
  const g = createGame(); g.started = true;
  g.score.red = RULES.GOALS_TO_WIN - 1;
  g.ball.x = HALF_L - 2; g.ball.z = 0; g.ball.vx = 40;
  for (let i = 0; i < 60 && g.phase === 'play'; i++) tick(g, i * 1000 * TICK_DT);
  assert.strictEqual(g.phase, 'result', 'debería terminar el partido');
  assert.strictEqual(g.winner, 'red');
  // Tras el freeze, resetea marcador y vuelve a jugar.
  tick(g, g.resultUntil + 1);
  assert.strictEqual(g.phase, 'play');
  assert.strictEqual(g.score.red, 0);
}

// 5) setInput normaliza vectores > 1 (anti-cheat de velocidad).
{
  const g = createGame(); g.started = true;
  addPlayer(g, 'p1', 'x');
  setInput(g, 'p1', { mx: 3, mz: 4, kick: false }); // len 5
  const inp = g.players.get('p1').input;
  assert.ok(Math.hypot(inp.mx, inp.mz) <= 1.0001, 'input de movimiento normalizado');
}

// 6) snapshot es serializable y trae lo esencial.
{
  const g = createGame(); g.started = true;
  addPlayer(g, 'p1', 'x');
  const s = snapshot(g);
  JSON.stringify(s);
  assert.ok(s.players.length === 1 && s.ball && s.score && s.phase);
}

// 7) Lobby: sin started, el tick está congelado (no hay goles ni física).
{
  const g = createGame(); // started = false por defecto
  g.ball.x = HALF_L - 2; g.ball.z = 0; g.ball.vx = 40;
  for (let i = 0; i < 60; i++) tick(g, i * 1000 * TICK_DT);
  assert.strictEqual(g.score.red, 0, 'en el lobby no se puede anotar');
  assert.strictEqual(g.ball.x, HALF_L - 2, 'la pelota no se mueve en el lobby');
}

// 8) tryStart: sólo el anfitrión (primero) y con TODOS listos.
{
  const g = createGame();
  addPlayer(g, 'h', 'host');   // anfitrión (entró primero)
  addPlayer(g, 'g', 'guest');
  assert.strictEqual(tryStart(g, 'g'), false, 'un no-anfitrión no puede iniciar');
  assert.strictEqual(tryStart(g, 'h'), false, 'sin todos listos no inicia');
  setReady(g, 'h', true);
  assert.strictEqual(tryStart(g, 'h'), false, 'falta el invitado listo');
  setReady(g, 'g', true);
  assert.strictEqual(tryStart(g, 'g'), false, 'el invitado no inicia aunque estén todos listos');
  assert.strictEqual(tryStart(g, 'h'), true, 'anfitrión + todos listos: inicia');
  assert.strictEqual(g.started, true);
}

console.log('game.test.js OK');
