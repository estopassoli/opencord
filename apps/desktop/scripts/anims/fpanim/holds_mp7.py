"""As pegadas do MP7 (a direita e as de apoio por restrições, `grip.py`; pente e alavanca por busca, `fit.py`) (espaço da arma; a do pente no espaço do pente, a da alavanca no da alavanca), encaixadas na malha
por `fit.py`. Calculadas uma vez (`mp7.py --holds`, ~10 min) e guardadas em `mp7-holds.json`; a animação lê de lá.

- `R`: direita no punho: indicador esticado sobre a armação, acima do guarda-mato; médio, anelar e mindinho dando a
  volta na frente do punho; polegar pela esquerda, para a frente.
- `L_fgrip` / `L_vgrip`: esquerda fechada em volta da empunhadura dobrável (a do MP7A1) ou da vertical do armeiro.
- `L_agrip`: a palma atrás da rampa da angulada, os dedos para a frente embaixo do guarda-mão, sem fechar.
- `L_mag` / `L_mag_ext`: esquerda pegando o pente pela parte que sai do punho (o estendido, mais embaixo).
- `L_charge`: esquerda com o indicador e o médio enganchados na asa esquerda da alavanca em T.
- `R_trigger`: só o indicador da direita, a ponta na lâmina do gatilho.
"""
import math

from mathutils import Matrix, Quaternion, Vector

from .space import basis, look_basis

GUN_PARTS = ('body', 'mag', 'charge', 'trigger', 'att', 'fgrip')


def _q(x, y, z):
    return list(basis(Vector(x).normalized(), Vector(y).normalized(), Vector(z).normalized()))


def _left_vertical(tilt_deg):
    """esquerda em volta de uma barra quase de pé: indicador em cima, dorso para a esquerda, dedos para a frente"""
    t = math.radians(tilt_deg)
    x = Vector((0, math.cos(t), math.sin(t)))
    y = Vector((-1, 0, 0))
    return list(basis(x, y, x.cross(y)))


PRE_FIST = {"index": [0, 1.2, 0.9, 0.4, 0], "middle": [0, 1.3, 0.9, 0.4, 0], "ring": [0.1, 1.35, 0.85, 0.4, 0.03],
            "pinky": [0.2, 1.4, 0.8, 0.4, 0.08], "thumb": [[0.25, -0.9, -0.45], [0.3, -0.05, 0], [0.2, 0, 0]]}
PRE_FLAT = {"index": [0, 0.2, 0.15, 0.1, -0.05], "middle": [0, 0.25, 0.15, 0.1, 0], "ring": [0.05, 0.3, 0.15, 0.1, 0.03],
            "pinky": [0.1, 0.35, 0.15, 0.1, 0.08], "thumb": [[0.1, -0.4, -0.3], [0.1, 0, 0], [0.1, 0, 0]]}


