"""Quadros de conferência no Blender (Workbench, sem GPU): a vista do jogador (câmera do viewmodel, 55° na vertical,
16:9) e closes das mãos. Só para quem anima conferir; o jogo desenha com o three.js."""
import math

import bpy
from mathutils import Matrix, Vector

from .space import C4, mb, vb

VFOV = 55.0


class View:
    def __init__(self, rig, gun, w=960, h=540):
        sc = bpy.context.scene
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.display.shading.light = 'STUDIO'
        sc.display.shading.color_type = 'MATERIAL'
        sc.display.shading.show_cavity = False
        sc.render.resolution_x = w
        sc.render.resolution_y = h
        sc.render.image_settings.file_format = 'JPEG'
        sc.world = sc.world or bpy.data.worlds.new('w')
        sc.display.shading.background_type = 'VIEWPORT'
        sc.display.shading.background_color = (0.35, 0.38, 0.44)
        self.rig, self.gun = rig, gun
        cam = bpy.data.cameras.new('cam')
        cam.sensor_fit = 'VERTICAL'
        cam.angle_y = math.radians(VFOV)
        cam.clip_start = 0.01
        self.cam = bpy.data.objects.new('cam', cam)
        sc.collection.objects.link(self.cam)
        sc.camera = self.cam
        self._mat('arms', (0.36, 0.40, 0.33))
        for name, p in gun.parts.items():
            col = (0.12, 0.13, 0.14) if name != 'att' and name != 'fgrip' else (0.2, 0.21, 0.24)
            if name == 'mag':
                col = (0.16, 0.16, 0.17)
            p['obj'].data.materials.append(self._mat('gun_' + name, col))
        if rig.mesh:
            for slot in rig.mesh.material_slots:
                n = slot.material.name if slot.material else ''
                c = (0.23, 0.27, 0.21) if 'manga' in n else (0.43, 0.38, 0.31) if 'luva' in n else (0.76, 0.57, 0.45)
                if slot.material:
                    slot.material.diffuse_color = (*c, 1)

    def _mat(self, name, col):
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*col, 1)
        return m

    def pose_gun(self, Wgun, moved):
        for name, p in self.gun.parts.items():
            M = Wgun @ moved.get(name, Matrix())
            p['obj'].matrix_world = mb(M)

    def look(self, eye, target, up=(0, 1, 0), fov=VFOV):
        """câmera em `eye` olhando para `target` (espaço do jogo)"""
        e, t = Vector(eye), Vector(target)
        z = (e - t).normalized()  # a câmera olha para −z
        x = Vector(up).cross(z).normalized()
        y = z.cross(x)
        M = Matrix((x, y, z)).transposed().to_4x4()
        M.translation = e
        # a câmera do Blender também olha para −z local com y para cima: só o espaço do mundo muda
        self.cam.matrix_world = C4 @ M
        self.cam.data.angle_y = math.radians(fov)

    def player(self):
        self.look((0, 0, 0), (0, 0, -1))

    def render(self, path):
        bpy.context.view_layer.update()
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
