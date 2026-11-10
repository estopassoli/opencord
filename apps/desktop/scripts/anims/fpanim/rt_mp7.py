"""MP7 com movimento de referência (ADR-0061, adendo): idle, saque, guardar e tiro vêm do "AK-74M" de LokitoBlu; as duas
recargas (pente no punho) do "Pistol" dele (CC BY 4.0). Corrida, corrida tática, golpe e inspeção são escritos à mão
(`clips_mp7.py`) em cima da pegada que sai do idle de referência.

As mãos e a arma são as nossas: a arma de origem vira o MP7 pelo punho (`retarget.grip_frame`), a mão de apoio vai do
guarda-mão do AK para a frente de baixo da caixa do MP7 (a mesma pegada de guarda-mão, por baixo), e na recarga da
pistola o pente curto dela vira o nosso, mais comprido: com a mão no pente, ela pega mais embaixo.
"""
import math
import os

import bpy
from mathutils import Matrix, Quaternion, Vector

from . import source
from .retarget import Retarget, anat, grip_frame, rot, src_bones

SRC_DIR = os.environ.get('ANIM_SRC', '')
AK = 'ak74m/model.glb'
PISTOL = 'pistol/model.glb'
FPS = 30
KNUCKLE = 0.09  # pulso → nó do médio na nossa mão (m)


def _bones():
    b = src_bones(1) + src_bones(-1)
    return b


def extract(path, gun_bone, mag_bone, slide_bone, clips):
    """lê um arquivo de origem e devolve o descanso, o punho da arma e os quadros pedidos; depois apaga tudo da cena"""
    src = source.load(path)
    bones = _bones()
    have = [b for b in [gun_bone, mag_bone, slide_bone] if b in src['names']]
    rest = source.rest(src, bones)
    rest_side = {1: {k: v for k, v in rest.items() if k.startswith('r_')},
                 -1: {k: v for k, v in rest.items() if k.startswith('l_')}}
    # o punho da arma: os pontos da malha perto da altura do nó do médio da direita, no idle
    fr, _ = source.sample(src, 'Idle', bones + have, FPS)
    G0 = fr[0][1][gun_bone]
    mid = G0.inverted() @ fr[0][1]['r_middle_low'].translation
    pts = source.gun_points(src, gun_bone)
    near = [p for p in pts if mid.y - 3.2 < p.y < mid.y - 0.3 and mid.z - 4.0 < p.z < mid.z + 0.5 and abs(p.x) < 2.0]
    gc, ga = grip_frame(near)
    mpts = source.gun_points(src, mag_bone) if mag_bone in src['names'] else []
    mag_len = (max(p.y for p in mpts) - min(p.y for p in mpts)) if mpts else 0.0
    data = {}
    for c in clips:
        frames, L = source.sample(src, c, bones + have, FPS)
        data[c] = {'len': L, 'frames': frames}
    for o in src['objs']:
        bpy.data.objects.remove(o, do_unlink=True)
    return {'rest': rest_side, 'grip': (gc, ga), 'mag_len': mag_len, 'clips': data, 'gun': gun_bone,
            'mag': mag_bone, 'slide': slide_bone}


