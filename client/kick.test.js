// Self-check del clip de patada (IK de 2 huesos). Corre: `node client/kick.test.js`.
import assert from 'node:assert';
import * as THREE from 'three';
import { buildKickClip } from './scene.js';

// Rig IK como el real: la pierna (UpperLeg.R→LowerLeg.R→LowerLeg.R_end) es una cadena;
// Foot.R cuelga de la raíz (NO de la tibia). Nombres sanitizados como GLTFLoader.
const root = new THREE.Object3D();
const hip = new THREE.Bone(); hip.name = 'UpperLegR'; hip.position.set(0, 3, 0);
const knee = new THREE.Bone(); knee.name = 'LowerLegR'; knee.position.set(0, -1, 0);
// Los tips `_end` NO están en skin.joints → GLTFLoader los crea Object3D, no Bone.
const ankle = new THREE.Object3D(); ankle.name = 'LowerLegR_end'; ankle.position.set(0, -1, 0);
knee.add(ankle); hip.add(knee); root.add(hip);
const foot = new THREE.Bone(); foot.name = 'FootR'; foot.position.set(0, 1, 0.1); // cuelga de root
const toe = new THREE.Object3D(); toe.name = 'FootR_end'; toe.position.set(0, 0, 0.3);
foot.add(toe); root.add(foot);

const clip = buildKickClip({ scene: root });
assert(clip, 'debería construir un clip');
assert.strictEqual(clip.tracks.length, 4, 'muslo + rodilla + pie(rot) + pie(pos) → 4 tracks');
assert(Math.abs(clip.duration - 0.5) < 1e-6, 'duración 0.5s');

const byName = Object.fromEntries(clip.tracks.map((t) => [t.name, t]));
for (const n of ['UpperLegR.quaternion', 'LowerLegR.quaternion', 'FootR.quaternion', 'FootR.position']) {
  assert(byName[n], `falta track ${n}`);
  for (const v of byName[n].values) assert(Number.isFinite(v), `NaN en ${n}`);
}
// Cuaterniones normalizados.
for (const n of ['UpperLegR.quaternion', 'LowerLegR.quaternion', 'FootR.quaternion']) {
  const vals = byName[n].values;
  for (let i = 0; i < vals.length; i += 4) {
    const m = Math.hypot(vals[i], vals[i + 1], vals[i + 2], vals[i + 3]);
    assert(Math.abs(m - 1) < 1e-6, `quaternion normalizado en ${n}`);
  }
}
// En el golpe (keyframe 2) el tobillo tiene que estar ADELANTE del bind (foot pos z sube).
const fp = byName['FootR.position'].values;
assert(fp[2 * 3 + 2] > fp[0 * 3 + 2] + 0.5, 'en el golpe el pie va bien adelante');
// Empieza y termina en bind (mismo valor) en todos los tracks.
for (const n of Object.keys(byName)) {
  const v = byName[n].values, s = v.length / 4; // stride depende del tipo
  const st = n.endsWith('.position') ? 3 : 4;
  const last = v.length - st;
  for (let i = 0; i < st; i++) assert(Math.abs(v[i] - v[last + i]) < 1e-6, `empieza/termina en bind: ${n}`);
}

// Sin los huesos de la pierna → null (fallback a jump en runtime).
assert.strictEqual(buildKickClip({ scene: new THREE.Object3D() }), null);

console.log('kick.test OK — 4 tracks,', clip.duration.toFixed(2) + 's');
