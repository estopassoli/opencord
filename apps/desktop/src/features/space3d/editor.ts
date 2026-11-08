/**
 * Editor do Espaço 3D (ADR-0055), estilo The Sims: com a câmera livre, clicar numa peça seleciona e arrastar move
 * (grade de 25 cm); R/Q giram; Delete apaga; a ferramenta Parede desenha arrastando (grade de 50 cm). Trabalha num
 * rascunho; só vai para o servidor ao salvar. Ctrl+Z desfaz.
 */
import {
  SPACE_MAX_ITEMS,
  SPACE_MAX_SIZE,
  SPACE_MAX_WALLS,
  SPACE_MIN_SIZE,
  type SpaceItemKind,
  type SpaceLayout,
} from '@opencord/contracts';
import * as THREE from 'three';
import { ITEM_SPECS } from './models';
import type { SpaceScene } from './scene';

export type EditorTool = 'select' | 'wall';
export type Selection = { kind: 'item'; id: string } | { kind: 'wall'; index: number } | null;

const ITEM_SNAP = 0.25;
const WALL_SNAP = 0.5;
const snap = (v: number, s: number) => Math.round(v / s) * s;
const r2 = (n: number) => Math.round(n * 100) / 100;

export class SpaceEditor {
  tool: EditorTool = 'select';
  selection: Selection = null;
  draft: SpaceLayout;
  dirty = false;
  private history: SpaceLayout[] = [];
  private helper: THREE.BoxHelper | null = null;
  private dragging: { id: string; dx: number; dz: number; moved: boolean } | null = null;
  private wallStart: THREE.Vector3 | null = null;
  private preview: THREE.Mesh | null = null;

  constructor(
    private readonly scene: SpaceScene,
    layout: SpaceLayout,
    private readonly onChange: (e: SpaceEditor) => void,
  ) {
    this.draft = structuredClone(layout);
    scene.editorInput = {
      down: (e) => this.down(e),
      move: (e) => this.move(e),
      up: () => this.up(),
      key: (e) => this.key(e),
    };
  }

  private emit() {
    this.onChange(this);
  }

  private commit(next: SpaceLayout, keepSelection = true) {
    this.history.push(this.draft);
    if (this.history.length > 60) this.history.shift();
    this.draft = next;
    this.dirty = true;
    if (!keepSelection) this.selection = null;
    this.rebuild();
  }

  private rebuild() {
    this.scene.setLayout(this.draft, true);
    this.highlight();
    this.emit();
  }

  replace(layout: SpaceLayout) {
    this.commit(structuredClone(layout), false);
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.draft = prev;
    this.dirty = true;
    this.selection = null;
    this.rebuild();
  }

  get canUndo() {
    return this.history.length > 0;
  }

  setTool(t: EditorTool) {
    this.tool = t;
    this.wallStart = null;
    this.clearPreview();
    this.emit();
  }

  select(sel: Selection) {
    this.selection = sel;
    this.highlight();
    this.emit();
  }

  private highlight() {
    if (this.helper) {
      this.scene.scene.remove(this.helper);
      this.helper.dispose();
      this.helper = null;
    }
    const w = this.scene.world;
    const s = this.selection;
    if (!w || !s) return;
    const obj = s.kind === 'item' ? w.items.get(s.id) : w.walls[s.index];
    if (!obj) {
      this.selection = null;
      return;
    }
    this.helper = new THREE.BoxHelper(obj, 0xffd23f);
    this.scene.scene.add(this.helper);
  }

  private newId(): string {
    const used = new Set(this.draft.items.map((i) => i.id));
    let id = '';
    do id = Math.random().toString(36).slice(2, 10);
    while (used.has(id));
    return id;
  }

  private clampToFloor(x: number, z: number) {
    const hx = this.draft.width / 2 - 0.3;
    const hz = this.draft.depth / 2 - 0.3;
    return { x: r2(Math.max(-hx, Math.min(hx, x))), z: r2(Math.max(-hz, Math.min(hz, z))) };
  }

  addItem(kind: SpaceItemKind) {
    if (this.draft.items.length >= SPACE_MAX_ITEMS) return;
    const f = this.scene.focus;
    const p = this.clampToFloor(snap(f.x, ITEM_SNAP), snap(f.z, ITEM_SNAP));
    const id = this.newId();
    const next = structuredClone(this.draft);
    next.items.push({ id, kind, x: p.x, z: p.z, rot: 0, color: ITEM_SPECS[kind].color });
    this.selection = { kind: 'item', id };
    this.commit(next);
  }

