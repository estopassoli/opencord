/**
 * Captura de tela/janela + áudio do sistema (validado no spike F0.3/F0.4, ADR-0003).
 * Fluxo: renderer lista fontes → escolhe → `capture:select` concede a PRÓXIMA chamada a getDisplayMedia
 * (concessão expira em 10 s) → handler entrega a fonte com `audio: 'loopback'` quando pedido (Windows).
 */
import { desktopCapturer, session, type DesktopCapturerSource } from 'electron';
import type { CaptureSelectArgs, CaptureSourceDto } from '../shared/ipc';

const GRANT_TTL_MS = 10_000;
const known = new Map<string, DesktopCapturerSource>();
let grant: (CaptureSelectArgs & { expiresAt: number }) | null = null;

export async function listSources(): Promise<CaptureSourceDto[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    // miniaturas grandes: o seletor mostra duas por linha
    thumbnailSize: { width: 640, height: 360 },
    fetchWindowIcons: true,
  });
  known.clear();
  for (const s of sources) known.set(s.id, s);
  return sources
    .filter((s) => !s.thumbnail.isEmpty() || s.id.startsWith('screen:'))
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.toDataURL(),
      ...(s.appIcon && !s.appIcon.isEmpty() ? { appIcon: s.appIcon.toDataURL() } : {}),
      ...(s.display_id ? { displayId: s.display_id } : {}),
    }));
}

export function selectSource(args: CaptureSelectArgs) {
  grant = { ...args, expiresAt: Date.now() + GRANT_TTL_MS };
}

export function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const g = grant;
      grant = null; // concessão de uso único
      const resolve = async () => {
        if (!g || g.expiresAt < Date.now()) return null;
        // IDs de janela podem não reaparecer numa nova listagem: reutilizar o objeto da listagem anterior
        let src = known.get(g.sourceId);
        if (!src)
          src = (await desktopCapturer.getSources({ types: ['screen', 'window'] })).find((s) => s.id === g.sourceId);
        return src ? { src, audio: g.systemAudio && process.platform === 'win32' } : null;
      };
      // Negar = callback({}); o Electron lança se vídeo foi pedido e não concedido, e o renderer recebe o erro.
      const deny = () => {
        try {
          callback({});
        } catch {
          /* pedido negado */
        }
      };
      resolve().then(
        (r) => (r ? callback(r.audio ? { video: r.src, audio: 'loopback' } : { video: r.src }) : deny()),
        deny,
      );
    },
    { useSystemPicker: false },
  );
}
