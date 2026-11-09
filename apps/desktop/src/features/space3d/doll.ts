/**
 * Boneco de massinha do Espaço 3D (ADR-0055): corpo liso feito por nós (gerado a partir de cápsulas que se fundem,
 * com cabeça esculpida) sobre o esqueleto e as animações da Universal Animation Library da Quaternius (CC0). O
 * arquivo `assets/doll.glb` já traz a malha pronta, o esqueleto e só as animações usadas; o rosto (olhos que piscam,
 * boca que fala) e a antena são montados aqui, presos ao osso da cabeça.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import dollUrl from './assets/doll.glb?url';

/** o boneco do arquivo tem ~1,88 m; no espaço ele fica com ~1,3 m, do tamanho dos móveis e das arenas */
export const DOLL_SCALE = 0.7;

export const CLIPS = [
  'Idle_Loop',
  'Idle_Talking_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Sprint_Loop',
  'Jump_Loop',
  'Sitting_Idle_Loop',
  'Sitting_Talking_Loop',
  'Driving_Loop',
  'Punch_Jab',
  'Punch_Cross',
  'Death01',
  'Hit_Chest',
  'Sword_Attack',
  'Dance_Loop',
] as const;
export type ClipName = (typeof CLIPS)[number];

type V3 = [number, number, number];
interface DollInfo {
  eyeL: V3;
  eyeR: V3;
  mouth: V3;
  antenna: V3;
}

export interface DollTemplate {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  info: DollInfo;
  /** posição do quadril (unidades do arquivo) sentado e pilotando, para apoiar o boneco no assento */
  sitPelvis: THREE.Vector3;
  drivePelvis: THREE.Vector3;
  /** velocidade (m/s no espaço, já com a escala) em que cada animação de andar/correr não escorrega */
  gait: Partial<Record<ClipName, number>>;
}

let loading: Promise<DollTemplate> | null = null;
let ready: DollTemplate | null = null;

function isV3(v: unknown): v is V3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number');
}

/** posição do osso do quadril com a animação parada no começo (num clone, sem mexer no modelo base) */
function pelvisAt(scene: THREE.Object3D, clip: THREE.AnimationClip | undefined): THREE.Vector3 {
  if (!clip) return new THREE.Vector3(0, 0.5, 0);
  const c = SkeletonUtils.clone(scene);
  const mixer = new THREE.AnimationMixer(c);
  mixer.clipAction(clip).play();
  mixer.update(0);
  c.updateMatrixWorld(true);
  const p = c.getObjectByName('pelvis')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 0.5, 0);
  mixer.stopAllAction();
  mixer.uncacheRoot(c);
  return p;
}

/**
 * Velocidade natural de uma animação de andar (no lugar): o pé apoiado percorre, para trás, a distância que o corpo
 * andaria. Essa distância é a amplitude do pé para a frente e para trás, durante a fração do ciclo em que ele fica
 * no chão (`stance`: ~60% andando, menos correndo).
 */
function gaitSpeed(scene: THREE.Object3D, clip: THREE.AnimationClip | undefined, stance: number): number {
  if (!clip) return 1;
  const c = SkeletonUtils.clone(scene);
  const mixer = new THREE.AnimationMixer(c);
  mixer.clipAction(clip).play();
  const foot = c.getObjectByName('foot_l');
  let lo = Infinity;
  let hi = -Infinity;
  const N = 60;
  for (let i = 0; i <= N && foot; i++) {
    mixer.setTime((i / N) * clip.duration);
    c.updateMatrixWorld(true);
    const z = foot.getWorldPosition(new THREE.Vector3()).z;
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(c);
  if (!foot || !Number.isFinite(hi)) return 1;
  return Math.max(0.3, ((hi - lo) / (stance * clip.duration)) * DOLL_SCALE);
}

/** carrega o boneco uma vez (as próximas chamadas reaproveitam) */
export function loadDoll(): Promise<DollTemplate> {
  loading ??= new GLTFLoader().loadAsync(dollUrl).then((gltf) => {
    const scene = gltf.scene;
    let raw: Record<string, unknown> = {};
    scene.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) {
        raw = o.userData as Record<string, unknown>;
        o.frustumCulled = false;
        o.castShadow = true;
      }
    });
    const { eyeL, eyeR, mouth, antenna } = raw;
    if (!isV3(eyeL) || !isV3(eyeR) || !isV3(mouth) || !isV3(antenna)) throw new Error('boneco sem rosto');
    const clips = new Map(gltf.animations.map((c) => [c.name, c]));
    const t: DollTemplate = {
      scene,
      clips,
      info: { eyeL, eyeR, mouth, antenna },
      sitPelvis: pelvisAt(scene, clips.get('Sitting_Idle_Loop')),
      drivePelvis: pelvisAt(scene, clips.get('Driving_Loop')),
      gait: {
        Walk_Loop: gaitSpeed(scene, clips.get('Walk_Loop'), 0.62),
        Jog_Fwd_Loop: gaitSpeed(scene, clips.get('Jog_Fwd_Loop'), 0.42),
        Sprint_Loop: gaitSpeed(scene, clips.get('Sprint_Loop'), 0.35),
      },
    };
    ready = t;
    return t;
  });
  return loading;
}

