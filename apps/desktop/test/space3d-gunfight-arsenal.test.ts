/**
 * Armas novas do gunfight (adendo do ADR-0058): cada uma tem lugar no menu, números coerentes com a classe, encaixes
 * do armeiro, som e recarga; o revólver recarrega pelo tambor.
 */
import { GUN_IDS, type GunId } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import { attachmentsFor, defaultLabel, slotsFor } from '../src/features/space3d/gunfight/attachments';
import { cylinderPose, MAG_OUT_AT, MAG_SEAT_AT } from '../src/features/space3d/gunfight/reload';
import { GUNS, SLOT_GUNS, shotsToKill } from '../src/features/space3d/gunfight/weapons';
import { GUN_CLASS } from '../src/features/space3d/sfxmap';

const NEW: GunId[] = [
  'rs9',
  'msmc',
  'mcx',
  'scarl',
  'mpx',
  'automag3',
  'aks74u',
  'pdw',
  'sv98',
  'ballista',
  'bfr',
  'stg44',
  'rhino',
];

describe('gunfight: armas novas', () => {
  it('todas estão no contrato, no menu do espaço certo e com som de manuseio', () => {
    for (const id of NEW) {
      expect(GUN_IDS).toContain(id);
      const spec = GUNS[id];
      expect(SLOT_GUNS[spec.slot]).toContain(id);
      expect(GUN_CLASS[id]).toBeTruthy();
      expect(spec.mag).toBeGreaterThan(0);
      expect(spec.reserve).toBeGreaterThanOrEqual(spec.mag * 3);
    }
    // ninguém some do menu e ninguém aparece duas vezes
    const all = [...SLOT_GUNS.primary, ...SLOT_GUNS.secondary, ...SLOT_GUNS.melee];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(GUN_IDS.length);
  });

  it('as snipers de ferrolho derrubam com um tiro no peito de perto; a SV-98 não de longe', () => {
    for (const id of ['rs9', 'ballista', 'sv98'] as const) {
      expect(GUNS[id].boltMs).toBeGreaterThan(0);
      expect(shotsToKill(GUNS[id], 30)).toBe(1);
    }
    expect(shotsToKill(GUNS.sv98, 120)).toBe(2);
    expect(shotsToKill(GUNS.rs9, 120)).toBe(1);
  });

  it('submetralhadoras matam mais rápido de perto que os fuzis novos, e perdem de longe', () => {
    const ttk = (id: GunId, d: number) => ((shotsToKill(GUNS[id], d) - 1) * 60000) / GUNS[id].rpm;
    for (const smg of ['mpx', 'msmc', 'pdw'] as const) {
      expect(ttk(smg, 5)).toBeLessThan(ttk('scarl', 5));
      expect(shotsToKill(GUNS[smg], 40)).toBeGreaterThan(shotsToKill(GUNS.scarl, 40));
    }
  });

  it('revólveres: sem supressor nem carregador; MSMC e MCX trazem mira e empunhadura de fábrica', () => {
    for (const id of ['rhino', 'bfr'] as const) {
      expect(GUNS[id].revolver).toBe(true);
      expect(attachmentsFor(id, 'muzzle')).not.toContain('sup');
      expect(slotsFor(id)).not.toContain('mag');
    }
    expect(defaultLabel('mcx', 'optic')).toBe('Ponto vermelho de fábrica');
    expect(defaultLabel('msmc', 'under')).toBe('Empunhadura de fábrica');
    expect(defaultLabel('scarl', 'optic')).toBe('Mira de ferro');
    expect(defaultLabel('rs9', 'optic')).toBe('Luneta de precisão');
  });

  it('recarga do revólver: o tambor abre, a mão vai ao cinto e volta, empurra os cartuchos e o tambor fecha', () => {
    expect(cylinderPose(0).out).toBe(0);
    expect(cylinderPose(MAG_OUT_AT + 0.05).out).toBeCloseTo(1, 2);
    expect(cylinderPose(0.44).pouch).toBeGreaterThan(0.9);
    expect(cylinderPose(MAG_SEAT_AT).palm).toBeGreaterThan(0.9);
    expect(cylinderPose(MAG_SEAT_AT).out).toBeCloseTo(1, 2);
    expect(cylinderPose(1).out).toBe(0);
    expect(cylinderPose(1).hold).toBe(0);
  });
});
