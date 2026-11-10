"""Mãos: âncora, poses dos dedos (FK, junta por junta), esferas de contato e o encaixe na malha da arma.

Espaço da mão (a "âncora", o mesmo de `handrig.ts`): pulso na origem, dedos para −z, palma para −y, dorso para +y; na
direita o indicador e o polegar ficam em −x (na esquerda, espelhado). O osso `hand_*` fica na âncora vezes o descanso
dele (`ARM_RIG.<lado>.hand`, lido de `armsrig.ts`).

Uma pose de dedos é um dicionário: por dedo `[metacarpo, base, meio, ponta, abertura]` (rad, + fecha para a palma) e o
polegar com três giros XYZ (escritos para a direita; a esquerda espelha y e z, como `poseFingers`).
"""
import math
import re
from pathlib import Path

from mathutils import Matrix, Quaternion, Vector

from .space import qxyz, trs

FINGERS = ['index', 'middle', 'ring', 'pinky']
SEGS = {f: [f + '1', f + '2', f + '3'] for f in FINGERS}
SEGS['thumb'] = ['thumb2', 'thumb3']
PROBES_PER_SEG = 4
# folga da pele: o contato vale entre −0,5 mm (aperta) e +1 mm (encosta)
GAP = 0.0004


def _parse_rig(path):
    src = Path(path).read_text()
    out = {}
    for side in ('r', 'l'):
        start = src.index(f'  {side}: {{')
        block = src[start:src.index('palm:', start)]
        hand = re.search(r"hand: \{ pos: \[([^\]]*)\], quat: \[([^\]]*)\] \}", block)
        bones = {}
        for m in re.finditer(r"name: '([a-z_0-9]+)',.*?len: ([0-9.e-]+),\s*r: ([0-9.e-]+)", block, re.S):
            bones[m.group(1)] = {'len': float(m.group(2)), 'r': float(m.group(3))}
        pblock = src[src.index('palm:', start):]
        pblock = pblock[:pblock.index('],\n  }') if '],\n  }' in pblock else len(pblock)]
        palm = [tuple(float(x) for x in m.group(1).split(',')) for m in re.finditer(r"\[(-?[0-9.]+, -?[0-9.]+, -?[0-9.]+, [0-9.]+)\]", pblock)]
        hp = [float(x) for x in hand.group(1).split(',')]
        hq = [float(x) for x in hand.group(2).split(',')]
        out[side] = {'hand': trs(hp, Quaternion((hq[3], hq[0], hq[1], hq[2]))), 'bones': bones, 'palm': palm}
    return out


class Hands:
    def __init__(self, rig, armsrig_ts):
        self.rig = rig
        self.data = _parse_rig(armsrig_ts)

    @staticmethod
    def sfx(side):
        return '_r' if side > 0 else '_l'

    # -------------------------------------------------------------- pose

    def place(self, side, A):
        """a âncora `A` (espaço do jogo) → osso da mão"""
        d = self.data['r' if side > 0 else 'l']
        self.rig.set_world('hand' + self.sfx(side), A @ d['hand'])

    def anchor(self, side):
        d = self.data['r' if side > 0 else 'l']
        return self.rig.world('hand' + self.sfx(side)) @ d['hand'].inverted()

    def fingers(self, side, pose):
        s = self.sfx(side)
        if 'q' in pose:
            # pose em giros prontos (do movimento de referência): osso → giro local em cima do descanso
            for name, q in pose['q'].items():
                self.rig.set_local(name, Quaternion(q))
            return
        sp = 1 if side > 0 else -1
        for f in FINGERS:
            m, a, b, c, spread = pose[f]
            self.rig.set_local('palm_' + f + s, qxyz(m, 0, 0))
            self.rig.set_local(f + '1' + s, qxyz(a, 0, sp * spread))
            self.rig.set_local(f + '2' + s, qxyz(b, 0, 0))
            self.rig.set_local(f + '3' + s, qxyz(c, 0, 0))
        for j, (x, y, z) in enumerate(pose['thumb']):
            self.rig.set_local('thumb%d%s' % (j + 1, s), qxyz(x, sp * y, sp * z))

    # -------------------------------------------------------------- esferas

    def probes(self, side, parts=None):
        """(parte, falange, centro no espaço do jogo, raio): falanges pelo eixo e a grade da palma"""
        s = self.sfx(side)
        d = self.data['r' if side > 0 else 'l']
        out = []
        for part, names in SEGS.items():
            if parts and part not in parts:
                continue
            for k, n in enumerate(names):
                b = d['bones'][n]
                W = self.rig.world(n + s)
                half = max(0.0, b['len'] - b['r'] * 1.4) / 2
                for i in range(PROBES_PER_SEG):
                    along = b['len'] / 2 + half * (-1 + 2 * i / (PROBES_PER_SEG - 1))
                    out.append((part, k, W @ Vector((0, along, 0)), b['r']))
        if not parts or 'palm' in parts:
            A = self.anchor(side)
            for i, (x, y, z, r) in enumerate(d['palm']):
                out.append(('palm', i, A @ Vector((x, y, z)), r))
            b = d['bones']['thumb1']
            W = self.rig.world('thumb1' + s)
            for i in range(PROBES_PER_SEG):
                out.append(('palm', 100 + i, W @ Vector((0, b['len'] * (i + 0.5) / PROBES_PER_SEG, 0)), b['r']))
        return out


