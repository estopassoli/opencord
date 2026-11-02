import type { ActionRow, Button as ButtonSpec, CreateInteractionRequest, SelectMenu } from '@opencord/contracts';
import { Button, Icon, portalTarget } from '@opencord/ui';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../lib/api';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { buttonVariant, selectChoices, selectionSummary, toggleSelection } from './bot-ui';
import { ExternalLink } from './rich';

/**
 * Botões e menus de uma mensagem de bot ou de um cartão efêmero (ADR-0034). O clique vira
 * `POST /interactions { type: 'component' }`; o app não mexe na mensagem — o bot responde com `update` (evento
 * `chat:message:updated` / `interaction:replied` com `update`) ou com uma resposta nova.
 */
export type ComponentSource = { messageId: string } | { ephemeralOf: string };

export async function sendComponentInteraction(source: ComponentSource, customId: string, values: string[] = []) {
  const body: CreateInteractionRequest = { type: 'component', customId, values, ...source };
  await api().request('POST', '/interactions', body);
}

interface Props {
  rows: ActionRow[];
  source: ComponentSource;
  /** servidor da mensagem: menus de usuário/cargo/canal listam os dele */
  serverId?: string | undefined;
  nameOf?: ((id: string) => string) | undefined;
}

export function ComponentRows({ rows, source, serverId, nameOf }: Props) {
  // uma interação por vez por mensagem: bloqueia o clique duplo e deixa claro qual está a caminho
  const [busy, setBusy] = useState<string | null>(null);
  const inflight = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (!rows.length) return null;

  const send = async (customId: string, values: string[] = []) => {
    if (inflight.current) return;
    inflight.current = customId;
    setBusy(customId);
    try {
      await sendComponentInteraction(source, customId, values);
    } catch (e) {
      useUi.getState().toast('error', e instanceof ApiError && e.status === 409 ? 'Bot offline.' : describeError(e));
    } finally {
      inflight.current = null;
      if (alive.current) setBusy(null);
    }
  };

  return (
    <div className="components">
      {rows.map((row, i) => (
        <div key={i} className="component-row" role="group" aria-label={`Ações ${i + 1}`}>
          {row.components.map((c, j) =>
            c.type === 'button' ? (
              <ComponentButton
                key={c.customId ?? `link-${j}`}
                b={c}
                busy={busy !== null && busy === c.customId}
                onClick={() => c.customId && void send(c.customId)}
              />
            ) : (
              <ComponentSelect
                key={c.customId}
                menu={c}
                serverId={serverId}
                nameOf={nameOf}
                busy={busy === c.customId}
                send={(values) => void send(c.customId, values)}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function ComponentButton({ b, busy, onClick }: { b: ButtonSpec; busy: boolean; onClick: () => void }) {
  const content = (
    <>
      {b.emoji && (
        <span className="component-emoji" aria-hidden={Boolean(b.label)}>
          {b.emoji}
        </span>
      )}
      {b.label}
    </>
  );
  if (b.style === 'link' && b.url) {
    if (b.disabled)
      return (
        <span className="oc-btn oc-btn-secondary oc-btn-sm component-btn component-link" aria-disabled="true">
          {content}
          <Icon name="popout" size={14} />
        </span>
      );
    return (
      <ExternalLink href={b.url} className="oc-btn oc-btn-secondary oc-btn-sm component-btn component-link">
        {content}
        <Icon name="popout" size={14} />
      </ExternalLink>
    );
  }
  return (
    <Button
      variant={buttonVariant(b.style)}
      size="sm"
      className="component-btn"
      disabled={b.disabled ?? false}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy && <Icon name="refresh" size={14} className="component-spin" />}
      {content}
    </Button>
  );
}

/**
 * Menu de seleção: combobox (foco fica no gatilho) + listbox em portal, como o Select do kit, mas com seleção
 * múltipla (`maxValues > 1`: Espaço marca, Enter ou "Pronto" confirma) e opções vindas do servidor
 * (`kind` user/role/channel). Seleção única envia ao escolher; Esc ou clique fora cancelam sem enviar.
 */
function ComponentSelect({
  menu,
  serverId,
  nameOf,
  busy,
  send,
}: {
  menu: SelectMenu;
  serverId: string | undefined;
  nameOf: ((id: string) => string) | undefined;
  busy: boolean;
  send: (values: string[]) => void;
}) {
  const detail = useData((s) => (serverId ? s.details[serverId] : undefined));
  const choices = useMemo(() => selectChoices(menu, detail, nameOf), [menu, detail, nameOf]);
  const max = Math.max(1, menu.maxValues ?? 1);
  const min = Math.min(max, menu.minValues ?? 1);
  const multi = max > 1;
  const [selected, setSelected] = useState<string[]>(() =>
    (menu.options ?? []).filter((o) => o.default).map((o) => o.value),
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  const listId = `${id}-list`;
  const disabled = (menu.disabled ?? false) || choices.length === 0;
  const valid = selected.length >= min && selected.length <= max;

  const openList = () => {
    if (disabled) return;
    setActive(
      Math.max(
        0,
        choices.findIndex((c) => selected.includes(c.value)),
      ),
    );
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const confirm = (values: string[]) => {
    close();
    setSelected(values);
    send(values);
  };
  const choose = (idx: number) => {
    const c = choices[idx];
    if (!c) return;
    if (!multi) return confirm([c.value]);
    setSelected((s) => toggleSelection(s, c.value, max));
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const desired = Math.min(320, choices.length * 40 + (multi ? 52 : 8));
    const up = below < Math.min(desired, 200) && above > below;
    const maxHeight = Math.max(120, Math.min(320, up ? above : below));
    setPos({
      left: r.left,
      width: Math.max(r.width, 220),
      top: up ? r.top - Math.min(desired, maxHeight) - 4 : r.bottom + 4,
      maxHeight,
    });
  }, [open, choices.length, multi]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(false);
    };
    const onAway = () => close(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onAway);
    window.addEventListener('blur', onAway);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('blur', onAway);
    };
  }, [open]);

  const typeahead = (ch: string) => {
    const now = Date.now();
    typed.current = {
      text: now - typed.current.at < 600 ? typed.current.text + ch.toLowerCase() : ch.toLowerCase(),
      at: now,
    };
    const idx = choices.findIndex((c) => c.label.toLowerCase().startsWith(typed.current.text));
    if (idx >= 0) setActive(idx);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    const n = choices.length;
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      close(e.key === 'Escape');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + n) % n);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(n - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!multi) choose(active);
      else if (valid) confirm(selected);
    } else if (e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) typeahead(e.key);
  };

  const placeholder = menu.placeholder || (multi ? 'Escolha…' : 'Escolher…');
  const summary = selected.length ? selectionSummary(selected, choices) : placeholder;

  return (
    <div className="component-select">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="oc-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={placeholder}
        aria-busy={busy || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
      >
        <span className={selected.length ? 'oc-select-value' : 'oc-select-value oc-placeholder'}>{summary}</span>
        {busy ? (
          <Icon name="refresh" size={16} className="component-spin" />
        ) : (
          <Icon name="chevron-down" size={16} className={open ? 'oc-select-chevron oc-rotated' : 'oc-select-chevron'} />
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            className="oc-listbox component-listbox"
            style={
              pos
                ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }
                : { visibility: 'hidden' }
            }
          >
            <ul id={listId} role="listbox" aria-multiselectable={multi || undefined} aria-label={placeholder}>
              {choices.map((c, i) => {
                const on = selected.includes(c.value);
                return (
                  <li
                    key={c.value}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={on}
                    className={i === active ? 'oc-option oc-option-active' : 'oc-option'}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(i)}
                  >
                    {c.emoji && (
                      <span className="component-emoji" aria-hidden>
                        {c.emoji}
                      </span>
                    )}
                    {c.color !== undefined && (
                      <span
                        className="component-option-dot"
                        style={{ background: c.color ?? 'var(--text-muted)' }}
                        aria-hidden
                      />
                    )}
                    {c.icon && <Icon name={c.icon} size={16} />}
                    <span className="oc-option-text">
                      <span className="oc-option-label">{c.label}</span>
                      {c.description && <span className="oc-option-desc">{c.description}</span>}
                    </span>
                    {on && <Icon name="check" size={16} active />}
                  </li>
                );
              })}
            </ul>
            {multi && (
              <div className="component-listbox-foot">
                <span>
                  {selected.length}/{max}
                  {min > 0 ? ` · mín. ${min}` : ''}
                </span>
                <Button
                  size="sm"
                  disabled={!valid}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => confirm(selected)}
                >
                  Pronto
                </Button>
              </div>
            )}
          </div>,
          portalTarget(trigger.current),
        )}
    </div>
  );
}
