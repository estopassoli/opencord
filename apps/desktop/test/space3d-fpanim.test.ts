/**
 * Gunfight: animações de primeira pessoa feitas à mão (ADR-0061). O arquivo de clipes do MP7 tem os clipes e os ossos
 * que o jogo lê; os tempos casam com os sons da recarga do `game.ts`; quem decide pesos e tempos (`FpMixer`) mantém a
 * soma dos pesos em 1, estica o clipe para a duração do jogo e põe o indicador no gatilho só no tiro; e, parado ou
 * mirando, a arma fica exatamente na pose de quadril do clipe (a linha de mira continua a das outras armas).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { MP7_ANIM } from '../src/features/space3d/gunfight/fpclips-mp7';
import { AuthoredArms, AUTHORED, registerFpAnims } from '../src/features/space3d/gunfight/fpanim';
import { FADE_IN, FADE_OUT, FpMixer, TRIGGER_HOLD } from '../src/features/space3d/gunfight/fpmix';
import type { GunModel } from '../src/features/space3d/gunfight/models';

const GLB = join(__dirname, '../src/features/space3d/assets/anims/mp7.glb');
const CLIPS = ['idle', 'ads', 'sprint', 'tac', 'draw', 'holster', 'fire', 'melee', 'reload', 'reloadEmpty', 'inspect'];

function load(): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  const buf = readFileSync(GLB);
  // cópia num ArrayBuffer deste ambiente (o do Buffer do Node falha no `instanceof` do GLTFLoader)
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Promise((ok, fail) => new GLTFLoader().parse(ab, '', (g) => ok(g), fail));
}

function fakeGun(buildKey = ''): GunModel {
  return {
    id: 'mp7',
    root: new THREE.Group(),
    parts: {},
    muzzle: new THREE.Vector3(),
    sight: new THREE.Vector3(),
    support: new THREE.Vector3(),
    length: 0.6,
    buildKey,
  };
}

const step = (m: FpMixer, s: number, inp = { ads: 0, sprint: 0, tac: 0, stride: 0 }) => {
  let out = m.step(0, inp);
  for (let t = 0; t < s - 1e-9; t += 1 / 60) out = m.step(1 / 60, inp);
  return out;
};
const sum = (o: ReturnType<FpMixer['step']>) =>
  o.loops.idle.w + o.loops.ads.w + o.loops.sprint.w + o.loops.tac.w + (o.one?.w ?? 0);

describe('clipes feitos à mão do MP7', () => {
  it('nenhuma arma usa o caminho novo por enquanto (o MP7 voltou ao de código)', () => {
    expect([...AUTHORED]).toEqual([]);
  });

  it('o arquivo tem todos os clipes, com a duração escrita e os ossos que o jogo lê', async () => {
    const g = await load();
    const names = g.animations.map((a) => a.name).sort();
    expect(names).toEqual([...CLIPS].sort());
    for (const a of g.animations) {
      const meta = (MP7_ANIM.clips as Record<string, { len: number }>)[a.name]!;
      expect(a.duration).toBeCloseTo(meta.len, 1);
      const tracks = new Set(a.tracks.map((t) => t.name));
      for (const n of [
        'weapon.quaternion',
        'weapon.position',
        'hand_r.quaternion',
        'hand_l.quaternion',
        'index2_r.quaternion',
      ])
        expect(tracks.has(n), `${a.name}: ${n}`).toBe(true);
    }
    const names2 = new Set<string>();
    g.scene.traverse((o) => names2.add(o.name));
    for (const n of ['weapon', 'mag', 'charge', 'ctl', 'upperarm_r', 'forearm_l', 'thumb3_l'])
      expect(names2.has(n)).toBe(true);
  });

  it('os eventos da recarga casam com os sons do jogo (pente sai em 18%, entra em 60%, alavanca em 80%)', () => {
    expect(MP7_ANIM.clips.reload.events).toEqual({ magOut: 0.18, magIn: 0.6 });
    expect(MP7_ANIM.clips.reloadEmpty.events).toEqual({ magOut: 0.18, magIn: 0.6, charge: 0.8 });
    expect(MP7_ANIM.clips.inspect.len).toBeGreaterThanOrEqual(3);
    expect(MP7_ANIM.clips.inspect.len).toBeLessThanOrEqual(4);
  });

  it('parado e mirando, a arma fica na pose de quadril do clipe (a mira não sai do lugar)', async () => {
    const g = await load();
    registerFpAnims('mp7', g.scene, g.animations);
    const arms = new AuthoredArms('mp7', fakeGun());
    const p = new THREE.Vector3();
    const hip = new THREE.Vector3().setFromMatrixPosition(arms.hip);
    for (const ads of [0, 1]) {
      for (let i = 0; i < 30; i++) arms.update(1 / 60, { ads, sprint: 0, tac: 0, stride: 0 });
      p.setFromMatrixPosition(arms.pose.gun);
      // respirando, no máximo uns milímetros; mirando, nada
      expect(p.distanceTo(hip)).toBeLessThan(ads ? 1e-4 : 0.004);
    }
    arms.dispose();
  });

  it('com empunhadura vertical, a mão de apoio vai para a pegada medida nela', async () => {
    const g = await load();
    registerFpAnims('mp7', g.scene, g.animations);
    const base = new AuthoredArms('mp7', fakeGun());
    const vg = new AuthoredArms('mp7', fakeGun('..vgrip.'));
    for (const a of [base, vg]) for (let i = 0; i < 10; i++) a.update(1 / 60, { ads: 1, sprint: 0, tac: 0, stride: 0 });
    const a = new THREE.Vector3().setFromMatrixPosition(base.pose.hand[1]);
    const b = new THREE.Vector3().setFromMatrixPosition(vg.pose.hand[1]);
    expect(a.distanceTo(b)).toBeGreaterThan(0.005);
    // a direita não muda
    expect(
      new THREE.Vector3()
        .setFromMatrixPosition(base.pose.hand[0])
        .distanceTo(new THREE.Vector3().setFromMatrixPosition(vg.pose.hand[0])),
    ).toBeLessThan(1e-6);
    base.dispose();
    vg.dispose();
  });
});

describe('FpMixer', () => {
  const lens = { idle: 4, ads: 1, sprint: 0.53, tac: 0.4, reload: 1.9, inspect: 3.6, fire: 0.2, draw: 0.6 };

  it('os pesos da base e do clipe de uma vez sempre somam 1', () => {
    const m = new FpMixer(lens);
    expect(sum(step(m, 0.5))).toBeCloseTo(1);
    m.play('reload', 2500);
    for (const s of [0.05, 0.6, 1.2, 2.4])
      expect(sum(step(m, s === 0.05 ? 0.05 : 0.6, { ads: 0.3, sprint: 0, tac: 0, stride: 0 }))).toBeCloseTo(1);
  });

  it('o clipe de uma vez entra suave, fica inteiro no meio, é esticado para a duração do jogo e acaba', () => {
    const m = new FpMixer(lens);
    m.play('reload', 2500);
    const a = step(m, FADE_IN / 2);
    expect(a.one!.w).toBeGreaterThan(0);
    expect(a.one!.w).toBeLessThan(1);
    const b = step(m, 1.25 - FADE_IN / 2);
    expect(b.one!.w).toBeCloseTo(1);
    // na metade do tempo do jogo, a metade do clipe escrito
    expect(b.one!.t).toBeCloseTo(0.95, 1);
    const c = step(m, 1.25 - FADE_OUT / 2);
    expect(c.one!.w).toBeLessThan(1);
    expect(step(m, 0.2).one).toBeNull();
  });

  it('a corrida segue a fase do passo e a tática ganha da corrida', () => {
    const m = new FpMixer(lens);
    const o = step(m, 0.3, { ads: 0, sprint: 1, tac: 0, stride: Math.PI });
    expect(o.loops.sprint.w).toBeCloseTo(1);
    expect(o.loops.sprint.t).toBeCloseTo(lens.sprint / 2);
    const t = step(m, 0.3, { ads: 0, sprint: 1, tac: 1, stride: 0 });
    expect(t.loops.tac.w).toBeCloseTo(1);
    expect(t.loops.sprint.w).toBeCloseTo(0);
  });

  it('o indicador vai ao gatilho no tiro e volta para a armação depois', () => {
    const m = new FpMixer(lens);
    expect(step(m, 0.2).trigger).toBeCloseTo(0);
    m.fire();
    const a = step(m, 0.1);
    expect(a.trigger).toBeGreaterThan(0.8);
    expect(a.fire).not.toBeNull();
    const b = step(m, TRIGGER_HOLD + 0.6);
    expect(b.trigger).toBeLessThan(0.1);
    expect(b.fire).toBeNull();
  });

  it('atirar corta a inspeção (sai suave) mas não a recarga', () => {
    const m = new FpMixer(lens);
    m.play('inspect', 3600);
    step(m, 0.5);
    m.fire();
    expect(step(m, FADE_OUT + 0.05).one).toBeNull();
    m.play('reload', 1900);
    step(m, 0.3);
    m.fire();
    expect(step(m, 0.3).one?.kind).toBe('reload');
  });
});