def angle_to_q(pose, side):
    """pose em ângulos (dedos [metacarpo, base, meio, ponta, abertura], polegar XYZ) → giros locais por osso"""
    if 'q' in pose:
        return pose
    s = '_r' if side > 0 else '_l'
    sp = 1 if side > 0 else -1
    q = {}
    for f in FINGERS:
        m, a, b, c, spread = pose[f]
        q['palm_' + f + s] = qxyz(m, 0, 0)
        q[f + '1' + s] = qxyz(a, 0, sp * spread)
        q[f + '2' + s] = qxyz(b, 0, 0)
        q[f + '3' + s] = qxyz(c, 0, 0)
    for j, (x, y, z) in enumerate(pose['thumb']):
        q['thumb%d%s' % (j + 1, s)] = qxyz(x, sp * y, sp * z)
    return {'q': {k: list(v) for k, v in q.items()}, 'side': side}


def gaps(hands, side, gun, Wgun, moved=None, parts=None, skip=()):
    """folga de cada esfera até a arma (m; negativa = entrando) → lista (parte, falange, folga, peça)"""
    inv = Wgun.inverted()
    out = []
    for part, k, p, r in hands.probes(side, parts):
        d, name = gun.nearest(inv @ p, moved, skip)
        out.append((part, k, d - r, name))
    return out


def worst(gl):
    """a menor folga por parte"""
    w = {}
    for part, k, g, _ in gl:
        w[part] = min(w.get(part, 1e9), g)
    return w


# ------------------------------------------------------------------ encaixe

def close_fingers(hands, side, gun, Wgun, pose, which, moved=None, limits=None, gap=GAP, skip=()):
    """fecha as falanges de cada dedo de `which`, da base para a ponta, cada uma até encostar (ou até o limite).
    Devolve a pose nova. `pose` é a pose de partida (aberta)."""
    pose = {k: [list(x) if isinstance(x, (list, tuple)) else x for x in v] if k == 'thumb' else list(v) for k, v in pose.items()}
    lim = limits or {}
    inv = Wgun.inverted()
    s = hands.sfx(side)

    def seg_gap(part, k):
        hands.fingers(side, pose)
        best = 1e9
        for pp, kk, p, r in hands.probes(side, [part]):
            if kk != k:
                continue
            d, _ = gun.nearest(inv @ p, moved, skip)
            best = min(best, d - r)
        return best

    for f in which:
        if f == 'thumb':
            # o polegar: o segundo e o terceiro osso dobram em x (o primeiro fica como a pose pediu)
            for j, k in ((1, 0), (2, 1)):
                lo, hi = pose['thumb'][j][0], lim.get(('thumb', j), 1.4)
                pose['thumb'][j][0] = _search(lambda a: _set_thumb(pose, j, a) or seg_gap('thumb', k), lo, hi, gap)
            continue
        for j in (1, 2, 3):
            lo = pose[f][j]
            hi = lim.get((f, j), (1.75, 1.9, 1.3)[j - 1])
            pose[f][j] = _search(lambda a: _set(pose, f, j, a) or seg_gap(f, j - 1), lo, hi, gap)
    hands.fingers(side, pose)
    return pose


def _set(pose, f, j, a):
    pose[f][j] = a


