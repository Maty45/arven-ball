// Escena three.js: cancha, luces, cámara. Devuelve helpers para crear/mover entidades.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FIELD, PLAYER, BALL } from '../server/constants.js';

const TEAM_COLOR = { red: 0xff5a5a, blue: 0x5a9dff };

// El armature del GLB ya trae scale x100 → tamaño natural ~humano. Ajustar acá si
// se ve muy grande/chico (el Box3 no sirve: es skinned, mide la pose de bind).
const PLAYER_SCALE = 1.35;
const SKIN_COLOR = 0xf3d0b0; // piel clara (el material base viene oscuro)
// El GLB de Quaternius mira hacia +Z; nuestro "facing" 0 es +X. Este offset alinea
// el modelo con la dirección de movimiento. Si el jugador corre de costado/espaldas,
// probar 0, Math.PI/2, -Math.PI/2 o Math.PI.
const MODEL_YAW_OFFSET = Math.PI / 2;

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = skyTexture();

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Luces: ambiente + hemisférica de relleno (evita el lado oscuro) + sol.
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x3a5a3a, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(20, 40, 20);
  scene.add(sun);

  // Césped.
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.LENGTH, FIELD.WIDTH),
    new THREE.MeshStandardMaterial({ color: 0x35a85a })
  );
  pitch.rotation.x = -Math.PI / 2;
  scene.add(pitch);

  addLines(scene);
  addGoals(scene);
  addStadium(scene);

  return { scene, camera, renderer };
}

// Cielo con degradé vertical (canvas), sin descargar nada.
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4a86c8');   // arriba: cielo
  grad.addColorStop(0.6, '#9fc4e6');
  grad.addColorStop(1, '#dfeaf2');   // horizonte claro
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  return new THREE.CanvasTexture(c);
}

// Textura de público: foto del usuario, aclarada en canvas (venía oscura).
function crowdTexture() {
  const tex = new THREE.Texture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.filter = 'brightness(1.5) saturate(1.15)'; // aclarar el público
    g.drawImage(img, 0, 0);
    tex.image = c; tex.needsUpdate = true;
  };
  img.src = '/textures/crowd.jpg';
  return tex;
}

