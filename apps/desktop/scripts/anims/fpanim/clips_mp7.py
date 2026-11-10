"""Os clipes do MP7, escritos à mão (tempo em segundos, deslocamentos da arma a partir da pose de quadril, no espaço da
câmera: posição em metros e giro YXZ em rad; rx > 0 levanta a boca, ry > 0 vira a boca para a esquerda, rz > 0 deita
o topo para a esquerda).

Princípios usados (ADR-0061): antecipação antes de cada movimento grande, chegada devagar no contato (a mão "acha" a
peça), tranco curto e assentamento em ondas que decaem nos encaixes, mão de apoio andando em arco (por fora e por
baixo da arma, nunca atravessando), a mão de apoio chegando depois da arma (sobreposição) e silhuetas que leem na
vista do jogador (o pente e a mão aparecem no terço de baixo, nada tapa o centro).
"""
import math

from mathutils import Matrix, Quaternion, Vector

from .bake import POUCH, Clip, HandTrack
from .motion import Curve
from .space import look_basis, trs


def W(t, px=0, py=0, pz=0, rx=0, ry=0, rz=0, o=''):
    return (t, (px, py, pz, rx, ry, rz), o)


def k(t, space, A, pose, ease='io', tag=None, opts=''):
    return (t, space, A, pose, ease, tag, opts)


def grip_right(a, length):
    return HandTrack([k(0, 'gun', a.AR, a.PR, tag='grip'), k(length, 'gun', a.AR, a.PR, tag='grip')])


def cam(pos, fwd=(0.3, 0.2, -1), up=(-0.8, 0.4, 0.2)):
    """âncora no espaço da câmera (mão solta): posição, para onde os dedos apontam e para onde vai o dorso"""
    return trs(pos, look_basis(fwd, up))


def away(A, d=0.035, back=0.012, low=0.018):
    """a mão afastada da pegada pelo lado do dorso, um pouco para trás e para baixo (o indicador sai de baixo da caixa):
    é por aí que ela chega e sai sem os dedos atravessarem a peça (espaço da esquerda: dorso +y, pulso +z, indicador +x)"""
    return A @ trs((-low, d, back))


FG_DOWN = Vector((0, -math.cos(math.radians(10)), -math.sin(math.radians(10))))


def slide_off(A, d=0.075):
    """a mão descida pelo eixo da empunhadura (espaço da arma): a mão fechada só sai da barra por baixo dela"""
    return trs(FG_DOWN * d) @ A


def loose(a, P, k=0.45, thumb=True):
    """a pegada afrouxada: os dedos abrem um pouco e o polegar abre (para a barra passar pelo vão da mão); no pente
    o polegar só afrouxa junto (aberto, ele entrava no pente)"""
    from .motion import lerp_pose
    q = lerp_pose(P, a.P_open, k)
    if 'q' in q:
        from .hands import angle_to_q
        src = angle_to_q(a.P_open if thumb else P, q['side'])['q']
        for n in src:
            if n.startswith('thumb'):
                q['q'][n] = list(src[n])
        return q
    q['thumb'] = [list(t) for t in (a.P_open if thumb else P)['thumb']]
    return q


def under(A, d=0.07):
    """a mão abaixo da pegada no pente (no espaço do pente: −y desce pelo eixo dele): chega por baixo, aberta"""
    return trs((0, -d, 0)) @ A


def down_gun(A, dy, dx=0.0, dz=0.0):
    B = A.copy()
    B.translation = A.translation + Vector((dx, dy, dz))
    return B


# ---------------------------------------------------------------------------------------------------- laços

def idle(a):
    L = 4.0
    c = Clip('idle', L, loop=True)
    w = 2 * math.pi / L
    # respiração: sobe e desce devagar, a boca acompanha um pouco atrasada, um balanço lateral na metade do ritmo
    c.weapon_fn = lambda t: (0.0006 * math.sin(w * t * 0.5 * 2 + 1.0), 0.0016 * math.sin(w * t), 0.0008 * math.sin(w * t + 0.5),
                             0.0035 * math.sin(w * t - 0.6), 0.0015 * math.sin(w * t + 2.0), 0.002 * math.sin(2 * w * t))
    c.R = grip_right(a, L)
    c.L = HandTrack([k(0, 'gun', a.AL, a.PL, tag='support'), k(L, 'gun', a.AL, a.PL, tag='support')])
    return c.finish()