class Mapper:
    """da origem (espaço da câmera dela, unidades do arquivo) para o nosso (espaço da câmera do jogo, metros)"""

    def __init__(self, ex, rig, our_grip_center, our_grip_axis):
        self.ex = ex
        rig.begin()
        our = {1: {}, -1: {}}
        for side, sfx in ((1, '_r'), (-1, '_l')):
            for n in ['hand'] + [f + str(i) for f in ('index', 'middle', 'ring', 'pinky', 'thumb') for i in (1, 2, 3)]:
                our[side][n + sfx] = rig.world(n + sfx)
        R = ex['rest'][1]
        s = KNUCKLE / (R['r_middle_low'].translation - R['r_wrist'].translation).length
        self.s = s
        self.rt = Retarget(ex['rest'], our, s)
        self.our = our
        # a mão: a relação fixa entre o referencial anatômico e o osso da mão, em cada lado
        self.hand_rel = {side: self.rt.A_our[side].inverted() @ our[side]['hand' + ('_r' if side > 0 else '_l')]
                         for side in (1, -1)}
        # a arma de origem → a nossa, pelo punho: primeiro o giro de 180° (o cano dela vai para +z), depois o eixo do
        # punho dela no nosso, e o centro no centro
        gc, ga = ex['grip']
        Ry = Matrix.Rotation(math.pi, 3, 'Y')
        a1 = Ry @ ga
        # o cano fica na mesma direção do de origem (girar pelo punho inclinava o MP7 ~28° para baixo); a diferença de
        # inclinação dos punhos fica com a mão (corrigida depois pelo encaixe)
        Rx = Matrix.Identity(3)
        Rm = Rx @ Ry
        t = Vector(our_grip_center) - Rm @ (gc * s)
        T = Rm.to_4x4()
        T.translation = t
        self.T = T  # ponto da arma de origem (metros) → ponto da nossa arma
        self.Ti = T.inverted()
        # deslocamento do conjunto no espaço da câmera (a câmera de origem tem outro campo de visão: o quadril vai
        # para o enquadramento do jogo)
        self.off = Vector()

    def set_T(self, T):
        self.T = T
        self.Ti = T.inverted()

    def sc(self, M):
        # só o giro (o objeto do esqueleto de origem pode vir escalado) e a posição em metros
        N = M.to_3x3().normalized().to_4x4()
        N.translation = M.translation * self.s + self.off
        return N

    def gun(self, mats):
        return self.sc(mats[self.ex['gun']]) @ self.Ti

    def hand(self, side, mats):
        p = 'r_' if side > 0 else 'l_'
        o = self.off
        A = anat([mats[p + 'wrist'].translation * self.s + o, mats[p + 'middle_low'].translation * self.s + o,
                  mats[p + 'index_low'].translation * self.s + o, mats[p + 'pinky_low'].translation * self.s + o])
        return A @ self.hand_rel[side]

    def elbow(self, side, mats):
        p = 'r_' if side > 0 else 'l_'
        return mats[p + 'forearm'].translation * self.s + self.off

    def fingers(self, side, mats):
        rots, Asrc = self.rt.finger_world_rots(side, mats)
        R = rot(Asrc)
        return {k: R @ v for k, v in rots.items()}

    def part_delta(self, mats, mats0, bone):
        """o deslocamento de uma peça (pente, ferrolho) a partir do primeiro quadro, no espaço da NOSSA arma"""
        G = self.sc(mats[self.ex['gun']])
        G0 = self.sc(mats0[self.ex['gun']])
        P = G.inverted() @ self.sc(mats[bone])
        P0 = G0.inverted() @ self.sc(mats0[bone])
        D = P @ P0.inverted()
        return self.T @ D @ self.Ti


# ---------------------------------------------------------------------------------------------------------- clipes

