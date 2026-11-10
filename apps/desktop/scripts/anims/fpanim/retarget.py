"""Movimento de referência (CC BY 4.0, LokitoBlu) levado para os NOSSOS braços (`assets/arms.glb`) e a NOSSA arma.

O que se aproveita do arquivo de origem é só o movimento: onde a arma está em relação à câmera, onde cada mão está em
relação à arma, quanto cada junta de dedo dobra e o pente. A malha, a arma e as texturas dele não vão para o jogo.

Como:
- escala pelo tamanho da mão (pulso → nó do médio: 9 cm na nossa);
- a arma de origem vira a nossa pelo punho (`grip_align`): o centro do punho dela cai no centro do nosso e o eixo do
  punho dela no eixo do nosso (o cano gira junto, poucos graus);
- a mão: um referencial anatômico (pulso, nós do indicador, do médio e do mindinho) em cada esqueleto; a nossa mão vai
  para o mesmo referencial da mão de origem;
- os dedos: o quanto cada osso girou a partir do descanso, no referencial da mão, aplicado ao nosso osso equivalente
  (metacarpo fica no descanso; base, meio e ponta; polegar em três ossos);
- o cotovelo: o da origem, escalado (o braço do jogo é resolvido do pulso até o ombro com ele).
"""
import math

from mathutils import Matrix, Quaternion, Vector

FING = ['index', 'middle', 'ring', 'pinky']
SEG_SRC = ['low', 'mid', 'tip']


def src_bones(side):
    p = 'r_' if side > 0 else 'l_'
    out = [p + 'upperarm', p + 'forearm', p + 'wrist']
    for f in FING + ['thumb']:
        out += [p + f + '_' + s for s in SEG_SRC]
    return out


def map_bone(side, src_name):
    """osso de origem → nosso"""
    sfx = '_r' if side > 0 else '_l'
    b = src_name[2:]
    f, s = b.rsplit('_', 1)
    return f + str(SEG_SRC.index(s) + 1) + sfx


def anat(points):
    """referencial da mão: origem no pulso, y para o nó do médio, x do mindinho para o indicador (sem sinal de lado:
    vale igual para as duas mãos porque compara mão com mão do mesmo lado)"""
    w, mid, idx, pin = points
    y = (mid - w).normalized()
    x = (idx - pin)
    x = (x - y * x.dot(y)).normalized()
    z = x.cross(y)
    M = Matrix((x, y, z)).transposed().to_4x4()
    M.translation = w
    return M


def rot(M):
    return M.to_3x3().normalized().to_4x4()


class Retarget:
    def __init__(self, src_rest, our_rest, scale):
        """`src_rest`/`our_rest`: {lado: {nome: matriz de descanso (espaço do próprio esqueleto)}}"""
        self.s = scale
        self.src_rest = src_rest
        self.our_rest = our_rest
        self.A_src = {}
        self.A_our = {}
        for side in (1, -1):
            p = 'r_' if side > 0 else 'l_'
            sfx = '_r' if side > 0 else '_l'
            R = src_rest[side]
            self.A_src[side] = anat([R[p + 'wrist'].translation, R[p + 'middle_low'].translation,
                                     R[p + 'index_low'].translation, R[p + 'pinky_low'].translation])
            O = our_rest[side]
            self.A_our[side] = anat([O['hand' + sfx].translation, O['middle1' + sfx].translation,
                                     O['index1' + sfx].translation, O['pinky1' + sfx].translation])

    def scaled(self, M):
        N = M.copy()
        N.translation = M.translation * self.s
        return N

    def hand(self, side, src_wrist_cam, src_frame_points):
        """a nossa âncora anatômica no espaço da câmera (metros) a partir dos pontos da mão de origem"""
        return anat([p * self.s for p in src_frame_points])

    def finger_world_rots(self, side, src_mats):
        """{nosso osso: giro no espaço da câmera} para os dedos, pelo giro de cada osso a partir do descanso, medido no
        referencial anatômico de cada mão"""
        p = 'r_' if side > 0 else 'l_'
        sfx = '_r' if side > 0 else '_l'
        Asrc_now = anat([src_mats[p + 'wrist'].translation, src_mats[p + 'middle_low'].translation,
                         src_mats[p + 'index_low'].translation, src_mats[p + 'pinky_low'].translation])
        Rs_now = rot(Asrc_now)
        Rs_rest = rot(self.A_src[side])
        Ro_rest = rot(self.A_our[side])
        out = {}
        for f in FING + ['thumb']:
            for i, sname in enumerate(SEG_SRC):
                b = p + f + '_' + sname
                ours = map_bone(side, b)
                # giro do osso de origem no referencial da mão, agora e no descanso
                # a direção de cada falange (y ao longo do osso, x no eixo da dobra nos dois esqueletos) é a mesma da
                # origem, no referencial da mão; comparar com o descanso não serve (o descanso dela é a mão fechada)
                out[ours] = Rs_now.inverted() @ rot(src_mats[b])
        return out, Asrc_now


def grip_frame(points, up_hint=Vector((0, 1, 0))):
    """centro e eixo de um punho a partir dos pontos dele: o centro de cada fatia na altura (y) e uma reta por eles
    (z em função de y), para o eixo não ser puxado pelo comprimento da arma"""
    c = sum(points, Vector()) / len(points)
    ys = sorted(p.y for p in points)
    lo, hi = ys[0], ys[-1]
    n = 6
    cs = []
    for i in range(n):
        a = lo + (hi - lo) * i / n
        b = lo + (hi - lo) * (i + 1) / n
        sl = [p for p in points if a <= p.y <= b]
        if len(sl) > 3:
            cs.append((sum(p.y for p in sl) / len(sl), (min(p.z for p in sl) + max(p.z for p in sl)) / 2))
    my = sum(y for y, _ in cs) / len(cs)
    mz = sum(z for _, z in cs) / len(cs)
    k = sum((y - my) * (z - mz) for y, z in cs) / max(1e-9, sum((y - my) ** 2 for y, _ in cs))
    axis = Vector((0, 1, k)).normalized()
    if axis.dot(up_hint) < 0:
        axis = -axis
    return Vector((c.x, my, mz)), axis
