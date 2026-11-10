"""Braço de dois ossos (o mesmo do jogo: `viewmodel.ts solveElbow` e `arms.ts solve`), para pôr o braço e o antebraço
de cada quadro. Ombros fixos no espaço da câmera; o cotovelo pela lei dos cossenos com um polo escrito na animação
(para fora e para baixo, por padrão). Metade do giro do pulso vai para o antebraço (a pele do pulso não torce)."""
import math

from mathutils import Matrix, Quaternion, Vector

from .rig import K
from .space import mg

UPPER = 0.29
FORE = 0.26
SHOULDER = {1: Vector((0.2, -0.35, 0.1)), -1: Vector((-0.26, -0.32, -0.08))}
ELBOW_MAX_Z = -0.08


def shoulder(side):
    return SHOULDER[side].copy()


def solve_elbow(side, wrist, pole=None):
    S = shoulder(side)
    D = wrist - S
    d = max(abs(UPPER - FORE) + 1e-3, min(UPPER + FORE - 1e-3, D.length))
    D.normalize()
    along = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d)
    h = math.sqrt(max(0.0, UPPER * UPPER - along * along))
    P = Vector(pole) if pole is not None else Vector((side * 0.7, -1, 0.15))
    P = (P - D * P.dot(D)).normalized()
    E = S + D * along + P * h
    E.z = min(E.z, ELBOW_MAX_Z)
    return E


def _frame(at, y, x):
    y = y.normalized()
    x = (x - y * x.dot(y))
    if x.length < 1e-6:
        x = Vector((1, 0, 0)) - y * y.x
    x.normalize()
    z = x.cross(y)
    M = Matrix((x, y, z)).transposed().to_4x4()
    M.translation = at
    return M


class ArmSolver:
    def __init__(self, rig):
        self.rig = rig
        rig.begin()
        self.hinge = {}
        for side, s in ((1, '_r'), (-1, '_l')):
            S0 = rig.head('upperarm' + s)
            E0 = rig.head('forearm' + s)
            W0 = rig.head('hand' + s)
            n0 = (E0 - S0).cross(W0 - E0)
            x0 = rig.world('forearm' + s).to_3x3() @ Vector((1, 0, 0))
            self.hinge[side] = 1 if n0.dot(x0) >= 0 else -1
        self.last = {1: Vector((1, 0, 0)), -1: Vector((1, 0, 0))}

    def solve(self, side, H, elbow):
        """`H`: a matriz do osso da mão (espaço do jogo); `elbow`: o cotovelo pedido. Põe braço, antebraço e mão."""
        s = '_r' if side > 0 else '_l'
        W = H.translation.copy()
        E = W + (elbow - W).normalized() * FORE
        Sh = shoulder(side)
        S2 = E + (Sh - E).normalized() * UPPER
        N = (E - S2).cross(W - E)
        if N.length > 1e-6:
            self.last[side] = N.normalized() * self.hinge[side]
        x = self.last[side]
        U = _frame(S2, E - S2, x)
        F = _frame(E, W - E, x)
        # metade do giro do pulso em volta do antebraço
        rel = F.to_3x3().inverted() @ H.to_3x3() @ self._hand_rest_rot(s).inverted()
        q = rel.to_quaternion()
        tw = 2 * math.atan2(q.y, q.w)
        half = math.atan2(math.sin(tw), math.cos(tw)) * 0.5
        F = F @ Matrix.Rotation(half, 4, 'Y')
        self.rig.set_world('upperarm' + s, U)
        self.rig.set_world('forearm' + s, F)
        self.rig.set_world('hand' + s, H)
        return E

    def _hand_rest_rot(self, s):
        """giro de descanso da mão em relação ao antebraço"""
        bone = self.rig.arm.data.bones['hand' + s]
        rest = bone.parent.matrix_local.inverted() @ bone.matrix_local
        return (K @ mg(rest) @ K.inverted()).to_3x3()
