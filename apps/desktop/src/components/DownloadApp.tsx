import { Button, Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { normalizeServerUrl } from '../lib/api';
import { isDesktop, secrets } from '../lib/bridge';
import { DEFAULT_SERVER_URL } from '../lib/config';
import {
  allFiles,
  detectPlatform,
  fileLabel,
  pickFile,
  PLATFORM_NAME,
  type DesktopDownload,
  type DesktopFile,
} from '../lib/downloads';
import { useSession } from '../store/session';
import { Tooltip } from './Tooltip';

interface Downloads {
  /** Sugerido para o sistema de quem está no navegador (null em celular ou sem instalador publicado). */
  primary: DesktopFile | null;
  files: DesktopFile[];
}

/** Instaladores publicados pelo servidor (somente fora do app desktop). */
export function useDesktopDownloads(): Downloads {
  const sessionUrl = useSession((s) => s.serverUrl);
  const [files, setFiles] = useState<DesktopFile[]>([]);
  useEffect(() => {
    if (isDesktop) return;
    let cancelled = false;
    void (async () => {
      const base = sessionUrl || (await secrets.get('serverUrl')) || DEFAULT_SERVER_URL;
      try {
        const res = await fetch(`${normalizeServerUrl(base)}/downloads/desktop`);
        const body = (await res.json()) as DesktopDownload;
        if (!cancelled) setFiles(allFiles(body));
      } catch {
        if (!cancelled) setFiles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUrl]);
  return { primary: pickFile(files, detectPlatform(navigator)), files };
}

const sizeLabel = (b: number | null) => (b ? ` · ${Math.round(b / 1024 / 1024)} MB` : '');

/** Botão grande (tela de entrada) para quem acessa pelo navegador, com as demais plataformas abaixo. */
export function DownloadAppButton() {
  const { primary, files } = useDesktopDownloads();
  if (!primary) return null;
  const others = files.filter((f) => f !== primary);
  return (
    <div className="download-block">
      <a className="download-cta" href={primary.url} download={primary.fileName ?? undefined} rel="noopener">
        <Button variant="secondary" block icon="download" tabIndex={-1}>
          Baixar para {PLATFORM_NAME[primary.platform]}
          {primary.version ? ` ${primary.version}` : ''}
          {sizeLabel(primary.sizeBytes)}
        </Button>
      </a>
      {others.length > 0 && (
        <p className="download-others">
          Outras versões:{' '}
          {others.map((f, i) => (
            <span key={f.url}>
              {i > 0 && ' · '}
              <a href={f.url} download={f.fileName ?? undefined} rel="noopener">
                {fileLabel(f)}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** Item do rail (navegador): atalho para baixar o app do sistema atual. */
export function DownloadAppRailItem() {
  const { primary } = useDesktopDownloads();
  if (!primary) return null;
  const label = `Baixar o app para ${PLATFORM_NAME[primary.platform]}`;
  return (
    <li className="rail-li">
      <span className="rail-pill" aria-hidden />
      <Tooltip label={`${label}${primary.version ? ` (${primary.version})` : ''}`} side="right">
        <a
          className="rail-item rail-action"
          href={primary.url}
          download={primary.fileName ?? undefined}
          aria-label={label}
        >
          <Icon name="download" />
        </a>
      </Tooltip>
    </li>
  );
}
