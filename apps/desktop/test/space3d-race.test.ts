import { describe, expect, it } from 'vitest';
import { nearest, startGrid, stepBike, TRACK, TRACK_W, fireBoost, type Bike } from '../src/features/space3d/race';

/** piloto automático: mira um ponto alguns metros à frente na pista */
function drive(b: Bike, secs: number, reverse = false) {
  const laps: number[] = [];
  let boosts = 0;
  let now = 0;
  for (let t = 0; t < secs; t += 1 / 60) {
    now += 1000 / 60;
    const n = TRACK.pts.length;
    const ahead = TRACK.pts[(b.idx + (reverse ? -6 : 8) + n) % n]!;
    let want = Math.atan2(ahead.x - b.x, ahead.z - b.z) - b.h;
    want = Math.atan2(Math.sin(want), Math.cos(want));
    for (const e of stepBike(b, { up: true, down: false, left: want > 0.05, right: want < -0.05 }, 1 / 60, now, true)) {
      if (e.kind === 'lap') laps.push(e.lap);
      if (e.kind === 'boost') boosts++;
    }
  }
  return { laps, boosts };
}

describe('Espaço 3D: corrida de moto', () => {
  it('largada no grid, na pista e parada antes do sinal', () => {
    const b = startGrid(1);
    expect(nearest(TRACK, b.x, b.z).d).toBeLessThan(TRACK_W / 2);
    stepBike(b, { up: true, down: false, left: false, right: false }, 0.5, 0, false);
    expect(b.v).toBe(0);
  });

  it('seguindo a pista completa voltas e passa pelos turbos', () => {
    const b = startGrid(0);
    const { laps, boosts } = drive(b, 70);
    expect(laps.slice(0, 3)).toEqual([1, 2, 3]);
    expect(boosts).toBeGreaterThan(0);
  });

  it('andar ao contrário não conta volta', () => {
    const b = startGrid(0);
    expect(drive(b, 30, true).laps).toEqual([]);
  });

  it('item guardado vira turbo com F', () => {
    const b = startGrid(0);
    expect(fireBoost(b, 0)).toBe(false);
    b.item = true;
    expect(fireBoost(b, 1000)).toBe(true);
    expect(b.boostUntil).toBe(3000);
  });
});