def _set_thumb(pose, j, a):
    pose['thumb'][j][0] = a


def _search(fn, lo, hi, gap, it=14):
    """o maior ângulo em [lo, hi] com folga ≥ gap (a folga cai fechando); se nem `lo` serve, abre até servir"""
    if fn(hi) >= gap:
        return hi
    if fn(lo) < gap:
        # já entra na arma aberto assim: abre um pouco (até −0,4 rad) procurando folga
        a = lo
        for _ in range(8):
            a -= 0.05
            if fn(a) >= gap or a < lo - 0.4:
                return a
        return a
    a, b = lo, hi
    for _ in range(it):
        m = (a + b) / 2
        if fn(m) >= gap:
            a = m
        else:
            b = m
    fn(a)
    return a


def seat_palm(hands, side, gun, Wgun, A, axis, moved=None, gap=GAP, rng=0.04, skip=(), parts=('palm',)):
    """anda a âncora `A` ao longo de `axis` (espaço do jogo, para dentro da arma) até a palma encostar"""
    axis = Vector(axis).normalized()
    inv = Wgun.inverted()

    def g(t):
        B = A.copy()
        B.translation = A.translation + axis * t
        hands.place(side, B)
        best = 1e9
        for part, k, p, r in hands.probes(side, list(parts)):
            d, _ = gun.nearest(inv @ p, moved, skip)
            best = min(best, d - r)
        return best

    a, b = -rng, rng
    if g(b) >= gap:
        t = b
    elif g(a) < gap:
        t = a
    else:
        for _ in range(16):
            m = (a + b) / 2
            if g(m) >= gap:
                a = m
            else:
                b = m
        t = a
    B = A.copy()
    B.translation = A.translation + axis * t
    hands.place(side, B)
    return B


def fit_anchor(hands, side, gun, Wgun, A0, pose, contacts, targets=(), moved=None, skip=(), iters=80, step=0.006,
               rstep=0.08, pen_w=4e6, con_w=1e2, tol=0.0008):
    """Acha a âncora (posição e giro perto de `A0`, espaço do jogo) em que a mão, com os dedos já na forma da pegada
    (`pose`), encaixa na arma: nada entrando (folga ≥ −`tol`), as partes de `contacts` encostando (folga perto de 0) e
    os alvos (`targets`: (função da mão → ponto, ponto alvo, peso)) perto. Descida por coordenadas com passo que cai."""
    inv = Wgun.inverted()
    hands.fingers(side, pose)

    def build(p):
        q = Quaternion(Vector(p[3:6]).normalized(), Vector(p[3:6]).length) if Vector(p[3:6]).length > 1e-9 else Quaternion()
        A = A0.copy()
        R = (q.to_matrix() @ A0.to_3x3()).to_4x4()
        R.translation = A0.translation + Vector(p[0:3])
        return R

    def cost(p):
        A = build(p)
        hands.place(side, A)
        c = 0.0
        best = {}
        for part, k, pt, r in hands.probes(side):
            d, _ = gun.nearest(inv @ pt, moved, skip)
            g = d - r
            if g < -tol:
                c += pen_w * (g + tol) ** 2
            if part in contacts and (part != 'palm' or k in contacts['palm']):
                key = (part, k if part != 'palm' else 0)
                best[key] = min(best.get(key, 1e9), g)
        for key, g in best.items():
            c += con_w * max(0.0, g) ** 2 * 1e3
        for fn, tgt, w in targets:
            c += w * (fn(hands, A) - Vector(tgt)).length_squared * 1e3
        return c

    p = [0.0] * 6
    cur = cost(p)
    steps = [step] * 3 + [rstep] * 3
    for _ in range(iters):
        improved = False
        for i in range(6):
            for sgn in (1, -1):
                q = list(p)
                q[i] += sgn * steps[i]
                c = cost(q)
                if c < cur:
                    p, cur, improved = q, c, True
                    break
        if not improved:
            steps = [s * 0.5 for s in steps]
            if steps[0] < 0.0002:
                break
    A = build(p)
    hands.place(side, A)
    return A, cur


