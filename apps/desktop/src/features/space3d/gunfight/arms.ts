/**
 * Braços da primeira pessoa com esqueleto de verdade (`assets/arms.glb`, ADR-0060): manga, luva sem dedos e mão com
 * três falanges por dedo, pele presa aos ossos. Substituem as mãos de cápsulas e as mangas de cilindro.
 *
 * Quem posiciona é o `viewmodel.ts`, como antes: cada mão tem uma âncora (`hand(side).root`, no espaço da mão de
 * `handrig.ts`) que vai para a pegada da arma, e `setCurl` fecha os dedos com as poses escritas em `handrig.ts`. Aqui
 * o osso da mão vai para a âncora e o braço é resolvido do pulso para trás: o antebraço sai do pulso na direção do
 * cotovelo pedido (com o tamanho dele), e o braço vai do cotovelo para o ombro. Metade do giro do pulso em volta do
 * antebraço vai para o antebraço (pronação), para a pele do pulso não torcer.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import armsUrl from '../assets/arms.glb?url';
import { ARM_RIG } from './armsrig';
import { handBoneRest, poseFingers, type FingerOffsets, type PoseTarget } from './handrig';

let template: THREE.Object3D | null = null;
let loading: Promise<void> | null = null;

/** carrega o modelo uma vez (as chamadas seguintes esperam a mesma promessa) */
export function loadArms(): Promise<void> {
  loading ??= new GLTFLoader().loadAsync(armsUrl).then((g) => {
    template = g.scene;
  });
  return loading;
}

/** cores da manga, da luva sem dedos e da pele que aparece nas pontas dos dedos */
const SLEEVE = 0x3b4436;
const GLOVE = 0x6e6250;
const SKIN = 0xc39274;

/** a mão de um lado, como o viewmodel usa: a âncora no espaço da mão e o fechamento dos dedos */
export interface ArmHand {
  root: THREE.Group;
  setCurl(c: number, thumb?: number, index?: number, offsets?: FingerOffsets): void;
}

interface Side {
  hand: ArmHand;
  sign: 1 | -1;
  /** o que vem do modelo (depois de carregado) */
  bones: {
    upper: THREE.Bone;
    fore: THREE.Bone;
    hand: THREE.Bone;
    target: PoseTarget;
    /** sinal do eixo do cotovelo (o +x do antebraço é a dobradiça, para dentro ou para fora) */
    hinge: number;
    /** o inverso do giro de descanso da mão em relação ao antebraço */
    handRestQi: THREE.Quaternion;
  } | null;
  /** os dedos pedidos (aplicados quando o modelo chega) */
  curl: [number, number, number, FingerOffsets];
  /** o eixo do cotovelo do último quadro (braço esticado: não dá para tirar do plano) */
  lastHinge: THREE.Vector3;
}

