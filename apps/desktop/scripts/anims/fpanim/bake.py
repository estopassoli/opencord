"""Monta tudo: arma, esqueleto, pegadas, clipes; assa quadro a quadro, mede a folga e exporta."""
import itertools
import json
import os

import bpy
from mathutils import Matrix, Quaternion, Vector

from . import holds_mp7
from .fit import fit_hold
from .gun import load_mp7, mount
from .hands import Hands, gaps
from .rig import Rig

GLB = 'apps/desktop/src/features/space3d/assets/guns/mp7.glb'
ARMS = 'apps/desktop/src/features/space3d/assets/arms.glb'
RIGTS = 'apps/desktop/src/features/space3d/gunfight/armsrig.ts'

# montagens que mudam pegada: a de fábrica (empunhadura dobrável), as do armeiro e o pente estendido
VARIANTS = {'base': {}, 'vgrip': {'under': 'vgrip'}, 'agrip': {'under': 'agrip'}, 'ext': {'mag': 'ext'}}


def scene_gun(repo, build, name):
    col = bpy.data.collections.new('gun_' + name)
    bpy.context.scene.collection.children.link(col)
    g = load_mp7(os.path.join(repo, GLB), col)
    mount(g, build)
    g.finish(col)
    for p in g.parts.values():
        p['obj'].name = name + '_' + p['obj'].name
    return g, col


def fit_trigger(hands, gun, pose):
    """o indicador da direita na lâmina do gatilho (a pegada da direita já posta, espaço da arma)"""
    I = Matrix()
    lo, hi = gun.box('trigger')
    target = Vector(((lo.x + hi.x) / 2, lo.y + 0.45 * (hi.y - lo.y), lo.z - 0.002))
    best = (1e9, None)
    grid = [[0.0, 0.25, 0.5, 0.75, 1.0], [0.4, 0.8, 1.2, 1.6, 1.9], [0.0, 0.3, 0.6, 0.9], [-0.35, -0.15, 0.05, 0.25]]
    p = {k: [list(v) for v in vv] if k == 'thumb' else list(vv) for k, vv in pose.items()}

    def cost(a, b, c, s):
        p['index'] = [0, a, b, c, s]
        hands.fingers(1, p)
        pen = 0.0
        for part, k, pt, r in hands.probes(1, ['index']):
            d, _ = gun.nearest(pt, None, ())
            pen += max(0.0, -(d - r) - 0.0005) ** 2
        tip = hands.rig.world('index3_r') @ Vector((0, 0.012, 0))
        return pen * 1e7 + (tip - target).length * 100

    for a, b, c, s in itertools.product(*grid):
        v = cost(a, b, c, s)
        if v < best[0]:
            best = (v, [a, b, c, s])
    cur = best[1]
    cc = best[0]
    st = [0.12, 0.2, 0.15, 0.1]
    for _ in range(50):
        moved = False
        for i in range(4):
            for sg in (1, -1):
                q = list(cur)
                q[i] += sg * st[i]
                v = cost(*q)
                if v < cc:
                    cur, cc, moved = q, v, True
                    break
        if not moved:
            st = [x * 0.5 for x in st]
            if st[0] < 0.004:
                break
    cost(*cur)
    return [0] + cur, cc


def fit_grip(hands, g, spec, seed=3):
    import random
    from .grip import GripProblem
    from .space import trs
    from .bake import S0
    rnd = random.Random(seed)
    q, pos = spec['base']
    base = trs(pos, q)
    gp = GripProblem(hands, spec['side'], g, S0, spec['pre'], spec['wrap'], spec['targets'], thumb=spec['thumb'],
                     index_pose=spec['index'], weights=spec['weights'], wrap_lim=spec.get('lim'))
    rr = spec.get('rot', 0.3)
    starts = [[0] * 6] + [[rnd.uniform(-0.012, 0.012) for _ in range(3)] + [rnd.uniform(-rr, rr) for _ in range(3)]
                          for _ in range(spec.get('starts', 7))]
    A, (sc, pose, terms) = gp.solve(base, starts, log=lambda *a: print(*a, flush=True))
    return {'score': sc, 'A': [list(r) for r in A], 'pose': pose, 'info': {k: round(v, 3) for k, v in terms.items()}}


