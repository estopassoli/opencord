/**
 * Gunfight: o armeiro. A conta dos acessórios (`applyAttachments`: recuo, pente, recarga, mira, alcance, som e clarão
 * mudam a arma de verdade), o formato curto da rede (`encodeBuild`/`decodeBuild`, ADR-0059), o salvo e a migração do
 * equipamento antigo, as barras e os prós e contras do menu, os acessórios em 3D montados num modelo de mentira (a
 * linha de mira, a boca, a mão de apoio na empunhadura vertical, o carregador preso ao pente, o retículo no centro), o
 * controlador usando a arma montada e as telas do menu (cartões, lista e armeiro, com o teclado).
 */
import { SpaceGunPose } from '@opencord/contracts';
import { fireEvent, render } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('AudioWorkletNode', class {});

// os modelos .glb não carregam no teste: uma arma de mentira (com pente de verdade, para o carregador estendido)
vi.mock('../src/features/space3d/gunfight/models', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/features/space3d/gunfight/models')>();
  const fake = (id: string) => fakeGun(id);
  return { ...real, loadGuns: () => Promise.resolve(), gunsReady: () => true, makeGun: fake };
});

/** uma arma de mentira: caixa do corpo e um pente (grupo) embaixo, com a peça `mag` */
function fakeGun(id: string) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.8), new THREE.MeshStandardMaterial());
  body.position.set(0, 0.05, -0.3);
  root.add(body);
  const mag = new THREE.Group();
  mag.position.set(0, 0, -0.1);
  const magMesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.05), new THREE.MeshStandardMaterial());
  magMesh.position.set(0, -0.05, 0);
  mag.add(magMesh);
  root.add(mag);
  return {
    id,
    root,
    parts: {
      mag: { obj: mag, rest: mag.position.clone(), restQ: mag.quaternion.clone(), toParent: new THREE.Quaternion() },
    },
    muzzle: new THREE.Vector3(0, 0.05, -0.7),
    bore: new THREE.Vector3(0, 0.05, -0.7),
    sight: new THREE.Vector3(0, 0.11, -0.05),
    sightPitch: 0.01,
    support: new THREE.Vector3(0, 0.0, -0.35),
    length: 0.8,
  };
}

