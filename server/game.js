// Simulación autoritativa. Estado del mundo + tick de física. Sin dependencias.
import { FIELD, PLAYER, BALL, STAMINA, RULES, TICK_DT } from './constants.js';

const HALF_L = FIELD.LENGTH / 2;
const HALF_W = FIELD.WIDTH / 2;
const HALF_GOAL = FIELD.GOAL_WIDTH / 2;

// Nombres de equipo random con temática de programación.
const TEAM_NAMES = [
  'Vibecoder Deportivo Club', 'Los Merge Conflicts', 'Deportivo Null Pointer',
  'Racing de Stack Overflow', 'Segfault United', 'Los Kernel Panic',
  'Atlético Rubber Duck', 'Ctrl+Z Fútbol Club', 'Los Off-by-One',
  'Boca Syntax Error', 'Real Localhost', 'Los Infinite Loop',
  'Deportivo 404', 'Los Git Blame', 'Sudo Fútbol Club', 'Los Race Condition',
];

function pickTeamNames() {
  const i = Math.floor(Math.random() * TEAM_NAMES.length);
  let j = Math.floor(Math.random() * TEAM_NAMES.length);
  if (j === i) j = (j + 1) % TEAM_NAMES.length;
  return { red: TEAM_NAMES[i], blue: TEAM_NAMES[j] };
}

// Arranca un partido nuevo: marcador, reloj, nombres y formación reseteados.
function newMatch(game) {
  game.score.red = 0; game.score.blue = 0;
  game.clock = RULES.MATCH_SECONDS * 1000; // ms restantes
  game.teamNames = pickTeamNames();
  game.phase = 'play'; game.winner = null; game.scorer = null;
  resetPositions(game);
}

function clampSpeed(vx, vz, max) {
  const s = Math.hypot(vx, vz);
  if (s > max) {
    const k = max / s;
    return [vx * k, vz * k];
  }
  return [vx, vz];
}

export function createGame() {
  const game = {
    players: new Map(), // id -> { id, name, team, x, z, vx, vz, facing, input }
    ball: { x: 0, z: 0, vx: 0, vz: 0 },
    score: { red: 0, blue: 0 },
    clock: RULES.MATCH_SECONDS * 1000, // ms restantes del partido
    teamNames: pickTeamNames(),
    started: false, // lobby: no arranca hasta que alguien confirme
    // fase de juego: 'play' | 'goal' (cooldown/festejo) | 'result'
    phase: 'play',
    winner: null,
    scorer: null, // equipo que acaba de anotar (para el banner)
    goalUntil: 0,
    resultUntil: 0,
  };
  return game;
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
    input: { mx: 0, mz: 0, kick: false, sprint: false },
    stamina: STAMINA.MAX,
    sprinting: false, // estado con histéresis (ver tick)
    ready: false, // lobby: se marca listo antes de iniciar
  };
  game.players.set(id, p);
  return p;
}

export function removePlayer(game, id) {
  game.players.delete(id);
  // Sala vacía -> volver al lobby con un partido nuevo listo para empezar.
  if (game.players.size === 0) {
    game.started = false;
    newMatch(game);
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
  newMatch(game); // partido nuevo: marcador, reloj, nombres y formación
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
  p.input = { mx, mz, kick: !!input.kick, sprint: !!input.sprint };
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
    if (now >= game.resultUntil) newMatch(game); // arranca otro partido
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

  // --- Reloj del partido: corre sólo en juego; a 0 gana el que va arriba ---
  game.clock -= dt * 1000;
  if (game.clock <= 0) {
    game.clock = 0;
    game.phase = 'result';
    game.winner = game.score.red > game.score.blue ? 'red'
      : game.score.blue > game.score.red ? 'blue' : null; // null = empate
    game.resultUntil = now + RULES.RESULT_FREEZE_MS;
    return;
  }

  // --- Jugadores: aceleración hacia el input, fricción, tope de velocidad ---
  for (const p of game.players.values()) {
    const { mx, mz } = p.input;
    const moving = mx !== 0 || mz !== 0;
    // Sprint con histéresis: para EMPEZAR hace falta MIN_TO_START, pero se puede
    // seguir esprintando hasta que la stamina llegue a 0 (evita parpadeo al agotarse).
    p.sprinting = p.input.sprint && moving &&
      (p.sprinting ? p.stamina > 0 : p.stamina >= STAMINA.MIN_TO_START);
    if (p.sprinting) p.stamina = Math.max(0, p.stamina - STAMINA.DRAIN * dt);
    else p.stamina = Math.min(STAMINA.MAX, p.stamina + STAMINA.REGEN * dt);
    const maxSpeed = PLAYER.MAX_SPEED * (p.sprinting ? STAMINA.SPRINT_MULT : 1);
    if (moving) {
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
    [p.vx, p.vz] = clampSpeed(p.vx, p.vz, maxSpeed);
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    // Confinar al campo (los jugadores no salen).
    p.x = Math.max(-HALF_L + PLAYER.RADIUS, Math.min(HALF_L - PLAYER.RADIUS, p.x));
    p.z = Math.max(-HALF_W + PLAYER.RADIUS, Math.min(HALF_W - PLAYER.RADIUS, p.z));
  }

  // --- Colisión jugador-jugador: se empujan, no se atraviesan (O(n²), pocos jugadores) ---
  const ps = [...game.players.values()];
  const minPP = 2 * PLAYER.RADIUS;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz) || 0.0001;
      if (d < minPP) {
        const nx = dx / d, nz = dz / d, push = (minPP - d) / 2;
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
      }
    }
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
      st: +(p.stamina / STAMINA.MAX).toFixed(2), // stamina 0..1 (barra en el HUD)
      r: p.ready, // listo en el lobby
    });
  }
  return {
    t: 'state',
    players,
    ball: { x: +game.ball.x.toFixed(2), z: +game.ball.z.toFixed(2) },
    score: game.score,
    clock: Math.max(0, Math.ceil(game.clock / 1000)), // segundos restantes
    teamNames: game.teamNames,
    started: game.started,
    hostId: hostId(game),
    phase: game.phase,
    winner: game.winner,
    scorer: game.scorer,
  };
}