def ads(a):
    c = Clip('ads', 1.0, loop=True)
    c.R = grip_right(a, 1.0)
    c.L = HandTrack([k(0, 'gun', a.AL, a.PL, tag='support'), k(1.0, 'gun', a.AL, a.PL, tag='support')])
    return c.finish()


def sprint(a):
    L = 16 / 30
    c = Clip('sprint', L, loop=True)
    w = 2 * math.pi / L
    base = (-0.035, -0.055, 0.015, -0.18, 0.62, 0.38)
    # dois passos por volta: o peso cai em cada passo (y em 2×), a arma vai e volta de lado (x em 1×) e gira junto
    c.weapon_fn = lambda t: (base[0] + 0.016 * math.sin(w * t), base[1] - 0.012 * (0.5 + 0.5 * math.cos(2 * w * t)),
                             base[2] + 0.004 * math.cos(2 * w * t), base[3] + 0.035 * math.cos(2 * w * t + 0.6),
                             base[4] + 0.05 * math.sin(w * t + 0.4), base[5] + 0.06 * math.sin(w * t))
    c.R = grip_right(a, L)
    c.L = HandTrack([k(0, 'gun', a.AL, a.PL, tag='support'), k(L, 'gun', a.AL, a.PL, tag='support')])
    return c.finish()


def tac(a):
    L = 12 / 30
    c = Clip('tac', L, loop=True)
    w = 2 * math.pi / L
    base = (0.05, 0.05, 0.03, 0.95, 0.28, 0.48)
    c.weapon_fn = lambda t: (base[0] + 0.012 * math.sin(w * t), base[1] - 0.014 * (0.5 + 0.5 * math.cos(2 * w * t)),
                             base[2], base[3] + 0.05 * math.cos(2 * w * t + 0.5), base[4] + 0.04 * math.sin(w * t),
                             base[5] + 0.05 * math.sin(w * t + 0.3))
    c.R = grip_right(a, L)
    # a esquerda solta e balança como num passo de corrida, quase toda fora da tela embaixo à esquerda
    A0 = cam((-0.24, -0.5, -0.24), fwd=(0.3, 0.6, -0.6), up=(-0.9, 0.1, 0.3))
    c.L = HandTrack([k(0, 'cam', A0, a.P_relax), k(L, 'cam', A0, a.P_relax)])

    def swing(t, A):
        B = A.copy()
        s = math.sin(w * t)
        B.translation = A.translation + Vector((0.02 * s, 0.05 * s, -0.08 * s))
        return B

    c.Lfn = swing
    return c.finish()


# ---------------------------------------------------------------------------------------------------- saque

DRAW_FROM = dict(px=0.07, py=-0.26, pz=0.06, rx=-0.95, ry=0.4, rz=0.35)


def draw(a):
    L = 0.6
    c = Clip('draw', L)
    # sobe de baixo e da direita girando; o cano sobe por último, passa um pouco do ponto e assenta
    c.weapon = Curve([W(0, **DRAW_FROM), W(0.22, 0.03, -0.07, 0.02, -0.32, 0.16, 0.14), W(0.4, 0.0, 0.006, -0.004, 0.045, -0.01, -0.02),
                      W(0.5, rx=-0.008, o='stop'), W(L, o='stop')])
    c.jolts = [(0.42, (0.0, 0.0, 0.0, 0.0)), (0.46, (0.25, -0.15, 0.02, 0.0))]
    c.R = grip_right(a, L)
    # a esquerda chega depois da arma: vem aberta de baixo, por fora, e fecha no apoio
    c.L = HandTrack([k(0, 'cam', cam((-0.2, -0.52, -0.2)), a.P_open),
                     k(0.2, 'cam', cam((-0.17, -0.36, -0.32)), a.P_open),
                     k(0.34, 'gun', slide_off(a.AL), loose(a, a.PL), tag='support'),
                     k(0.44, 'gun', a.AL, loose(a, a.PL), ease='o', tag='support'),
                     k(0.52, 'gun', a.AL, a.PL, tag='support'), k(L, 'gun', a.AL, a.PL, tag='support')])
    return c.finish()


