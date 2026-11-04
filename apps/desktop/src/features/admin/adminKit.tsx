/**
 * Peças do painel do super admin em formato de dashboard (ADR-0020): cartões, KPIs, gráficos de barras, sparklines,
 * chips de filtro e formatação. Tudo com classes `adm-*` (admin.css), acessível por teclado e sem `title` nativo.
 */
import { Icon, type IconName } from '@opencord/ui';
import type { ReactNode } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { describeError } from '../../store/session';
import { useUi } from '../../store/ui';

export const DAYS = 14;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MB = 1024 * 1024;

export const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));
export const nf = (n: number) => n.toLocaleString('pt-BR');
export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
export const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0);

/** série de 14 dias sempre com 14 posições (API antiga não manda) */
export const series14 = (d: readonly number[] | undefined): number[] => {
  const xs = d ?? [];
  return xs.length === DAYS
    ? [...xs]
    : [...new Array<number>(Math.max(0, DAYS - xs.length)).fill(0), ...xs].slice(-DAYS);
};

/** variação em % entre duas janelas; null quando não há base de comparação */
export const delta = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export function ago(iso: string | null | undefined): string {
  const t = ts(iso);
  if (!t) return 'nunca';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} d`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `há ${mo} ${mo > 1 ? 'meses' : 'mês'}` : `há ${Math.round(mo / 12)} ano(s)`;
}

export const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
export const fmtDate = (iso: string | undefined | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDay = (offsetFromToday: number) =>
  new Date(Date.now() - offsetFromToday * DAY_MS).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

// ---------------------------------------------------------------------------

export function Card({
  title,
  sub,
  actions,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** sem preenchimento interno (tabelas e listas encostam na borda) */
  flush?: boolean;
}) {
  return (
    <section className={`adm-card${flush ? ' adm-card-flush' : ''}${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <header className="adm-card-head">
          <div className="adm-card-titles">
            {title && <h3>{title}</h3>}
            {sub && <p className="muted small">{sub}</p>}
          </div>
          {actions && <div className="adm-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral';

export function Kpi({
  icon,
  label,
  value,
  hint,
  suffix,
  trend,
  live,
  tone,
  spark,
  onClick,
}: {
  icon: IconName;
  label: string;
  value: number | string;
  hint?: ReactNode;
  suffix?: string;
  trend?: number | null;
  live?: boolean;
  tone?: Tone;
  spark?: readonly number[];
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="adm-kpi-top">
        <span className="adm-kpi-icon" data-tone={tone ?? 'brand'} aria-hidden>
          <Icon name={icon} size={18} />
        </span>
        <span className="adm-kpi-label">{label}</span>
        {live && (
          <span className="adm-live">
            <span className="adm-dot" data-on aria-hidden />
            <span className="oc-visually-hidden">(ao vivo)</span>
          </span>
        )}
      </span>
      <span className="adm-kpi-value">
        {typeof value === 'number' ? nf(value) : value}
        {suffix && <span className="adm-kpi-suffix">{suffix}</span>}
        {trend !== undefined && <Trend value={trend} />}
      </span>
      <span className="adm-kpi-foot">
        {hint && <span className="muted small">{hint}</span>}
        {spark && <MiniLine data={spark} />}
      </span>
    </>
  );
  return (
    <li className="adm-kpi-li">
      {onClick ? (
        <button type="button" className="adm-kpi" onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className="adm-kpi">{body}</div>
      )}
    </li>
  );
}

export function KpiGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="adm-kpis" aria-label={label}>
      {children}
    </ul>
  );
}

