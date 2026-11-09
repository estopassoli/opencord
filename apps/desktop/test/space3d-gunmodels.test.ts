/**
 * Gunfight: liberar um modelo de arma (ou um boneco) libera também a textura dos ossos de cada esqueleto — o three
 * cria uma por esqueleto e cada cópia (`SkeletonUtils.clone`) tem o seu; sem isso, cada troca de arma, renascer e bot
 * deixava uma textura para trás.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeGun, type GunModel } from '../src/features/space3d/gunfight/models';

function skinned(): { root: THREE.Group; skeleton: THREE.Skeleton } {
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(
      new Array(n * 4).fill(0).map((_, i) => (i % 4 ? 0 : 1)),
      4,
    ),
  );
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.add(bone);
  mesh.bind(skeleton);
  const root = new THREE.Group();
  root.add(mesh);
  return { root, skeleton };
}

describe('gunfight: liberar modelos', () => {
  it('disposeGun libera o esqueleto da arma', () => {
    const { root, skeleton } = skinned();
    const spy = vi.spyOn(skeleton, 'dispose');
    const g: GunModel = {
      id: 'm4',
      root,
      parts: {},
      muzzle: new THREE.Vector3(),
      sight: new THREE.Vector3(),
      support: new THREE.Vector3(),
      length: 0.8,
    };
    disposeGun(g);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