def holster(a):
    L = 0.45
    c = Clip('holster', L)
    c.weapon = Curve([W(0), W(0.08, py=0.01, rx=0.05, o='stop'), W(0.3, 0.04, -0.12, 0.03, -0.5, 0.25, 0.2),
                      W(L, **DRAW_FROM)])
    c.R = grip_right(a, L)
    c.L = HandTrack([k(0, 'gun', a.AL, a.PL, tag='support'), k(0.05, 'gun', a.AL, loose(a, a.PL), tag='support'),
                     k(0.16, 'gun', slide_off(a.AL), loose(a, a.PL), ease='i'),
                     k(L, 'cam', cam((-0.22, -0.55, -0.18)), a.P_relax)])
    return c.finish()


# ---------------------------------------------------------------------------------------------------- tiro e golpe

def fire(a):
    L = 0.2
    c = Clip('fire', L)
    # o coice de verdade é a mola do jogo; aqui só a reação das mãos: a direita aperta o punho, a esquerda segura
    c.weapon = Curve([W(0), W(0.033, pz=0.005, rx=0.012, o='stop'), W(0.12, pz=0.0008, rx=0.002), W(L, o='stop')])
    c.R = HandTrack([k(0, 'gun', a.AR, a.PR, tag='grip'), k(0.033, 'gun', a.AR, squeeze(a.PR, 0.015), ease='o', tag='grip'),
                     k(L, 'gun', a.AR, a.PR, tag='grip')])
    c.L = HandTrack([k(0, 'gun', a.AL, a.PL, tag='support'), k(0.05, 'gun', a.AL, squeeze(a.PL, 0.015), ease='o', tag='support'),
                     k(L, 'gun', a.AL, a.PL, tag='support')])
    return c.finish()


def squeeze(p, d):
    q = {kk: [list(v) for v in vv] if kk == 'thumb' else list(vv) for kk, vv in p.items()}
    for f in ('middle', 'ring', 'pinky'):
        q[f][1] += d
        q[f][2] += d * 0.5
    return q


def melee(a):
    L = 0.5
    c = Clip('melee', L)
    # antecipa (a arma recua para a direita e gira), golpeia para a frente e para a esquerda (deitando) e volta
    c.weapon = Curve([W(0), W(0.16, 0.045, -0.02, 0.07, 0.05, -0.28, -0.25, o='stop'),
                      W(0.3, -0.1, 0.035, -0.17, 0.12, 0.42, 0.72, o='stop'), W(0.36, -0.095, 0.03, -0.16, 0.1, 0.4, 0.68),
                      W(L, o='stop')])
    c.jolts = [(0.3, (-0.4, 0.3, 0.0, 0.08))]
    c.R = grip_right(a, L)
    c.L = HandTrack([k(0, 'gun', a.AL, a.PL, tag='support'), k(L, 'gun', a.AL, a.PL, tag='support')])
    return c.finish()


# ---------------------------------------------------------------------------------------------------- recargas

RELOAD_POSE = dict(px=-0.045, py=0.075, pz=0.035, rx=0.34, ry=0.16, rz=-0.42)


def _mag_track(a, keys):
    return HandTrack([(t, sp, A, None, e, None, o) for t, sp, A, e, o in keys])