def fit_all(repo, out, only=()):
    rig = Rig(os.path.join(repo, ARMS))
    hands = Hands(rig, os.path.join(repo, RIGTS))
    rig.begin()
    res = json.load(open(out)) if only and os.path.exists(out) else {}
    for vname, build in VARIANTS.items():
        if only and vname not in only and not any(o.startswith(vname + ':') for o in only):
            continue
        g, col = scene_gun(repo, build, vname)
        sp = holds_mp7.specs(g)
        gs = holds_mp7.grip_specs(g)
        want = ['R', 'L_support', 'L_mag', 'L_charge'] if vname == 'base' else (
            ['L_support'] if vname in ('vgrip', 'agrip') else ['L_mag'])
        for name in want:
            if only and vname not in only and (vname + ':' + name) not in only:
                continue
            if name in gs:
                r = fit_grip(hands, g, gs[name])
            else:
                s = sp[name]
                r = fit_hold(hands, s['side'], g, s, n=s.get('n', 240), seed=7)
            res[vname + ':' + name] = r
            print('HOLD', vname, name, round(r['score'], 3), r['info'], flush=True)
            if name == 'R':
                hands.place(1, Matrix(r['A']))
                idx, c = fit_trigger(hands, g, r['pose'])
                res['base:R_trigger'] = {'index': idx, 'score': c}
                print('TRIGGER', idx, c, flush=True)
        if vname == 'base':
            res[vname + ':slap'] = {'A': [list(x) for x in holds_mp7.slap_anchor(g)]}
        json.dump(res, open(out, 'w'), indent=1)
    print('holds ok', out)


# ====================================================================== animação

from .armik import FORE, ArmSolver, solve_elbow  # noqa: E402
from .grip import forearm_dir  # noqa: E402
from .motion import Curve, EASE, lerp_pose, mat_lerp, spring_track  # noqa: E402
from .space import qyxz, trs  # noqa: E402

FPS = 30
# a pose de quadril (espaço da câmera): a mesma do jogo para esta arma (o `S0` do `fpclips-mp7.ts`)
HIP = ((0.1, -0.1, -0.33), (0.0, 0.07, -0.06))


def weapon_mat(pos, rot):
    return trs(pos, qyxz(*rot))


S0 = weapon_mat(*HIP)
PASS_OUT = (-0.05, -0.06, 0.03)
POUCH = trs((-0.3, -0.5, -0.22), Quaternion((1, 0, 0), 0.6) @ Quaternion((0, 0, 1), 1.2))


