"""Curvas da animação: chaves com tempo, interpolação de Hermite com tangentes de Catmull-Rom (arcos e acelerações
naturais) e paradas onde a chave pede (`stop`: a peça chega devagar e para, como a mão encostando), molas para o
assentamento (ondas que decaem depois de um tranco, como uma bola quicando) e a pose escrita de cada quadro.

Tempo em segundos. Valores são tuplas de floats (posição, giros pequenos, abertura de dedos).
"""
import math

from mathutils import Matrix, Quaternion, Vector


def smooth(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def ease_out(u, p=2.2):
    u = max(0.0, min(1.0, u))
    return 1 - (1 - u) ** p


def ease_in(u, p=2.2):
    u = max(0.0, min(1.0, u))
    return u ** p


EASE = {'io': smooth, 'o': ease_out, 'i': ease_in, 'l': lambda u: max(0.0, min(1.0, u)),
        'oo': lambda u: ease_out(u, 3.5), 'ii': lambda u: ease_in(u, 3.0)}


class Curve:
    """chaves (t, valor, parar?) com Hermite; `stop` zera a tangente na chave"""

    def __init__(self, keys):
        # keys: [(t, value, opts)] ; opts: 'stop' | '' ; value: sequência de floats
        self.k = sorted([(float(t), tuple(float(x) for x in v), o) for t, v, *rest in keys for o in [rest[0] if rest else '']],
                        key=lambda x: x[0])
        n = len(self.k)
        self.m = []
        for i in range(n):
            t, v, o = self.k[i]
            if 'stop' in o or i == 0 or i == n - 1:
                self.m.append(tuple(0.0 for _ in v))
                continue
            t0, v0, _ = self.k[i - 1]
            t1, v1, _ = self.k[i + 1]
            # Catmull-Rom pelo tempo, sem passar do ponto entre duas chaves iguais
            m = tuple((b - a) / max(1e-6, t1 - t0) for a, b in zip(v0, v1))
            # monotonia (Fritsch–Carlson simplificado): sem tangente onde a chave é pico ou vale
            m = tuple(0.0 if (vi - a) * (b - vi) <= 0 else mi for mi, a, vi, b in zip(m, v0, v, v1))
            self.m.append(m)

    def __call__(self, t):
        k = self.k
        if t <= k[0][0]:
            return k[0][1]
        if t >= k[-1][0]:
            return k[-1][1]
        for i in range(len(k) - 1):
            t0, v0, _ = k[i]
            t1, v1, _ = k[i + 1]
            if t0 <= t <= t1:
                h = t1 - t0
                u = (t - t0) / h if h > 0 else 1.0
                h00 = 2 * u ** 3 - 3 * u ** 2 + 1
                h10 = u ** 3 - 2 * u ** 2 + u
                h01 = -2 * u ** 3 + 3 * u ** 2
                h11 = u ** 3 - u ** 2
                return tuple(h00 * a + h10 * h * ma + h01 * b + h11 * h * mb
                             for a, b, ma, mb in zip(v0, v1, self.m[i], self.m[i + 1]))
        return k[-1][1]


class Steps:
    """chaves com transição em cada trecho por uma curva de suavização (`EASE`), sem passar do ponto"""

    def __init__(self, keys):
        self.k = sorted([(float(t), v, e) for t, v, e in keys], key=lambda x: x[0])

    def seg(self, t):
        """(chave de antes, chave de depois, peso 0–1)"""
        k = self.k
        if t <= k[0][0]:
            return k[0], k[0], 0.0
        for i in range(len(k) - 1):
            if k[i][0] <= t <= k[i + 1][0]:
                h = k[i + 1][0] - k[i][0]
                u = (t - k[i][0]) / h if h > 0 else 1.0
                return k[i], k[i + 1], EASE[k[i + 1][2]](u)
        return k[-1], k[-1], 0.0


def spring_track(impulses, t_end, fps, k=260.0, c=16.0, dims=1):
    """molas que recebem trancos (t, (dv...)) e voltam com ondas que decaem; devolve uma função t → valor"""
    dt = 1.0 / (fps * 8)
    n = int(t_end / dt) + 2
    x = [0.0] * dims
    v = [0.0] * dims
    imp = sorted(impulses)
    j = 0
    out = []
    for i in range(n):
        t = i * dt
        while j < len(imp) and imp[j][0] <= t:
            for d in range(dims):
                v[d] += imp[j][1][d]
            j += 1
        for d in range(dims):
            a = -k * x[d] - c * v[d]
            v[d] += a * dt
            x[d] += v[d] * dt
        out.append(tuple(x))

    def f(t):
        i = max(0, min(len(out) - 1, int(round(t / dt))))
        return out[i]

    return f


def lerp_pose(a, b, w):
    """mistura duas poses de dedos (mesmo formato de `hands.Hands.fingers`)"""
    if a is None or b is None:
        return a if b is None else b
    if 'q' in a or 'q' in b:
        from .hands import angle_to_q
        side = a.get('side', b.get('side', 1))
        qa, qb = angle_to_q(a, side)['q'], angle_to_q(b, side)['q']
        keys = set(qa) | set(qb)
        return {'q': {k: list(Quaternion(qa.get(k, qb.get(k))).slerp(Quaternion(qb.get(k, qa.get(k))), w)) for k in keys},
                'side': side}
    out = {}
    for k in a:
        if k == 'thumb':
            out[k] = [[x + (y - x) * w for x, y in zip(ra, rb)] for ra, rb in zip(a[k], b[k])]
        else:
            out[k] = [x + (y - x) * w for x, y in zip(a[k], b[k])]
    return out


def mat_lerp(A, B, w):
    """posição linear e giro esférico entre duas matrizes"""
    pa, qa, _ = A.decompose()
    pb, qb, _ = B.decompose()
    M = qa.slerp(qb, w).to_matrix().to_4x4()
    M.translation = pa.lerp(pb, w)
    return M
