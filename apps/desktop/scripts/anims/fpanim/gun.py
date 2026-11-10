"""A arma no espaço do jogo (o mesmo de `models.ts fromFile`): cano para −z, origem 3 cm abaixo e 2 cm atrás do nó
`trigger`. Lê o .glb do jogo (só a geometria, nada do arquivo roda) e separa as peças que mexem pelo osso de maior peso
(o pente com os cartuchos, a alavanca de carregar com o ferrolho, o gatilho). Os acessórios do armeiro são feitos em
código no jogo (`attachmodels.ts`); aqui entram como peças simples com as mesmas medidas, só para medir contato.

Cada peça vira uma malha do Blender (para ver nos quadros de conferência) e uma árvore de busca (BVH) no espaço da
arma, para medir a distância de cada falange até a superfície.
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

from .space import C3, vb

# osso do arquivo → peça (o resto é o corpo)
PART_OF = {'mag': 'mag', 'bullet': 'mag', 'bullets': 'mag', 'charginghandle': 'charge', 'bolt': 'charge',
           'trigger': 'trigger'}


class Gun:
    """as peças da arma: triângulos no espaço do jogo, malha do Blender e BVH"""

    def __init__(self, gid):
        self.id = gid
        self.parts = {}  # nome → {'verts': [Vector], 'tris': [(a, b, c)], 'bvh': BVHTree, 'obj': Object}
        self.points = {}

    def add(self, name, verts, tris):
        p = self.parts.setdefault(name, {'verts': [], 'tris': []})
        base = len(p['verts'])
        p['verts'] += [Vector(v) for v in verts]
        p['tris'] += [(a + base, b + base, c + base) for a, b, c in tris]

    def finish(self, collection):
        for name, p in self.parts.items():
            p['bvh'] = BVHTree.FromPolygons(p['verts'], p['tris'])
            me = bpy.data.meshes.new('gun_' + name)
            me.from_pydata([vb(v) for v in p['verts']], [], p['tris'])
            me.update()
            ob = bpy.data.objects.new('gun_' + name, me)
            collection.objects.link(ob)
            p['obj'] = ob

    def box(self, name):
        vs = self.parts[name]['verts']
        lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
        hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        return lo, hi

    def nearest(self, p, moved=None, skip=()):
        """distância (com sinal: negativa = dentro) do ponto `p` (espaço da arma) até a peça mais perto.
        `moved`: nome → matriz da peça neste quadro (espaço da arma)"""
        best = (1e9, None)
        for name, part in self.parts.items():
            if name in skip:
                continue
            q = p
            m = (moved or {}).get(name)
            if m is not None:
                q = m.inverted() @ p
            hit = part['bvh'].find_nearest(q, 0.08)
            if hit[0] is None:
                continue
            loc, nrm, _, d = hit
            # dentro ou fora: a normal da face mais perto engana perto das quinas (a busca escolhe uma das faces
            # empatadas e o sinal mudava de uma vez para outra); perto da superfície, vale a contagem de cruzamentos
            # de três raios (maioria: a malha pode ter furos)
            if d < 0.03 and _inside(part['bvh'], q):
                d = -d
            if d < best[0]:
                best = (d, name)
        return best


_RAYS = (Vector((0.577, 0.577, 0.577)), Vector((-0.7, 0.1, -0.7)), Vector((0.1, -0.99, 0.1)))


def _inside(bvh, p):
    votes = 0
    for d in _RAYS:
        d = d.normalized()
        o = p.copy()
        n = 0
        for _ in range(40):
            hit = bvh.ray_cast(o, d, 1.0)
            if hit[0] is None:
                break
            n += 1
            o = hit[0] + d * 1e-5
        votes += n % 2
    return votes >= 2


def load_mp7(glb_path, collection):
    """o MP7 do jogo, no espaço da arma"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    new = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    rig = next(o for o in new if o.type == 'ARMATURE')
    # o gatilho (cabeça do osso) no espaço do arquivo (glTF: y para cima, cano em +x)
    trig_b = rig.matrix_world @ rig.pose.bones['trigger'].head
    to_gltf = C3.transposed()
    # fromFile: gira 90° em y (o cano vai para −z) e põe a origem no punho
    ry = Matrix.Rotation(math.pi / 2, 3, 'Y')
    g0 = ry @ (to_gltf @ trig_b)
    origin = Vector((g0.x, g0.y - 0.03, g0.z + 0.02))

    def to_gun(pb):
        return ry @ (to_gltf @ pb) - origin

    gun = Gun('mp7')
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in new:
        # só a malha da arma (o importador cria uma esfera para desenhar os ossos)
        if ob.type != 'MESH' or not ob.vertex_groups:
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        names = {g.index: g.name.lower() for g in ob.vertex_groups}
        owner = []
        for v in ob.data.vertices:
            best, w = 'body', -1
            for ge in v.groups:
                if ge.weight > w:
                    w = ge.weight
                    best = PART_OF.get(names.get(ge.group, ''), 'body')
            owner.append(best)
        verts = [to_gun(ev.matrix_world @ v.co) for v in me.vertices]
        by = {}
        for t in me.loop_triangles:
            a, b, c = t.vertices
            by.setdefault(owner[a], []).append((a, b, c))
        for name, tris in by.items():
            used = sorted({i for t in tris for i in t})
            remap = {i: k for k, i in enumerate(used)}
            gun.add(name, [verts[i] for i in used], [(remap[a], remap[b], remap[c]) for a, b, c in tris])
        ev.to_mesh_clear()
    for ob in new:
        bpy.data.objects.remove(ob, do_unlink=True)
    gun.points['origin_file'] = origin
    return gun


# ------------------------------------------------------------------ acessórios (medidas de `attachmodels.ts`)

