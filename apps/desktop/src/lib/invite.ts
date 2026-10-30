/** Extrai o código de um convite colado (o código puro ou um link que termina nele). */
export function parseInviteCode(text: string): string | null {
  const m = /([A-Za-z0-9]{10})\/?\s*$/.exec(text.trim());
  return m ? m[1]! : null;
}

const KEY = 'oc-pending-invite';

/**
 * Link de convite aberto no navegador (`/invite/<código>`): guarda o código até a pessoa entrar e limpa a barra
 * de endereço. Sobrevive a recarregar a página (sessionStorage), mas não a fechar a aba.
 */
export function capturePendingInvite(loc: Pick<Location, 'pathname' | 'search'> = location): string | null {
  // o nginx da interface web redireciona /invite/<código> para /?invite=<código>
  const q = new URLSearchParams(loc.search).get('invite') ?? '';
  const m = /^\/invite\/([A-Za-z0-9]{10})\/?$/.exec(loc.pathname) ?? /^([A-Za-z0-9]{10})$/.exec(q);
  if (m) {
    try {
      sessionStorage.setItem(KEY, m[1]!);
    } catch {
      /* sem armazenamento: o código fica só na memória */
    }
    memory = m[1]!;
    history.replaceState(null, '', loc.pathname.startsWith('/invite/') ? '/' : loc.pathname);
  }
  return pendingInvite();
}

let memory: string | null = null;

export function pendingInvite(): string | null {
  try {
    return sessionStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function clearPendingInvite() {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignorado */
  }
}