const att = await import('../src/features/space3d/gunfight/attachments');
const {
  ATT_CODES,
  applyAttachments,
  attachmentEffects,
  attachmentsFor,
  buildFromKey,
  buildKey,
  decodeBuild,
  encodeBuild,
  gunStats,
  randomBuild,
  validBuild,
} = att;
const { GUNS, damageAt, maxDamage, recoilKick } = await import('../src/features/space3d/gunfight/weapons');
const { aimReticles, makeBuiltGun, mountAttachments } = await import('../src/features/space3d/gunfight/attachmodels');
const { disposeGun, partBox } = await import('../src/features/space3d/gunfight/models');
const { leftGrip } = await import('../src/features/space3d/gunfight/grips');
const { readSaved, useGunHud, validBuilds } = await import('../src/features/space3d/gunfight/state');
const { GunGame } = await import('../src/features/space3d/gunfight/game');
const { gunObstacles } = await import('../src/features/space3d/gunfight/map');
const { GunMatchPanel } = await import('../src/features/space3d/gunfight/GunHud');
type GunHost = import('../src/features/space3d/gunfight/game').GunHost;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  localStorage.clear();
  useGunHud.getState().set({ loadout: { primary: 'm4', secondary: 'm9', melee: 'karambit' }, builds: {} });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('armeiro: a conta dos acessórios', () => {
  it('sem acessório, a própria arma (o mesmo objeto)', () => {
    expect(applyAttachments(GUNS.m4, undefined)).toBe(GUNS.m4);
    expect(applyAttachments(GUNS.m4, {})).toBe(GUNS.m4);
  });

  it('carregador estendido: metade a mais no pente e na reserva, recarga e mira mais lentas', () => {
    const s = applyAttachments(GUNS.m4, { mag: 'ext' });
    expect(s.mag).toBe(45);
    expect(s.reserve).toBe(180);
    expect(s.reloadMs).toBeGreaterThan(GUNS.m4.reloadMs);
    expect(s.emptyReloadMs).toBeGreaterThan(GUNS.m4.emptyReloadMs);
    expect(s.adsMs).toBeGreaterThan(GUNS.m4.adsMs);
    expect(s.move).toBeLessThan(GUNS.m4.move);
    expect(applyAttachments(GUNS.m9, { mag: 'ext' }).mag).toBe(23);
  });

  it('compensador: sobe menos em todo o padrão (e no coice), escapa mais para o lado', () => {
    const s = applyAttachments(GUNS.ak47, { muzzle: 'comp' });
    for (let n = 1; n <= 25; n++) {
      const a = recoilKick(GUNS.ak47, n);
      const b = recoilKick(s, n);
      expect(b.up).toBeCloseTo(a.up * 0.8, 6);
    }
    expect(Math.abs(recoilKick(s, 10).side)).toBeGreaterThan(Math.abs(recoilKick(GUNS.ak47, 10).side));
    expect(s.recoil.vm.rise).toBeCloseTo(GUNS.ak47.recoil.vm.rise * 0.8, 6);
    expect(s.recoil.punch.up).toBeCloseTo(GUNS.ak47.recoil.punch.up * 0.8, 6);
  });

  it('supressor: tiro abafado e sem clarão, menos alcance do dano (o máximo nunca muda)', () => {
    const s = applyAttachments(GUNS.m4, { muzzle: 'sup' });
    expect(s.quiet).toBe(true);
    expect(s.noFlash).toBe(true);
    expect(s.range[0]).toBeCloseTo(GUNS.m4.range[0] * 0.85, 6);
    expect(damageAt(s, 30, false)).toBeLessThan(damageAt(GUNS.m4, 30, false));
    expect(damageAt(s, 5, false)).toBe(damageAt(GUNS.m4, 5, false));
    expect(maxDamage(s)).toBe(maxDamage(GUNS.m4));
  });

  it('quebra-chamas esconde o clarão sem abafar o som', () => {
    const s = applyAttachments(GUNS.mp7, { muzzle: 'flash' });
    expect(s.noFlash).toBe(true);
    expect(s.quiet).toBeUndefined();
  });

  it('miras: a luneta 3x vira luneta (prisma), o ponto vermelho só muda o zoom; a variável da sniper mira mais rápido', () => {
    const s3 = applyAttachments(GUNS.m4, { optic: 'scope3' });
    expect(s3.scope).toBe(true);
    expect(s3.zoom).toBe(3);
    expect(s3.scopeStyle).toBe('prism');
    expect(s3.spread.ads).toBeLessThan(GUNS.m4.spread.ads);
    const rd = applyAttachments(GUNS.m4, { optic: 'reddot' });
    expect(rd.scope).toBe(false);
    expect(rd.zoom).toBeGreaterThan(GUNS.m4.zoom);
    const lp = applyAttachments(GUNS.l115, { optic: 'lpvo' });
    expect(lp.scope).toBe(true);
    expect(lp.zoom).toBeLessThan(GUNS.l115.zoom);
    expect(lp.adsMs).toBeLessThan(GUNS.l115.adsMs);
    expect(applyAttachments(GUNS.kar98k, { optic: 'kscope' }).scopeStyle).toBe('post');
  });

  it('empunhaduras: a vertical segura o recuo e mira devagar; a angulada mira mais rápido', () => {
    const v = applyAttachments(GUNS.m4, { under: 'vgrip' });
    expect(recoilKick(v, 8).up).toBeLessThan(recoilKick(GUNS.m4, 8).up);
    expect(v.adsMs).toBeGreaterThan(GUNS.m4.adsMs);
    const a = applyAttachments(GUNS.m4, { under: 'agrip' });
    expect(a.adsMs).toBeLessThan(GUNS.m4.adsMs);
  });

  it('acessórios juntos se combinam e o que não cabe na arma é ignorado', () => {
    const all = applyAttachments(GUNS.m4, { optic: 'reddot', muzzle: 'comp', under: 'vgrip', mag: 'ext' });
    expect(recoilKick(all, 3).up).toBeCloseTo(recoilKick(GUNS.m4, 3).up * 0.8 * 0.85, 6);
    expect(all.adsMs).toBe(Math.round(GUNS.m4.adsMs * 1.05 * 1.02 * 1.08 * 1.06));
    // pistola não tem empunhadura; a Desert Eagle não tem supressor; faca não tem nada
    expect(applyAttachments(GUNS.m9, { under: 'vgrip' })).toBe(GUNS.m9);
    expect(applyAttachments(GUNS.deagle, { muzzle: 'sup' })).toBe(GUNS.deagle);
    expect(attachmentsFor('karambit', 'optic')).toEqual([]);
    expect(validBuild('m4', { optic: 'lpvo', muzzle: 'sup', mag: 'bazuca' })).toEqual({ muzzle: 'sup' });
  });
});

