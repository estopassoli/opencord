import { Permission, type ServerDetail } from '@opencord/contracts';
import { fireEvent, render, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as string[]);
vi.mock('../src/features/chat/ChatView', () => ({
  sendMessage: (_k: string, _t: unknown, _r: string, body: string) => {
    sent.push(body);
    return Promise.resolve();
  },
}));

import { Composer } from '../src/features/chat/Composer';
import { useData } from '../src/store/data';
import { useUi } from '../src/store/ui';

const S = '0190a000-0000-7000-8000-000000000051';
const CH = '0190a000-0000-7000-8000-0000000000c1';
const user = (id: string, username: string, displayName: string) => ({
  id,
  username,
  displayName,
  avatarKey: null,
  bot: false,
});
const BLESSED = user('0190a000-0000-7000-8000-000000000b01', 'blessed', 'Blessed');
const IDK = user('0190a000-0000-7000-8000-000000000b02', 'idk', 'idk');

const renderComposer = () =>
  render(
    <Composer
      target={{ channelId: CH }}
      targetKey={`c:${CH}`}
      placeholder="Conversar"
      canAttach={false}
      serverId={S}
    />,
  );

describe('compositor: menções com @', () => {
  beforeEach(() => {
    // jsdom não tem matchMedia: mouse e teclado físico (Enter envia)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: false,
        media: q,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    sent.length = 0;
    useUi.setState({ drafts: {} });
    useData.setState({
      me: { ...IDK } as never,
      details: {
        [S]: {
          id: S,
          channels: [],
          roles: [],
          emojis: [],
          ownerId: IDK.id,
          myPermissions: Permission.SEND_MESSAGES | Permission.MENTION_EVERYONE,
          members: [
            { user: BLESSED, nickname: null, roleIds: [] },
            { user: IDK, nickname: null, roleIds: [] },
          ],
        } as unknown as ServerDetail,
      },
      servers: [],
      conversations: [],
    });
  });

  it('lista quem combina ao digitar @, Tab escolhe e o envio sai com a menção de verdade', () => {
    const { getByRole, queryByRole } = renderComposer();
    const box = getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Bora jogar sexta @bl' } });
    const list = getByRole('listbox', { name: 'Mencionar' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['BLBlessed@blessed']);
    fireEvent.keyDown(box, { key: 'Tab' });
    expect(box.value).toBe('Bora jogar sexta @blessed ');
    expect(queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(sent).toEqual([`Bora jogar sexta <@${BLESSED.id}>`]);
  });

  it('@usuario escrito por inteiro: Enter envia direto, já como menção', () => {
    const { getByRole } = renderComposer();
    const box = getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@Idk' } });
    expect(getByRole('listbox', { name: 'Mencionar' })).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(sent).toEqual([`<@${IDK.id}>`]);
  });

  it('@everyone aparece para quem pode; Esc fecha a lista', () => {
    const { getByRole, queryByRole } = renderComposer();
    const box = getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@ev' } });
    expect(within(getByRole('listbox')).getByText('@everyone')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(queryByRole('listbox')).toBeNull();
  });
});