class HandTrack:
    """caminho de uma mão: chaves (t, espaço, âncora no espaço, pose dos dedos, suavização, marca, opções).
    Espaços: 'gun' (a arma), 'mag' (o pente), 'charge' (a alavanca), 'cam' (a câmera). Duas chaves seguidas no mesmo
    espaço e com a mesma âncora seguram a mão parada na peça. As outras andam em arco (Hermite pelas posições de
    agora); chave presa a peça para a mão (chega devagar), a não ser com a opção 'pass'."""

    def __init__(self, keys):
        self.k = sorted(keys, key=lambda k: k[0])

    def bracket(self, t):
        k = self.k
        if t <= k[0][0]:
            return 0, 0, 0.0
        for i in range(len(k) - 1):
            if k[i][0] <= t <= k[i + 1][0]:
                h = k[i + 1][0] - k[i][0]
                u = (t - k[i][0]) / h if h > 0 else 1.0
                return i, i + 1, u
        n = len(k) - 1
        return n, n, 0.0

    def uses(self, t, space):
        i, j, _ = self.bracket(t)
        return self.k[i][1] == space or self.k[j][1] == space

    def tag(self, t, name):
        i, j, u = self.bracket(t)
        a = 1.0 if self.k[i][5] == name else 0.0
        b = 1.0 if self.k[j][5] == name else 0.0
        return a + (b - a) * EASE[self.k[j][4]](u)

    def absolute(self, n, spaces):
        """a âncora da chave n no espaço da câmera; a de passagem (sem âncora) fica no meio das vizinhas, por fora
        (para a esquerda), por baixo e um pouco mais perto da câmera: a mão contorna a arma em vez de atravessar"""
        k = self.k
        if k[n][2] is not None:
            return spaces[k[n][1]] @ k[n][2]
        M = mat_lerp(self.absolute(n - 1, spaces), self.absolute(n + 1, spaces), 0.5)
        M.translation = M.translation + Vector(PASS_OUT)
        return M

    def eval(self, t, spaces):
        k = self.k
        i, j, u = self.bracket(t)
        w = EASE[k[j][4]](u)
        Ai = self.absolute(i, spaces)
        pose = lerp_pose(k[i][3], k[j][3], w)
        if i == j:
            return Ai, pose
        Aj = self.absolute(j, spaces)
        if k[i][2] is not None and k[i][1] == k[j][1] and (k[i][2] == k[j][2]):
            return Ai, pose
        # posição: Hermite com tangentes pelas vizinhas (avaliadas agora)
        def P(n):
            return self.absolute(n, spaces).translation

        def stop(n):
            return (k[n][1] != 'cam' and k[n][2] is not None and 'pass' not in k[n][6]) or 'stop' in k[n][6] or n in (0, len(k) - 1)

        def tan(n):
            if stop(n):
                return Vector()
            return (P(n + 1) - P(n - 1)) / max(1e-6, k[n + 1][0] - k[n - 1][0])

        h = k[j][0] - k[i][0]
        p0, p1, m0, m1 = Ai.translation, Aj.translation, tan(i), tan(j)
        uu = EASE[k[j][4]](u) if k[j][4] in ('io',) and stop(i) and stop(j) else u
        h00 = 2 * uu ** 3 - 3 * uu ** 2 + 1
        h10 = uu ** 3 - 2 * uu ** 2 + uu
        h01 = -2 * uu ** 3 + 3 * uu ** 2
        h11 = uu ** 3 - uu ** 2
        pos = p0 * h00 + m0 * (h10 * h) + p1 * h01 + m1 * (h11 * h)
        M = mat_lerp(Ai, Aj, w)
        M.translation = pos
        return M, pose


class Clip:
    def __init__(self, name, length, loop=False):
        self.name, self.len, self.loop = name, length, loop
        self.weapon = Curve([(0, (0,) * 6), (length, (0,) * 6)])
        self.jolts = []
        self.R = None
        self.L = None
        self.mag = None  # HandTrack de matrizes do pente (espaços 'gun', 'handL', 'cam')
        self.charge = Curve([(0, (0,)), (length, (0,))])
        self.rounds = Curve([(0, (1,)), (length, (1,))])
        self.weapon_fn = None  # deslocamento extra por função (laços: respirar, passos)
        self.Lfn = None
        self.events = {}
        self._spring = None

    def finish(self):
        if self.jolts:
            self._spring = spring_track(self.jolts, self.len + 0.1, FPS, dims=4)
        return self


