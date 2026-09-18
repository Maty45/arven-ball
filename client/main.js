import * as THREE from 'three';
import { createScene, makeAvatar, makeBallMesh, loadPlayerModel, makeConfetti, makeShadow } from './scene.js';
import { BALL } from '../server/constants.js';
import { connect } from './net.js';

const INTERP_DELAY = 100; // ms de retraso para interpolar entre snapshots

const { scene, camera, renderer } = createScene(document.getElementById('app'));
const ballMesh = makeBallMesh();
scene.add(ballMesh);
const ballShadow = makeShadow(BALL.RADIUS * 1.3);
scene.add(ballShadow);
const confetti = makeConfetti(scene);

// Para hacer rodar la pelota según cuánto se desplazó.
let lastBall = null;
const ROLL_AXIS = new THREE.Vector3();
let confettiTimer = 0; // ráfagas ambientales cada tanto

// id -> { obj, mixer, actions, current, lastKick, jumpUntil }
const players = new Map();
let net = null;

// Modelo del jugador: se precarga una vez y se clona por jugador.
let playerTemplate = null;
loadPlayerModel().then((t) => { playerTemplate = t; });

// Sonido de patada (CC0 Kenney). Se clona por reproducción para que se solapen.
const kickSound = new Audio('/sounds/kick.ogg');
kickSound.volume = 0.35;
function playKick() { const s = kickSound.cloneNode(); s.volume = 0.35; s.play().catch(() => {}); }

// Sonido de gol/festejo (mp3). Se reinicia por si suena en ráfaga.
const goalSound = new Audio('/sounds/goal.mp3');
goalSound.volume = 0.2;
function playGoal() { goalSound.currentTime = 0; goalSound.play().catch(() => {}); }

// --- Input ---
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));

// Intención en ejes de pantalla; se rota según la cámara en el render.
function readKeys() {
  let fwd = 0, right = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) right += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) right -= 1;
  return { fwd, right, kick: keys.has('Space'), sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') };
}

// Yaw de la cámara: sigue el rumbo del jugador con suavizado (no salta).
let camYaw = null;
let lastT = null;
let prevPhase = 'play'; // para disparar el sonido de gol una sola vez por transición

// --- Join ---
const joinEl = document.getElementById('join');
const nameEl = document.getElementById('name');
document.getElementById('joinBtn').addEventListener('click', doJoin);
nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

function doJoin() {
  const name = (nameEl.value || 'anon').trim().slice(0, 16);
  goalSound.play().then(() => { goalSound.pause(); goalSound.currentTime = 0; }).catch(() => {}); // desbloquear audio con el gesto del click
  net = connect({ name });
  joinEl.style.display = 'none';
  lobbyEl.style.display = 'grid'; // esperar en el lobby hasta iniciar
}

// --- Lobby ---
const lobbyEl = document.getElementById('lobby');
// El nombre lo elige el jugador y se inyecta en innerHTML → escapar para no permitir
// inyección de HTML/markup en la lista del lobby de los demás.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lobbyList = document.getElementById('lobbyList');
const readyBtn = document.getElementById('readyBtn');
const startBtn = document.getElementById('startBtn');
const lobbyHint = document.getElementById('lobbyHint');
let myReady = false;
readyBtn.addEventListener('click', () => net?.ready(!myReady));
startBtn.addEventListener('click', () => net?.start());

function renderLobby(state) {
  if (state.started) { lobbyEl.style.display = 'none'; return; }
  lobbyEl.style.display = 'grid';

  const me = state.players.find((p) => p.id === net.myId);
  myReady = !!me?.r;
  const isHost = net.myId === state.hostId;
  const allReady = state.players.length > 0 && state.players.every((p) => p.r);

  lobbyList.innerHTML = state.players.map((p) => {
    const you = p.id === net.myId ? ' (vos)' : '';
    const host = p.id === state.hostId ? ' 👑' : '';
    const st = p.r ? '<span class="st ok">✓ listo</span>' : '<span class="st">esperando</span>';
    return `<li><span class="dot ${p.team}"></span>${esc(p.name)}${you}${host}${st}</li>`;
  }).join('') || '<li>Conectando…</li>';

  readyBtn.textContent = myReady ? '✓ Listo (cancelar)' : 'Marcar listo';
  readyBtn.classList.toggle('on', myReady);

  startBtn.style.display = isHost ? '' : 'none';
  startBtn.disabled = !allReady;

  lobbyHint.textContent = isHost
    ? (allReady ? 'Todos listos — ¡dale Iniciar!' : 'Esperá a que todos marquen "Listo".')
    : (allReady ? 'Todos listos — esperando al anfitrión 👑' : 'Marcá que estás listo.');
}

