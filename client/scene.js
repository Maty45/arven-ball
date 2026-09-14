// Escena three.js: cancha, luces, cámara. Devuelve helpers para crear/mover entidades.
import * as THREE from 'three';
import { FIELD, PLAYER, BALL } from '../server/constants.js';

const TEAM_COLOR = { red: 0xff5a5a, blue: 0x5a9dff };

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

export function makePlayerMesh(team) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER.RADIUS, 1.6, 4, 8),
    new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team] || 0xcccccc })
  );
  body.position.y = PLAYER.RADIUS + 0.8;
  group.add(body);
  // Naricita para ver hacia dónde mira (dirección +X local).
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1.0, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(PLAYER.RADIUS + 0.6, PLAYER.RADIUS + 0.8, 0);
  group.add(nose);
  return group;
}

export function makeBallMesh() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(BALL.RADIUS, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
}