describe('armeiro: rede e salvo', () => {
  it('a montagem vai na pose como até 4 números (sem os zeros do fim) e volta igual', () => {
    expect(encodeBuild(undefined)).toBeUndefined();
    expect(encodeBuild({})).toBeUndefined();
    expect(encodeBuild({ optic: 'reddot' })).toEqual([1]);
    expect(encodeBuild({ muzzle: 'sup', mag: 'ext' })).toEqual([0, 1, 0, 1]);
    const b = { optic: 'holo', muzzle: 'comp', under: 'agrip', mag: 'ext' } as const;
    expect(decodeBuild('m4', encodeBuild(b))).toEqual(b);
    // a pose valida no contrato (o servidor repassa)
    expect(
      SpaceGunPose.safeParse({ w: 'm4', pitch: 0, crouch: false, ads: false, alive: true, att: encodeBuild(b) })
        .success,
    ).toBe(true);
  });

  it('código desconhecido (app mais novo) ou que não cabe na arma vira o padrão', () => {
    expect(decodeBuild('m4', [15, 9, 0, 1])).toEqual({ mag: 'ext' });
    // ponto de pistola (4) num fuzil não existe
    expect(decodeBuild('m4', [4])).toEqual({});
    expect(decodeBuild('m9', [4])).toEqual({ optic: 'pdot' });
    // a ordem do catálogo é a da rede: não muda
    expect(ATT_CODES.optic.slice(0, 3)).toEqual(['reddot', 'holo', 'scope3']);
  });

  it('a chave da montagem volta para a montagem', () => {
    const b = { optic: 'scope3', mag: 'ext' } as const;
    expect(buildFromKey(buildKey(b))).toEqual(b);
    expect(buildKey({})).toBe('');
    expect(buildFromKey('')).toEqual({});
  });

  it('o equipamento antigo (só as armas) passa para o novo; o estragado vira o padrão', () => {
    const store: Record<string, string> = {
      'opencord.space3d.loadout': JSON.stringify({ primary: 'ak47', secondary: 'deagle', melee: 'bayonet' }),
    };
    const s = readSaved((k) => store[k] ?? null);
    expect(s.loadout).toEqual({ primary: 'ak47', secondary: 'deagle', melee: 'bayonet' });
    expect(s.builds).toEqual({});
    const v2 = {
      'opencord.space3d.loadout.v2': JSON.stringify({
        v: 2,
        loadout: { primary: 'mp7', secondary: 'm9', melee: 'karambit' },
        builds: { mp7: { optic: 'holo', under: 'nada' }, m9: { under: 'vgrip' }, bazuca: { optic: 'reddot' } },
      }),
    };
    const s2 = readSaved((k) => v2[k as keyof typeof v2] ?? null);
    expect(s2.loadout.primary).toBe('mp7');
    expect(s2.builds).toEqual({ mp7: { optic: 'holo' } });
    expect(readSaved((k) => (k.endsWith('v2') ? '{lixo' : null)).loadout).toEqual({
      primary: 'm4',
      secondary: 'm9',
      melee: 'karambit',
    });
    expect(validBuilds('lixo')).toEqual({});
  });
});