class Anim:
    def __init__(self, repo, holds):
        self.repo = repo
        self.H = holds
        self.rig = Rig(os.path.join(repo, ARMS))
        self.hands = Hands(self.rig, os.path.join(repo, RIGTS))
        self.ik = ArmSolver(self.rig)
        self.gun, _ = scene_gun(repo, {}, 'base')
        g = self.gun
        lo, hi = g.box('mag')
        self.mag_pivot = Vector(((lo.x + hi.x) / 2, hi.y, (lo.z + hi.z) / 2))
        clo, chi = g.box('charge')
        self.charge_pivot = Vector(((clo.x + chi.x) / 2, (clo.y + chi.y) / 2, chi.z))
        M0 = trs(self.mag_pivot)
        self.M0 = M0
        A = lambda key: Matrix(holds[key]['A'])  # noqa: E731
        self.AR = A('base:R')
        self.AL = A('base:L_support')
        self.ALmag_gun = A('base:L_mag')
        self.ALmag = M0.inverted() @ self.ALmag_gun  # no espaço do pente
        self.ALch_gun = A('base:L_charge')
        C0 = trs(self.charge_pivot)
        self.ALch = C0.inverted() @ self.ALch_gun
        self.Aslap = A('base:slap')
        self.PR = holds['base:R']['pose']
        self.PL = holds['base:L_support']['pose']
        self.PLmag = holds['base:L_mag']['pose']
        self.PLch = holds['base:L_charge']['pose']
        self.trigger = holds['base:R_trigger']['index']
        self.P_open = {"index": [0, 0.25, 0.25, 0.15, 0], "middle": [0, 0.3, 0.3, 0.15, 0], "ring": [0.05, 0.35, 0.3, 0.15, 0.03],
                       "pinky": [0.1, 0.4, 0.3, 0.15, 0.08], "thumb": [[0.15, -0.35, -0.25], [0.2, 0, 0], [0.15, 0, 0]]}
        self.P_relax = {"index": [0, 0.55, 0.6, 0.3, 0], "middle": [0, 0.7, 0.7, 0.35, 0], "ring": [0.08, 0.8, 0.7, 0.35, 0.03],
                        "pinky": [0.15, 0.9, 0.7, 0.35, 0.08], "thumb": [[0.2, -0.6, -0.35], [0.3, 0, 0], [0.25, 0, 0]]}
        self.P_flat = {"index": [0, 0.08, 0.06, 0.04, -0.05], "middle": [0, 0.1, 0.06, 0.04, 0], "ring": [0.03, 0.12, 0.06, 0.04, 0.03],
                       "pinky": [0.05, 0.14, 0.06, 0.04, 0.1], "thumb": [[0.05, -0.2, -0.35], [0.05, 0, 0], [0.05, 0, 0]]}

    # ------------------------------------------------------------------ quadro

    def frame(self, c, t):
        """avalia o clipe no tempo t e põe o esqueleto; devolve o que o jogo mede (arma, pente, mãos)"""
        rig, hands = self.rig, self.hands
        rig.begin()
        W = self.weapon_world(c, t)
        spaces = {'gun': W, 'cam': Matrix()}
        # o pente: primeiro o que não depende da mão
        mag_needs_hand = c.mag is not None and c.mag.uses(t, 'handL')
        if c.mag is not None and not mag_needs_hand:
            Mg, _ = c.mag.eval(t, spaces)
        else:
            Mg = W @ self.M0
        spaces['mag'] = Mg
        pull = c.charge(t)[0]
        Ch = W @ trs(self.charge_pivot + Vector((0, 0, pull)))
        spaces['charge'] = Ch
        AR, PR = c.R.eval(t, spaces)
        AL, PL = c.L.eval(t, spaces)
        if c.Lfn:
            AL = c.Lfn(t, AL)
        spaces['handL'] = AL
        if mag_needs_hand:
            Mg, _ = c.mag.eval(t, spaces)
            spaces['mag'] = Mg
        drop = getattr(c, '_drop', None)
        if drop and drop[0][0] <= t <= c._drop_until:
            # o pente vazio cai: primeiro desliza reto pelo punho (sem girar: ele está dentro da mão direita) e, solto
            # dele, cai girando devagar
            t0 = drop[0][0]
            dt = t - t0
            g = 9.8
            slide = 0.5 * g * dt * dt + 0.3 * dt
            CLEAR = 0.15
            W0 = self.weapon_world(c, t0)
            if slide < CLEAR:
                Mg = W0 @ trs(self.mag_pivot + Vector((0, -0.012 - slide, 0)))
            else:
                # quando saiu do punho (resolvendo a parábola) e quanto andou depois
                te = (-0.3 + (0.09 + 2 * g * CLEAR) ** 0.5) / g
                v = W0.to_3x3() @ Vector((0, -(0.3 + g * te), 0))
                d2 = dt - te
                M = W0 @ trs(self.mag_pivot + Vector((0, -0.012 - CLEAR, 0)))
                R = Matrix.Rotation(1.8 * d2, 4, 'Z') @ Matrix.Rotation(-1.0 * d2, 4, 'X')
                Mg = Matrix.Translation(v * d2 + Vector((-0.08 * d2, -4.9 * d2 * d2, 0))) @ M @ R
            spaces['mag'] = Mg
        rig.set_world('weapon', W)
        rig.set_world('mag', Mg)
        rig.set_world('charge', Ch)
        sup = c.L.tag(t, 'support')
        mh = c.L.tag(t, 'mag')
        rig.set_world('ctl', trs((sup, mh, c.rounds(t)[0])))
        for side, A, P in ((1, AR, PR), (-1, AL, PL)):
            hands.place(side, A)
            Hm = rig.world('hand' + hands.sfx(side))
            # direita: pulso reto (o antebraço continua a linha do dorso; o cotovelo sai daí e o braço aponta o ombro);
            # esquerda: o cotovelo do braço (ombro → pulso), com o pulso dobrando pouco (a pegada foi escolhida assim)
            E = Hm.translation + forearm_dir(A) * FORE if side > 0 else solve_elbow(side, Hm.translation)
            self.ik.solve(side, Hm, E)
            hands.fingers(side, P)
        return W, Mg, Ch, AR, AL

    def weapon_world(self, c, t):
        d = c.weapon(t)
        sp = c._spring(t) if c._spring else (0, 0, 0, 0)
        extra = c.weapon_fn(t) if c.weapon_fn else (0,) * 6
        pos = Vector(HIP[0]) + Vector(d[0:3]) + Vector(extra[0:3]) + Vector((0, sp[2], sp[3]))
        rot = Vector(HIP[1]) + Vector(d[3:6]) + Vector(extra[3:6]) + Vector((sp[0], 0, sp[1]))
        return weapon_mat(pos, rot)

    def measure(self, W, Mg, Ch):
        moved = {'mag': W.inverted() @ Mg @ self.M0.inverted(),
                 'charge': W.inverted() @ Ch @ trs(self.charge_pivot).inverted()}
        out = {}
        for side, name in ((1, 'R'), (-1, 'L')):
            g = gaps(self.hands, side, self.gun, W, moved)
            worst = {}
            for part, k, gg, piece in g:
                if gg < worst.get(part, (9, None))[0]:
                    worst[part] = (gg, piece)
            out[name] = {p: [round(v[0] * 1000, 1), v[1]] for p, v in worst.items()}
        return out