// --- HUD ---
const redNameEl = document.getElementById('redName');
const blueNameEl = document.getElementById('blueName');
const redScoreEl = document.getElementById('redScore');
const blueScoreEl = document.getElementById('blueScore');
const clockEl = document.getElementById('clock');
const bannerEl = document.getElementById('banner');
const staminaEl = document.getElementById('stamina');
const staminaFillEl = document.getElementById('staminaFill');

function fmtClock(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Interpolación de ángulo por el camino corto.
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Crossfade entre animaciones (idle/run/jump). No hace nada si es cápsula.
function setAction(entry, name) {
  if (!entry.actions || entry.current === name || !entry.actions[name]) return;
  const next = entry.actions[name];
  const prev = entry.current && entry.actions[entry.current];
  next.reset().fadeIn(0.2).play();
  if (prev) prev.fadeOut(0.2);
  entry.current = name;
}

// Reconstruye el estado interpolado a mostrar este frame: busca el par de snapshots
// que rodea (now - INTERP_DELAY) e interpola entre ellos -> movimiento suave.
function interpolatedState() {
  const buf = net.buffer;
  if (buf.length === 0) return null;
  const renderAt = performance.now() - INTERP_DELAY;
  const first = buf[0], last = buf[buf.length - 1];
  if (renderAt <= first.recvAt) return { state: first.state, prev: first.state, alpha: 0 };
  if (renderAt >= last.recvAt) return { state: last.state, prev: last.state, alpha: 1 };
  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i], b = buf[i + 1];
    if (renderAt >= a.recvAt && renderAt <= b.recvAt) {
      const span = Math.max(1, b.recvAt - a.recvAt);
      return { state: b.state, prev: a.state, alpha: (renderAt - a.recvAt) / span };
    }
  }
  return { state: last.state, prev: last.state, alpha: 1 };
}