def fit_thumb(hands, side, gun, Wgun, pose, tip_target, moved=None, skip=(), bend=(0.35, 0.25), tol=0.0005,
              rng=((-0.6, 0.9), (-1.7, 0.5), (-1.3, 0.7)), n=9):
    """Busca em grade o giro do primeiro osso do polegar (e a dobra dos outros dois) em que ele não entra na arma e a
    ponta fica perto de `tip_target` (espaço da arma). Devolve a pose com o polegar novo."""
    import itertools
    inv = Wgun.inverted()
    s = hands.sfx(side)
    tgt = Vector(tip_target)
    best = (1e18, None)

    def score(t1, b2, b3):
        pose['thumb'] = [list(t1), [b2, pose['thumb'][1][1], pose['thumb'][1][2]], [b3, 0, 0]]
        hands.fingers(side, pose)
        pen = 0.0
        for part, k, pt, r in hands.probes(side, ['thumb']):
            d, _ = gun.nearest(inv @ pt, moved, skip)
            pen += max(0.0, -(d - r) - tol) ** 2
        tip = inv @ hands.rig.tail('thumb3' + s)
        return pen * 1e7 + (tip - tgt).length_squared * 1e3

    axes = [[lo + (hi - lo) * i / (n - 1) for i in range(n)] for lo, hi in rng]
    for t1 in itertools.product(*axes):
        for b2, b3 in ((bend[0], bend[1]), (bend[0] + 0.3, bend[1] + 0.2), (0.1, 0.1)):
            c = score(t1, b2, b3)
            if c < best[0]:
                best = (c, (t1, b2, b3))
    # refino em volta do melhor
    (t1, b2, b3) = best[1]
    stepv = [(hi - lo) / (n - 1) / 2 for lo, hi in rng] + [0.1, 0.1]
    cur = list(t1) + [b2, b3]
    cc = best[0]
    for _ in range(40):
        moved_any = False
        for i in range(5):
            for sg in (1, -1):
                q = list(cur)
                q[i] += sg * stepv[i]
                c = score(q[:3], q[3], q[4])
                if c < cc:
                    cur, cc, moved_any = q, c, True
                    break
        if not moved_any:
            stepv = [x * 0.5 for x in stepv]
            if stepv[0] < 0.005:
                break
    score(cur[:3], cur[3], cur[4])
    return pose, cc


def wrap_finger(hands, side, gun, Wgun, pose, f, moved=None, skip=(), tol=0.0004, lim=(1.75, 1.9, 1.3), lo=(-0.1, 0.0, 0.0),
                ratio=None):
    """Dobra as três juntas de um dedo para ele dar a volta na peça: nenhuma falange entrando e cada uma encostando o
    mais perto possível (busca em grade e depois refino). `ratio`: proporção preferida entre as juntas (desempate)."""
    inv = Wgun.inverted()
    segs_n = {}

    def cost(j):
        pose[f][1], pose[f][2], pose[f][3] = j
        hands.fingers(side, pose)
        pen = 0.0
        mins = [1e9, 1e9, 1e9]
        for part, k, pt, r in hands.probes(side, [f]):
            d, _ = gun.nearest(inv @ pt, moved, skip)
            g = d - r
            if g < -tol:
                pen += (g + tol) ** 2
            mins[k] = min(mins[k], g)
        con = sum(max(0.0, min(m, 0.03)) ** 2 for m in mins)
        reg = 0.0
        if ratio:
            s = sum(j) or 1
            reg = sum((j[i] / s - ratio[i]) ** 2 for i in range(3)) * 1e-4
        return pen * 1e7 + con * 1e3 + reg

    best = (1e18, None)
    n = 8
    grid = [[lo[i] + (lim[i] - lo[i]) * k / (n - 1) for k in range(n)] for i in range(3)]
    for a in grid[0]:
        for b in grid[1]:
            for c in grid[2]:
                v = cost((a, b, c))
                if v < best[0]:
                    best = (v, [a, b, c])
    cur, cc = best[1], best[0]
    st = [(lim[i] - lo[i]) / (n - 1) / 2 for i in range(3)]
    for _ in range(60):
        moved_any = False
        for i in range(3):
            for sg in (1, -1):
                q = list(cur)
                q[i] = max(lo[i], min(lim[i], q[i] + sg * st[i]))
                v = cost(q)
                if v < cc:
                    cur, cc, moved_any = q, v, True
                    break
        if not moved_any:
            st = [x * 0.5 for x in st]
            if st[0] < 0.004:
                break
    cost(cur)
    return pose, cc