// Puntos de un rectángulo redondeado (offset constante al campo, esquinas despejadas).
function roundedRect(hx, hz, r, per = 16) {
  const pts = [];
  const arcs = [
    [hx - r, hz - r, 0, Math.PI / 2],
    [-(hx - r), hz - r, Math.PI / 2, Math.PI],
    [-(hx - r), -(hz - r), Math.PI, 1.5 * Math.PI],
    [hx - r, -(hz - r), 1.5 * Math.PI, 2 * Math.PI],
  ];
  for (const [cx, cz, a0, a1] of arcs) {
    for (let i = 0; i <= per; i++) {
      const a = a0 + (a1 - a0) * (i / per);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return pts;
}

// Cinta (loft) entre dos anillos. UV por LONGITUD DE ARCO (no por índice) para que
// la textura no se comprima/deforme en las esquinas. `tilePer` = unidades por repetición.
function bandMesh(inner, outer, y0, y1, tilePer, vRepeat, material) {
  const N = inner.length;
  // distancia acumulada a lo largo del anillo interno (cerrado).
  const cum = [0];
  for (let i = 1; i <= N; i++) {
    const a = inner[i % N], b = inner[i - 1];
    cum[i] = cum[i - 1] + Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  const total = cum[N];
  // Repeticiones enteras -> la textura cierra sin salto en la costura del anillo.
  const tiles = Math.max(1, Math.round(total / tilePer));
  const position = [], uv = [], index = [];
  for (let i = 0; i < N; i++) {
    const [ix, iz] = inner[i], [ox, oz] = outer[i];
    position.push(ix, y0, iz, ox, y1, oz);
    const u = (cum[i] / total) * tiles; // 0..tiles (entero) -> costura perfecta
    uv.push(u, 0, u, vRepeat);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
    index.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

// Confeti / fuegos: pool de puntos que se lanzan en ráfagas y caen con gravedad.
// Devuelve { update(dt), burst(n) }. Nada que descargar.
export function makeConfetti(scene, spread = 55) {
  const MAX = 700;
  const pos = new Float32Array(MAX * 3).fill(-1000);
  const col = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, depthWrite: false }));
  pts.frustumCulled = false;
  scene.add(pts);

  const palette = [[1, 0.35, 0.35], [0.35, 0.62, 1], [1, 0.82, 0.29], [0.26, 0.82, 0.5], [1, 1, 1]];
  let next = 0;
  const spawn = (x, y, z) => {
    const i = next; next = (next + 1) % MAX;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
    // poco impulso hacia arriba: caen flotando dentro del campo de visión.
    vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = 1 + Math.random() * 4; vel[i * 3 + 2] = Math.sin(a) * sp;
    const c = palette[(Math.random() * palette.length) | 0];
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    life[i] = 3 + Math.random() * 2;
  };

  return {
    // Lluvia de confeti sobre la cancha (a la vista de la cámara), no arriba de todo.
    burst(n = 70) {
      const ox = (Math.random() - 0.5) * spread * 2, oz = (Math.random() - 0.5) * spread * 1.2;
      for (let k = 0; k < n; k++) spawn(ox + (Math.random() - 0.5) * 20, 22 + Math.random() * 8, oz + (Math.random() - 0.5) * 20);
    },
    update(dt) {
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        vel[i * 3 + 1] -= 8 * dt; // gravedad suave -> flotan
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (life[i] <= 0) pos[i * 3 + 1] = -1000;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

// Estadio: rectángulo redondeado con offset constante al campo (pegado a los lados
// pero sin comer las esquinas). Carteles bajos + tribuna inclinada con público.
function addStadium(scene) {
  const HL = FIELD.LENGTH / 2, HW = FIELD.WIDTH / 2;

  // Piso de cemento alrededor (visible fuera del rectángulo verde).
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(Math.hypot(HL, HW) + 100, 48),
    new THREE.MeshStandardMaterial({ color: 0x3a3f45 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  scene.add(floor);

  // Anillo interno (borde del campo) y externo (tribuna abierta hacia afuera).
  const inner = roundedRect(HL + 10, HW + 10, 20); // offset 10: despeja esquinas
  const outer = roundedRect(HL + 38, HW + 38, 44);

  // Carteles/publicidad: banda vertical baja pegada al campo.
  const boards = bandMesh(inner, inner, 0, 3.5, 1, 1,
    new THREE.MeshStandardMaterial({ color: 0x141a20, side: THREE.DoubleSide }));
  scene.add(boards);

  // Tribuna: del borde de los carteles hacia arriba y afuera, con público.
  // tilePer=14 (repetición cada ~14u), vRepeat=5 (filas de público).
  const stand = bandMesh(inner, outer, 3.5, 40, 14, 5,
    new THREE.MeshBasicMaterial({ map: crowdTexture(), side: THREE.DoubleSide }));
  scene.add(stand);
}

function addLines(scene) {
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
  const hl = FIELD.LENGTH / 2, hw = FIELD.WIDTH / 2;
  const y = 0.02;
  const line = (pts2d) => scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts2d.map(([x, z]) => new THREE.Vector3(x, y, z))), mat));

  // perímetro + línea de medio campo
  line([[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw], [-hl, -hw]]);
  line([[0, -hw], [0, hw]]);

  // círculo central
  const circle = [];
  for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; circle.push([Math.cos(a) * 10, Math.sin(a) * 10]); }
  line(circle);

  // Áreas por arco: grande, chica, punto de penal y arco frontal.
  const PA_D = 22, PA_W = 66;   // área grande: profundidad y ancho (Z)
  const GA_D = 9, GA_W = 42;    // área chica
  const SPOT = 15;             // distancia del punto de penal a la línea de gol
  const ARC_R = 14;
  for (const dir of [-1, 1]) {
    const gx = dir * hl; // línea de gol
    // área grande (3 lados; el 4to es la línea de gol)
    line([[gx, -PA_W / 2], [gx - dir * PA_D, -PA_W / 2], [gx - dir * PA_D, PA_W / 2], [gx, PA_W / 2]]);
    // área chica
    line([[gx, -GA_W / 2], [gx - dir * GA_D, -GA_W / 2], [gx - dir * GA_D, GA_W / 2], [gx, GA_W / 2]]);
    // punto de penal (círculo chico)
    const sx = gx - dir * SPOT;
    const spot = [];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; spot.push([sx + Math.cos(a) * 0.7, Math.sin(a) * 0.7]); }
    line(spot);
    // arco frontal del área (sólo la parte fuera del área grande)
    const cosLim = (PA_D - SPOT) / ARC_R; // límite donde el arco sale del área
    const half = Math.acos(Math.max(-1, Math.min(1, cosLim)));
    const arc = [];
    for (let i = 0; i <= 24; i++) {
      const t = -half + (2 * half) * (i / 24);
      arc.push([sx - dir * ARC_R * Math.cos(t), ARC_R * Math.sin(t)]);
    }
    line(arc);
  }
}

function addGoals(scene) {
  const hl = FIELD.LENGTH / 2, hg = FIELD.GOAL_WIDTH / 2;
  const H = 7; // alto del arco
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const postGeo = new THREE.CylinderGeometry(0.3, 0.3, H, 10);
  for (const dir of [-1, 1]) {
    for (const z of [-hg, hg]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(dir * hl, H / 2, z);
      scene.add(post);
    }
    // travesaño
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, FIELD.GOAL_WIDTH, 10), postMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(dir * hl, H, 0);
    scene.add(bar);

    // malla (red): fondo + techo + laterales, translúcida.
    const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
    const nd = 7; // profundidad de la red hacia afuera
    const back = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.GOAL_WIDTH, H), netMat);
    back.rotation.y = Math.PI / 2; back.position.set(dir * (hl + nd), H / 2, 0); scene.add(back);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(nd, FIELD.GOAL_WIDTH), netMat);
    top.rotation.x = Math.PI / 2; top.position.set(dir * (hl + nd / 2), H, 0); scene.add(top);
    for (const z of [-hg, hg]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(nd, H), netMat);
      side.position.set(dir * (hl + nd / 2), H / 2, z); scene.add(side);
    }
  }
}