# ====================================================================== assar e exportar

OUT_GLB = 'apps/desktop/src/features/space3d/assets/anims/mp7.glb'
OUT_TS = 'apps/desktop/src/features/space3d/gunfight/fpclips-mp7.ts'


def key_times(c):
    ts = set()
    for kk in c.weapon.k:
        ts.add(round(kk[0], 3))
    for tr in (c.L, c.R):
        for kk in tr.k:
            ts.add(round(kk[0], 3))
    return sorted(t for t in ts if 0 <= t <= c.len)


def _q3(M):
    q = M.to_quaternion()
    return [round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)]


def _m16(M):
    """matriz 4×4 no formato do three (coluna por coluna)"""
    return [round(M[r][c], 6) for c in range(4) for r in range(4)]


def finger_quats(anim, side, pose):
    """o giro local (do three) de cada osso de dedo nesta pose"""
    rig, hands = anim.rig, anim.hands
    rig.begin()
    hands.place(side, Matrix())
    hands.fingers(side, pose)
    sfx = hands.sfx(side)
    out = {}
    for f in ('index', 'middle', 'ring', 'pinky'):
        for n in ('palm_' + f, f + '1', f + '2', f + '3'):
            b = rig.arm.data.bones[n + sfx]
            out[n + sfx] = _q3(rig.world(b.parent.name).inverted() @ rig.world(n + sfx))
    for n in ('thumb1', 'thumb2', 'thumb3'):
        b = rig.arm.data.bones[n + sfx]
        out[n + sfx] = _q3(rig.world(b.parent.name).inverted() @ rig.world(n + sfx))
    return out