function tickRender() {
  requestAnimationFrame(tickRender);
  if (!net) { renderer.render(scene, camera); return; }

  const snap = interpolatedState();
  if (!snap) { renderer.render(scene, camera); return; }

  const { state, prev, alpha } = snap;

  // dt del frame (para mixers de animación y suavizado de cámara).
  const now = performance.now();
  const dt = lastT === null ? 0.016 : Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  // índice de posiciones previas por id para interpolar
  const prevById = new Map(prev.players.map((p) => [p.id, p]));

  const seen = new Set();
  let me = null, myEntry = null;
  for (const p of state.players) {
    seen.add(p.id);
    let entry = players.get(p.id);
    if (!entry) {
      entry = makeAvatar(playerTemplate, p.team, p.name, p.id !== net.myId); // { obj, mixer, actions }
      entry.current = null; entry.lastKick = false; entry.jumpUntil = 0; entry.fall = 0;
      scene.add(entry.obj);
      players.set(p.id, entry);
    }
    const pp = prevById.get(p.id) || p;
    const x = pp.x + (p.x - pp.x) * alpha;
    const z = pp.z + (p.z - pp.z) * alpha;
    entry.obj.position.set(x, 0, z);
    entry.obj.rotation.y = -lerpAngle(pp.f, p.f, alpha);

    // Animación: patada en flanco de subida, si no correr/idle según movimiento.
    const kickName = entry.actions?.kick ? 'kick' : 'jump'; // fallback si no hubo clip
    if (p.k && !entry.lastKick) {
      const ka = entry.actions?.[kickName];
      entry.jumpUntil = now + (ka ? ka.getClip().duration : 0.45) * 1000;
      playKick();
    }
    entry.lastKick = p.k;
    const moving = Math.hypot(p.x - pp.x, p.z - pp.z) > 0.05;
    setAction(entry, now < entry.jumpUntil ? kickName : moving && !p.dn ? 'run' : 'idle');
    entry.mixer?.update(dt);

    // Caído por una patada: se tumba de espaldas de golpe y se levanta más lento.
    const fall = p.dn ? 1 : 0;
    entry.fall += (fall - entry.fall) * (1 - Math.exp(-dt * (p.dn ? 14 : 6)));
    entry.tilt.rotation.z = entry.fall * Math.PI / 2;
    entry.tilt.position.y = entry.fall * 0.35; // que la espalda no se hunda en el pasto

    if (p.id === net.myId) { me = { x, z, f: lerpAngle(pp.f, p.f, alpha) }; myEntry = entry; }
  }
  // sacar los que se fueron
  for (const [id, entry] of players) {
    if (!seen.has(id)) { scene.remove(entry.obj); players.delete(id); }
  }

  // pelota: posición interpolada + rodar según el desplazamiento.
  const bx = prev.ball.x + (state.ball.x - prev.ball.x) * alpha;
  const bz = prev.ball.z + (state.ball.z - prev.ball.z) * alpha;
  ballMesh.position.set(bx, BALL.RADIUS, bz);
  ballShadow.position.set(bx, 0.04, bz);
  if (lastBall) {
    const dx = bx - lastBall.x, dz = bz - lastBall.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      // eje de giro = horizontal, perpendicular al movimiento (up × mov).
      ROLL_AXIS.set(dz, 0, -dx).normalize();
      ballMesh.rotateOnWorldAxis(ROLL_AXIS, d / BALL.RADIUS);
    }
  }
  lastBall = { x: bx, z: bz };

  // Confeti: ráfagas ambientales cada ~5s + update del sistema.
  confettiTimer -= dt;
  if (confettiTimer <= 0) { confetti.burst(50); confettiTimer = 4 + Math.random() * 3; }
  confetti.update(dt);

  // cámara chase detrás del propio jugador (o vista aérea si aún no aparecí)
  if (me) {
    if (camYaw === null) camYaw = me.f;

    const fx = Math.cos(camYaw), fz = Math.sin(camYaw); // "adelante" de la cámara
    const rx = -fz, rz = fx;                             // "derecha" de la cámara

    // Input relativo a la cámara: W siempre es hacia adentro de la pantalla.
    const k = readKeys();
    let mx = k.fwd * fx + k.right * rx;
    let mz = k.fwd * fz + k.right * rz;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    net.sendInput(mx, mz, k.kick, k.sprint);

    // La cámara gira hacia el rumbo SOLO si hay avance (fwd>=0). Con S sola no gira:
    // el jugador retrocede y la cámara sigue apuntando adelante.
    if (len > 0.01 && k.fwd >= 0) {
      camYaw = lerpAngle(camYaw, Math.atan2(mz, mx), 1 - Math.exp(-dt / 0.38));
    }

    // El jugador local mira igual que la cámara.
    myEntry.obj.rotation.y = -camYaw;

    const nfx = Math.cos(camYaw), nfz = Math.sin(camYaw);
    const camPos = new THREE.Vector3(me.x - nfx * 20, 15, me.z - nfz * 20);
    camera.position.lerp(camPos, 1 - Math.exp(-dt / 0.12));
    camera.lookAt(me.x + nfx * 8, 1, me.z + nfz * 8);
  } else {
    camera.position.set(0, 55, 0.01);
    camera.lookAt(0, 0, 0);
  }

  // Gol: sonar + ráfaga grande de confeti al entrar en 'goal'/'result' desde 'play'.
  if (prevPhase === 'play' && (state.phase === 'goal' || state.phase === 'result')) {
    playGoal();
    for (let i = 0; i < 4; i++) confetti.burst(90);
  }
  prevPhase = state.phase;

  // Lobby (visible hasta iniciar la partida)
  renderLobby(state);

  // HUD: nombres, marcador y reloj.
  const names = state.teamNames || { red: 'Rojo', blue: 'Azul' };
  redNameEl.textContent = names.red;
  blueNameEl.textContent = names.blue;
  redScoreEl.textContent = state.score.red;
  blueScoreEl.textContent = state.score.blue;
  clockEl.textContent = fmtClock(state.clock ?? 0);

  // Barra de stamina del jugador local (valor autoritativo del server).
  const meState = state.players.find((p) => p.id === net.myId);
  if (me && state.started && meState?.st != null) {
    staminaEl.style.display = 'block';
    staminaFillEl.style.width = `${Math.round(meState.st * 100)}%`;
    staminaFillEl.classList.toggle('low', meState.st < 0.3);
  } else {
    staminaEl.style.display = 'none';
  }

  if (state.phase === 'result') {
    bannerEl.textContent = state.winner ? `¡Gana ${names[state.winner]}!` : '¡Empate!';
    bannerEl.style.display = 'grid';
  } else if (state.phase === 'goal') {
    bannerEl.textContent = `¡GOL de ${names[state.scorer]}!`;
    bannerEl.style.display = 'grid';
  } else {
    bannerEl.style.display = 'none';
  }

  renderer.render(scene, camera);
}
tickRender();