describe('armeiro: barras e textos do menu', () => {
  it('as barras ficam entre 0 e 100 e mexem com os acessórios', () => {
    for (const id of Object.keys(GUNS) as (keyof typeof GUNS)[]) {
      for (const v of Object.values(gunStats(GUNS[id]))) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
    const base = gunStats(GUNS.m4);
    expect(gunStats(applyAttachments(GUNS.m4, { muzzle: 'comp' })).control).toBeGreaterThan(base.control!);
    expect(gunStats(applyAttachments(GUNS.m4, { mag: 'ext' })).handling).toBeLessThan(base.handling!);
    expect(gunStats(applyAttachments(GUNS.m4, { muzzle: 'sup' })).range).toBeLessThan(base.range!);
    // sniper bate mais que fuzil; submetralhadora atira mais rápido; faca sem controle de recuo
    expect(gunStats(GUNS.l115).damage).toBeGreaterThan(base.damage!);
    expect(gunStats(GUNS.mp7).rate).toBeGreaterThan(base.rate!);
    expect(gunStats(GUNS.karambit).control).toBeUndefined();
  });

  it('prós e contras com o sinal: o pente diz de quanto para quanto', () => {
    const fx = attachmentEffects('ext', GUNS.m4);
    expect(fx.find((f) => f.good === true)?.text).toBe('Pente de 30 para 45 balas');
    expect(fx.some((f) => f.good === false)).toBe(true);
    const sup = attachmentEffects('sup', GUNS.m4).map((f) => f.text);
    expect(sup).toContain('Sem clarão na boca');
    expect(attachmentEffects('scope3', GUNS.m4)[0]).toEqual({ text: 'Zoom 3x com luneta', good: null });
  });

  it('a montagem do bot sai sorteada, válida e repetível', () => {
    const rng = (seed: number) => {
      let x = seed;
      return () => {
        x = (x * 48271) % 2147483647;
        return x / 2147483647;
      };
    };
    for (let i = 1; i < 40; i++) {
      const b = randomBuild('ak47', rng(i));
      expect(validBuild('ak47', b)).toEqual(b);
    }
    expect(randomBuild('m4', rng(7))).toEqual(randomBuild('m4', rng(7)));
    expect(randomBuild('karambit', rng(3))).toEqual({});
  });
});

describe('armeiro: acessórios no modelo 3D', () => {
  it('mira: a linha de mira sobe para a da mira, sem a inclinação da mira de ferro, e ganha o vidro com retículo', () => {
    const g = makeBuiltGun('m4', { optic: 'reddot' })!;
    expect(g.sight.y).toBeGreaterThan(0.14);
    expect(g.sightPitch).toBeUndefined();
    expect(g.reticles).toHaveLength(1);
    expect(g.buildKey).toBe('reddot...');
    // a luneta 3x não tem vidro de ponto (a tela de luneta desenha o retículo)
    expect(makeBuiltGun('m4', { optic: 'scope3' })!.reticles).toBeUndefined();
  });

  it('boca: a saída do tiro vai para a ponta da peça nova', () => {
    const g = makeBuiltGun('m4', { muzzle: 'sup' })!;
    expect(g.muzzle.z).toBeLessThan(-0.7 + 0.035 - 0.1);
    expect(g.muzzle.y).toBeCloseTo(0.05, 6);
  });

  it('empunhadura vertical: a mão de apoio fecha nela (embaixo do guarda-mão), não no guarda-mão', () => {
    const plain = makeBuiltGun('m4')!;
    const g = makeBuiltGun('m4', { under: 'vgrip' })!;
    expect(g.foregrip?.kind).toBe('vertical');
    const a = leftGrip(plain, 'ar');
    const b = leftGrip(g, 'ar');
    expect(b.pos.y).toBeLessThan(a.pos.y - 0.02);
    expect(b.quat.angleTo(a.quat)).toBeGreaterThan(0.5);
    // a angulada fica à frente da mão: o mesmo "C", só 3 cm para trás (o lado do indicador encosta na rampa)
    const c = leftGrip(makeBuiltGun('m4', { under: 'agrip' })!, 'ar');
    expect(c.pos.x).toBeCloseTo(a.pos.x, 6);
    expect(c.pos.y).toBeCloseTo(a.pos.y, 6);
    expect(c.pos.z - a.pos.z).toBeCloseTo(0.03, 6);
    expect(c.quat.angleTo(a.quat)).toBeLessThan(1e-6);
  });

  it('carregador estendido: preso ao pente (sai junto na recarga) e conta na caixa dele', () => {
    const plain = makeBuiltGun('m4')!;
    const g = makeBuiltGun('m4', { mag: 'ext' })!;
    expect(g.magExt).toBeGreaterThan(0.03);
    const mag = g.parts.mag!;
    expect(mag.obj.children.length).toBe(2);
    const b0 = partBox(plain, plain.parts.mag!)!;
    const b1 = partBox(g, mag)!;
    expect(b1.min.y).toBeLessThan(b0.min.y - 0.03);
  });

  it('liberar a arma libera a geometria e os materiais dos acessórios', () => {
    const g = makeBuiltGun('m4', { optic: 'holo', muzzle: 'comp', under: 'vgrip', mag: 'ext' })!;
    const geos: THREE.BufferGeometry[] = [];
    g.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.att) geos.push(o.geometry);
    });
    expect(geos.length).toBeGreaterThan(4);
    const spies = geos.map((x) => vi.spyOn(x, 'dispose'));
    disposeGun(g);
    for (const s of spies) expect(s).toHaveBeenCalled();
  });

  it('o retículo fica onde a linha do centro da câmera cruza o vidro (centro da tela)', () => {
    const g = makeBuiltGun('m4', { optic: 'reddot' })!;
    const scene = new THREE.Scene();
    scene.add(g.root);
    // a arma 1 cm à direita e 2 cm abaixo da linha do olho: o ponto vai 1 cm para a esquerda e 2 para cima no vidro
    const lens = g.reticles![0]!.mesh;
    lens.updateWorldMatrix(true, false);
    const at = lens.getWorldPosition(new THREE.Vector3());
    g.root.position.set(0.01 - at.x, -0.02 - at.y, -0.3 - at.z);
    const cam = new THREE.PerspectiveCamera();
    aimReticles(g, cam);
    const u = g.reticles![0]!.uniforms;
    expect(u.uDot.value.x).toBeCloseTo(-0.01, 4);
    expect(u.uDot.value.y).toBeCloseTo(0.02, 4);
    expect(u.uDist.value).toBeCloseTo(0.3, 4);
  });

  it('montar duas vezes a mesma arma dá modelos independentes (cada um com os seus acessórios)', () => {
    const a = makeBuiltGun('mp7', { optic: 'holo' })!;
    const b = makeBuiltGun('mp7')!;
    mountAttachments(b, { muzzle: 'flash' });
    expect(a.reticles).toHaveLength(1);
    expect(b.reticles).toBeUndefined();
    expect(b.buildKey).toBe('.flash..');
  });
});