def bake_all(repo, holds_path, render=None, only=()):
    from . import clips_mp7
    holds = json.load(open(holds_path))
    a = Anim(repo, holds)
    clips = [f(a) for f in clips_mp7.ALL]
    report = {}
    arm = a.rig.arm
    arm.animation_data_create()
    view = None
    if render:
        from .view import View
        view = View(a.rig, a.gun)
        os.makedirs(render, exist_ok=True)
    for c in clips:
        n = int(round(c.len * FPS))
        act = bpy.data.actions.new(c.name)
        arm.animation_data.action = act
        rep = []
        keys = set(key_times(c))
        for f in range(n + 1):
            t = min(c.len, f / FPS)
            W, Mg, Ch, AR, AL = a.frame(c, t)
            a.rig.apply()
            a.rig.key(f)
            m = a.measure(W, Mg, Ch)
            rep.append({'f': f, 't': round(t, 3), **m})
            if view and (not only or c.name in only):
                near_key = any(abs(t - kt) < 0.5 / FPS for kt in keys)
                if near_key or f % 3 == 0:
                    view.pose_gun(W, {'mag': W.inverted() @ Mg @ a.M0.inverted(),
                                      'charge': W.inverted() @ Ch @ trs(a.charge_pivot).inverted()})
                    tag = ('k' if near_key else 'f')
                    base = os.path.join(render, '%s_%03d_%s' % (c.name, f, tag))
                    view.player()
                    view.render(base + '_fp.jpg')
                    if near_key:
                        # closes presos à arma: a esquerda (pelo lado esquerdo e por baixo) e a direita no punho
                        R3 = W.to_3x3()
                        for tag2, tgt, off, up in (('cL', (0, -0.04, -0.06), (-1, 0.25, 0.25), (0, 1, 0)),
                                                   ('bL', (0, -0.06, -0.06), (-0.4, -1, -0.5), (0, 0, -1)),
                                                   ('cR', (0, -0.02, 0.02), (1, 0.15, 0.1), (0, 1, 0)),
                                                   ('bR', (0, -0.02, 0.02), (-0.9, 0.1, 0.4), (0, 1, 0))):
                            p = W @ Vector(tgt)
                            view.look(p + R3 @ (Vector(off).normalized() * 0.3), p, up=R3 @ Vector(up), fov=42)
                            view.render(base + '_%s.jpg' % tag2)
        report[c.name] = rep
        tr = arm.animation_data.nla_tracks.new()
        tr.name = c.name
        tr.strips.new(c.name, 0, act)
        arm.animation_data.action = None
        worst = {s: min((r[s][p][0] for r in rep for p in r[s]), default=0) for s in ('R', 'L')}
        print('CLIP', c.name, n + 1, 'quadros; menor folga (mm)', worst, flush=True)
    # relatório (fora do git)
    rd = os.environ.get('ANIM_REPORT') or os.path.join(repo, '.anim-report')
    os.makedirs(rd, exist_ok=True)
    json.dump(report, open(os.path.join(rd, 'mp7.json'), 'w'))
    write_ts(a, clips, holds, os.path.join(repo, OUT_TS))
    export(a, os.path.join(repo, OUT_GLB))


def export(a, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # só o esqueleto vai para o arquivo (a malha dos braços e a arma já estão no jogo)
    for o in list(bpy.data.objects):
        if o != a.rig.arm:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.scene.render.fps = FPS
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_animations=True, export_skins=False,
                              export_animation_mode='ACTIONS', export_force_sampling=True,
                              export_optimize_animation_size=True, export_frame_step=1, export_extras=False,
                              export_def_bones=False, export_reset_pose_bones=True)
    print('GLB', path, os.path.getsize(path))


