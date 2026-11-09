import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameBus, type GameEvent } from '../src/features/space3d/events';
import { HITSTOP, HitStop, Juice, Shake } from '../src/features/space3d/juice';

const at = { x: 0, y: 1, z: 0 };
const hit = (power: number, zone = 3): GameEvent => ({ kind: 'hit', by: 'eu', with: 'racket', power, zone, at });
const goal: GameEvent = { kind: 'score', side: 'a', points: 1, by: 'eu', reason: 'gol', power: 1, zone: 2, at };

function juice(motion: number, zone: number) {
  const scene = new THREE.Scene();
  const j = new Juice(scene, { motion, labels: false });
  j.setZone(zone);
  return { j, scene };
}

describe('Espaço 3D: sensação de impacto (juice, P5)', () => {
  it('a pausa de impacto vai de 40 a 90 ms pela força, com teto e no máximo uma a cada 150 ms', () => {
    const h = new HitStop();
    expect(h.trigger(0, 0)).toBe(HITSTOP.min);
    expect(h.trigger(100, 1)).toBe(0); // 100 ms depois da anterior: recusada
    expect(h.trigger(150, 1)).toBe(HITSTOP.max);
    expect(h.trigger(400, 7)).toBeLessThanOrEqual(HITSTOP.max); // força fora da faixa não passa do teto
    expect(h.scale(410)).toBe(0);
    expect(h.scale(400 + HITSTOP.max + 1)).toBe(1);
    // com "reduzir movimento", pela metade
    const r = new HitStop();
    expect(r.trigger(0, 1, 0)).toBe(HITSTOP.max / 2);
  });

  it('com motionScale = 0 o tremor é zero, mesmo no gol e no golpe forte', () => {
    const s = new Shake();
    s.kick(0.1, 0);
    s.step(0.016);
    expect(s.amplitude).toBe(0);
    expect(s.offset({ x: 1, y: 1, z: 1 })).toEqual({ x: 0, y: 0, z: 0 });

    const { j } = juice(0, 2);
    j.onEvent(goal, 0);
    j.onEvent({ kind: 'kick', by: 'eu', power: 1, zone: 2, at }, 200);
    j.update(0.016, 216);
    expect(j.shake.amplitude).toBe(0);
    const off = j.shakeOffset(new THREE.Vector3(5, 5, 5));
    expect(off.length()).toBe(0);

    // com movimento normal, o gol treme e o tremor some sozinho
    const { j: on } = juice(1, 2);
    on.onEvent(goal, 0);
    expect(on.shake.amplitude).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) on.update(1 / 60, i * 16);
    expect(on.shake.amplitude).toBe(0);
  });

  it('tremor só em golpe forte e no ponto; rebatida comum não treme', () => {
    const { j } = juice(1, 3);
    j.onEvent(hit(0.5), 0);
    expect(j.shake.amplitude).toBe(0);
    j.onEvent(hit(1), 500);
    expect(j.shake.amplitude).toBeGreaterThan(0);
  });

  it('o golpe pausa o jogo e respeita o intervalo; o barramento liga o juice', () => {
    const bus = new GameBus();
    const { j } = juice(1, 3);
    const off = j.attach(bus);
    const now = performance.now();
    bus.emit(hit(1));
    expect(j.timeScale(now + 1)).toBe(0);
    expect(j.timeScale(now + HITSTOP.max + 50)).toBe(1);
    off();
  });

  it('evento de outra zona não faz nada', () => {
    const { j } = juice(1, 1);
    j.onEvent(hit(1, 3), 0);
    j.onEvent(goal, 0);
    expect(j.particles.alive).toBe(0);
    expect(j.timeScale(1)).toBe(1);
  });

  it('pool fixo: rajada enorme não passa do limite, e o quadro não cria objetos novos', () => {
    const { j, scene } = juice(1, 2);
    const children = scene.children.length;
    const geo = j.particles.points.geometry;
    const arr = geo.getAttribute('position').array;
    for (let i = 0; i < 40; i++) j.onEvent({ ...goal, at: { x: i, y: 1, z: 0 } }, i * 200);
    expect(j.particles.alive).toBeLessThanOrEqual(256);
    expect(j.particles.alive).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) j.update(1 / 60, 10_000 + i * 16);
    expect(scene.children.length).toBe(children);
    expect(j.particles.points.geometry).toBe(geo);
    expect(geo.getAttribute('position').array).toBe(arr);
    // tudo apagou sozinho
    expect(j.particles.alive).toBe(0);
  });

  it('com reduzir movimento, metade das partículas', () => {
    const full = juice(1, 2).j;
    const half = juice(0, 2).j;
    full.onEvent(goal, 0);
    half.onEvent(goal, 0);
    expect(half.particles.alive).toBeLessThan(full.particles.alive);
    expect(half.particles.alive).toBeGreaterThanOrEqual(Math.floor(full.particles.alive / 2));
  });

  it('o que foi atingido acende e volta à cor de antes', () => {
    const { j } = juice(1, 3);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshLambertMaterial({ color: 0xffff00 }));
    j.setBall(ball);
    j.onEvent(hit(0.8), 0);
    j.update(0.016, 10);
    const mat = ball.material;
    expect(mat.emissive.r).toBeGreaterThan(0.3);
    j.update(0.016, 500);
    expect(mat.emissive.getHex()).toBe(0x000000);
  });

  it('no gol, a rede do gol estufa e volta ao lugar', () => {
    const { j } = juice(1, 2);
    const decor = new THREE.Group();
    const net = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    net.name = 'net:1';
    net.position.set(20.7, 1.1, 0);
    decor.add(net);
    j.setDecor(decor);
    j.onEvent(goal, 0);
    let moved = 0;
    for (let i = 1; i < 10; i++) {
      j.update(1 / 60, i * 16);
      moved = Math.max(moved, Math.abs(net.scale.x - 1));
    }
    expect(moved).toBeGreaterThan(0.01);
    for (let i = 0; i < 120; i++) j.update(1 / 60, 200 + i * 16);
    expect(net.scale.x).toBe(1);
    expect(net.position.x).toBe(20.7);
  });
});