const NO_OFF: FingerOffsets = [0, 0, 0, 0, 0];
// temporários (o solve roda todo quadro)
const W = new THREE.Vector3();
const E = new THREE.Vector3();
const S2 = new THREE.Vector3();
const X = new THREE.Vector3();
const Y = new THREE.Vector3();
const Z = new THREE.Vector3();
const N = new THREE.Vector3();
const M = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
const HM = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const SC = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class FpsArms {
  /** vai para a cena da primeira pessoa (espaço da câmera) */
  readonly root = new THREE.Group();
  private readonly sides: Record<'r' | 'l', Side>;
  private model: THREE.Object3D | null = null;
  private readonly mats: THREE.Material[] = [];
  private readonly handRest = { r: handBoneRest(1), l: handBoneRest(-1) };

  constructor() {
    const make = (sign: 1 | -1): Side => {
      const side: Side = {
        sign,
        bones: null,
        curl: [0.2, 0.16, 0.2, NO_OFF],
        lastHinge: new THREE.Vector3(1, 0, 0),
        hand: {
          root: new THREE.Group(),
          setCurl: (c, t = c * 0.8, ix = c, off = NO_OFF) => {
            side.curl = [c, t, ix, off];
            if (side.bones) poseFingers(side.bones.target, sign, c, t, ix, off);
          },
        },
      };
      return side;
    };
    this.sides = { r: make(1), l: make(-1) };
    this.build();
  }

  hand(side: 1 | -1): ArmHand {
    return this.sides[side > 0 ? 'r' : 'l'].hand;
  }

  /** monta a malha se o modelo já carregou (chamado de novo a cada quadro até dar) */
  build(): boolean {
    if (this.model) return true;
    if (!template) return false;
    const m = cloneSkinned(template);
    m.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.frustumCulled = false;
      o.castShadow = false;
      const name = (o.material as THREE.Material).name;
      const mat = new THREE.MeshStandardMaterial({
        color: name === 'manga' ? SLEEVE : name === 'luva' ? GLOVE : SKIN,
        roughness: name === 'pele' ? 0.7 : 0.88,
      });
      this.mats.push(mat);
      o.material = mat;
    });
    m.updateMatrixWorld(true);
    for (const key of ['r', 'l'] as const) {
      const s = this.sides[key];
      const get = (n: string) => m.getObjectByName(n + '_' + key) as THREE.Bone;
      const upper = get('upperarm');
      const fore = get('forearm');
      const hand = get('hand');
      const target: PoseTarget = { bones: new Map(), rest: new Map() };
      for (const b of ARM_RIG[key].bones) {
        const bone = get(b.name);
        target.bones.set(b.name, bone);
        target.rest.set(b.name, new THREE.Quaternion().fromArray(b.quat));
      }
      // o eixo do cotovelo: a normal do plano ombro–cotovelo–pulso no descanso, comparada ao +x do antebraço
      const s0 = upper.getWorldPosition(new THREE.Vector3());
      const e0 = fore.getWorldPosition(new THREE.Vector3());
      const w0 = hand.getWorldPosition(new THREE.Vector3());
      const n0 = new THREE.Vector3().crossVectors(e0.clone().sub(s0), w0.clone().sub(e0));
      const x0 = new THREE.Vector3(1, 0, 0).applyQuaternion(fore.getWorldQuaternion(new THREE.Quaternion()));
      s.bones = {
        upper,
        fore,
        hand,
        target,
        hinge: n0.dot(x0) >= 0 ? 1 : -1,
        handRestQi: hand.quaternion.clone().invert(),
      };
      const [c, t, ix, off] = s.curl;
      poseFingers(target, s.sign, c, t, ix, off);
    }
    this.model = m;
    this.root.add(m);
    return true;
  }

  /**
   * Põe o braço de um lado: o osso da mão na âncora (que já está no lugar deste quadro), o antebraço do pulso na
   * direção de `elbow` e o braço do cotovelo na direção de `shoulder` (tudo no espaço da cena da primeira pessoa).
   */
  solve(side: 1 | -1, shoulder: THREE.Vector3, elbow: THREE.Vector3) {
    const s = this.sides[side > 0 ? 'r' : 'l'];
    if (!s.bones) return;
    const rest = side > 0 ? this.handRest.r : this.handRest.l;
    // a mão: a âncora vezes o descanso do osso no espaço da mão
    HM.copy(s.hand.root.matrixWorld).multiply(M.compose(rest.pos, rest.quat, ONE));
    this.solveHand(side, HM, shoulder, elbow);
  }

  /**
   * O mesmo `solve`, com a matriz do osso da mão já pronta (espaço da cena): as animações feitas à mão (`fpanim.ts`)
   * dão a mão e o cotovelo de cada quadro.
   */
  solveHand(side: 1 | -1, hand: THREE.Matrix4, shoulder: THREE.Vector3, elbow: THREE.Vector3) {
    const s = this.sides[side > 0 ? 'r' : 'l'];
    const b = s.bones;
    if (!b) return;
    if (hand !== HM) HM.copy(hand);
    W.setFromMatrixPosition(HM);
    // antebraço com o tamanho dele, do pulso para o cotovelo pedido; braço do cotovelo para o ombro
    E.copy(elbow).sub(W);
    if (E.lengthSq() < 1e-8) E.set(0.3 * side, -0.4, 0.5);
    E.normalize().multiplyScalar(ARM_RIG.fore).add(W);
    S2.copy(shoulder).sub(E);
    if (S2.lengthSq() < 1e-8) S2.set(0, -1, 1);
    S2.normalize().multiplyScalar(ARM_RIG.upper).add(E);
    // o eixo do cotovelo: normal do plano dos três pontos (esticado, fica o do quadro anterior)
    N.copy(E).sub(S2).cross(Y.copy(W).sub(E));
    if (N.lengthSq() > 1e-8) s.lastHinge.copy(N.normalize().multiplyScalar(b.hinge));
    // braço
    Y.copy(E).sub(S2).normalize();
    this.place(b.upper, S2, Y, s.lastHinge);
    // antebraço, com metade do giro do pulso
    Y.copy(W).sub(E).normalize();
    this.place(b.fore, E, Y, s.lastHinge);
    b.fore.updateMatrixWorld(true);
    Q.setFromRotationMatrix(M2.extractRotation(b.fore.matrixWorld)).invert();
    Q2.setFromRotationMatrix(M2.extractRotation(HM));
    // giro da mão em relação ao antebraço, tirando o descanso; a parte em volta do eixo do antebraço (y dele)
    const delta = Q.multiply(Q2).multiply(b.handRestQi);
    const twist = 2 * Math.atan2(delta.y, delta.w);
    const half = Math.atan2(Math.sin(twist), Math.cos(twist)) * 0.5;
    b.fore.quaternion.multiply(Q.setFromAxisAngle(Y_AXIS, half));
    b.fore.updateMatrixWorld(true);
    // a mão: de volta para o espaço do antebraço
    M.copy(b.fore.matrixWorld).invert().multiply(HM);
    M.decompose(b.hand.position, b.hand.quaternion, SC);
    b.hand.scale.set(1, 1, 1);
  }

  /** giro local de cada osso de dedo (nomes sem o sufixo do lado), no lugar da pose escrita do `setCurl` */
  setFingerQuats(side: 1 | -1, q: ReadonlyMap<string, THREE.Quaternion>) {
    const b = this.sides[side > 0 ? 'r' : 'l'].bones;
    if (!b) return;
    for (const [name, bone] of b.target.bones) {
      const v = q.get(name);
      if (v) bone.quaternion.copy(v);
    }
  }

  /** um osso na posição `at`, com o y dele em `y` e o x o mais perto possível de `x` (no espaço da cena) */
  private place(bone: THREE.Bone, at: THREE.Vector3, y: THREE.Vector3, x: THREE.Vector3) {
    X.copy(x).addScaledVector(y, -x.dot(y));
    if (X.lengthSq() < 1e-8) X.set(1, 0, 0).addScaledVector(y, -y.x);
    X.normalize();
    Z.crossVectors(X, y);
    M.makeBasis(X, y, Z).setPosition(at);
    const parent = bone.parent;
    if (parent) {
      parent.updateMatrixWorld(true);
      M.premultiply(M2.copy(parent.matrixWorld).invert());
    }
    M.decompose(bone.position, bone.quaternion, SC);
    bone.scale.set(1, 1, 1);
    bone.updateMatrixWorld(true);
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.mats.length = 0;
    // a geometria é do modelo carregado (compartilhada entre as cópias): fica
    this.model?.removeFromParent();
    this.model = null;
  }
}