def write_ts(a, clips, holds, path, trigger=True):
    def anchor(key):
        return _m16(Matrix(holds[key]['A']))

    support = {'base': {'anchor': anchor('base:L_support'), 'fingers': finger_quats(a, -1, holds['base:L_support']['pose'])}}
    for v in ('vgrip', 'agrip'):
        k = v + ':L_support'
        if k in holds and holds[k].get('A'):
            support[v] = {'anchor': anchor(k), 'fingers': finger_quats(a, -1, holds[k]['pose'])}
    M0 = a.M0
    mag = {'base': _m16(M0.inverted() @ Matrix(holds['base:L_mag']['A']))}
    if 'ext:L_mag' in holds:
        mag['ext'] = _m16(M0.inverted() @ Matrix(holds['ext:L_mag']['A']))
    trig_pose = {k: [list(v) for v in vv] if k == 'thumb' else list(vv) for k, vv in holds['base:R']['pose'].items()}
    trig_pose['index'] = holds['base:R_trigger']['index']
    tq = finger_quats(a, 1, trig_pose)
    trigger = {k: v for k, v in tq.items() if k.startswith('index') or k.startswith('palm_index')} if trigger else {}
    meta = {
        'fps': FPS,
        'hip': {'pos': list(HIP[0]), 'rot': list(HIP[1])},
        'source': 'LokitoBlu, "AK-74M" e "Pistol" (Sketchfab, CC BY 4.0): movimento adaptado',
        'magPivot': [round(x, 5) for x in a.mag_pivot],
        'chargePivot': [round(x, 5) for x in a.charge_pivot],
        # `keys`: os tempos das chaves escritas (só para as folhas de conferência)
        'clips': {c.name: {'len': round(c.len, 4), 'loop': c.loop, 'events': c.events,
                           'keys': getattr(c, 'keys_override', None) or key_times(c)} for c in clips},
        'support': support,
        'magGrab': mag,
        'trigger': trigger,
    }
    body = json.dumps(meta, indent=2)
    ts = ('/**\n * Gerado por `apps/desktop/scripts/anims/mp7.py` (Blender) junto com `assets/anims/mp7.glb` — não editar à mão.\n'
          ' *\n * A pose de quadril em que os clipes foram escritos (espaço da câmera, giro YXZ), o pivô do pente e da alavanca\n'
          ' * (espaço da arma), a duração e os eventos de cada clipe, as pegadas de apoio por acessório (âncora da mão no\n'
          ' * espaço da arma e o giro local de cada dedo), a mão no pente (espaço do pente) e o indicador no gatilho.\n */\n'
          'export const MP7_ANIM = ' + body + ' as const;\n')
    open(path, 'w').write(ts)
    print('TS', path)


# ====================================================================== movimento de referência (ADR-0061, adendo)

class _Ctl:
    """o que o `frame` de um clipe resolvido devolve"""


def rt_frame(a, c, t):
    fr = c.at(t)
    rig = a.rig
    rig.begin()
    W = fr['W']
    Mg = W @ fr['mag'] @ a.M0
    Ch = W @ trs(a.charge_pivot + Vector((0, 0, fr['pull'])))
    rig.set_world('weapon', W)
    rig.set_world('mag', Mg)
    rig.set_world('charge', Ch)
    rig.set_world('ctl', trs(fr['ctl']))
    out = {}
    for side in (1, -1):
        H, E, F = fr[side]
        a.ik.solve(side, H, E)
        for k, v in F.items():
            rig.set_world_rot(k, v)
        out[side] = H @ a.hands.data['r' if side > 0 else 'l']['hand'].inverted()
    return W, Mg, Ch, out[1], out[-1]


def q_pose(a, side, H_gun, F_gun):
    """pose de dedos em giros locais a partir dos giros no espaço da arma (para os clipes escritos à mão)"""
    rig = a.rig
    rig.begin()
    rig.set_world('hand' + ('_r' if side > 0 else '_l'), H_gun)
    for k, v in F_gun.items():
        rig.set_world_rot(k, v)
    return {'q': {k: list(rig.basis[k][1]) for k in F_gun}, 'side': side}