describe('armeiro: som do supressor', () => {
  it('o tiro abafado é a gravação da arma com passa-baixa, mais baixa e sem o estampido de longe', async () => {
    const { sfxFor, SUPPRESSED_HZ } = await import('../src/features/space3d/sfxmap');
    const ctx = { me: 'me', team: 'a' as const };
    const loud = sfxFor({ kind: 'gunshot', by: 'bob', w: 'm4', power: 1, zone: 8, at: { x: 0, y: 0, z: 0 } }, ctx)[0]!;
    const quiet = sfxFor(
      { kind: 'gunshot', by: 'bob', w: 'm4', quiet: true, power: 1, zone: 8, at: { x: 0, y: 0, z: 0 } },
      ctx,
    )[0]!;
    expect(quiet.sample).toBe('m4');
    expect(quiet.muffle).toBe(SUPPRESSED_HZ);
    expect(quiet.far).toBeUndefined();
    expect(quiet.gain).toBeLessThan(loud.gain);
    expect(loud.far).toBe('shotFar');
  });
});

describe('armeiro: o jogo usa a arma montada', () => {
  function host(): GunHost {
    return {
      selfId: 'me',
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(70, 1, 0.05, 200),
      obstacles: gunObstacles(),
      yaw: () => 0,
      pitch: () => 0,
      turn: () => undefined,
      wish: () => ({ f: 0, r: 0 }),
      held: () => false,
      players: () => [],
      nameOf: (id) => id,
      send: () => undefined,
      emit: () => undefined,
      place: () => undefined,
      spawnAvatar: () => ({ root: new THREE.Group(), place: () => undefined, dispose: () => undefined }),
    };
  }

  it('pente, pose com os acessórios e o tiro abafado; trocar no menu sozinho vale na hora', async () => {
    useGunHud.getState().set({ builds: { m4: { muzzle: 'sup', mag: 'ext' } } });
    const events: { kind: string; quiet?: boolean }[] = [];
    const h = { ...host(), emit: (e: { kind: string }) => void events.push(e) } as GunHost;
    const g = new GunGame(h);
    await Promise.resolve();
    await Promise.resolve();
    expect(g.spec.mag).toBe(45);
    expect(g.pose().att).toEqual([0, 1, 0, 1]);
    Reflect.set(g, 'protUntil', 0);
    // o relógio do jogo é o performance.now (na suíte inteira ele já passou de muitos segundos)
    const t0 = performance.now() + 5000;
    g.press('fire', t0);
    expect(events.find((e) => e.kind === 'gunshot')?.quiet).toBe(true);
    // sozinho na arena: a montagem nova vale no próximo quadro
    useGunHud.getState().set({ builds: { m4: { optic: 'holo' } } });
    g.step(0.016, t0 + 1000);
    expect(g.spec.mag).toBe(30);
    expect(g.pose().att).toEqual([2]);
    g.dispose();
  });
});

