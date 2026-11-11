/**
 * Peças do painel do super admin em formato de dashboard (ADR-0020): cartões, KPIs, gráficos de barras, sparklines,
 * chips de filtro e formatação. Tudo com classes `adm-*` (admin.css), acessível por teclado e sem `title` nativo.
 */
import { Icon, type IconName } from '@opencord/ui';
import { useState, type ReactNode } from 'react';
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

/** Porcentagens inteiras que somam 100 (maior resto): 33/33/34 em vez de 33/33/33. */
export function percents(values: readonly number[]): number[] {
  const total = sum(values);
  if (!total) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - sum(out);
  for (const [, i] of raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left--;
  }
  return out;
}
const pctText = (p: number, v: number) => (p === 0 && v > 0 ? '<1%' : `${p}%`);

export interface PieSlice {
  id: string;
  label: string;
  value: number;
  /** cor por papel (variável CSS), fixa por entidade */
  color: string;
  /** marca curta ao lado do nome na legenda ("mais recente") */
  tag?: ReactNode;
  /** linha extra no tooltip */
  note?: ReactNode;
}

/** fatia de pizza de a0 a a1 (radianos, 0 = 12 h, sentido horário) */
function arcPath(c: number, r: number, a0: number, a1: number) {
  const x = (a: number) => (c + r * Math.sin(a)).toFixed(2);
  const y = (a: number) => (c - r * Math.cos(a)).toFixed(2);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${c},${c} L${x(a0)},${y(a0)} A${r},${r} 0 ${large} 1 ${x(a1)},${y(a1)} Z`;
}

/**
 * Pizza com legenda (nome, % e total à vista, para não depender só da cor) e tooltip ao passar o mouse na fatia;
 * a fatia sob o mouse (ou a linha da legenda) fica em destaque e as outras esmaecem.
 */
export function PieChart({
  slices,
  unit,
  label,
  size = 148,
}: {
  slices: readonly PieSlice[];
  /** [singular, plural] */
  unit: [string, string];
  label: string;
  size?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = sum(slices.map((s) => s.value));
  const pcts = percents(slices.map((s) => s.value));
  const c = size / 2;
  const r = c - 1;
  const amount = (v: number) => `${nf(v)} ${v === 1 ? unit[0] : unit[1]}`;
  const summary = slices.map((s, i) => `${s.label} ${pctText(pcts[i] ?? 0, s.value)}`).join(', ');
  let acc = 0;
  return (
    <div className="adm-pie">
      <svg
        className="adm-pie-svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label}: ${summary}`}
      >
        {slices.map((s, i) => {
          const a0 = (acc / total) * 2 * Math.PI;
          acc += s.value;
          const a1 = (acc / total) * 2 * Math.PI;
          // o tooltip sai do meio da fatia, não do topo da caixa dela (que numa fatia grande é a pizza inteira)
          const mid = (a0 + a1) / 2;
          const k = slices.length === 1 ? 0 : 0.6;
          const at = (el: Element) => {
            const box = ((el as SVGElement).ownerSVGElement ?? el).getBoundingClientRect();
            const scale = box.width / size;
            return new DOMRect(
              box.left + (c + k * r * Math.sin(mid)) * scale,
              box.top + (c - k * r * Math.cos(mid)) * scale,
              0,
              0,
            );
          };
          const tip = (
            <span className="adm-pie-tip">
              <strong>{s.label}</strong>
              <span>
                {pctText(pcts[i] ?? 0, s.value)} · {amount(s.value)}
              </span>
              {s.note && <span className="muted small">{s.note}</span>}
            </span>
          );
          const common = {
            className: 'adm-pie-slice',
            fill: s.color,
            'data-dim': (active !== null && active !== s.id) || undefined,
            onMouseEnter: () => setActive(s.id),
            onMouseLeave: () => setActive(null),
          };
          return (
            <Tooltip key={s.id} label={tip} at={at}>
              {slices.length === 1 ? (
                <circle cx={c} cy={c} r={r} {...common} />
              ) : (
                <path d={arcPath(c, r, a0, a1)} {...common} />
              )}
            </Tooltip>
          );
        })}
      </svg>
      <ul className="adm-pie-legend" aria-label={`Legenda: ${label}`}>
        {slices.map((s, i) => (
          <li
            key={s.id}
            data-active={active === s.id || undefined}
            onMouseEnter={() => setActive(s.id)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="adm-pie-swatch" style={{ background: s.color }} aria-hidden />
            <span className="adm-pie-name">
              <span className="truncate">{s.label}</span>
              {s.tag}
            </span>
            <span className="adm-num adm-pie-pct">{pctText(pcts[i] ?? 0, s.value)}</span>
            <span className="muted small adm-num adm-pie-n">{nf(s.value)}</span>
          </li>
        ))}
      </ul>
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