def bake_retarget(repo, holds_path, src_dir, render=None, only=()):
    from . import clips_mp7, rt_mp7
    global HIP, S0
    holds = json.load(open(holds_path))
    a = Anim(repo, holds)
    # com o movimento de referência a esquerda segura por baixo da frente da caixa (como no guarda-mão do AK): sem a
    # empunhadura dobrável
    fg = a.gun.parts.pop('fgrip', None)
    if fg:
        fg['obj'].hide_render = True
    lo, hi = a.gun.box('mag')
    a.mag_len = hi.y - lo.y
    rclips, W0, h = rt_mp7.build(a, src_dir)
    pos = W0.translation
    e = W0.to_3x3().to_euler('YXZ')
    HIP = (tuple(round(x, 5) for x in pos), (round(e.x, 5), round(e.y, 5), round(e.z, 5)))
    S0 = weapon_mat(*HIP)
    # a pegada do idle de referência vira a base dos clipes escritos à mão
    a.AR = h['AR'] @ a.hands.data['r']['hand'].inverted()
    a.AL = h['AL'] @ a.hands.data['l']['hand'].inverted()
    a.PR = q_pose(a, 1, h['AR'], h['FR'])
    a.PL = q_pose(a, -1, h['AL'], h['FL'])
    holds = dict(holds)
    holds['base:L_support'] = {'A': [list(r) for r in a.AL], 'pose': a.PL}
    authored = [clips_mp7.sprint(a), clips_mp7.tac(a), clips_mp7.melee(a), clips_mp7.inspect(a)]
    for c in rclips:
        c.rt = True
    clips = rclips + authored
    report = {}
    arm = a.rig.arm
    arm.animation_data_create()
    view = None
    if render:
        from .view import View
        view = View(a.rig, a.gun)
        os.makedirs(render, exist_ok=True)
    for c in clips:
        n = int(round(c.len * FPS))
        act = bpy.data.actions.new(c.name)
        arm.animation_data.action = act
        rep = []
        keys = set(round(i * 0.1, 3) for i in range(int(c.len / 0.1) + 1)) if getattr(c, 'rt', False) else set(key_times(c))
        for f in range(n + 1):
            t = min(c.len, f / FPS)
            W, Mg, Ch, AR, AL = rt_frame(a, c, t) if getattr(c, 'rt', False) else a.frame(c, t)
            a.rig.apply()
            a.rig.key(f)
            rep.append({'f': f, 't': round(t, 3), **a.measure(W, Mg, Ch)})
            if view and (not only or c.name in only) and any(abs(t - kt) < 0.5 / FPS for kt in keys):
                view.pose_gun(W, {'mag': W.inverted() @ Mg @ a.M0.inverted(),
                                  'charge': W.inverted() @ Ch @ trs(a.charge_pivot).inverted()})
                view.player()
                view.render(os.path.join(render, '%s_%03d_k_fp.jpg' % (c.name, f)))
        report[c.name] = rep
        tr = arm.animation_data.nla_tracks.new()
        tr.name = c.name
        tr.strips.new(c.name, 0, act)
        arm.animation_data.action = None
        worst = {s: min((r[s][p][0] for r in rep for p in r[s]), default=0) for s in ('R', 'L')}
        print('CLIP', c.name, n + 1, 'quadros; menor folga (mm)', worst, flush=True)
        if getattr(c, 'rt', False):
            c.weapon = None
    rd = os.environ.get('ANIM_REPORT') or os.path.join(repo, '.anim-report')
    os.makedirs(rd, exist_ok=True)
    json.dump(report, open(os.path.join(rd, 'mp7.json'), 'w'))
    for c in rclips:
        c.keys_override = sorted(set(round(i * 0.1, 3) for i in range(int(c.len / 0.1) + 1)))
    write_ts(a, clips, holds, os.path.join(repo, OUT_TS), trigger=False)
    # só os nossos clipes vão para o arquivo (os do arquivo de origem ficaram na memória do Blender)
    ours = {c.name for c in clips}
    for act in list(bpy.data.actions):
        if act.name not in ours:
            bpy.data.actions.remove(act)
    export(a, os.path.join(repo, OUT_GLB))