// Sombra falsa: disco oscuro translúcido en el piso (barato, sin shadow maps).
export function makeShadow(radius) {
  const s = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  );
  s.rotation.x = -Math.PI / 2;
  s.position.y = 0.04;
  return s;
}

// Carga el GLB del jugador una vez. Devuelve { scene, animations } o null si falla.
export function loadPlayerModel(url = '/models/player.glb') {
  const loader = new GLTFLoader();
  return new Promise((resolve) => {
    loader.load(url, (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
      undefined, (err) => { console.warn('No se pudo cargar el modelo, uso cápsulas:', err); resolve(null); });
  });
}

// Anillo de equipo bajo los pies (ayuda a distinguir desde arriba; la remera ya tiñe).
function teamDisc(team) {
  const disc = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.5, 24),
    new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team] || 0xcccccc, side: THREE.DoubleSide })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.05;
  return disc;
}

// Tag de nombre flotante (sprite con canvas). Mira siempre a la cámara.
function makeNameTag(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 40px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(name, 128, 32);
  g.fillStyle = '#fff';
  g.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(4, 1, 1);
  sprite.position.y = 4.6;
  return sprite;
}

// Patada por IK de 2 huesos. El rig es IK: Foot.R (donde está el zapato) NO cuelga
// de la tibia, sino de la raíz. Así que movemos el control del pie a la posición de
// la patada y doblamos muslo/tibia para alcanzarlo (el glTF no trae solver de IK).
// Plano sagital: adelante = +Z, arriba = +Y (el modelo mira +Z).
const KICK = {
  dur: 0.5,
  times: [0, 0.14, 0.28, 0.5],
  // Posición objetivo del tobillo por keyframe, relativa a la cadera: [fwd, up, alcance]
  // donde alcance = fracción de (muslo+tibia). null = bind pose.
  foot: [null, [-0.35, -0.94, 0.98], [0.98, 0.20, 0.92], null], // amaga atrás-abajo, golpea adelante
  kneeLead: 1, // signo del doblez de rodilla; si apunta al revés, poner -1
};

