import { Button, Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { normalizeServerUrl } from '../lib/api';
import { isDesktop, secrets } from '../lib/bridge';
import { DEFAULT_SERVER_URL } from '../lib/config';
import { useSession } from '../store/session';
import { Tooltip } from './Tooltip';

interface DesktopDownload {
  windows: { url: string; fileName: string | null; version: string | null; sizeBytes: number | null } | null;
}

/** Link do instalador Windows publicado pelo servidor (somente fora do app desktop). */
export function useDesktopDownload(): DesktopDownload['windows'] {
  const sessionUrl = useSession((s) => s.serverUrl);
  const [dl, setDl] = useState<DesktopDownload['windows']>(null);
  useEffect(() => {
    if (isDesktop) return;
    let cancelled = false;
    void (async () => {
      const base = sessionUrl || (await secrets.get('serverUrl')) || DEFAULT_SERVER_URL;
      try {
        const res = await fetch(`${normalizeServerUrl(base)}/downloads/desktop`);
        const body = (await res.json()) as DesktopDownload;
        if (!cancelled) setDl(body.windows);
      } catch {
        if (!cancelled) setDl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUrl]);
  return dl;
}

const sizeLabel = (b: number | null) => (b ? ` · ${Math.round(b / 1024 / 1024)} MB` : '');

/** Botão grande (tela de entrada) para quem acessa pelo navegador. */
export function DownloadAppButton() {
  const dl = useDesktopDownload();
  if (!dl) return null;
  return (
    <a className="download-cta" href={dl.url} download={dl.fileName ?? undefined} rel="noopener">
      <Button variant="secondary" block icon="download" tabIndex={-1}>
        Baixar para Windows{dl.version ? ` ${dl.version}` : ''}
        {sizeLabel(dl.sizeBytes)}
      </Button>
    </a>
  );
}

/** Item do rail (navegador): atalho para baixar o app. */
export function DownloadAppRailItem() {
  const dl = useDesktopDownload();
  if (!dl) return null;
  return (
    <li className="rail-li">
      <span className="rail-pill" aria-hidden />
      <Tooltip label={`Baixar o app para Windows${dl.version ? ` (${dl.version})` : ''}`} side="right">
        <a
          className="rail-item rail-action"
          href={dl.url}
          download={dl.fileName ?? undefined}
          aria-label="Baixar o app para Windows"
        >
          <Icon name="download" />
        </a>
      </Tooltip>
    </li>
  );
}