def reload(a, empty=False):
    L = 2.3 if empty else 1.9
    c = Clip('reloadEmpty' if empty else 'reload', L)
    # tempos do jogo (frações de `reloadMs`): o pente sai em 0,18 e entra em 0,6 (sons do `game.ts`); vazia: alavanca em 0,8
    t_out = 0.18 * L
    t_in = 0.6 * L
    rp = RELOAD_POSE
    tilt = W(0.32, **rp)
    hold = W(0.62 * L, rp['px'], rp['py'] + 0.005, rp['pz'], rp['rx'] + 0.03, rp['ry'], rp['rz'] + 0.02)
    if not empty:
        c.weapon = Curve([W(0), W(0.1, 0.005, -0.008, 0.0, -0.03, 0.0, 0.05, o='stop'), tilt,
                          W(t_out + 0.05, rp['px'], rp['py'] + 0.006, rp['pz'], rp['rx'] - 0.03, rp['ry'], rp['rz']),
                          W(0.5 * L, rp['px'], rp['py'] - 0.006, rp['pz'], rp['rx'] + 0.02, rp['ry'] + 0.02, rp['rz'] - 0.03),
                          hold, W(0.86 * L, 0.004, 0.006, 0, 0.03, 0.01, -0.03), W(L, o='stop')])
    else:
        c.weapon = Curve([W(0), W(0.1, 0.005, -0.008, 0.0, -0.03, 0.0, 0.05, o='stop'), tilt,
                          W(t_out + 0.05, rp['px'], rp['py'] + 0.006, rp['pz'], rp['rx'] - 0.03, rp['ry'], rp['rz']),
                          W(0.45 * L, rp['px'], rp['py'] - 0.006, rp['pz'], rp['rx'] + 0.02, rp['ry'] + 0.02, rp['rz'] - 0.03),
                          W(t_in, rp['px'], rp['py'] + 0.004, rp['pz'], rp['rx'] + 0.02, rp['ry'], rp['rz']),
                          # alavanca: a arma deita para a esquerda e vem para perto (o topo de trás aparece)
                          W(0.7 * L, -0.03, 0.05, 0.0, 0.12, -0.05, 0.38, o='stop'),
                          W(0.8 * L, -0.025, 0.045, 0.012, 0.1, -0.05, 0.36),
                          W(0.9 * L, 0.004, 0.004, 0.0, 0.02, 0.0, -0.02), W(L, o='stop')])
    c.jolts = [(t_out, (-0.25, 0.1, -0.015, 0.0)), (t_in, (0.55, -0.2, 0.05, 0.02))]
    if empty:
        c.jolts.append((0.8 * L, (0.4, -0.25, 0.03, -0.03)))
    c.R = grip_right(a, L)
    M0 = a.M0
    mag_hand = a.ALmag.inverted()  # o pente no espaço da mão (pegando o pente)
    Lk = [k(0, 'gun', a.AL, a.PL, tag='support'), k(0.05, 'gun', a.AL, loose(a, a.PL), ease='o', tag='support'),
          k(0.12, 'gun', slide_off(a.AL), loose(a, a.PL), ease='io')]
    Mk = [(0, 'gun', M0, 'io', ''), ]
    if not empty:
        # pega o pente: a mão sai do apoio por fora e por baixo e chega devagar no pente
        Lk += [k(0.2, 'mag', under(a.ALmag), loose(a, a.PLmag, 0.35, thumb=False), ease='io'),
               k(t_out - 0.04, 'mag', a.ALmag, loose(a, a.PLmag, 0.35, thumb=False), ease='io', tag='mag'),
               k(t_out, 'mag', a.ALmag, a.PLmag, ease='o', tag='mag')]
        # puxa reto para baixo pelo eixo do punho, e o leva ao colete por fora, em arco
        Mk += [(t_out, 'gun', M0, 'io', ''), (t_out + 0.02, 'handL', mag_hand, 'io', '')]
        Lk += [k(t_out + 0.14, 'gun', down_gun(a.ALmag_gun, -0.14, -0.006), a.PLmag, ease='i', tag='mag'),
               k(t_out + 0.27, 'cam', cam((-0.2, -0.36, -0.28)), a.PLmag, tag='mag', opts='pass'),
               k(0.42 * L, 'cam', POUCH, a.PLmag, tag='mag'),
               k(0.47 * L, 'cam', POUCH, a.PLmag, tag='mag')]
    else:
        # vazia: o polegar da direita aperta o retém e o pente cai sozinho; a mão já vai ao colete
        Lk += [k(0.22, 'cam', cam((-0.2, -0.36, -0.3)), a.P_open, opts='pass'),
               k(0.36 * L, 'cam', POUCH, a.P_relax),
               k(0.41 * L, 'cam', POUCH, a.PLmag, tag='mag')]
        # o pente cai (gravidade, girando um pouco) e sai da tela por baixo
        drop = []
        g = 9.8
        v0 = Vector((-0.05, -0.25, 0.04))
        for i in range(0, 9):
            dt = i * 0.035
            drop.append((t_out + 0.02 + dt, dt, v0 * dt + Vector((0, -0.5 * g * dt * dt, 0))))
        Mk += [(t_out, 'gun', M0, 'io', ''), (t_out + 0.02, 'gun', down_gun(M0, -0.012), 'o', '')]
        c._drop = drop
        c._drop_until = 0.41 * L - 0.001
        c.rounds = Curve([(0, (1,)), (t_out, (1,)), (t_out + 0.001, (0,)), (0.4 * L, (0,)), (0.4 * L + 0.001, (1,)), (L, (1,))])
    # volta com o pente cheio em arco, alinha embaixo do punho, entra devagar e é empurrado de uma vez
    t_back = 0.47 * L if not empty else 0.41 * L
    Mk += [(t_back, 'handL', mag_hand, 'io', '')]
    Lk += [k(t_back + 0.1, 'cam', cam((-0.18, -0.34, -0.3), fwd=(0.5, 0.4, -0.8)), a.PLmag, tag='mag', opts='pass'),
           k(t_in - 0.2, 'gun', down_gun(a.ALmag_gun, -0.06), a.PLmag, tag='mag')]
    # entrando: agora o pente manda (sobe pelo punho) e a mão vai junto
    # preso à mão até o quadro em que encosta no punho; dali em diante quem manda é a arma
    Mk += [(t_in - 0.2 - 1e-3, 'handL', mag_hand, 'io', ''),
           (t_in - 0.2, 'gun', down_gun(M0, -0.06), 'io', ''),
           (t_in - 0.1, 'gun', down_gun(M0, -0.014), 'o', ''),
           (t_in - 0.06, 'gun', down_gun(M0, -0.012), 'io', ''),
           (t_in, 'gun', M0, 'ii', ''), (L, 'gun', M0, 'io', '')]
    Lk += [k(t_in - 0.1, 'mag', a.ALmag, a.PLmag, tag='mag'),
           # solta, desce um pouco, espalma e bate por baixo (o tapa assenta o pente)
           k(t_in - 0.075, 'mag', under(a.ALmag, 0.035), loose(a, a.PLmag, 0.35, thumb=False), ease='o'),
           k(t_in - 0.035, 'gun', down_gun(a.Aslap, -0.035, -0.01), a.P_flat, ease='io'),
           k(t_in, 'gun', a.Aslap, a.P_flat, ease='ii', opts='pass'),
           k(t_in + 0.07, 'gun', down_gun(a.Aslap, -0.045, -0.02), a.P_open, ease='o')]
    if empty:
        # a mão sobe pela lateral esquerda até a alavanca em T, engancha, puxa e solta (a mola leva o ferrolho)
        Lk += [k(0.66 * L, 'gun', trs((-0.09, 0.02, -0.02)) @ a.ALch_gun, a.P_open, opts='pass'),
               k(0.705 * L, 'charge', trs((0, 0.035, 0.012)) @ a.ALch, a.P_open, ease='io'),
               k(0.73 * L, 'charge', a.ALch, a.P_open, ease='io'),
               k(0.755 * L, 'charge', a.ALch, a.PLch, ease='o'),
               k(0.8 * L - 0.02, 'charge', a.ALch, a.PLch),
               k(0.8 * L + 0.05, 'gun', trs((-0.015, 0.04, 0.03)) @ a.ALch_gun, a.P_open, ease='o'),
               k(0.86 * L, 'gun', trs((-0.09, -0.01, -0.06)) @ a.ALch_gun, a.P_open, opts='pass')]
        c.charge = Curve([(0, (0,)), (0.755 * L, (0,), 'stop'), (0.8 * L - 0.02, (0.062,), 'stop'),
                          (0.8 * L, (0.062,), 'stop'), (0.8 * L + 0.025, (0,), 'stop'), (L, (0,))])
        c.events = {'magOut': 0.18, 'magIn': 0.6, 'charge': 0.8}
        back = 0.94 * L
    else:
        Lk += [k(t_in + 0.2, 'cam', None, a.P_open, opts='pass')]
        c.events = {'magOut': 0.18, 'magIn': 0.6}
        back = t_in + 0.36
    Lk += [k(back, 'gun', slide_off(a.AL), loose(a, a.PL), tag='support'),
           k(back + 0.07, 'gun', a.AL, loose(a, a.PL), ease='o', tag='support'),
           k(back + 0.14, 'gun', a.AL, a.PL, tag='support'), k(L, 'gun', a.AL, a.PL, tag='support')]
    c.L = HandTrack(_fill_cam(Lk))
    c.mag = _mag_track(a, sorted(Mk, key=lambda x: x[0]))
    return c.finish()


