import {
  MAX_REACTION_ROLES,
  REACTION_ROLE_FORBIDDEN,
  type Message,
  type ReactionSummary,
  type Role,
} from '@opencord/contracts';
import { Button, Icon, Select, TextField } from '@opencord/ui';
import { useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { useData, useMessages } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';

const NO_ROLES: Role[] = [];

/**
 * Cargos por reação (ADR-0019) sob a mensagem: um botão por emoji → cargo. Clicar reage (e o servidor dá o
 * cargo); clicar de novo tira a reação e o cargo. A reação comum (pelo seletor de emoji) faz o mesmo.
 */
export function ReactionRoleChips({
  message,
  serverId,
  canReact,
  react,
}: {
  message: Message;
  serverId: string | undefined;
  canReact: boolean;
  react: (emoji: string, on: boolean) => void;
}) {
  const roles = useData((s) => (serverId ? s.details[serverId]?.roles : undefined)) ?? NO_ROLES;
  const mine = (emoji: string) => message.reactions.some((r: ReactionSummary) => r.emoji === emoji && r.me);
  return (
    <div className="reaction-roles" role="group" aria-label="Cargos por reação">
      <span className="muted small">Clique para pegar ou largar um cargo:</span>
      {message.reactionRoles.map((rr) => {
        const role = roles.find((r) => r.id === rr.roleId);
        const on = mine(rr.emoji);
        return (
          <button
            key={rr.emoji}
            className="reaction-role"
            aria-pressed={on}
            disabled={!canReact}
            style={role?.color ? ({ '--role': role.color } as React.CSSProperties) : undefined}
            onClick={() => react(rr.emoji, !on)}
          >
            <span aria-hidden="true">{rr.emoji}</span>
            <span>{role?.name ?? 'cargo removido'}</span>
            {on && <Icon name="check" size={14} />}
          </button>
        );
      })}
    </div>
  );
}

/** Configurar: pares emoji → cargo (só cargos abaixo do meu e sem poder de moderação). */
export function ReactionRolesDialog({
  message,
  serverId,
  onClose,
}: {
  message: Message;
  serverId: string;
  onClose: () => void;
}) {
  const detail = useData((s) => s.details[serverId]);
  const meId = useData((s) => s.me?.id);
  const [pairs, setPairs] = useState(() =>
    message.reactionRoles.length ? message.reactionRoles : [{ emoji: '', roleId: '' }],
  );
  const [busy, setBusy] = useState(false);
  // meu cargo mais alto (dono/super admin: todos)
  const mine = detail?.members.find((m) => m.user.id === meId)?.roleIds ?? [];
  const top =
    detail?.ownerId === meId
      ? Infinity
      : Math.max(0, ...(detail?.roles.filter((r) => mine.includes(r.id)).map((r) => r.position) ?? []));
  const usable = (detail?.roles ?? [])
    .filter((r) => !r.isEveryone && (r.permissions & REACTION_ROLE_FORBIDDEN) === 0 && r.position < top)
    .sort((a, b) => b.position - a.position);
  const filled = pairs.filter((p) => p.emoji.trim() && p.roleId);
  const dup = new Set(filled.map((p) => p.emoji.trim())).size !== filled.length;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (dup) return;
    setBusy(true);
    try {
      const m = await api().request<Message>('PUT', `/messages/${message.id}/reaction-roles`, {
        pairs: filled.map((p) => ({ emoji: p.emoji.trim(), roleId: p.roleId })),
      });
      useMessages.getState().upsert(m);
      useUi.getState().toast('success', filled.length ? 'Cargos por reação salvos.' : 'Cargos por reação removidos.');
      onClose();
    } catch (err) {
      useUi.getState().toast('error', describeError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Cargos por reação" onClose={onClose} wide>
      <form className="form" onSubmit={(e) => void save(e)}>
        <p className="muted small">
          Quem reagir a esta mensagem com o emoji ganha o cargo; quem tirar a reação perde. Só aparecem cargos abaixo do
          seu e sem permissões de moderação.
        </p>
        {!usable.length && (
          <p className="form-error">
            Crie um cargo sem permissões de moderação (em Configurações do servidor → Cargos).
          </p>
        )}
        <div className="rr-rows">
          {pairs.map((p, i) => (
            <div key={i} className="rr-row">
              <TextField
                aria-label={`Emoji ${i + 1}`}
                fieldClassName="rr-emoji"
                placeholder="🎮"
                value={p.emoji}
                maxLength={64}
                onChange={(e) => setPairs((l) => l.map((x, j) => (j === i ? { ...x, emoji: e.target.value } : x)))}
              />
              <Select<string>
                aria-label={`Cargo ${i + 1}`}
                className="rr-role"
                value={p.roleId || null}
                placeholder="Escolha o cargo"
                onChange={(v) => setPairs((l) => l.map((x, j) => (j === i ? { ...x, roleId: v } : x)))}
                options={usable.map((r) => ({ value: r.id, label: r.name }))}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remover linha ${i + 1}`}
                data-tip="Remover"
                onClick={() =>
                  setPairs((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [{ emoji: '', roleId: '' }]))
                }
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>
        {pairs.length < MAX_REACTION_ROLES && (
          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            onClick={() => setPairs((l) => [...l, { emoji: '', roleId: '' }])}
          >
            Adicionar cargo
          </Button>
        )}
        {dup && <p className="form-error">Cada emoji só pode dar um cargo.</p>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || dup}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