def _cyl(gun, name, a, b, r, seg=12):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    u = d.orthogonal().normalized()
    w = d.cross(u)
    verts, tris = [], []
    for i in range(seg):
        t = 2 * math.pi * i / seg
        off = (u * math.cos(t) + w * math.sin(t)) * r
        verts += [a + off, b + off]
    verts += [a, b]
    ca, cb = 2 * seg, 2 * seg + 1
    for i in range(seg):
        j = (i + 1) % seg
        tris += [(2 * i, 2 * j, 2 * i + 1), (2 * j, 2 * j + 1, 2 * i + 1), (ca, 2 * j, 2 * i), (cb, 2 * i + 1, 2 * j + 1)]
    gun.add(name, verts, tris)


def _box(gun, name, w, h, d, cx, cy, cz):
    x0, x1, y0, y1, z0, z1 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2
    verts = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    q = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    tris = []
    for a, b, c, d2 in q:
        tris += [(a, b, c), (a, c, d2)]
    gun.add(name, verts, tris)


def _prism(gun, name, pts_zy, w, at):
    """perfil de lado ([z, y]) extrudado em x (largura `w`), deslocado por `at`"""
    n = len(pts_zy)
    verts = [Vector((s * w / 2, y, z)) + Vector(at) for s in (-1, 1) for z, y in pts_zy]
    tris = []
    for i in range(1, n - 1):
        tris += [(0, i, i + 1), (n, n + i + 1, n + i)]
    for i in range(n):
        j = (i + 1) % n
        tris += [(i, j, n + j), (i, n + j, n + i)]
    gun.add(name, verts, tris)


# o apoio de fábrica do MP7 (medido no jogo: `support`), a mira e a boca
MP7 = {
    'support': Vector((0, 0.02253, -0.1726)),
    'sight': Vector((0, 0.12654, -0.05)),
    'bore': Vector((0, 0.0452, -0.24657)),
    'grip_dz': 0.01,
    'rail_top': (0.1, -0.005),
}


def mount(gun, build):
    """acessórios montados (mesmas medidas do jogo); a empunhadura dobrável do MP7 sai quando há outra"""
    sup = MP7['support']
    z = sup.z + MP7['grip_dz']
    under = build.get('under')
    if under == 'vgrip':
        at = Vector((0, sup.y, z))
        _box(gun, 'att', 0.024, 0.011, 0.044, at.x, at.y - 0.0055, at.z)
        _cyl(gun, 'att', at + Vector((0, -0.01, 0)), at + Vector((0, -0.095, -0.012)), 0.0146)
        gun.points['vgrip_top'] = at + Vector((0, -0.01, 0))
        gun.points['vgrip_bot'] = at + Vector((0, -0.095, -0.012))
    elif under == 'agrip':
        at = Vector((0, sup.y, z))
        _box(gun, 'att', 0.022, 0.009, 0.06, at.x, at.y - 0.0045, at.z - 0.045)
        _prism(gun, 'att', [(-0.012, -0.008), (-0.075, -0.008), (-0.072, -0.02), (-0.03, -0.042), (-0.016, -0.04)],
               0.02, at)
        gun.points['agrip_at'] = at
    else:
        # a empunhadura dobrável do MP7A1, aberta (o modelo do jogo é o A2, de trilho): presa na frente de baixo da
        # caixa, inclinada uns 12° para a frente, fina e curta (é feita no jogo por `fpanim.ts`, só na 1ª pessoa)
        top, bot = foregrip_axis()
        _box(gun, 'fgrip', 0.022, 0.012, 0.03, top.x, top.y + 0.002, top.z)
        _cyl(gun, 'fgrip', top, bot, FOREGRIP['r'])
        gun.points['fgrip_top'] = top
        gun.points['fgrip_bot'] = bot
    if build.get('mag') == 'ext':
        lo, hi = gun.box('mag')
        L = 0.045
        cx, cz = (lo.x + hi.x) / 2, (lo.z + hi.z) / 2
        _box(gun, 'mag', (hi.x - lo.x) * 0.96, L, 0.03, cx, lo.y - L / 2 + 0.002, cz)
        _box(gun, 'mag', hi.x - lo.x + 0.004, 0.008, 0.036, cx, lo.y - L - 0.002, cz)
    optic = build.get('optic')
    y, oz = MP7['rail_top']
    if optic == 'red':
        _box(gun, 'att', 0.03, 0.045, 0.055, 0, y + 0.0225, oz)
    elif optic == 'holo':
        _box(gun, 'att', 0.026, 0.035, 0.04, 0, y + 0.0175, oz)
    elif optic == 'acog':
        _cyl(gun, 'att', (0, y + 0.032, oz + 0.06), (0, y + 0.032, oz - 0.07), 0.021)
        _box(gun, 'att', 0.024, 0.014, 0.06, 0, y + 0.007, oz)
    muzzle = build.get('muzzle')
    if muzzle:
        b = MP7['bore']
        ln = {'sup': 0.13, 'comp': 0.045, 'flash': 0.05}[muzzle]
        r = {'sup': 0.018, 'comp': 0.013, 'flash': 0.012}[muzzle]
        _cyl(gun, 'att', b + Vector((0, 0, 0.02)), b + Vector((0, 0, 0.02 - ln)), r)
    return gun


# a empunhadura dobrável (espaço da arma): topo, inclinação para a frente, comprimento e raio
FOREGRIP = {'top': (0, 0.024, -0.165), 'tilt': math.radians(10), 'len': 0.078, 'r': 0.012}


def foregrip_axis():
    t = Vector(FOREGRIP['top'])
    d = Vector((0, -math.cos(FOREGRIP['tilt']), -math.sin(FOREGRIP['tilt'])))
    return t, t + d * FOREGRIP['len']