def specs(gun):
    fg_top = gun.points.get('fgrip_top')
    S = {}
    S['R'] = {
        'side': 1, 'quat': [0.7819, 0.0239, 0.0158, -0.6228], 'rot': (0.2, 0.2, 0.2), 'ref': 'middle1',
        'ref_box': ((0.035, -0.024, 0.005), (0.055, -0.01, 0.022)),
        'pre': {"index": [0, 0.12, 0.08, 0.05, -0.12], "middle": [0, 1.3, 0.9, 0.4, 0],
                "ring": [0.1, 1.35, 0.85, 0.4, 0.03], "pinky": [0.2, 1.4, 0.8, 0.4, 0.08],
                "thumb": [[0.25, -0.9, -0.45], [0.3, -0.05, 0], [0.2, 0, 0]]},
        'wrap': ['middle', 'ring', 'pinky'], 'thumb': (-0.021, 0.03, -0.022), 'n': 260,
    }
    if fg_top is not None:
        S['L_support'] = {
            'side': -1, 'quat': _left_vertical(10), 'rot': (0.4, 0.4, 0.4), 'ref': 'middle1',
            'ref_box': ((-0.05, -0.035, -0.195), (-0.022, -0.005, -0.16)), 'pre': PRE_FIST,
            'wrap': ['index', 'middle', 'ring', 'pinky'], 'thumb': (0.014, -0.002, -0.175), 'n': 260,
        }
    if 'vgrip_top' in gun.points:
        S['L_support'] = {
            'side': -1, 'quat': _left_vertical(8), 'rot': (0.4, 0.4, 0.4), 'ref': 'middle1',
            'ref_box': ((-0.05, -0.045, -0.19), (-0.022, -0.012, -0.155)), 'pre': PRE_FIST,
            'wrap': ['index', 'middle', 'ring', 'pinky'], 'thumb': (0.012, 0.004, -0.17), 'n': 260,
        }
    if 'agrip_at' in gun.points:
        S['L_support'] = {
            'side': -1, 'quat': list(look_basis((0.05, 0.1, -1), (-0.7, -0.7, 0))), 'rot': (0.45, 0.45, 0.45),
            'ref': 'middle1', 'ref_box': ((-0.03, -0.005, -0.25), (0.0, 0.018, -0.205)), 'pre': PRE_FLAT,
            'wrap': ['index', 'middle', 'ring', 'pinky'], 'lim': {f: (0.7, 0.6, 0.4) for f in ('index', 'middle', 'ring', 'pinky')},
            'thumb': (0.012, 0.01, -0.2), 'w': {'palm': 600.0, 'seg0': 1.0}, 'n': 260,
        }
    lo, hi = gun.box('mag')
    S['L_mag'] = {
        'side': -1, 'quat': _left_vertical(0), 'rot': (0.35, 0.35, 0.35), 'ref': 'middle1',
        'ref_box': ((-0.05, lo.y + 0.025, -0.06), (-0.02, lo.y + 0.05, -0.025)), 'pre': PRE_FIST,
        'wrap': ['index', 'middle', 'ring', 'pinky'], 'thumb': (0.014, lo.y + 0.04, 0.03), 'n': 220,
        'skip': ('body', 'charge', 'trigger', 'att', 'fgrip'),
    }
    cl, ch = gun.box('charge')
    S['L_charge'] = {
        'side': -1, 'quat': list(look_basis((1, -0.35, 0.1), (0, 0.3, -1))), 'rot': (0.4, 0.4, 0.4), 'ref': 'index2',
        'ref_box': ((cl.x - 0.012, ch.y - 0.008, ch.z - 0.04), (cl.x + 0.004, ch.y + 0.008, ch.z - 0.018)),
        'pre': {"index": [0, 0.9, 0.9, 0.4, 0], "middle": [0, 0.9, 0.9, 0.4, 0], "ring": [0.1, 1.2, 1.1, 0.5, 0.03],
                "pinky": [0.2, 1.3, 1.1, 0.5, 0.08], "thumb": [[0.2, -0.5, -0.3], [0.2, 0, 0], [0.2, 0, 0]]},
        'wrap': ['index', 'middle'], 'thumb': None, 'n': 220,
        'skip': ('mag', 'trigger', 'att', 'fgrip'),
    }
    return S


def slap_anchor(gun, ext=0.0):
    """esquerda espalmada embaixo do fundo do pente (empurra para cima): palma para cima, dedos para a direita"""
    lo, hi = gun.box('mag')
    q = look_basis((0.85, 0.05, -0.5), (0.05, -1, 0.1))
    A = q.to_matrix().to_4x4()
    # o meio da palma (~5 cm à frente do pulso) embaixo do pente
    mid = Vector(((lo.x + hi.x) / 2, lo.y - ext - 0.016, (lo.z + hi.z) / 2))
    A.translation = mid - q @ Vector((0, 0, -0.05))
    return A


# ------------------------------------------------------------------ pegadas por restrições (`grip.py`)

def _web(sfx):
    """a membrana entre o polegar e o indicador: um ponto fixo na mão (não anda quando o polegar gira)"""
    side = -1 if sfx == '_l' else 1
    return lambda hh: hh.anchor(side) @ Vector((-0.03 * side, -0.009, -0.069))


def _above(bone, y_min, sfx):
    return lambda hh: Vector((0, max(0.0, y_min - hh.rig.head(bone + sfx).y), 0))


def _heel(sfx):
    """a base da palma (perto do pulso, do lado da palma), no espaço da arma"""
    return lambda hh: hh.anchor(-1 if sfx == '_l' else 1) @ Vector((0, -0.016, -0.012))