/** ↑/↓ em relação à janela anterior */
export function Trend({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const tone = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return (
    <span className="adm-trend" data-tone={tone}>
      {value > 0 ? '↑' : value < 0 ? '↓' : '→'} {Math.abs(value)}%
      <span className="oc-visually-hidden"> em relação aos 7 dias anteriores</span>
    </span>
  );
}

/** linha suave decorativa dentro do KPI (o número ao lado já diz o valor) */
function MiniLine({ data }: { data: readonly number[] }) {
  const w = 84;
  const h = 26;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((n, i) => `${(i * step).toFixed(1)},${(h - 2 - (n / max) * (h - 4)).toFixed(1)}`);
  return (
    <svg className="adm-miniline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={`0,${h} ${pts.join(' ')} ${w},${h}`} className="adm-miniline-area" />
      <polyline points={pts.join(' ')} className="adm-miniline-stroke" />
    </svg>
  );
}

/** Gráfico de barras com o total diário (14 dias), eixo de datas e valor no hover/foco. */
export function BarChart({
  data,
  unit,
  label,
  height = 150,
}: {
  data: readonly number[];
  /** [singular, plural] */
  unit: [string, string];
  label: string;
  height?: number;
}) {
  const max = Math.max(1, ...data);
  const n = data.length;
  return (
    <div className="adm-bars" role="list" aria-label={label} style={{ height }}>
      {data.map((v, i) => {
        const day = fmtDay(n - 1 - i);
        const today = i === n - 1;
        const text = `${today ? 'Hoje' : day}: ${nf(v)} ${v === 1 ? unit[0] : unit[1]}`;
        return (
          <Tooltip key={i} label={text}>
            <span className="adm-bar" role="listitem" tabIndex={0} aria-label={text}>
              <span
                className="adm-bar-fill"
                data-today={today || undefined}
                data-zero={v === 0 || undefined}
                style={{ height: `${v === 0 ? 2 : Math.max(4, (v / max) * 100)}%` }}
              />
              <span className="adm-bar-day" aria-hidden>
                {i % 2 === (n - 1) % 2 ? (today ? 'hoje' : day) : ''}
              </span>
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Mini gráfico de barras (14 dias) para linhas de tabela; a última semana em destaque. */
export function Sparkline({ data, name }: { data: readonly number[]; name: string }) {
  const max = Math.max(1, ...data);
  const total = sum(data);
  const peak = data.indexOf(Math.max(...data));
  const label =
    total === 0
      ? `${name}: nenhuma mensagem em ${data.length} dias`
      : `${name}: ${nf(total)} mensagens em ${data.length} dias; pico de ${nf(data[peak] ?? 0)} em ${fmtDay(data.length - 1 - peak)}`;
  const w = 4;
  const gap = 2;
  const width = data.length * (w + gap) - gap;
  return (
    <Tooltip label={label}>
      <span className="adm-spark" tabIndex={0} role="img" aria-label={label}>
        <svg width={width} height={22} viewBox={`0 0 ${width} 22`} aria-hidden>
          {data.map((v, i) => {
            const h = v === 0 ? 2 : Math.max(3, Math.round((v / max) * 22));
            return (
              <rect
                key={i}
                x={i * (w + gap)}
                y={22 - h}
                width={w}
                height={h}
                rx={1}
                data-zero={v === 0 || undefined}
                data-recent={i >= data.length - 7 || undefined}
              />
            );
          })}
        </svg>
      </span>
    </Tooltip>
  );
}

/** Ranking com barras proporcionais. */
export function RankList({
  items,
  empty,
}: {
  items: { id: string; icon: ReactNode; label: ReactNode; value: number }[];
  empty: string;
}) {
  if (items.length === 0) return <p className="muted small adm-empty">{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="adm-rank">
      {items.map((it) => (
        <li key={it.id}>
          <span className="adm-rank-icon" aria-hidden>
            {it.icon}
          </span>
          <span className="adm-rank-body">
            <span className="adm-rank-line">
              <span className="truncate">{it.label}</span>
              <span className="adm-num">{nf(it.value)}</span>
            </span>
            <span className="adm-rank-bar" aria-hidden>
              <span style={{ width: `${Math.max(4, (it.value / max) * 100)}%` }} />
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Chips<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; n?: number }[];
  label: string;
}) {
  return (
    <div className="adm-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="adm-chip"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.n !== undefined && <span className="adm-chip-n">{nf(o.n)}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="adm-pill" data-tone={tone}>
      {children}
    </span>
  );
}

/** Lista de fatos (rótulo → valor) para cartões de resumo. */
export function Facts({ items }: { items: { label: ReactNode; value: ReactNode; tone?: Tone }[] }) {
  return (
    <dl className="adm-facts">
      {items.map((f, i) => (
        <div key={i}>
          <dt>{f.label}</dt>
          <dd data-tone={f.tone}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Esqueleto enquanto carrega (respeita reduced motion no CSS). */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="adm-loading" aria-busy="true" aria-live="polite">
      <span className="oc-visually-hidden">Carregando…</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="adm-skel" />
      ))}
    </div>
  );
}

export function Empty({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="adm-empty-state">
      <Icon name={icon} size={28} />
      <p className="muted">{children}</p>
    </div>
  );
}

/** Botão de ícone "⋯" com tooltip (abre o menu de ações da linha). */
export function MoreButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <Tooltip label="Mais ações">
      <button
        type="button"
        className="adm-icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={onClick}
      >
        <Icon name="more" size={18} />
      </button>
    </Tooltip>
  );
}

export function IconButton({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="adm-icon-btn"
        data-danger={danger || undefined}
        aria-label={label}
        onClick={onClick}
      >
        <Icon name={icon} size={18} />
      </button>
    </Tooltip>
  );
}