// Construye el AnimationClip 'Kick' resolviendo IK de 2 huesos por keyframe y leyendo
// las transformaciones locales resultantes. Se calcula una vez y se cachea en template.
export function buildKickClip(template) {
  const root = template.scene;
  // GLTFLoader sanitiza los nombres (UpperLeg.R -> UpperLegR): buscamos ignorando
  // puntos/guiones/mayúsculas. Sin exigir isBone: los tips `_end` (LowerLeg.R_end,
  // Foot.R_end) no están en skin.joints, así que GLTFLoader los crea como Object3D.
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const findBone = (t) => { let h = null; root.traverse((o) => { if (!h && norm(o.name) === t) h = o; }); return h; };
  const hip = findBone('upperlegr'), knee = findBone('lowerlegr'), ankle = findBone('lowerlegrend');
  const foot = findBone('footr'), toe = findBone('footrend');
  if (!hip || !knee || !ankle || !foot) return null;

  root.updateMatrixWorld(true);
  const P = (b) => b.getWorldPosition(new THREE.Vector3());
  const pHip = P(hip);
  const L1 = P(knee).distanceTo(pHip), L2 = P(ankle).distanceTo(P(knee)); // largos muslo/tibia
  const reach = L1 + L2;
  const F = new THREE.Vector3(0, 0, 1), U = new THREE.Vector3(0, 1, 0);

  // bind (para resetear entre keyframes y no dejar el template posado)
  const bindQ = { hip: hip.quaternion.clone(), knee: knee.quaternion.clone(), foot: foot.quaternion.clone() };
  const bindFootPos = foot.position.clone();

  // Orienta un hueso para que el vector hueso→hijo apunte a worldDir (unit).
  const pointAt = (bone, child, worldDir) => {
    root.updateMatrixWorld(true);
    const cur = P(child).sub(P(bone)).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, worldDir);
    const desired = delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    const pInv = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(pInv.multiply(desired));
    bone.updateMatrixWorld(true);
  };

  // Resuelve el triángulo cadera-rodilla-tobillo para un objetivo [fwd,up,frac].
  const solve = (spec) => {
    const dir = new THREE.Vector3().addScaledVector(F, spec[0]).addScaledVector(U, spec[1]).normalize();
    const d = Math.min(reach * spec[2], reach * 0.999); // distancia cadera→tobillo (evita singularidad)
    const target = pHip.clone().addScaledVector(dir, d);
    const base = Math.atan2(dir.dot(U), dir.dot(F)); // ángulo de la línea cadera→objetivo
    const cosB = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
    const thighAng = base + Math.acos(cosB) * KICK.kneeLead;
    const thighDir = new THREE.Vector3(0, Math.sin(thighAng), Math.cos(thighAng));
    const kneePos = pHip.clone().addScaledVector(thighDir, L1);
    return { thighDir, shinDir: target.clone().sub(kneePos).normalize(), target };
  };

  const hipV = [], kneeV = [], footV = [], footP = [];
  for (const spec of KICK.foot) {
    hip.quaternion.copy(bindQ.hip); knee.quaternion.copy(bindQ.knee);
    foot.quaternion.copy(bindQ.foot); foot.position.copy(bindFootPos);
    root.updateMatrixWorld(true);
    if (spec) {
      const { thighDir, shinDir, target } = solve(spec);
      pointAt(hip, knee, thighDir);
      pointAt(knee, ankle, shinDir);
      foot.position.copy(foot.parent.worldToLocal(target.clone())); // control del pie al tobillo
      foot.updateMatrixWorld(true);
      if (toe) pointAt(foot, toe, shinDir); // la punta sigue la línea de la tibia
    }
    hipV.push(hip.quaternion.x, hip.quaternion.y, hip.quaternion.z, hip.quaternion.w);
    kneeV.push(knee.quaternion.x, knee.quaternion.y, knee.quaternion.z, knee.quaternion.w);
    footV.push(foot.quaternion.x, foot.quaternion.y, foot.quaternion.z, foot.quaternion.w);
    footP.push(foot.position.x, foot.position.y, foot.position.z);
  }
  hip.quaternion.copy(bindQ.hip); knee.quaternion.copy(bindQ.knee);
  foot.quaternion.copy(bindQ.foot); foot.position.copy(bindFootPos);
  root.updateMatrixWorld(true);

  const t = KICK.times;
  return new THREE.AnimationClip('Kick', KICK.dur, [
    new THREE.QuaternionKeyframeTrack(hip.name + '.quaternion', t, hipV),
    new THREE.QuaternionKeyframeTrack(knee.name + '.quaternion', t, kneeV),
    new THREE.QuaternionKeyframeTrack(foot.name + '.quaternion', t, footV),
    new THREE.VectorKeyframeTrack(foot.name + '.position', t, footP),
  ]);
}