/** o boneco já carregado (ou null) */
export function dollNow(): DollTemplate | null {
  return ready;
}

// peças do rosto compartilhadas por todos (nunca descartadas)
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const SPHERE_LO = new THREE.SphereGeometry(1, 10, 8);
const STALK = new THREE.CylinderGeometry(0.008, 0.008, 0.13, 8);
const INK = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.35 });
const GLINT = new THREE.MeshBasicMaterial({ color: 0xffffff });
const MOUTH_IN = new THREE.MeshStandardMaterial({ color: 0x7a2a35, roughness: 0.6 });
const STALK_MAT = new THREE.MeshStandardMaterial({ color: 0x2b2e36, roughness: 0.55 });

export interface DollFace {
  eyes: THREE.Object3D[];
  lip: THREE.Object3D;
  inner: THREE.Object3D;
  tip: THREE.Mesh;
}

/**
 * Prende `obj` ao osso mantendo a orientação que ele teria no boneco (o osso pode estar girado): `at` é a posição no
 * espaço local do osso. Chamar com o boneco na pose de referência e sem rotação no pai.
 */
export function attachUpright(bone: THREE.Object3D, obj: THREE.Object3D, model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const q = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
  q.multiply(model.getWorldQuaternion(new THREE.Quaternion()));
  obj.quaternion.premultiply(q);
  const s = bone.getWorldScale(new THREE.Vector3()).x / model.getWorldScale(new THREE.Vector3()).x;
  obj.scale.multiplyScalar(1 / s);
  bone.add(obj);
}

/** olhos, boca e antena no osso da cabeça (posições gravadas no arquivo, na superfície da cabeça) */
export function buildFace(model: THREE.Object3D, info: DollInfo, tipColor: THREE.ColorRepresentation): DollFace {
  const head = model.getObjectByName('Head');
  if (!head) throw new Error('boneco sem cabeça');
  const eyes: THREE.Object3D[] = [];
  for (const p of [info.eyeL, info.eyeR]) {
    const eye = new THREE.Group();
    const iris = new THREE.Mesh(SPHERE, INK);
    iris.scale.set(0.024, 0.036, 0.012);
    eye.add(iris);
    const glint = new THREE.Mesh(SPHERE_LO, GLINT);
    glint.scale.setScalar(0.0075);
    glint.position.set(0.007, 0.012, 0.009);
    eye.add(glint);
    eye.position.fromArray(p);
    attachUpright(head, eye, model);
    eyes.push(eye);
  }
  const mouth = new THREE.Group();
  const lip = new THREE.Mesh(SPHERE, INK);
  lip.scale.set(0.034, 0.006, 0.012);
  mouth.add(lip);
  const inner = new THREE.Mesh(SPHERE, MOUTH_IN);
  inner.scale.set(0.028, 0.004, 0.011);
  inner.position.z = 0.002;
  mouth.add(inner);
  mouth.position.fromArray(info.mouth);
  attachUpright(head, mouth, model);

  const antenna = new THREE.Group();
  const stalk = new THREE.Mesh(STALK, STALK_MAT);
  stalk.position.y = 0.065;
  antenna.add(stalk);
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.026, 16, 12),
    new THREE.MeshStandardMaterial({ color: tipColor, emissive: tipColor, emissiveIntensity: 0.35, roughness: 0.4 }),
  );
  tip.position.y = 0.135;
  antenna.add(tip);
  antenna.position.fromArray(info.antenna);
  antenna.rotation.z = -0.25;
  attachUpright(head, antenna, model);
  return { eyes, lip, inner, tip };
}

/** um boneco novo (clone do modelo: a malha é compartilhada, o esqueleto é de cada um) */
export function cloneDoll(t: DollTemplate): THREE.Object3D {
  return SkeletonUtils.clone(t.scene);
}
