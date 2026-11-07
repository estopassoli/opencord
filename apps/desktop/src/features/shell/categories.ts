/** Ações de categoria usadas na lista de canais e nas configurações do servidor. */
import type { Category, ServerDetail } from '@opencord/contracts';
import { askConfirmCheck } from '../../components/AskDialog';
import { useData } from '../../store/data';
import { api, describeError, loadServer } from '../../store/session';
import { useUi } from '../../store/ui';

/** Pergunta e exclui a categoria; com a caixa marcada, os canais dela vão junto. Devolve true se excluiu. */
export async function deleteCategory(detail: ServerDetail, category: Category): Promise<boolean> {
  const count = detail.channels.filter((c) => c.categoryId === category.id && !c.temporary).length;
  const r = await askConfirmCheck(
    count
      ? `A categoria “${category.name}” será excluída. Sem marcar a caixa, ${count === 1 ? 'o canal dela fica' : `os ${count} canais dela ficam`} sem categoria.`
      : `A categoria “${category.name}” será excluída.`,
    {
      title: 'Excluir categoria',
      confirmLabel: 'Excluir',
      danger: true,
      check: count === 1 ? 'Excluir também o canal dela' : `Excluir também os ${count} canais dela`,
      checkDescription: 'As mensagens desses canais somem junto. Isso não pode ser desfeito.',
    },
  );
  if (!r) return false;
  try {
    await api().request('DELETE', `/categories/${category.id}${r.checked && count ? '?channels=true' : ''}`);
    const d = useData.getState();
    if (r.checked) for (const c of detail.channels) if (c.categoryId === category.id) d.removeChannel(detail.id, c.id);
    d.removeCategory(detail.id, category.id);
    return true;
  } catch (err) {
    useUi.getState().toast('error', describeError(err));
    return false;
  }
}

/** Grava a nova ordem das categorias (arrastar na lista), já mostrando na tela; volta atrás se falhar. */
export function reorderCategories(serverId: string, ids: string[]) {
  useData.setState((st) => {
    const d = st.details[serverId];
    if (!d) return {};
    const pos = new Map(ids.map((id, i) => [id, i]));
    const categories = d.categories
      .map((c) => ({ ...c, position: pos.get(c.id) ?? c.position }))
      .sort((a, b) => a.position - b.position);
    return { details: { ...st.details, [serverId]: { ...d, categories } } };
  });
  api()
    .request('PUT', `/servers/${serverId}/categories/order`, { categoryIds: ids })
    .catch((err: unknown) => {
      useUi.getState().toast('error', describeError(err));
      void loadServer(serverId).catch(() => undefined);
    });
}