// Avatar de un jugador: clona el modelo (o cápsula de fallback) + mixer de animación.
// Devuelve { obj, mixer, actions } — actions = { idle, run, jump, kick } o null si es cápsula.
// showTag: mostrar el nombre encima (típicamente los otros jugadores, no uno mismo).
export function makeAvatar(template, team, name, showTag) {
  const group = new THREE.Group();
  group.add(makeShadow(1.6));  // sombra bajo los pies
  group.add(teamDisc(team)); // marca de equipo bajo los pies (siempre visible)
  if (showTag && name) group.add(makeNameTag(name));

  if (!template) {
    // Fallback: cápsula del color del equipo.
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER.RADIUS, 1.6, 4, 8),
      new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team] || 0xcccccc })
    );
    body.position.y = PLAYER.RADIUS + 0.8;
    group.add(body);
    return { obj: group, mixer: null, actions: null };
  }

  const model = cloneSkinned(template.scene);
  model.scale.setScalar(PLAYER_SCALE); // tamaño natural (armature ya escala x100)
  model.rotation.y = MODEL_YAW_OFFSET;

  // Teñir la remera con el color del equipo (clonar el material: el clone comparte
  // materiales, si no todos los jugadores cambiarían de color juntos).
  const shirt = new THREE.Color(TEAM_COLOR[team] || 0xcccccc);
  const skin = new THREE.Color(SKIN_COLOR);
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const n = o.material.name || '';
    if (/shirt/i.test(n)) { o.material = o.material.clone(); o.material.color.copy(shirt); }
    else if (/skin/i.test(n)) { o.material = o.material.clone(); o.material.color.copy(skin); }
    // El GLB viene con metalness 0.4 -> sin env map se ve oscuro. Lo pasamos a mate.
    o.material.metalness = 0;
    o.material.roughness = 0.9;
  });
  group.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const find = (kw) => template.animations.find((a) => a.name.toLowerCase().includes(kw));
  const mk = (clip, loop) => {
    if (!clip) return null;
    const act = mixer.clipAction(clip);
    if (loop === 'once') { act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; }
    return act;
  };
  if (!template.__kickClip) template.__kickClip = buildKickClip(template);
  const actions = {
    idle: mk(find('idle')),
    run: mk(find('run')),
    jump: mk(find('jump'), 'once'),
    kick: template.__kickClip ? mk(template.__kickClip, 'once') : null,
  };
  return { obj: group, mixer, actions };
}

// Textura de pelota dibujada en canvas (sin descargar nada): blanca con parches negros.
function soccerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#141414';
  const pentagon = (cx, cy, r) => {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / 5);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.fill();
  };
  const spots = [[48, 40], [140, 30], [214, 64], [40, 130], [128, 128], [216, 160], [72, 210], [180, 216]];
  for (const [x, y] of spots) pentagon(x, y, 24);
  return new THREE.CanvasTexture(c);
}

export function makeBallMesh() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(BALL.RADIUS, 32, 32),
    new THREE.MeshStandardMaterial({ map: soccerTexture(), roughness: 0.7 })
  );
}
