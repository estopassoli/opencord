"""Pegada por restrições (a da direita no punho e as de apoio): em vez de girar juntas à mão, a pose sai de um
problema com metas medidas na malha da arma.

Restrições duras (pesam muito): nada da mão entra na arma além de 1 mm; o pulso fica reto — o antebraço continua a
linha do dorso da mão (até ~12° de extensão, sem desvio para os lados) e o cotovelo que sai daí tem de caber no braço
(a distância até o ombro perto do tamanho do braço).

Metas (pesam menos): a membrana entre o polegar e o indicador encaixada no alto das costas do punho, a base da palma
encostada nas costas do punho, cada falange do médio, anelar e mindinho encostando (fechando em cascata, como um
punho em volta de um cilindro: a base de cada dedo parecida com a do vizinho), o mindinho acima do fim do punho, o
indicador esticado sobre a armação acima do guarda-mato e o polegar pela esquerda, para a frente, encostado.
"""
import math

from mathutils import Matrix, Quaternion, Vector

from .armik import FORE, UPPER, shoulder, solve_elbow
from .hands import fit_thumb, gaps, wrap_finger

EXT = math.radians(10)


def forearm_dir(A):
    """o antebraço saindo do pulso com o dorso quase reto (espaço da âncora: dedos −z, dorso +y)"""
    return (A.to_3x3() @ Vector((0, -math.sin(EXT), math.cos(EXT)))).normalized()


def _copy(p):
    return {k: [list(v) for v in vv] if k == 'thumb' else list(vv) for k, vv in p.items()}


class GripProblem:
    def __init__(self, hands, side, gun, Wgun, pre, wrap, targets, thumb=None, index_pose=None, side_shoulder=None,
                 weights=None, skip=(), moved=None, wrap_lim=None):
        self.h, self.side, self.gun, self.W = hands, side, gun, Wgun
        self.pre, self.wrap, self.targets, self.thumb = pre, wrap, targets, thumb
        self.index_pose = index_pose
        self.S = side_shoulder if side_shoulder is not None else shoulder(side)
        self.w = {'pen': 3e4, 'arm': 400.0, 'contact': 150.0, 'target': 300.0, 'cascade': 2.0, 'thumb': 0.4, 'index': 100.0}
        self.w.update(weights or {})
        self.skip, self.moved = skip, moved
        self.wrap_lim = wrap_lim or {}

    def build(self, base, p):
        rv = Vector(p[3:6])
        q = Quaternion(rv.normalized(), rv.length) if rv.length > 1e-9 else Quaternion()
        A = (q.to_matrix() @ base.to_3x3()).to_4x4()
        A.translation = base.translation + Vector(p[0:3])
        return A

    def evaluate(self, A, quick=True):
        h, s, I = self.h, self.side, Matrix()
        h.place(s, A)
        pose = _copy(self.pre)
        if self.index_pose is not None:
            pose['index'] = list(self.index_pose)
        h.fingers(s, pose)
        terms = {}
        # pulso reto: o antebraço continua o dorso; ele tem de sair da tela pelo canto de baixo do lado dele (descendo,
        # para fora e para trás), como um braço de verdade vindo do ombro
        d = self.W.to_3x3() @ forearm_dir(A)
        if self.side > 0:
            terms['arm'] = ((max(0.0, 0.3 + d.y) / 0.1) ** 2 + (max(0.0, 0.12 - self.side * d.x) / 0.1) ** 2
                            + (max(0.0, 0.1 - d.z) / 0.1) ** 2)
        else:
            # mão de apoio: o cotovelo vem do braço (ombro → pulso, dobrando para baixo e para fora) e o pulso pode
            # dobrar pouco (até ~22° da linha do dorso)
            Wc = (self.W @ A).translation
            E = solve_elbow(self.side, Wc)
            real = (E - Wc).normalized()
            bend = math.degrees(real.angle(d)) if real.length > 0 else 0.0
            terms['arm'] = (max(0.0, bend - 22.0) / 10.0) ** 2
        # pré-teste da palma (rápido)
        g = gaps(h, s, self.gun, I, self.moved, parts=['palm'], skip=self.skip)
        if min(x[2] for x in g) < -0.008:
            return 1e9, pose, {'reject': 1}
        for f in self.wrap:
            pose, _ = wrap_finger(h, s, self.gun, I, pose, f, self.moved, self.skip, lim=self.wrap_lim.get(f, (1.75, 1.9, 1.3)))
        if self.thumb is not None:
            pose, tc = fit_thumb(h, s, self.gun, I, pose, self.thumb, self.moved, self.skip, n=5 if quick else 7)
            terms['thumb'] = tc
        g = gaps(h, s, self.gun, I, self.moved, skip=self.skip)
        pen = min(x[2] for x in g)
        terms['pen'] = max(0.0, -pen - 0.001) * 1000
        seg = {}
        for part, k, gg, _ in g:
            seg[(part, k)] = min(seg.get((part, k), 9.0), gg)
        con = 0.0
        for f in self.wrap:
            for k in range(3):
                con += max(0.0, seg.get((f, k), 0.0) - 0.0012) * 1000
        terms['contact'] = con / 10
        if self.index_pose is not None:
            # o indicador encostado (de leve) na armação
            terms['index'] = max(0.0, min(seg.get(('index', 1), 0.0), seg.get(('index', 2), 0.0)) - 0.0015) * 100
        # cascata: as juntas dos dedos que fecham parecidas entre vizinhos
        js = [pose[f] for f in self.wrap]
        cas = 0.0
        for a, b in zip(js, js[1:]):
            cas += (a[1] - b[1]) ** 2 + 0.5 * (a[2] - b[2]) ** 2 + 0.3 * (a[3] - b[3]) ** 2
        terms['cascade'] = cas
        tg = 0.0
        for fn, tgt, wt in self.targets:
            tg += wt * ((fn(h) - Vector(tgt)).length / 0.01) ** 2
        terms['target'] = tg
        score = sum(self.w[k] * v for k, v in terms.items() if k in self.w)
        return score, pose, terms

    def solve(self, base, starts, iters=10, step=0.004, rstep=0.08, log=None):
        best = None
        for st0 in starts:
            p = list(st0)
            cur = self.evaluate(self.build(base, p))
            st = [step] * 3 + [rstep] * 3
            for it in range(iters):
                improved = False
                for i in range(6):
                    for sg in (1, -1):
                        q = list(p)
                        q[i] += sg * st[i]
                        r = self.evaluate(self.build(base, q))
                        if r[0] < cur[0]:
                            p, cur, improved = q, r, True
                            break
                if not improved:
                    st = [x * 0.5 for x in st]
                    if st[0] < 0.0006:
                        break
            if log:
                log('start', [round(x, 3) for x in st0], 'score', round(cur[0], 2), {k: round(v, 3) for k, v in cur[2].items()})
            if best is None or cur[0] < best[0][0]:
                best = (cur, p)
        cur, p = best
        A = self.build(base, p)
        final = self.evaluate(A, quick=True)
        self.h.place(self.side, A)
        self.h.fingers(self.side, final[1])
        return A, final
