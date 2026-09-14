// Escena three.js: cancha, luces, cámara. Devuelve helpers para crear/mover entidades.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FIELD, PLAYER, BALL } from '../server/constants.js';

const TEAM_COLOR = { red: 0xff5a5a, blue: 0x5a9dff };

const TARGET_HEIGHT = 3.2; // alto del muñeco en unidades de juego
// El GLB de Quaternius mira hacia +Z; nuestro "facing" 0 es +X. Este offset alinea
// el modelo con la dirección de movimiento. Si el jugador corre de costado/espaldas,
// probar 0, Math.PI/2, -Math.PI/2 o Math.PI.
const MODEL_YAW_OFFSET = -Math.PI / 2;

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1e12);

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

  // Luces.
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(20, 40, 20);
  scene.add(sun);

  // Césped.
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.LENGTH, FIELD.WIDTH),
    new THREE.MeshStandardMaterial({ color: 0x1f7a3d })
  );
  pitch.rotation.x = -Math.PI / 2;
  scene.add(pitch);

  addLines(scene);
  addGoals(scene);

  return { scene, camera, renderer };
}

function addLines(scene) {
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
  const hl = FIELD.LENGTH / 2, hw = FIELD.WIDTH / 2;
  const y = 0.02;
  const pts = [
    // perímetro
    [-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw], [-hl, -hw],
  ].map(([x, z]) => new THREE.Vector3(x, y, z));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));

  // línea de medio campo
  const mid = [new THREE.Vector3(0, y, -hw), new THREE.Vector3(0, y, hw)];
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(mid), mat));

  // círculo central
  const circle = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    circle.push(new THREE.Vector3(Math.cos(a) * 6, y, Math.sin(a) * 6));
  }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circle), mat));
}

function addGoals(scene) {
  const hl = FIELD.LENGTH / 2, hg = FIELD.GOAL_WIDTH / 2;
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const postGeo = new THREE.CylinderGeometry(0.25, 0.25, 4, 8);
  for (const dir of [-1, 1]) {
    for (const z of [-hg, hg]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(dir * hl, 2, z);
      scene.add(post);
    }
    // travesaño
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, FIELD.GOAL_WIDTH, 8), postMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(dir * hl, 4, 0);
    scene.add(bar);
  }
}

// Carga el GLB del jugador una vez. Devuelve { scene, animations } o null si falla.
export function loadPlayerModel(url = '/models/player.glb') {
  const loader = new GLTFLoader();
  return new Promise((resolve) => {
    loader.load(url, (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
      undefined, (err) => { console.warn('No se pudo cargar el modelo, uso cápsulas:', err); resolve(null); });
  });
}

function teamDisc(team) {
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 0.12, 20),
    new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team] || 0xcccccc })
  );
  disc.position.y = 0.06;
  return disc;
}

// Avatar de un jugador: clona el modelo (o cápsula de fallback) + mixer de animación.
// Devuelve { obj, mixer, actions } — actions = { idle, run, jump } o null si es cápsula.
export function makeAvatar(template, team) {
  const group = new THREE.Group();
  group.add(teamDisc(team)); // marca de equipo bajo los pies (siempre visible)

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
  // Escalar a una altura consistente según su bounding box.
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y || 1;
  const s = TARGET_HEIGHT / h;
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s; // apoyar los pies en y=0
  model.rotation.y = MODEL_YAW_OFFSET;
  group.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const find = (kw) => template.animations.find((a) => a.name.toLowerCase().includes(kw));
  const mk = (clip, loop) => {
    if (!clip) return null;
    const act = mixer.clipAction(clip);
    if (loop === 'once') { act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; }
    return act;
  };
  const actions = {
    idle: mk(find('idle')),
    run: mk(find('run')),
    jump: mk(find('jump'), 'once'),
  };
  return { obj: group, mixer, actions };
}

export function makeBallMesh() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(BALL.RADIUS, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
}
