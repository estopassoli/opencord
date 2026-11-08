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
  /** altura do quadril (unidades do arquivo) sentado e pilotando, para apoiar o boneco no assento */
  sitPelvis: number;
  drivePelvis: number;
}

let loading: Promise<DollTemplate> | null = null;
let ready: DollTemplate | null = null;

function isV3(v: unknown): v is V3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number');
}

/** altura do osso do quadril com a animação parada no começo (num clone, sem mexer no modelo base) */
function pelvisHeight(scene: THREE.Object3D, clip: THREE.AnimationClip | undefined): number {
  if (!clip) return 0.5;
  const c = SkeletonUtils.clone(scene);
  const mixer = new THREE.AnimationMixer(c);
  mixer.clipAction(clip).play();
  mixer.update(0);
  c.updateMatrixWorld(true);
  const y = c.getObjectByName('pelvis')?.getWorldPosition(new THREE.Vector3()).y ?? 0.5;
  mixer.stopAllAction();
  mixer.uncacheRoot(c);
  return y;
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
      sitPelvis: pelvisHeight(scene, clips.get('Sitting_Idle_Loop')),
      drivePelvis: pelvisHeight(scene, clips.get('Driving_Loop')),
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
