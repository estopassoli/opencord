/**
 * Editor de cenas do Go Live (ADR-0015): lista de cenas, prévia 16:9 (arraste para mover, puxe o canto para
 * redimensionar) e camadas (tela, câmera, imagem, texto). Salvo neste computador; a live em andamento acompanha.
 */
import { Button, Icon, Switch, TextField } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import {
  cameraLayer,
  clampRect,
  imageLayer,
  screenLayer,
  shrinkImage,
  textLayer,
  type Layer,
  type Scene,
} from '../../lib/scenes';
import { useScenes } from '../../store/scenes';
import { useUi } from '../../store/ui';
import { drawScene, syncImages, videoOf, type SceneSources } from '../../voice/compositor';
import { useVoice } from '../../store/voice';

const W = 640;
const H = 360;
const KIND_ICON = { screen: 'screen', camera: 'camera', image: 'upload', text: 'edit' } as const;

export function SceneEditor({ onClose }: { onClose: () => void }) {
  const stored = useScenes((s) => s.scenes);
  const [scenes, setScenes] = useState<Scene[]>(stored);
  const [sceneId, setSceneId] = useState<string>(useScenes.getState().activeId ?? stored[0]?.id ?? '');
  const [layerId, setLayerId] = useState<string | null>(null);
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];
  const layer = scene?.layers.find((l) => l.id === layerId) ?? null;
  const fileInput = useRef<HTMLInputElement>(null);

  // salva a cada mudança (e a live em andamento acompanha a cena ativa); arrastando, só a tela muda e salva ao soltar
  const commit = (next: Scene[], persist = true) => {
    setScenes(next);
    if (persist && !useScenes.getState().setScenes(next))
      useUi.getState().toast('error', 'Não coube no armazenamento: use imagens menores.');
  };
  const patchScene = (fn: (s: Scene) => Scene, persist = true) =>
    scene &&
    commit(
      scenes.map((s) => (s.id === scene.id ? fn(s) : s)),
      persist,
    );
  const patchLayer = (id: string, p: Partial<Layer>, persist = true) =>
    patchScene((s) => ({ ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, ...p } : l)) }), persist);
  const addLayer = (l: Layer) => {
    patchScene((s) => ({ ...s, layers: [...s.layers, l] }));
    setLayerId(l.id);
  };
  const move = (id: string, dir: -1 | 1) =>
    patchScene((s) => {
      const i = s.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.layers.length) return s;
      const layers = [...s.layers];
      [layers[i], layers[j]] = [layers[j]!, layers[i]!];
      return { ...s, layers };
    });

  const newScene = () => {
    const s: Scene = { id: crypto.randomUUID(), name: `Cena ${scenes.length + 1}`, layers: [screenLayer()] };
    commit([...scenes, s]);
    setSceneId(s.id);
    setLayerId(null);
  };
  const removeScene = () => {
    if (!scene || scenes.length <= 1) return;
    if (!confirm(`Excluir a cena "${scene.name}"?`)) return;
    const rest = scenes.filter((s) => s.id !== scene.id);
    commit(rest);
    setSceneId(rest[0]!.id);
    setLayerId(null);
  };

  const pickImage = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const { src, aspect } = await shrinkImage(file);
      addLayer(imageLayer(src, aspect));
    } catch {
      useUi.getState().toast('error', 'Não foi possível abrir a imagem.');
    }
  };

  if (!scene) return null;
  return (
    <Dialog
      title="Cenas da transmissão"
      onClose={onClose}
      wide
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              useScenes.getState().setActive(scene.id);
              onClose();
            }}
          >
            Usar esta cena
          </Button>
          <Button onClick={onClose}>Pronto</Button>
        </>
      }
    >
      <div className="scene-editor">
        <aside className="scene-list" aria-label="Cenas">
          <ul>
            {scenes.map((s) => (
              <li key={s.id}>
                <button
                  className="scene-item"
                  aria-current={s.id === scene.id ? 'true' : undefined}
                  onClick={() => {
                    setSceneId(s.id);
                    setLayerId(null);
                  }}
                >
                  <span className="truncate">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" icon="plus" onClick={newScene}>
            Nova cena
          </Button>
        </aside>

        <div className="scene-main">
          <div className="scene-title-row">
            <TextField
              label="Nome da cena"
              value={scene.name}
              maxLength={40}
              onChange={(e) => patchScene((s) => ({ ...s, name: e.target.value }))}
            />
            <Button variant="ghost" icon="trash" disabled={scenes.length <= 1} onClick={removeScene}>
              Excluir cena
            </Button>
          </div>
          <ScenePreview
            scene={scene}
            selected={layerId}
            onSelect={setLayerId}
            onRect={(id, r, final) => patchLayer(id, r, final)}
          />
          <div className="scene-add" role="group" aria-label="Adicionar camada">
            <Button size="sm" variant="secondary" icon="screen" onClick={() => addLayer(screenLayer())}>
              Tela
            </Button>
            <Button size="sm" variant="secondary" icon="camera" onClick={() => addLayer(cameraLayer())}>
              Câmera
            </Button>
            <Button size="sm" variant="secondary" icon="upload" onClick={() => fileInput.current?.click()}>
              Imagem
            </Button>
            <Button size="sm" variant="secondary" icon="edit" onClick={() => addLayer(textLayer())}>
              Texto
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              aria-label="Escolher imagem para a cena"
              onChange={(e) => void pickImage(e.target.files?.[0])}
            />
          </div>
        </div>

        <aside className="scene-layers" aria-label="Camadas">
          <h3 className="section-label">Camadas (de cima para baixo)</h3>
          <ul>
            {[...scene.layers].reverse().map((l) => (
              <li key={l.id} data-selected={l.id === layerId ? 'true' : undefined}>
                <button className="scene-layer" onClick={() => setLayerId(l.id)}>
                  <Icon name={KIND_ICON[l.kind]} size={16} />
                  <span className="truncate">{l.kind === 'text' ? (l.text ?? 'Texto') : l.name}</span>
                </button>
                <button
                  className="icon-btn"
                  aria-label={l.visible ? `Esconder ${l.name}` : `Mostrar ${l.name}`}
                  data-tip={l.visible ? 'Esconder' : 'Mostrar'}
                  aria-pressed={!l.visible}
                  onClick={() => patchLayer(l.id, { visible: !l.visible })}
                >
                  <Icon name={l.visible ? 'eye' : 'eye-off'} size={16} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Subir ${l.name}`}
                  data-tip="Para cima"
                  onClick={() => move(l.id, 1)}
                >
                  <Icon name="chevron-up" size={16} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Descer ${l.name}`}
                  data-tip="Para baixo"
                  onClick={() => move(l.id, -1)}
                >
                  <Icon name="chevron-down" size={16} />
                </button>
              </li>
            ))}
          </ul>
          {layer && (
            <div className="scene-props">
              {layer.kind === 'text' && (
                <>
                  <TextField
                    label="Texto"
                    value={layer.text ?? ''}
                    maxLength={120}
                    onChange={(e) => patchLayer(layer.id, { text: e.target.value })}
                  />
                  <div className="scene-colors" role="radiogroup" aria-label="Cor do texto">
                    {['#ffffff', '#ffd166', '#ef476f', '#06d6a0', '#4d56fd', '#000000'].map((c) => (
                      <button
                        key={c}
                        role="radio"
                        aria-checked={layer.color === c}
                        aria-label={`Cor ${c}`}
                        className="scene-color"
                        style={{ background: c }}
                        onClick={() => patchLayer(layer.id, { color: c })}
                      />
                    ))}
                  </div>
                </>
              )}
              {layer.kind === 'camera' && (
                <Switch
                  label="Cantos arredondados"
                  checked={layer.rounded ?? false}
                  onChange={(on) => patchLayer(layer.id, { rounded: on })}
                />
              )}
              <div className="scene-props-actions">
                <Button size="sm" variant="ghost" onClick={() => patchLayer(layer.id, { x: 0, y: 0, w: 1, h: 1 })}>
                  Tela cheia
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  onClick={() => {
                    patchScene((s) => ({ ...s, layers: s.layers.filter((l) => l.id !== layer.id) }));
                    setLayerId(null);
                  }}
                >
                  Remover
                </Button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </Dialog>
  );
}

/** Prévia 16:9 da cena; com a live no ar mostra a tela de verdade. Arraste para mover, puxe o canto para redimensionar. */
function ScenePreview({
  scene,
  selected,
  onSelect,
  onRect,
}: {
  scene: Scene;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onRect: (id: string, r: Pick<Layer, 'x' | 'y' | 'w' | 'h'>, final: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sources = useRef<SceneSources>({ images: new Map() });
  const live = useVoice((v) => v.stream.status === 'live');
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const drag = useRef<{
    id: string;
    mode: 'move' | 'resize';
    x: number;
    y: number;
    r: Pick<Layer, 'x' | 'y' | 'w' | 'h'>;
  } | null>(null);

  // fontes de verdade quando possível: a tela da live em andamento
  useEffect(() => {
    const track = live ? useVoice.getState().engine()?.screenTrack() : null;
    const video = track ? videoOf(track) : null;
    sources.current.screen = video;
    return () => {
      if (video) video.srcObject = null;
      sources.current.screen = null;
    };
  }, [live]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const loop = () => {
      syncImages(sceneRef.current, sources.current.images);
      drawScene(ctx, sceneRef.current, sources.current, W, H, true);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  const toFrac = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).closest('.scene-preview')!.getBoundingClientRect();
    return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
  };
  return (
    <div className="scene-preview" onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}>
      <canvas ref={canvas} width={W} height={H} aria-label={`Prévia da cena ${scene.name}`} role="img" />
      {[...scene.layers].map(
        (l) =>
          l.visible && (
            <div
              key={l.id}
              className="scene-box"
              data-selected={l.id === selected ? 'true' : undefined}
              style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(l.id);
                const { fx, fy } = toFrac(e);
                const resize = (e.target as HTMLElement).classList.contains('scene-handle');
                drag.current = {
                  id: l.id,
                  mode: resize ? 'resize' : 'move',
                  x: fx,
                  y: fy,
                  r: { x: l.x, y: l.y, w: l.w, h: l.h },
                };
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.id !== l.id) return;
                const { fx, fy } = toFrac(e);
                const dx = fx - d.x;
                const dy = fy - d.y;
                onRect(
                  l.id,
                  clampRect(
                    d.mode === 'move'
                      ? { ...d.r, x: d.r.x + dx, y: d.r.y + dy }
                      : { ...d.r, w: d.r.w + dx, h: d.r.h + dy },
                  ),
                  false,
                );
              }}
              onPointerUp={() => {
                if (drag.current) {
                  const cur = sceneRef.current.layers.find((x) => x.id === drag.current!.id);
                  if (cur) onRect(cur.id, { x: cur.x, y: cur.y, w: cur.w, h: cur.h }, true);
                }
                drag.current = null;
              }}
            >
              {l.id === selected && <span className="scene-handle" aria-hidden="true" />}
            </div>
          ),
      )}
    </div>
  );
}