def smooth(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def mlerp(A, B, w):
    pa, qa, _ = A.decompose()
    pb, qb, _ = B.decompose()
    M = qa.slerp(qb, w).to_matrix().to_4x4()
    M.translation = pa.lerp(pb, w)
    return M


class RTClip:
    """clipe já resolvido: por quadro (30 qps), tudo no espaço da câmera do jogo (metros)"""

    def __init__(self, name, frames, loop=False, events=None):
        self.name, self.frames, self.loop = name, frames, loop
        self.len = (len(frames) - 1) / FPS
        self.events = events or {}

    def at(self, t):
        i = max(0, min(len(self.frames) - 1, int(round(t * FPS))))
        return self.frames[i]


def relpose(mapper, mats, side, W):
    """mão, cotovelo e dedos de um lado, em relação à arma (espaço da nossa arma)"""
    H = mapper.hand(side, mats)
    E = mapper.elbow(side, mats)
    F = mapper.fingers(side, mats)
    Wi = W.inverted()
    return Wi @ H, Wi @ E, {k: Wi.to_3x3().to_4x4() @ v for k, v in F.items()}


def build(anim, src_dir):
    """lê as duas fontes e monta os clipes; ajusta a pegada de apoio (do guarda-mão do AK para a frente de baixo do
    MP7) e devolve (clipes, a pose de quadril, as pegadas que os clipes escritos à mão usam)"""
    rig, gun = anim.rig, anim.gun
    # o centro e o eixo do nosso punho (na altura do nó do médio), medidos na malha
    b = gun.parts['body']['bvh']
    yc = -0.02
    f = b.ray_cast(Vector((0, yc, -0.2)), Vector((0, 0, 1)), 0.4)[0]
    k = b.ray_cast(Vector((0, yc, 0.2)), Vector((0, 0, -1)), 0.4)[0]
    our_center = Vector((0, yc, (f.z + k.z) / 2))
    our_axis = Vector((0, 1, 0))
    ak = extract(os.path.join(src_dir, AK), 'Gun', 'Magazine', 'Slide', ['Idle', 'Draw', 'Not_Draw', 'Shot'])
    m_ak = Mapper(ak, rig, our_center, our_axis)
    pi = extract(os.path.join(src_dir, PISTOL), 'Weapon', 'Mag', 'Slide', ['Idle', 'Reload_Fast', 'Reload_Complete'])
    m_pi = Mapper(pi, rig, our_center, our_axis)
    f0 = ak['clips']['Idle']['frames'][0][1]
    W0 = m_ak.gun(f0)
    # o quadril no enquadramento do jogo (a arma onde ficava antes, `HIP_TARGET`)
    m_ak.off = Vector(HIP_TARGET) - W0.translation
    m_pi.off = m_ak.off.copy()
    W0 = m_ak.gun(f0)
    # a direita no NOSSO punho: a arma anda uns milímetros por baixo da mão até nada entrar e a mão encostar
    d = grip_fix(anim, m_ak, f0, W0)
    m_ak.set_T(Matrix.Translation(-d) @ m_ak.T)
    W0 = m_ak.gun(f0)
    # a pegada de apoio de referência levada para a frente de baixo da caixa do MP7: anda na linha da arma até a palma
    # ficar embaixo do trilho da frente e sobe até encostar
    HL0, EL0, FL0 = relpose(m_ak, f0, -1, W0)
    shift = support_shift(anim, HL0, FL0, float(os.environ['ANIM_WRIST_Z']) if os.environ.get('ANIM_WRIST_Z') else None)
    HR0, ER0, FR0 = relpose(m_ak, f0, 1, W0)

    def frame_from(mapper, mats, W, Lrel=None, Rrel=None, mag=None, pull=0.0, sup=1.0, mh=0.0, rounds=1.0):
        out = {'W': W, 'mag': mag or Matrix(), 'pull': pull, 'ctl': (sup, mh, rounds)}
        for side in (1, -1):
            rel = (Rrel if side > 0 else Lrel) or relpose(mapper, mats, side, W)
            H, E, F = rel
            out[side] = (W @ H, W @ E, {k: W.to_3x3().to_4x4() @ v for k, v in F.items()})
        return out

    def ak_clip(name, src_name, loop=False):
        frames = []
        fr = ak['clips'][src_name]['frames']
        Lrel_idle = (HL0, EL0, FL0)
        for t, mats in fr:
            W = m_ak.gun(mats)
            Hl, El, Fl = relpose(m_ak, mats, -1, W)
            # a esquerda perto da pegada de idle (no guarda-mão): vai para a frente do MP7 junto
            d = (Hl.translation - HL0.translation).length
            w = 1 - smooth((d - 0.03) / 0.08)
            S = Matrix.Translation(shift * w)
            frames.append(frame_from(m_ak, mats, W, Lrel=(S @ Hl, S @ El, Fl), sup=w))
        return RTClip(name, frames, loop)

    clips = [ak_clip('idle', 'Idle', loop=True), ak_clip('draw', 'Draw'), ak_clip('holster', 'Not_Draw'),
             ak_clip('fire', 'Shot')]
    # mirando: o primeiro quadro do idle, parado
    idle0 = clips[0].frames[0]
    clips.append(RTClip('ads', [idle0] * 31, loop=True))
    # recargas da pistola, a partir da pose de quadril do AK
    pf0 = pi['clips']['Idle']['frames'][0][1]
    Wp_home = m_pi.gun(pf0)
    HLp0, _, _ = relpose(m_pi, pf0, -1, Wp_home)
    our_mag_len = anim.mag_len
    dL = max(0.0, our_mag_len - pi['mag_len'] * m_pi.s)

    def reload_clip(name, src_name, events):
        fr = pi['clips'][src_name]['frames']
        Wp0 = m_pi.gun(fr[0][1])
        frames = []
        for t, mats in fr:
            Wp = m_pi.gun(mats)
            W = W0 @ (Wp0.inverted() @ Wp)
            Hl, El, Fl = relpose(m_pi, mats, -1, Wp)
            # em casa (as duas mãos no punho da pistola) → a pegada de apoio do AK, na frente do MP7
            d = (Hl.translation - HLp0.translation).length
            w = 1 - smooth((d - 0.03) / 0.07)
            S = Matrix.Translation(shift)
            Hs = S @ HL0
            Hl2 = mlerp(Hl, Hs, w)
            El2 = El.lerp(S @ EL0, w)
            Fl2 = {k: mlerp(v, FL0[k], w) for k, v in Fl.items()}
            D = m_pi.part_delta(mats, fr[0][1], 'Mag') if 'Mag' in mats else Matrix()
            # a mão no pente (perto dele): pega mais embaixo no nosso, que é mais comprido
            Mp = Wp.inverted() @ m_pi.sc(mats['Mag']) if 'Mag' in mats else None
            mh = 0.0
            if Mp is not None:
                dm = (Hl.translation - m_pi.T @ Mp.translation).length
                mh = 1 - smooth((dm - 0.07) / 0.05)
            down = D.to_3x3() @ Vector((0, -dL * mh * (1 - w), 0))
            Hl2 = Matrix.Translation(down) @ Hl2
            El2 = El2 + down
            moved = D.translation.length
            pull = 0.0
            if 'Slide' in mats:
                Ds = m_pi.part_delta(mats, fr[0][1], 'Slide')
                pull = max(0.0, Ds.translation.z)
            frames.append(frame_from(m_pi, mats, W, Lrel=(Hl2, El2, Fl2), Rrel=(HR0, ER0, FR0), mag=D, pull=pull,
                                     sup=w, mh=mh * (1 - w), rounds=1.0 if moved > 0.004 else 1.0))
        for i in range(0, len(frames), 10):
            Wf = frames[i]['W']
            print('W', name, i, [round(x, 3) for x in Wf.translation], [round(x, 2) for x in Wf.to_euler('YXZ')],
                  'R', [round(x, 3) for x in frames[i][1][0].translation], flush=True)
        return RTClip(name, frames, events=events)

    for t, mats in pi['clips']['Reload_Fast']['frames'][::10]:
        print('PISTOLA', round(t, 2), [round(x, 3) for x in m_pi.gun(mats).translation], flush=True)
    print('EIXOS', 'ak', [round(x, 3) for x in ak['grip'][1]], 'pistola', [round(x, 3) for x in pi['grip'][1]], 'W0', [round(x, 3) for x in W0.translation], [round(x, 3) for x in W0.to_euler('YXZ')], flush=True)
    clips.append(reload_clip('reload', 'Reload_Fast', {'magOut': 0.18, 'magIn': 0.6}))
    clips.append(reload_clip('reloadEmpty', 'Reload_Complete', {'magOut': 0.18, 'magIn': 0.6, 'charge': 0.8}))
    holds = {'AR': HR0, 'AL': Matrix.Translation(shift) @ HL0, 'FR': FR0, 'FL': FL0}
    return clips, W0, holds


HIP_TARGET = (0.1, -0.11, -0.34)


def grip_fix(anim, mapper, f0, W0):
    """o deslocamento (espaço da nossa arma) que tira a direita de dentro do punho e encosta a palma/dedos nele"""
    from .hands import gaps
    H, E, F = relpose(mapper, f0, 1, W0)
    I = Matrix()
    best = (1e9, Vector())
    steps = [i * 0.005 for i in range(-8, 9)]
    for dx in steps:
        for dy in steps:
            for dz in steps:
                dv = Vector((dx, dy, dz))
                anim.rig.begin()
                anim.rig.set_world('hand_r', Matrix.Translation(-dv) @ H)
                for k, v in F.items():
                    anim.rig.set_world_rot(k, v)
                g = gaps(anim.hands, 1, anim.gun, I)
                pen = max(0.0, -min(x[2] for x in g) - 0.001)
                segs = {}
                for part, kk, gg, _ in g:
                    if part in ('middle', 'ring', 'pinky', 'palm'):
                        segs[(part, kk if part != 'palm' else 0)] = min(segs.get((part, kk if part != 'palm' else 0), 9), gg)
                con = sum(max(0.0, v) for v in segs.values())
                c = pen * 100 + con + dv.length * 0.3
                if c < best[0]:
                    best = (c, dv)
    print('PUNHO', [round(x, 3) for x in best[1]], round(best[0], 4), flush=True)
    return best[1]


def support_shift(anim, HL0, FL0, wrist_z=None):
    """quanto a pegada de apoio de referência anda (espaço da arma) para a palma ficar embaixo da frente da caixa do
    MP7: para a frente (o pulso em `wrist_z`) e depois para cima até a mão encostar"""
    from .hands import gaps
    I = Matrix()
    shift = Vector((0, 0, 0))
    if wrist_z is not None:
        shift.z = wrist_z - HL0.translation.z
    best = None
    for dy in [i * 0.003 for i in range(-40, 30)]:
        S = Matrix.Translation(shift + Vector((0, dy, 0)))
        anim.rig.begin()
        anim.rig.set_world('hand_l', S @ HL0)
        for k, v in FL0.items():
            anim.rig.set_world_rot(k, v)
        g = gaps(anim.hands, -1, anim.gun, I)
        m = min(x[2] for x in g)
        if abs(dy * 1000 % 30) < 1:
            w = min(g, key=lambda x: x[2])
            print('  dy', round(dy, 3), 'min', round(m * 1000, 1), w[0], w[3], flush=True)
        if m < -0.001:
            if best is not None:
                break
            continue
        best = dy
    print('APOIO', [round(x, 3) for x in HL0.translation], 'deslocado', [round(x, 3) for x in shift], 'sobe', best, flush=True)
    return shift + Vector((0, best or 0.0, 0))