  duplicate() {
    const s = this.selection;
    if (s?.kind !== 'item' || this.draft.items.length >= SPACE_MAX_ITEMS) return;
    const it = this.draft.items.find((i) => i.id === s.id);
    if (!it) return;
    const id = this.newId();
    const p = this.clampToFloor(it.x + 0.75, it.z + 0.75);
    const next = structuredClone(this.draft);
    next.items.push({ ...it, id, x: p.x, z: p.z });
    this.selection = { kind: 'item', id };
    this.commit(next);
  }

  removeSelected() {
    const s = this.selection;
    if (!s) return;
    const next = structuredClone(this.draft);
    if (s.kind === 'item') next.items = next.items.filter((i) => i.id !== s.id);
    else next.walls.splice(s.index, 1);
    this.commit(next, false);
  }

  rotateSelected(delta: number) {
    const s = this.selection;
    if (s?.kind !== 'item') return;
    const next = structuredClone(this.draft);
    const it = next.items.find((i) => i.id === s.id);
    if (!it) return;
    let r = it.rot + delta;
    r = Math.atan2(Math.sin(r), Math.cos(r));
    it.rot = r2(r);
    this.commit(next);
  }

  recolorSelected(color: string) {
    const s = this.selection;
    if (s?.kind !== 'item') return;
    const next = structuredClone(this.draft);
    const it = next.items.find((i) => i.id === s.id);
    if (!it || it.color === color) return;
    it.color = color;
    this.commit(next);
  }

  setWallHeight(h: number) {
    const s = this.selection;
    if (s?.kind !== 'wall') return;
    const next = structuredClone(this.draft);
    const w = next.walls[s.index];
    if (!w) return;
    w.h = h;
    this.commit(next);
  }

  setLook(patch: Partial<Pick<SpaceLayout, 'theme' | 'floorColor' | 'wallColor'>>) {
    this.commit({ ...structuredClone(this.draft), ...patch });
  }

  /** muda o tamanho da área: paredes que estavam na borda acompanham; o resto é trazido para dentro */
  setSize(width: number, depth: number) {
    width = Math.max(SPACE_MIN_SIZE, Math.min(SPACE_MAX_SIZE, Math.round(width / 2) * 2));
    depth = Math.max(SPACE_MIN_SIZE, Math.min(SPACE_MAX_SIZE, Math.round(depth / 2) * 2));
    const ohx = this.draft.width / 2;
    const ohz = this.draft.depth / 2;
    const hx = width / 2;
    const hz = depth / 2;
    const mapX = (x: number) =>
      Math.abs(Math.abs(x) - ohx) < 0.01 ? Math.sign(x) * hx : Math.max(-hx, Math.min(hx, x));
    const mapZ = (z: number) =>
      Math.abs(Math.abs(z) - ohz) < 0.01 ? Math.sign(z) * hz : Math.max(-hz, Math.min(hz, z));
    const next = structuredClone(this.draft);
    next.width = width;
    next.depth = depth;
    next.walls = next.walls
      .map((w) => ({ ...w, x1: mapX(w.x1), z1: mapZ(w.z1), x2: mapX(w.x2), z2: mapZ(w.z2) }))
      .filter((w) => Math.hypot(w.x2 - w.x1, w.z2 - w.z1) >= 0.5);
    // peças encostadas na parede do fundo (telão) acompanham a parede
    next.items = next.items.map((it) => {
      const nearBack = Math.abs(it.z + ohz) < 1.2;
      const zz = nearBack ? -hz + (it.z + ohz) : it.z;
      const p = { x: Math.max(-hx + 0.3, Math.min(hx - 0.3, it.x)), z: Math.max(-hz + 0.3, Math.min(hz - 0.3, zz)) };
      return { ...it, x: r2(p.x), z: r2(p.z) };
    });
    next.spawn = {
      x: Math.max(-hx + 1, Math.min(hx - 1, next.spawn.x)),
      z: Math.max(-hz + 1, Math.min(hz - 1, next.spawn.z)),
    };
    this.selection = null;
    this.commit(next);
  }

  setSpawnHere() {
    const f = this.scene.focus;
    const p = this.clampToFloor(f.x, f.z);
    this.commit({ ...structuredClone(this.draft), spawn: p });
  }

  // ---------- entrada do canvas ----------
  private itemIdOf(o: THREE.Object3D | null): string | null {
    while (o) {
      const id = (o.userData as { itemId?: string }).itemId;
      if (id) return id;
      o = o.parent;
    }
    return null;
  }

