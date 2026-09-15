// Simulación autoritativa. Estado del mundo + tick de física. Sin dependencias.
import { FIELD, PLAYER, BALL, RULES, TICK_DT } from './constants.js';

const HALF_L = FIELD.LENGTH / 2;
const HALF_W = FIELD.WIDTH / 2;
const HALF_GOAL = FIELD.GOAL_WIDTH / 2;

function clampSpeed(vx, vz, max) {
  const s = Math.hypot(vx, vz);
  if (s > max) {
    const k = max / s;
    return [vx * k, vz * k];
  }
  return [vx, vz];
}

export function createGame() {
  return {
    players: new Map(), // id -> { id, name, team, x, z, vx, vz, facing, input }
    ball: { x: 0, z: 0, vx: 0, vz: 0 },
    score: { red: 0, blue: 0 },
    started: false, // lobby: no arranca hasta que alguien confirme
    // fase de juego: 'play' | 'goal' (cooldown/festejo) | 'result'
    phase: 'play',
    winner: null,
    scorer: null, // equipo que acaba de anotar (para el banner)
    goalUntil: 0,
    resultUntil: 0,
  };
}

export function addPlayer(game, id, name) {
  // Equipo con menos jugadores; empata -> red.
  let red = 0, blue = 0;
  for (const p of game.players.values()) p.team === 'red' ? red++ : blue++;
  const team = red <= blue ? 'red' : 'blue';
  // Aparece en su mitad, con un pequeño offset por índice para no encimar.
  const dir = team === 'red' ? -1 : 1;
  const spread = (game.players.size % 5) * 3 - 6;
  const p = {
    id,
    name: (name || 'anon').slice(0, 16),
    team,
    x: dir * HALF_L * 0.5,
    z: spread,
    vx: 0, vz: 0,
    facing: team === 'red' ? 0 : Math.PI, // mirando hacia el arco rival
    input: { mx: 0, mz: 0, kick: false },
    ready: false, // lobby: se marca listo antes de iniciar
  };
  game.players.set(id, p);
  return p;
}

export function removePlayer(game, id) {
  game.players.delete(id);
  // Sala vacía -> volver al lobby (la próxima persona espera y confirma de nuevo).
  if (game.players.size === 0) {
    game.started = false;
    game.score.red = 0; game.score.blue = 0;
    game.phase = 'play'; game.winner = null; game.scorer = null;
    resetPositions(game); // pelota al centro (si no, queda donde la dejaron)
  }
}

// Anfitrión = el que entró primero (primer id en la sala).
export function hostId(game) {
  const it = game.players.keys().next();
  return it.done ? null : it.value;
}

export function setReady(game, id, ready) {
  const p = game.players.get(id);
  if (p) p.ready = !!ready;
}

// Inicia la partida sólo si lo pide el anfitrión y todos están listos.
export function tryStart(game, id) {
  if (id !== hostId(game) || game.players.size === 0) return false;
  for (const p of game.players.values()) if (!p.ready) return false;
  resetPositions(game); // saque desde el centro, formación limpia
  game.started = true;
  return true;
}

export function setInput(game, id, input) {
  const p = game.players.get(id);
  if (!p) return;
  // Normalizar el vector de movimiento (defensa contra clientes que mandan >1).
  let mx = Number(input.mx) || 0;
  let mz = Number(input.mz) || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  p.input = { mx, mz, kick: !!input.kick };
}

function resetPositions(game) {
  game.ball.x = 0; game.ball.z = 0; game.ball.vx = 0; game.ball.vz = 0;
  // Formación de saque: cada equipo en su mitad, repartidos sobre Z (x y z se resetean).
  const idx = { red: 0, blue: 0 };
  for (const p of game.players.values()) {
    const dir = p.team === 'red' ? -1 : 1;
    const i = idx[p.team]++;
    p.x = dir * HALF_L * 0.5;
    p.z = (i % 5) * 9 - 18; // abanico sobre su mitad
    p.vx = 0; p.vz = 0;
  }
}