def grip_specs(gun):
    """{nome: (lado, giro de partida (matriz), posição de partida, pré-pose, dedos que fecham, metas, polegar,
    indicador fixo, pesos, limites)}"""
    out = {}
    x = Vector((0, -1, -0.08)).normalized()
    y = Vector((1, 0, 0.12))
    y = (y - x * y.dot(x)).normalized()
    out['R'] = dict(side=1, base=(basis(x, y, x.cross(y)), (0.035, -0.012, 0.095)),
                    pre={"index": [0, 0.1, 0.12, 0.06, -0.08], "middle": [0, 1.3, 0.9, 0.4, 0],
                         "ring": [0.1, 1.35, 0.85, 0.4, 0.03], "pinky": [0.2, 1.4, 0.8, 0.4, 0.08],
                         "thumb": [[0.25, -0.9, -0.45], [0.3, -0.05, 0], [0.2, 0, 0]]},
                    wrap=['middle', 'ring', 'pinky'],
                    targets=[(_web('_r'), (0.004, 0.004, 0.06), 1.0), (_above('pinky1', -0.06, '_r'), (0, 0, 0), 3.0)],
                    thumb=(-0.019, 0.026, -0.03), index=[0, 0.1, 0.12, 0.06, -0.08],
                    weights={'arm': 40.0, 'contact': 400.0}, rot=0.35, starts=8)
    lx = Vector((0, 0.985, 0.17)).normalized()
    ly = Vector((-1, 0, 0))
    lv = basis(lx, ly, lx.cross(ly))

    def straight(wrist_gun, up=lx):
        """giro da esquerda em volta de uma barra de pé com o pulso reto: o dorso da mão continua o antebraço que o
        braço dá (ombro → pulso, `solve_elbow`) e o indicador fica para cima, na linha da barra"""
        from .bake import S0
        from .armik import solve_elbow
        w = S0 @ Vector(wrist_gun)
        E = solve_elbow(-1, w)
        z = (S0.inverted().to_3x3() @ (E - w)).normalized()
        x = (Vector(up) - z * Vector(up).dot(z)).normalized()
        return basis(x, z.cross(x), z)

    HOLE = Vector((0, -0.03, -0.068))  # o vão do punho fechado no espaço da mão (o eixo da barra passa por ele)

    def around(center, q):
        """a âncora com o eixo da barra passando pelo vão do punho"""
        return tuple(Vector(center) - q @ HOLE)
    fist = PRE_FIST
    if 'fgrip_top' in gun.points:
        qf = straight((-0.03, -0.02, -0.085))
        out['L_support'] = dict(side=-1, base=(qf, around((0, -0.0144, -0.1718), qf)), pre=fist,
                                wrap=['index', 'middle', 'ring', 'pinky'],
                                targets=[(_web('_l'), (-0.004, 0.012, -0.142), 1.0)],
                                thumb=(0.014, 0.008, -0.18), index=None, weights={'arm': 60.0, 'contact': 300.0}, rot=0.5, starts=6)
    if 'vgrip_top' in gun.points:
        qv = straight((-0.03, -0.03, -0.08))
        out['L_support'] = dict(side=-1, base=(qv, around((0, -0.03, -0.1686), qv)), pre=fist,
                                wrap=['index', 'middle', 'ring', 'pinky'],
                                targets=[(_web('_l'), (-0.004, 0.0, -0.146), 1.0)],
                                thumb=(0.014, -0.006, -0.176), index=None, weights={'arm': 60.0, 'contact': 300.0}, rot=0.5, starts=6)
    if 'agrip_at' in gun.points:
        from .bake import S0
        from .armik import solve_elbow
        w0 = Vector((-0.02, -0.04, -0.12))
        wc = S0 @ w0
        zf = (S0.inverted().to_3x3() @ (solve_elbow(-1, wc) - wc)).normalized()
        qa = look_basis(-zf, (-0.6, -0.8, 0.0))
        heel = Vector((-0.004, -0.004, -0.17))
        out['L_support'] = dict(side=-1, base=(qa, tuple(heel - qa @ Vector((0, -0.016, -0.012)))),
                                pre=PRE_FLAT, wrap=['index', 'middle', 'ring', 'pinky'],
                                lim={f: (0.8, 0.7, 0.5) for f in ('index', 'middle', 'ring', 'pinky')},
                                targets=[(_heel('_l'), (-0.004, -0.004, -0.17), 2.0)],
                                thumb=(0.014, 0.014, -0.2), index=None, weights={'arm': 60.0, 'contact': 150.0}, rot=0.3, starts=5)
    return out
