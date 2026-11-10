/**
 * Gunfight do Espaço 3D: o Magnum BFR na primeira pessoa — o polegar arma o cão (o cão só anda com o polegar nele e
 * termina armado), o tambor sai inteiro da armação no braço, a ordem da recarga (abre, estojos caem com o cano para
 * cima, carregador rápido alinhado antes de empurrar, larga, fecha parando num furo) e a coronhada e a inspeção que
 * começam e terminam na pose de repouso.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BFR_CHAMBER,
  BFR_CLOSE_AT,
  BFR_DUMP_AT,
  BFR_INSPECT,
  BFR_LOADER_DROP,
  BFR_LOADER_SHOW,
  BFR_MELEE,
  BFR_RL_COCK,
  BFR_SEAT_AT,
  COCK_MS,
  bfrMove,
  bfrReload,
  blankBfrMove,
  blankBfrReload,
  cockAt,
  craneOffset,
} from '../src/features/space3d/gunfight/bfr';

/** o tambor do modelo (espaço da arma): centro e raio */
const CYL = new THREE.Vector3(-0.005, 0.0605, 0);
const CYL_R = 0.03;
/** a lateral esquerda da armação na altura do tambor */
const FRAME_LEFT = -0.029;

describe('BFR: o polegar e o cão', () => {
  it('o cão só anda com o polegar nele e termina armado (ou abaixado, desarmando)', () => {
    const c = { reach: 0, ham: 0 };
    for (let ms = 0; ms <= COCK_MS; ms += 10) {
      cockAt(ms, false, c);
      if (c.ham > 0.001 && c.ham < 0.999) expect(c.reach).toBeGreaterThan(0.99);
    }
    expect(cockAt(COCK_MS, false, c)).toEqual({ reach: 0, ham: 1 });
    expect(cockAt(COCK_MS, true, c)).toEqual({ reach: 0, ham: 0 });
    expect(cockAt(0, false, c)).toEqual({ reach: 0, ham: 0 });
  });

  it('depois do tiro o gesto cabe entre dois tiros (100 tiros/min) e o da recarga acaba antes do fim dela', () => {
    expect(150 + COCK_MS).toBeLessThan(600);
    const end = BFR_RL_COCK.at + COCK_MS / (2900 * BFR_RL_COCK.speed);
    expect(end).toBeLessThan(1);
  });
});

describe('BFR: a recarga', () => {
  it('o tambor aberto sai inteiro da armação, para a esquerda', () => {
    const d = craneOffset(CYL, 1, new THREE.Vector3());
    expect(CYL.x + d.x + CYL_R).toBeLessThanOrEqual(FRAME_LEFT + 0.001);
    expect(craneOffset(CYL, 0, new THREE.Vector3()).length()).toBeCloseTo(0, 6);
  });

  it('segue a ordem de um revólver de tambor basculante', () => {
    const at = (u: number) => ({ ...bfrReload(u, blankBfrReload()) });
    // os estojos caem com o tambor aberto e o cano bem para cima
    expect(at(BFR_DUMP_AT).out).toBeCloseTo(1, 3);
    expect(at(BFR_DUMP_AT).rx).toBeGreaterThan(0.6);
    // o carregador aparece na mão fora do tambor; quando empurra, a mão está nele e o cano não está para cima
    expect(at(BFR_LOADER_SHOW).belt).toBeGreaterThan(0.5);
    expect(at(0.53).loader).toBeCloseTo(1, 3);
    expect(at(0.53).lz).toBeGreaterThan(0.02);
    expect(at(BFR_SEAT_AT).lz).toBeCloseTo(0, 6);
    expect(at(BFR_SEAT_AT).rx).toBeLessThan(0.3);
    // largado depois de empurrar, e o tambor só fecha depois
    expect(BFR_LOADER_DROP).toBeGreaterThan(BFR_SEAT_AT);
    expect(at(BFR_LOADER_DROP).out).toBeCloseTo(1, 3);
    expect(at(BFR_CLOSE_AT).out).toBeCloseTo(0, 6);
    // fechado, o tambor para num furo (o giro é um número inteiro de furos)
    const turns = at(1).spin / BFR_CHAMBER;
    expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-6);
    // a pose volta à de repouso
    const end = at(1);
    for (const k of ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'cradle', 'belt', 'loader', 'out'] as const)
      expect(end[k]).toBeCloseTo(0, 6);
  });
});

describe('BFR: coronhada e inspeção', () => {
  it('começam e terminam em repouso; a coronhada passa do meio da tela no acerto', () => {
    for (const t of [BFR_MELEE, BFR_INSPECT]) {
      const a = { ...bfrMove(t, 0, blankBfrMove()) };
      const b = { ...bfrMove(t, 1, blankBfrMove()) };
      for (const v of [...Object.values(a), ...Object.values(b)]) expect(v).toBeCloseTo(0, 6);
    }
    const hit = bfrMove(BFR_MELEE, 0.32, blankBfrMove());
    const wind = { ...bfrMove(BFR_MELEE, 0.16, blankBfrMove()) };
    expect(wind.px).toBeGreaterThan(0);
    expect(hit.px).toBeLessThan(-0.08);
    expect(hit.away).toBeCloseTo(1, 3);
  });
});