  private down(e: PointerEvent): boolean {
    const w = this.scene.world;
    if (!w) return false;
    const p = this.scene.floorPoint(e);
    if (this.tool === 'wall') {
      if (!p || this.draft.walls.length >= SPACE_MAX_WALLS) return false;
      this.wallStart = new THREE.Vector3(snap(p.x, WALL_SNAP), 0, snap(p.z, WALL_SNAP));
      return true;
    }
    const hits = this.scene.pick(e, [...w.items.values(), ...w.walls]);
    for (const h of hits) {
      const id = this.itemIdOf(h.object);
      if (id) {
        this.select({ kind: 'item', id });
        const it = this.draft.items.find((i) => i.id === id);
        if (it && p) this.dragging = { id, dx: it.x - p.x, dz: it.z - p.z, moved: false };
        return true;
      }
      const wi = (h.object.userData as { wallIndex?: number }).wallIndex;
      if (wi !== undefined) {
        this.select({ kind: 'wall', index: wi });
        return true;
      }
    }
    if (this.selection) this.select(null);
    return false;
  }

  private move(e: PointerEvent) {
    const p = this.scene.floorPoint(e);
    if (!p) return;
    if (this.tool === 'wall' && this.wallStart) {
      const end = new THREE.Vector3(snap(p.x, WALL_SNAP), 0, snap(p.z, WALL_SNAP));
      this.showPreview(this.wallStart, end);
      return;
    }
    const d = this.dragging;
    if (!d) return;
    const g = this.scene.world?.items.get(d.id);
    if (!g) return;
    const q = this.clampToFloor(snap(p.x + d.dx, ITEM_SNAP), snap(p.z + d.dz, ITEM_SNAP));
    g.position.set(q.x, 0, q.z);
    d.moved = true;
    this.helper?.update();
  }

  private up() {
    if (this.tool === 'wall' && this.wallStart) {
      const prev = this.preview;
      const start = this.wallStart;
      this.wallStart = null;
      this.clearPreview();
      if (!prev) return;
      const end = prev.userData as { x: number; z: number };
      const hx = this.draft.width / 2;
      const hz = this.draft.depth / 2;
      const c = (v: number, h: number) => Math.max(-h, Math.min(h, v));
      const wall = {
        x1: c(start.x, hx),
        z1: c(start.z, hz),
        x2: c(end.x, hx),
        z2: c(end.z, hz),
        h: this.defaultWallH(),
      };
      if (Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) < 0.5) return;
      const next = structuredClone(this.draft);
      next.walls.push(wall);
      this.selection = { kind: 'wall', index: next.walls.length - 1 };
      this.commit(next);
      return;
    }
    const d = this.dragging;
    this.dragging = null;
    if (!d?.moved) return;
    const g = this.scene.world?.items.get(d.id);
    if (!g) return;
    const next = structuredClone(this.draft);
    const it = next.items.find((i) => i.id === d.id);
    if (!it) return;
    it.x = r2(g.position.x);
    it.z = r2(g.position.z);
    this.commit(next);
  }

  private defaultWallH() {
    const outer = this.draft.walls.map((w) => w.h).sort((a, b) => b - a)[0];
    return outer && outer > 1.2
      ? Math.min(outer, 3.6)
      : this.draft.theme === 'rooftop' || this.draft.theme === 'beach'
        ? 1
        : 3.6;
  }

  private showPreview(a: THREE.Vector3, b: THREE.Vector3) {
    this.clearPreview();
    const len = a.distanceTo(b);
    if (len < 0.01) return;
    const h = this.defaultWallH();
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(len + 0.2, h, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.45 }),
    );
    m.position.set((a.x + b.x) / 2, h / 2, (a.z + b.z) / 2);
    m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    m.userData = { x: b.x, z: b.z };
    this.preview = m;
    this.scene.scene.add(m);
  }

  private clearPreview() {
    if (!this.preview) return;
    this.scene.scene.remove(this.preview);
    this.preview.geometry.dispose();
    (this.preview.material as THREE.Material).dispose();
    this.preview = null;
  }

  private key(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      this.undo();
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'd') {
      this.duplicate();
      return true;
    }
    if (k === 'delete' || k === 'backspace') {
      this.removeSelected();
      return true;
    }
    if (k === 'r') {
      this.rotateSelected(e.shiftKey ? Math.PI / 4 : Math.PI / 2);
      return true;
    }
    if (k === 'q') {
      this.rotateSelected(-Math.PI / 4);
      return true;
    }
    if (k === 'escape') {
      if (this.tool === 'wall') this.setTool('select');
      else this.select(null);
      return true;
    }
    return false;
  }

  dispose() {
    this.clearPreview();
    if (this.helper) {
      this.scene.scene.remove(this.helper);
      this.helper.dispose();
    }
    this.scene.editorInput = null;
  }
}