// Un tick de física. `now` en ms (inyectado; el módulo no llama a Date).
export function tick(game, now) {
  if (!game.started) return; // en el lobby está todo congelado

  if (game.phase === 'result') {
    if (now >= game.resultUntil) {
      game.score.red = 0; game.score.blue = 0;
      game.winner = null;
      game.phase = 'play';
      resetPositions(game);
    }
    return; // congelado durante el resultado
  }

  if (game.phase === 'goal') {
    if (now >= game.goalUntil) {
      game.scorer = null;
      game.phase = 'play';
    }
    return; // congelado durante el festejo/cooldown (posiciones ya reseteadas)
  }

  const dt = TICK_DT;

  // --- Jugadores: aceleración hacia el input, fricción, tope de velocidad ---
  for (const p of game.players.values()) {
    const { mx, mz } = p.input;
    if (mx !== 0 || mz !== 0) {
      p.vx += mx * PLAYER.ACCEL * dt;
      p.vz += mz * PLAYER.ACCEL * dt;
      p.facing = Math.atan2(mz, mx);
    } else {
      // fricción hacia 0
      const s = Math.hypot(p.vx, p.vz);
      if (s > 0) {
        const drop = Math.min(s, PLAYER.FRICTION * dt);
        const k = (s - drop) / s;
        p.vx *= k; p.vz *= k;
      }
    }
    [p.vx, p.vz] = clampSpeed(p.vx, p.vz, PLAYER.MAX_SPEED);
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    // Confinar al campo (los jugadores no salen).
    p.x = Math.max(-HALF_L + PLAYER.RADIUS, Math.min(HALF_L - PLAYER.RADIUS, p.x));
    p.z = Math.max(-HALF_W + PLAYER.RADIUS, Math.min(HALF_W - PLAYER.RADIUS, p.z));
  }

  // --- Pelota: fricción de rodadura ---
  const bs = Math.hypot(game.ball.vx, game.ball.vz);
  if (bs > 0) {
    const drop = Math.min(bs, BALL.FRICTION * dt);
    const k = (bs - drop) / bs;
    game.ball.vx *= k; game.ball.vz *= k;
  }
  game.ball.x += game.ball.vx * dt;
  game.ball.z += game.ball.vz * dt;

  // --- Colisión jugador-pelota + patada ---
  const b = game.ball;
  const minDist = PLAYER.RADIUS + BALL.RADIUS;
  for (const p of game.players.values()) {
    const dx = b.x - p.x;
    const dz = b.z - p.z;
    const d = Math.hypot(dx, dz) || 0.0001;
    // Empuje al chocar (no atravesar).
    if (d < minDist) {
      const nx = dx / d, nz = dz / d;
      const overlap = minDist - d;
      b.x += nx * overlap;
      b.z += nz * overlap;
      // La pelota toma algo de la velocidad del jugador.
      b.vx += p.vx * 0.5;
      b.vz += p.vz * 0.5;
    }
    // Patada: dentro de rango y con tecla, impulso en la dirección en que mira.
    if (p.input.kick && d < BALL.KICK_RANGE) {
      b.vx += Math.cos(p.facing) * BALL.KICK_IMPULSE;
      b.vz += Math.sin(p.facing) * BALL.KICK_IMPULSE;
    }
  }
  [b.vx, b.vz] = clampSpeed(b.vx, b.vz, BALL.MAX_SPEED);

  // --- Bordes / goles ---
  // Bordes en Z (laterales): siempre rebotan.
  if (b.z < -HALF_W + BALL.RADIUS) {
    b.z = -HALF_W + BALL.RADIUS; b.vz = -b.vz * FIELD.WALL_RESTITUTION;
  } else if (b.z > HALF_W - BALL.RADIUS) {
    b.z = HALF_W - BALL.RADIUS; b.vz = -b.vz * FIELD.WALL_RESTITUTION;
  }
  // Bordes en X (fondos): gol si pasa por la boca del arco, si no rebota.
  const inGoalMouth = Math.abs(b.z) < HALF_GOAL;
  if (b.x < -HALF_L + BALL.RADIUS) {
    if (inGoalMouth) { scoreGoal(game, 'blue', now); return; }
    b.x = -HALF_L + BALL.RADIUS; b.vx = -b.vx * FIELD.WALL_RESTITUTION;
  } else if (b.x > HALF_L - BALL.RADIUS) {
    if (inGoalMouth) { scoreGoal(game, 'red', now); return; }
    b.x = HALF_L - BALL.RADIUS; b.vx = -b.vx * FIELD.WALL_RESTITUTION;
  }
}

function scoreGoal(game, team, now) {
  game.score[team] += 1;
  game.scorer = team;
  resetPositions(game); // acomoda el saque; queda congelado durante el cooldown
  if (game.score[team] >= RULES.GOALS_TO_WIN) {
    game.phase = 'result';
    game.winner = team;
    game.resultUntil = now + RULES.RESULT_FREEZE_MS;
  } else {
    game.phase = 'goal';
    game.goalUntil = now + RULES.GOAL_FREEZE_MS;
  }
}

// Snapshot compacto para broadcast.
export function snapshot(game) {
  const players = [];
  for (const p of game.players.values()) {
    players.push({
      id: p.id, name: p.name, team: p.team,
      x: +p.x.toFixed(2), z: +p.z.toFixed(2), f: +p.facing.toFixed(2),
      k: p.input.kick, // patada apretada (para animación en el cliente)
      r: p.ready, // listo en el lobby
    });
  }
  return {
    t: 'state',
    players,
    ball: { x: +game.ball.x.toFixed(2), z: +game.ball.z.toFixed(2) },
    score: game.score,
    started: game.started,
    hostId: hostId(game),
    phase: game.phase,
    winner: game.winner,
    scorer: game.scorer,
  };
}