def _fill_cam(keys):
    """chaves de passagem sem âncora (None): o meio do caminho entre a de antes e a de depois, por fora e por baixo da
    arma (preenchidas na hora, no espaço da câmera, a partir das vizinhas)"""
    return [_Pass(kk) if kk[2] is None else kk for kk in keys]


class _Pass(tuple):
    pass


# ---------------------------------------------------------------------------------------------------- inspeção

def inspect(a):
    L = 3.6
    c = Clip('inspect', L)
    A_ = dict(px=-0.07, py=0.05, pz=0.05, rx=0.12, ry=0.72, rz=0.32)  # lado esquerdo para a câmera
    B_ = dict(px=-0.02, py=0.055, pz=0.0, rx=0.16, ry=-0.3, rz=-0.72)  # lado direito: a arma deita (o topo e a direita à mostra), sem a coronha cruzar a tela
    C_ = dict(px=-0.035, py=0.08, pz=0.04, rx=0.48, ry=0.12, rz=-0.3)  # o pente para a câmera
    c.weapon = Curve([W(0), W(0.22, 0.004, -0.012, 0.01, -0.05, -0.06, 0.03, o='stop'),
                      W(0.62, A_['px'] * 1.05, A_['py'] * 1.05, A_['pz'], A_['rx'], A_['ry'] * 1.06, A_['rz'] * 1.05),
                      W(0.78, **A_), W(1.25, A_['px'], A_['py'] + 0.004, A_['pz'], A_['rx'] + 0.02, A_['ry'] - 0.04, A_['rz'], o='stop'),
                      W(1.45, -0.02, 0.07, 0.05, 0.16, 0.05, -0.05),
                      W(1.7, B_['px'], B_['py'] * 1.04, B_['pz'], B_['rx'], B_['ry'] * 1.06, B_['rz'] * 1.06),
                      W(1.86, **B_), W(2.3, B_['px'], B_['py'] - 0.004, B_['pz'], B_['rx'] - 0.02, B_['ry'] + 0.04, B_['rz'], o='stop'),
                      W(2.62, **C_), W(2.95, C_['px'], C_['py'], C_['pz'], C_['rx'] + 0.02, C_['ry'], C_['rz'] + 0.02, o='stop'),
                      W(3.3, 0.004, 0.006, 0, 0.03, 0.01, -0.03), W(L, o='stop')])
    c.jolts = [(0.78, (0.12, 0.1, 0.0, 0.0)), (1.86, (0.12, -0.1, 0.0, 0.0)), (2.86, (0.3, 0.0, 0.02, 0.0))]
    c.R = grip_right(a, L)
    M0 = a.M0
    c.L = HandTrack(_fill_cam([
        k(0, 'gun', a.AL, a.PL, tag='support'), k(2.3, 'gun', a.AL, a.PL, tag='support'),
        k(2.36, 'gun', a.AL, loose(a, a.PL), ease='o', tag='support'),
        k(2.44, 'gun', slide_off(a.AL), loose(a, a.PL)),
        k(2.56, 'mag', under(a.ALmag), loose(a, a.PLmag, 0.35, thumb=False)),
        k(2.64, 'mag', a.ALmag, loose(a, a.PLmag, 0.35, thumb=False), tag='mag'), k(2.7, 'mag', a.ALmag, a.PLmag, ease='o', tag='mag'),
        k(2.95, 'mag', a.ALmag, a.PLmag, tag='mag'),
        k(2.98, 'mag', a.ALmag, loose(a, a.PLmag, 0.35, thumb=False), ease='o'),
        k(3.06, 'mag', under(a.ALmag), loose(a, a.PLmag, 0.35, thumb=False), ease='o'),
        k(3.14, 'cam', None, a.P_open, opts='pass'),
        k(3.28, 'gun', slide_off(a.AL), loose(a, a.PL), tag='support'),
        k(3.36, 'gun', a.AL, loose(a, a.PL), ease='o', tag='support'), k(3.46, 'gun', a.AL, a.PL, tag='support'),
        k(L, 'gun', a.AL, a.PL, tag='support')]))
    # conferindo o pente: puxa uns milímetros e empurra de volta (tranco)
    c.mag = _mag_track(a, [(0, 'gun', M0, 'io', ''), (2.72, 'gun', M0, 'io', ''),
                           (2.8, 'gun', down_gun(M0, -0.007), 'o', ''), (2.84, 'gun', down_gun(M0, -0.007), 'io', ''),
                           (2.86, 'gun', M0, 'ii', ''), (L, 'gun', M0, 'io', '')])
    return c.finish()


ALL = [idle, ads, sprint, tac, draw, holster, fire, melee, lambda a: reload(a, False), lambda a: reload(a, True), inspect]
