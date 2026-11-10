"""Encaixe de uma pegada na malha da arma: busca aleatória (com semente) em volta de um giro de partida e refino local.

Uma pegada (`HoldSpec`) diz: o lado, o giro de partida da âncora, quanto o giro pode variar, onde um osso de referência
deve cair (uma caixa no espaço da arma), a pose de partida dos dedos, quais dedos dão a volta na peça, para onde o
polegar aponta e o que conta como contato. Cada candidata é posta, os dedos fecham até encostar (`wrap_finger`), o
polegar procura o alvo dele e a nota soma: entrar na arma (proibido além da tolerância), falange longe da peça, palma
longe, polegar fora do alvo. A melhor passa pelo refino (descida por coordenadas nos 6 graus da âncora).

A pele é macia: a tolerância de entrada é 1 mm (a medida é por esferas, a malha da mão é mais fina que elas).
"""
import math
import random

from mathutils import Matrix, Quaternion, Vector

from .hands import fit_thumb, gaps, wrap_finger
from .space import trs

PEN_TOL = 0.001


def _copy_pose(p):
    return {k: [list(v) for v in vv] if k == 'thumb' else list(vv) for k, vv in p.items()}


def evaluate(hands, side, gun, A, spec, moved=None, quick=False):
    """põe a mão na âncora `A` (espaço da arma), fecha os dedos e dá a nota (menor é melhor)"""
    I = Matrix()
    hands.place(side, A)
    pose = _copy_pose(spec['pre'])
    hands.fingers(side, pose)
    skip = spec.get('skip', ())
    g = gaps(hands, side, gun, I, moved, parts=['palm'], skip=skip)
    if min(x[2] for x in g) < -0.006:
        return 1e9, pose, {}
    n = 6 if quick else 8
    for f in spec.get('wrap', ()):
        lim = spec.get('lim', {}).get(f, (1.75, 1.9, 1.3))
        lo = spec.get('lo', {}).get(f, (-0.1, 0.0, 0.0))
        pose, _ = wrap_finger(hands, side, gun, I, pose, f, moved, skip, lim=lim, lo=lo)
    if spec.get('thumb') is not None:
        pose, tc = fit_thumb(hands, side, gun, I, pose, spec['thumb'], moved, skip, n=5 if quick else 7,
                             rng=spec.get('thumb_rng', ((-0.6, 0.9), (-1.7, 0.5), (-1.3, 0.7))))
    else:
        tc = 0.0
    g = gaps(hands, side, gun, I, moved, skip=skip)
    pen = min(x[2] for x in g)
    seg = {}
    for part, k, gg, _ in g:
        if part in spec.get('wrap', ()):
            seg[(part, k)] = min(seg.get((part, k), 9.0), gg)
    palm = min(gg for part, k, gg, _ in g if part == 'palm')
    w = spec.get('w', {})
    score = 1e4 * max(0.0, -pen - PEN_TOL)
    score += sum(max(0.0, v - 0.0015) * (w.get('seg0', 3.0) if k[1] == 0 else 1.0) for k, v in seg.items()) * 100
    score += max(0.0, palm - 0.0015) * w.get('palm', 300.0)
    score += tc * w.get('thumb', 0.2)
    for bone, lo, hi, wt in spec.get('targets', ()):
        p = hands.rig.head(bone + hands.sfx(side))
        for i in range(3):
            score += wt * 100 * (max(0.0, lo[i] - p[i]) + max(0.0, p[i] - hi[i]))
    info = {'pen': pen, 'palm': palm, 'seg': {'%s%d' % k: round(v * 1000, 1) for k, v in seg.items()}, 'thumb': tc}
    return score, pose, info


def _anchor(spec, rq, ref_at, ref_local):
    return trs(Vector(ref_at) - rq @ ref_local, rq)


def search(hands, side, gun, spec, n=500, seed=1, moved=None):
    rnd = random.Random(seed)
    sfx = hands.sfx(side)
    base = Quaternion(spec['quat'])
    # onde fica o osso de referência na âncora (com a pose de partida)
    hands.place(side, Matrix())
    hands.fingers(side, _copy_pose(spec['pre']))
    ref_local = hands.rig.head(spec['ref'] + sfx).copy()
    lo, hi = spec['ref_box']
    rr = spec.get('rot', (0.4, 0.4, 0.4))
    best = (1e18, None, None, None)
    for _ in range(n):
        d = Vector((rnd.uniform(-rr[0], rr[0]), rnd.uniform(-rr[1], rr[1]), rnd.uniform(-rr[2], rr[2])))
        rq = (Quaternion(d.normalized(), d.length) if d.length > 1e-9 else Quaternion()) @ base
        at = Vector([rnd.uniform(lo[i], hi[i]) for i in range(3)])
        A = _anchor(spec, rq, at, ref_local)
        s, pose, info = evaluate(hands, side, gun, A, spec, moved, quick=True)
        if s < best[0]:
            best = (s, A, pose, info)
    return best


def refine(hands, side, gun, spec, A, moved=None, iters=12, step=0.003, rstep=0.05):
    cur = evaluate(hands, side, gun, A, spec, moved)
    st = [step] * 3 + [rstep] * 3
    for _ in range(iters):
        improved = False
        for i in range(6):
            for sg in (1, -1):
                B = A.copy()
                if i < 3:
                    B.translation = A.translation + Vector([sg * st[i] if j == i else 0 for j in range(3)])
                else:
                    ax = Vector([1 if j == i - 3 else 0 for j in range(3)])
                    R = Matrix.Rotation(sg * st[i], 4, ax)
                    piv = A.translation
                    B = Matrix.Translation(piv) @ R @ Matrix.Translation(-piv) @ A
                r = evaluate(hands, side, gun, B, spec, moved)
                if r[0] < cur[0]:
                    A, cur, improved = B, r, True
                    break
        if not improved:
            st = [x * 0.5 for x in st]
            if st[0] < 0.0005:
                break
    hands.place(side, A)
    hands.fingers(side, cur[1])
    return cur[0], A, cur[1], cur[2]


def fit_hold(hands, side, gun, spec, n=500, seed=1, moved=None):
    s, A, pose, info = search(hands, side, gun, spec, n, seed, moved)
    s2, A2, pose2, info2 = refine(hands, side, gun, spec, A, moved)
    return {'score': s2, 'A': [list(r) for r in A2], 'pose': pose2, 'info': info2}
