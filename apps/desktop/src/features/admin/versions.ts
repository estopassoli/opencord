/**
 * Versões do app no painel do super admin: fatias do gráfico de pizza (visão geral) e a versão mais recente
 * publicada (para marcar quem está desatualizado na lista de usuários).
 */
import type { AdminStats } from '@opencord/contracts';
import { useEffect, useState } from 'react';
import { allFiles, type DesktopDownload } from '../../lib/downloads';
import { api } from '../../store/session';

export type VersionShare = NonNullable<AdminStats['appVersions']>[number];

/** "0.3.10" > "0.3.9" > "0.2.393", número a número */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function newestVersion(vs: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of vs) if (v && (!best || compareVersions(v, best) > 0)) best = v;
  return best;
}

export interface VersionSlice {
  id: string;
  label: string;
  value: number;
  /** cor por papel (admin.css): as versões vão da 1 (a mais nova) à 4; o navegador é sempre a 5 */
  color: string;
  /** versões somadas em "Outras versões" */
  folded?: string[];
  latest?: boolean;
}

/** quantas versões ganham fatia própria; o resto vira "Outras versões" (a pizza fica legível com até 6 fatias) */
export const NAMED_VERSIONS = 4;

/**
 * Fatias da pizza: a versão mais recente sempre aparece; depois as com mais gente, até {@link NAMED_VERSIONS},
 * da mais nova para a mais antiga. O que sobra vai para "Outras versões" e quem usa pelo navegador fica à parte.
 */
export function versionSlices(shares: readonly VersionShare[], latest?: string | null): VersionSlice[] {
  const versions = shares.filter((s): s is { version: string; users: number } => Boolean(s.version) && s.users > 0);
  const newest = newestVersion(versions.map((s) => s.version));
  const top = new Set<string>(newest ? [newest] : []);
  for (const s of [...versions].sort((a, b) => b.users - a.users || compareVersions(b.version, a.version))) {
    if (top.size >= NAMED_VERSIONS) break;
    top.add(s.version);
  }
  const named = versions.filter((s) => top.has(s.version)).sort((a, b) => compareVersions(b.version, a.version));
  const rest = versions.filter((s) => !top.has(s.version)).sort((a, b) => compareVersions(b.version, a.version));
  const out: VersionSlice[] = named.map((s, i) => ({
    id: `v${s.version}`,
    label: s.version,
    value: s.users,
    color: `var(--adm-series-${i + 1})`,
    latest: latest ? s.version === latest : s.version === newest,
  }));
  if (rest.length)
    out.push({
      id: 'other',
      label: 'Outras versões',
      value: rest.reduce((n, s) => n + s.users, 0),
      color: 'var(--adm-series-other)',
      folded: rest.map((s) => s.version),
    });
  const web = shares.filter((s) => !s.version).reduce((n, s) => n + s.users, 0);
  if (web > 0) out.push({ id: 'web', label: 'Navegador', value: web, color: 'var(--adm-series-5)' });
  return out;
}

/**
 * Versão de referência para "mais recente": a publicada nos downloads ou, se alguém já usa uma mais nova (servidor
 * sem os instaladores novos), essa.
 */
export const referenceVersion = (release: string | null, shares: readonly VersionShare[] | undefined) =>
  newestVersion([release, ...(shares ?? []).map((s) => s.version)]);

let latestRelease: Promise<string | null> | null = null;

/** Versão mais recente publicada nos downloads do servidor (uma busca por sessão do app); null se não houver. */
export function useLatestRelease(): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    latestRelease ??= api()
      .request<DesktopDownload>('GET', '/downloads/desktop')
      .then(
        (d) => newestVersion(allFiles(d).map((f) => f.version)),
        () => null,
      );
    let cancelled = false;
    void latestRelease.then((x) => !cancelled && setV(x));
    return () => {
      cancelled = true;
    };
  }, []);
  return v;
}
