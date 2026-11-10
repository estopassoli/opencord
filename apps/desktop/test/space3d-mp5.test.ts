/**
 * Gunfight do Espaço 3D: as animações próprias da MP5 na primeira pessoa (`mp5.ts`) — a inspeção e o golpe começam e
 * terminam no quadril, o golpe chega na hora do acerto do jogo, e o "tapa HK" da recarga vazia trava a alavanca para
 * trás antes de o pente sair e só solta no tapa (no som `charge`), com a mão fora da alavanca no meio da troca do pente.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  HK_RELEASE,
  HK_TRAVEL,
  MP5_BASH,
  MP5_BASH_HIT,
  MP5_INSPECT,
  hkGesture,
  mp5Play,
  type HkPose,
} from '../src/features/space3d/gunfight/mp5';
import { MAG_OUT_AT, MAG_SEAT_AT } from '../src/features/space3d/gunfight/reload';
import { BASH } from '../src/features/space3d/gunfight/weapons';

function play(t: typeof MP5_INSPECT, u: number) {
  const pos = new THREE.Vector3();
  const rot = new THREE.Euler(0, 0, 0, 'YXZ');
  const mag = mp5Play(t, u, 1, pos, rot);
  return { pos, rot, mag };
}

function pose(): HkPose {
  return {
    bolt: 0,
    charge: 0,
    chargeRot: 0,
    alt: 0,
    altQ: new THREE.Quaternion(),
    out: 0,
    curl: 0,
    thumb: 0,
    at: new THREE.Vector3(),
    arc: new THREE.Vector3(),
    present: 0,
  };
}

describe('MP5 na primeira pessoa', () => {
  it('inspeção e golpe saem do quadril e voltam para ele', () => {
    for (const t of [MP5_INSPECT, MP5_BASH]) {
      for (const u of [0, 1]) {
        const p = play(t, u);
        expect(p.pos.length()).toBeLessThan(1e-9);
        expect(Math.abs(p.rot.x) + Math.abs(p.rot.y) + Math.abs(p.rot.z)).toBeLessThan(1e-9);
        expect(p.mag).toBe(0);
      }
    }
  });

  it('o golpe estoca para a frente na hora do acerto do jogo, depois de recuar', () => {
    expect(MP5_BASH_HIT).toBeCloseTo(160 / BASH.ms, 2);
    expect(play(MP5_BASH, 0.14).pos.z).toBeGreaterThan(0.02);
    expect(play(MP5_BASH, MP5_BASH_HIT).pos.z).toBeLessThan(-0.08);
  });

  it('na inspeção a esquerda vai ao pente só no segundo lado', () => {
    expect(play(MP5_INSPECT, 0.3).mag).toBe(0);
    expect(play(MP5_INSPECT, 0.66).mag).toBeCloseTo(1, 5);
  });

  it('tapa HK: trava a alavanca antes de o pente sair e só solta no tapa', () => {
    const ch = new THREE.Vector3(-0.012, 0.11, -0.21);
    const e = pose();
    const at = (u: number) => {
      hkGesture(u, ch, new THREE.Quaternion(), e, () => {});
      return { ...e, at: e.at.clone() };
    };
    expect(at(0).charge).toBe(0);
    // travada atrás e no entalhe quando o pente vazio cai e enquanto o novo entra
    for (const u of [MAG_OUT_AT, 0.4, MAG_SEAT_AT, HK_RELEASE - 0.02]) {
      const p = at(u);
      expect(p.charge).toBeCloseTo(HK_TRAVEL, 5);
      expect(p.chargeRot).toBeGreaterThan(0.3);
      expect(p.bolt).toBeCloseTo(p.charge, 9);
    }
    // a mão está na alavanca ao puxar e no tapa, e fora dela no meio (vai ao colete buscar o pente)
    expect(at(0.12).alt).toBeCloseTo(1, 5);
    expect(at(0.4).alt).toBe(0);
    expect(at(0.78).alt).toBeCloseTo(1, 5);
    // a mão anda junto com a alavanca puxando
    expect(at(0.14).at.z - at(0.085).at.z).toBeCloseTo(HK_TRAVEL, 3);
    // no tapa a palma desce até a alavanca e ela volta para a frente
    expect(at(0.77).at.y).toBeGreaterThan(at(HK_RELEASE).at.y + 0.02);
    const done = at(HK_RELEASE + 0.05);
    expect(done.charge).toBeLessThan(0.002);
    expect(done.chargeRot).toBe(0);
    expect(at(1).alt).toBe(0);
  });
});
