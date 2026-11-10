"""O esqueleto dos braços (`assets/arms.glb`) com os ossos novos da arma, e a escrita das poses quadro a quadro.

Ossos novos, filhos da raiz do esqueleto (o nó `rig`, que no jogo fica no lugar da câmera em repouso):
- `weapon`: o encaixe da arma (a origem da arma do jogo: o punho; frente em −z);
- `mag` e `charge`, filhos de `weapon`: o pente e a alavanca de carregar (o jogo move as peças do modelo por eles).

Convenção: todas as poses são matrizes no espaço do jogo (o da câmera da primeira pessoa). O Blender guarda os ossos com
o y ao longo do osso; o glTF que sai tem o mesmo nó que o .glb dos braços, então o giro do osso no jogo é o do Blender
convertido e girado 90° em x (`K`, medido: igual para todos os ossos).
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

from .space import mb, mg, trs

ARMS_GLB = 'apps/desktop/src/features/space3d/assets/arms.glb'
K = Matrix.Rotation(math.pi / 2, 4, 'X')
KI = K.inverted()

FINGERS = ['index', 'middle', 'ring', 'pinky']
NEW_BONES = ['weapon', 'mag', 'charge', 'ctl']


class Rig:
    def __init__(self, arms_glb):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=arms_glb)
        new = [o for o in bpy.data.objects if o not in before]
        self.arm = next(o for o in new if o.type == 'ARMATURE')
        self.mesh = next((o for o in new if o.type == 'MESH' and o.vertex_groups), None)
        for o in new:
            if o not in (self.arm, self.mesh):
                bpy.data.objects.remove(o, do_unlink=True)
        self.arm.name = 'rig'
        self.arm.data.name = 'rig'
        bpy.context.view_layer.objects.active = self.arm
        bpy.ops.object.mode_set(mode='EDIT')
        eb = self.arm.data.edit_bones
        w = eb.new('weapon')
        w.head, w.tail = (0, 0, 0), (0, 0.05, 0)
        for n in ('mag', 'charge'):
            b = eb.new(n)
            b.head, b.tail = (0, 0, 0), (0, 0.03, 0)
            b.parent = w
        # canais de controle para as camadas do jogo, na posição do osso: x = a esquerda no apoio (0–1), y = a
        # esquerda segurando o pente, z = os cartuchos à mostra
        c = eb.new('ctl')
        c.head, c.tail = (0, 0, 0), (0, 0.02, 0)
        bpy.ops.object.mode_set(mode='OBJECT')
        for pb in self.arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        # descanso de cada osso no espaço do jogo (para os dedos: giro local em cima do descanso)
        self.rest_local = {}
        for b in self.arm.data.bones:
            pm = b.parent.matrix_local if b.parent else Matrix()
            self.rest_local[b.name] = pm.inverted() @ b.matrix_local

    # ------------------------------------------------------------ escrita de pose (espaço do jogo)
    # As matrizes do quadro são calculadas aqui (sem esperar o depsgraph): `B` guarda a de cada osso no espaço do
    # esqueleto do Blender; pai antes do filho.

    def begin(self):
        self.basis = {}
        self._B = {}

    def _rest_rel(self, name):
        bone = self.arm.data.bones[name]
        return bone.parent.matrix_local.inverted() @ bone.matrix_local if bone.parent else bone.matrix_local

    def Bm(self, name):
        """a matriz do osso no espaço do esqueleto do Blender (calculada sob demanda; pai antes)"""
        m = self._B.get(name)
        if m is None:
            bone = self.arm.data.bones[name]
            loc, rot = self.basis.get(name, (Vector(), Quaternion()))
            parent = self.Bm(bone.parent.name) if bone.parent else Matrix()
            m = parent @ self._rest_rel(name) @ Matrix.LocRotScale(loc, rot, None)
            self._B[name] = m
        return m

    def set_world(self, name, W):
        """põe o osso com a matriz `W` (espaço do jogo)"""
        bone = self.arm.data.bones[name]
        parent = self.Bm(bone.parent.name) if bone.parent else Matrix()
        basis = self._rest_rel(name).inverted() @ parent.inverted() @ mb(W @ K)
        loc, rot, _ = basis.decompose()
        self.basis[name] = (loc, rot)
        self._B = {}

    def set_world_rot(self, name, R):
        """só o giro do osso no espaço do jogo; a posição fica a do descanso (dedos)"""
        bone = self.arm.data.bones[name]
        parent = self.Bm(bone.parent.name) if bone.parent else Matrix()
        want = mb(R.to_3x3().to_4x4() @ K).to_3x3()
        base = (parent @ self._rest_rel(name)).to_3x3()
        q = (base.inverted() @ want).to_quaternion()
        self.basis[name] = (Vector(), q.normalized())
        self._B = {}

    def set_local(self, name, q, loc=(0, 0, 0)):
        """giro (e deslocamento) do osso em relação ao descanso, como `setBone` de `handrig.ts` (descanso × q)"""
        self.basis[name] = (Vector(loc), q.normalized())
        self._B = {}

    def world(self, name):
        """a matriz do osso no espaço do jogo"""
        return mg(self.Bm(name)) @ KI

    def head(self, name):
        return self.world(name).translation

    def tail(self, name):
        return self.world(name) @ Vector((0, self.arm.data.bones[name].length, 0))

    def apply(self):
        """escreve o quadro nos ossos (para desenhar e para a chave)"""
        for n in self.all_bones():
            loc, rot = self.basis.get(n, (Vector(), Quaternion()))
            pb = self.arm.pose.bones[n]
            pb.location = loc
            pb.rotation_quaternion = rot

    def key(self, frame):
        for n in self.all_bones():
            pb = self.arm.pose.bones[n]
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            pb.keyframe_insert('location', frame=frame)

    def all_bones(self):
        return [b.name for b in self.arm.data.bones]


def bone_len(rig, name):
    return rig.arm.data.bones[name].length