describe('armeiro: o menu', () => {
  const panel = () => (
    <GunMatchPanel others={0} onBots={() => undefined} onRestart={() => undefined} onView={() => undefined} />
  );

  it('cartões das três armas com os acessórios; personalizar, escolher e Esc volta', () => {
    useGunHud.getState().set({ builds: { m4: { optic: 'reddot' } } });
    const { container, getByRole, getByText } = render(panel());
    expect(container.querySelectorAll('.gf-card')).toHaveLength(3);
    expect(getByText('Ponto vermelho')).toBeTruthy();
    // faca não tem armeiro
    expect(container.querySelectorAll('.gf-card-smith')).toHaveLength(2);
    fireEvent.click(getByRole('button', { name: 'Personalizar M4' }));
    expect(container.querySelector('h2')?.textContent).toBe('M4');
    // a aba da boca e o supressor
    fireEvent.click(getByRole('tab', { name: /Boca/ }));
    fireEvent.click(getByRole('button', { name: /^Supressor/ }));
    expect(useGunHud.getState().builds.m4).toEqual({ optic: 'reddot', muzzle: 'sup' });
    const saved = JSON.parse(localStorage.getItem('opencord.space3d.loadout.v2') ?? '{}') as {
      builds?: Record<string, unknown>;
    };
    expect(saved.builds?.m4).toEqual({ optic: 'reddot', muzzle: 'sup' });
    // o escolhido fica marcado (e o leitor de tela lê pró e contra)
    const sup = getByRole('button', { name: /^Supressor/ });
    expect(sup.getAttribute('aria-pressed')).toBe('true');
    expect(sup.textContent).toContain('Pró: ');
    // Esc volta para a lista e de novo para os cartões (sem fechar o menu)
    fireEvent.keyDown(sup, { key: 'Escape' });
    expect(container.querySelector('h2')?.textContent).toBe('Principal');
    fireEvent.keyDown(container.querySelector('.gf-row')!, { key: 'Escape' });
    expect(container.querySelectorAll('.gf-card')).toHaveLength(3);
  });

  it('trocar de arma pela lista equipa e abre o armeiro; "de fábrica" tira tudo', () => {
    const { container, getByRole } = render(panel());
    fireEvent.click(getByRole('button', { name: /^Principal: M4/ }));
    fireEvent.click(getByRole('button', { name: /^AK-47/ }));
    expect(useGunHud.getState().loadout.primary).toBe('ak47');
    expect(container.querySelector('h2')?.textContent).toBe('AK-47');
    fireEvent.click(getByRole('button', { name: /^Reflexa mini/ }));
    expect(useGunHud.getState().builds.ak47).toEqual({ optic: 'holo' });
    fireEvent.click(getByRole('button', { name: /De fábrica/ }));
    expect(useGunHud.getState().builds.ak47).toBeUndefined();
  });

  it('setas andam entre as opções; a barra mostra a diferença da opção em foco com o sinal', () => {
    const { container, getByRole } = render(panel());
    fireEvent.click(getByRole('button', { name: 'Personalizar M4' }));
    fireEvent.click(getByRole('tab', { name: /Carregador/ }));
    const opts = [...container.querySelectorAll<HTMLButtonElement>('.gf-opt')];
    opts[0]!.focus();
    fireEvent.keyDown(opts[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(opts[1]);
    fireEvent.focus(opts[1]!);
    const handling = getByRole('meter', { name: 'Velocidade de mira' });
    expect(handling.getAttribute('aria-valuetext')).toMatch(/menos \d+/);
    expect(container.querySelector('.gf-stat-val em[data-dir="down"]')?.textContent).toMatch(/^−\d+$/);
  });
});
