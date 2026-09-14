import * as THREE from 'three';
import { createScene, makeAvatar, makeBallMesh, loadPlayerModel } from './scene.js';
import { connect } from './net.js';

const INTERP_DELAY = 100; // ms de retraso para interpolar entre snapshots

const { scene, camera, renderer } = createScene(document.getElementById('app'));
const ballMesh = makeBallMesh();
scene.add(ballMesh);

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
  return { fwd, right, kick: keys.has('Space') };
}

// Yaw de la cámara: sigue el rumbo del jugador con suavizado (no salta).
let camYaw = null;
let lastT = null;

// --- Join ---
const joinEl = document.getElementById('join');
const nameEl = document.getElementById('name');
document.getElementById('joinBtn').addEventListener('click', doJoin);
nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

function doJoin() {
  const name = (nameEl.value || 'anon').trim().slice(0, 16);
  net = connect({ name });
  joinEl.style.display = 'none';
}

// --- HUD ---
const scoreEl = document.getElementById('score');
const bannerEl = document.getElementById('banner');

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

// Reconstruye el estado interpolado a mostrar este frame.
function interpolatedState() {
  const buf = net.buffer;
  if (buf.length === 0) return null;
  if (buf.length === 1) return { state: buf[0].state, prev: buf[0].state, alpha: 1 };
  const [a, b] = buf;
  const span = Math.max(1, b.recvAt - a.recvAt);
  const renderAt = performance.now() - INTERP_DELAY;
  let alpha = (renderAt - a.recvAt) / span;
  alpha = Math.max(0, Math.min(1, alpha));
  return { state: b.state, prev: a.state, alpha };
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
      entry = makeAvatar(playerTemplate, p.team); // { obj, mixer, actions }
      entry.current = null; entry.lastKick = false; entry.jumpUntil = 0;
      scene.add(entry.obj);
      players.set(p.id, entry);
    }
    const pp = prevById.get(p.id) || p;
    const x = pp.x + (p.x - pp.x) * alpha;
    const z = pp.z + (p.z - pp.z) * alpha;
    entry.obj.position.set(x, 0, z);
    entry.obj.rotation.y = -lerpAngle(pp.f, p.f, alpha);

    // Animación: patada (Jump) en flanco de subida, si no correr/idle según movimiento.
    if (p.k && !entry.lastKick) {
      const jd = entry.actions?.jump ? entry.actions.jump.getClip().duration : 0.6;
      entry.jumpUntil = now + jd * 1000;
      playKick();
    }
    entry.lastKick = p.k;
    const moving = Math.hypot(p.x - pp.x, p.z - pp.z) > 0.05;
    setAction(entry, now < entry.jumpUntil ? 'jump' : moving ? 'run' : 'idle');
    entry.mixer?.update(dt);

    if (p.id === net.myId) { me = { x, z, f: lerpAngle(pp.f, p.f, alpha) }; myEntry = entry; }
  }
  // sacar los que se fueron
  for (const [id, entry] of players) {
    if (!seen.has(id)) { scene.remove(entry.obj); players.delete(id); }
  }

  // pelota
  const bx = prev.ball.x + (state.ball.x - prev.ball.x) * alpha;
  const bz = prev.ball.z + (state.ball.z - prev.ball.z) * alpha;
  ballMesh.position.set(bx, 0.6, bz);

  // cámara chase detrás del propio jugador (o vista aérea si aún no aparecí)
  if (me) {
    // El yaw persigue el rumbo del jugador, suave (constante de tiempo ~0.38s).
    if (camYaw === null) camYaw = me.f;
    else camYaw = lerpAngle(camYaw, me.f, 1 - Math.exp(-dt / 0.38));

    const fx = Math.cos(camYaw), fz = Math.sin(camYaw); // "adelante" de la cámara
    const rx = -fz, rz = fx;                             // "derecha" de la cámara

    // El jugador local mira igual que la cámara (no salta).
    myEntry.obj.rotation.y = -camYaw;

    // Input relativo a la cámara: W siempre es hacia adentro de la pantalla.
    const k = readKeys();
    let mx = k.fwd * fx + k.right * rx;
    let mz = k.fwd * fz + k.right * rz;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    net.sendInput(mx, mz, k.kick);

    const camPos = new THREE.Vector3(me.x - fx * 20, 15, me.z - fz * 20);
    camera.position.lerp(camPos, 1 - Math.exp(-dt / 0.12));
    camera.lookAt(me.x + fx * 8, 1, me.z + fz * 8);
  } else {
    camera.position.set(0, 55, 0.01);
    camera.lookAt(0, 0, 0);
  }

  // HUD
  scoreEl.innerHTML = `<span class="red">${state.score.red}</span> — <span class="blue">${state.score.blue}</span>`;
  if (state.phase === 'result') {
    const w = state.winner === 'red' ? 'ROJO' : 'AZUL';
    bannerEl.textContent = `¡Gana ${w}!`;
    bannerEl.style.display = 'grid';
  } else {
    bannerEl.style.display = 'none';
  }

  renderer.render(scene, camera);
}
tickRender();
