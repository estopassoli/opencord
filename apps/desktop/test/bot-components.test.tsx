import type { ActionRow, Embed, ServerEvents } from '@opencord/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../src/lib/api';
import { ComponentRows } from '../src/features/chat/Components';
import { EmbedCards } from '../src/features/chat/Embeds';
import { useBots } from '../src/store/bots';
import { useSession } from '../src/store/session';
import { useUi } from '../src/store/ui';

const ANA = '01a18609-c3c2-70d3-8869-93ae42dcc504';
const nameOf = (id: string) => (id === 'u1' || id === ANA ? 'Ana' : 'alguém');
const bot = { id: 'b1', username: 'robo', displayName: 'Robô', avatarKey: null, bot: true };

describe('EmbedCards', () => {
  it('renderiza autor, título com link, descrição em markdown, campos em grade, imagens e rodapé', () => {
    const embed: Embed = {
      title: 'Título',
      url: 'https://exemplo.com/x',
      description: `**forte** <@${ANA}>`,
      color: '#ff8800',
      author: { name: 'Autor', url: 'https://exemplo.com/a', iconUrl: 'https://exemplo.com/i.png' },
      fields: [
        { name: 'A', value: 'a', inline: true },
        { name: 'B', value: 'b', inline: true },
        { name: 'C', value: 'c', inline: false },
      ],
      thumbnail: { url: 'https://exemplo.com/t.png' },
      image: { url: 'https://exemplo.com/img.png' },
      footer: { text: 'rodapé' },
      timestamp: '2026-01-01T12:00:00.000Z',
    };
    const { container } = render(<EmbedCards embeds={[embed]} nameOf={nameOf} />);
    const card = container.querySelector('.embed') as HTMLElement;
    expect(card.style.getPropertyValue('--embed-color')).toBe('#ff8800');
    expect(container.querySelector('.embed-title a')?.getAttribute('href')).toBe('https://exemplo.com/x');
    expect(container.querySelector('.embed-author a')?.textContent).toBe('Autor');
    expect(container.querySelector('.embed-desc strong')?.textContent).toBe('forte');
    expect(container.querySelector('.embed-desc .mention')?.textContent).toBe('@Ana');
    const rows = [...container.querySelectorAll('.embed-row')].map((r) => r.querySelectorAll('.embed-field').length);
    expect(rows).toEqual([2, 1]);
    expect(container.querySelector('.embed-thumb img')?.getAttribute('src')).toBe('https://exemplo.com/t.png');
    expect(container.querySelector('.embed-image img')?.getAttribute('src')).toBe('https://exemplo.com/img.png');
    expect(container.querySelector('.embed-footer')?.textContent).toContain('rodapé');
    expect(container.querySelector('.embed-footer time')).not.toBeNull();
    // nada de tooltip nativo nem HTML interpretado
    expect(container.querySelector('[title]')).toBeNull();
  });
  it('sem cor usa a barra neutra do CSS; sem rodapé/data não há footer', () => {
    const { container } = render(<EmbedCards embeds={[{ description: 'só texto', fields: [] }]} nameOf={nameOf} />);
    const card = container.querySelector('.embed') as HTMLElement;
    expect(card.style.getPropertyValue('--embed-color')).toBe('');
    expect(container.querySelector('.embed-footer')).toBeNull();
    expect(container.querySelector('.embed-thumb')).toBeNull();
  });
  it('clique na imagem abre o visualizador com as imagens do embed', () => {
    const { container } = render(
      <EmbedCards
        embeds={[{ title: 'Foto', fields: [], image: { url: 'https://exemplo.com/img.png' } }]}
        nameOf={nameOf}
        author={{ id: 'u1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' }}
      />,
    );
    fireEvent.click(container.querySelector('.embed-image') as HTMLElement);
    const media = useUi.getState().media;
    expect(media?.items[0]?.url).toBe('https://exemplo.com/img.png');
    expect(media?.items[0]?.authorName).toBe('Ana');
    useUi.getState().closeMedia();
  });
});

describe('ComponentRows', () => {
  const request = vi.fn();
  beforeEach(() => {
    request.mockReset();
    useSession.setState({ api: { request } as unknown as ApiClient });
  });
  afterEach(() => useSession.setState({ api: null }));

  const rows: ActionRow[] = [
    {
      type: 'row',
      components: [
        { type: 'button', style: 'primary', label: 'Sim', emoji: '✅', customId: 'yes', disabled: false },
        { type: 'button', style: 'danger', label: 'Não', customId: 'no', disabled: true },
        { type: 'button', style: 'link', label: 'Site', url: 'https://exemplo.com', disabled: false },
      ],
    },
  ];

  it('botões: variantes do kit, desabilitado, link externo; clique manda a interação e bloqueia o duplo', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    request.mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<ComponentRows rows={rows} source={{ messageId: 'm1' }} />);
    const yes = screen.getByRole('button', { name: /Sim/ });
    expect(yes.className).toContain('oc-btn-primary');
    expect((screen.getByRole('button', { name: 'Não' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: /Site/ }).getAttribute('href')).toBe('https://exemplo.com');
    fireEvent.click(yes);
    fireEvent.click(yes);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('POST', '/interactions', {
      type: 'component',
      customId: 'yes',
      values: [],
      messageId: 'm1',
    });
    expect(yes.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      resolve({ id: 'i1' });
    });
    expect(yes.getAttribute('aria-busy')).toBeNull();
  });

  it('erro da API vira toast', async () => {
    request.mockRejectedValue(new Error('deu ruim'));
    render(<ComponentRows rows={rows} source={{ ephemeralOf: 'i0' }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sim/ }));
    });
    expect(request).toHaveBeenCalledWith('POST', '/interactions', {
      type: 'component',
      customId: 'yes',
      values: [],
      ephemeralOf: 'i0',
    });
    expect(useUi.getState().toasts.at(-1)?.text).toBe('deu ruim');
  });

  it('menu de texto: seleção única envia ao escolher (teclado) e fecha', async () => {
    request.mockResolvedValue({ id: 'i2' });
    const menu: ActionRow[] = [
      {
        type: 'row',
        components: [
          {
            type: 'select',
            customId: 'cor',
            kind: 'string',
            placeholder: 'Escolha a cor',
            minValues: 1,
            maxValues: 1,
            disabled: false,
            options: [
              { label: 'Azul', value: 'blue', default: false },
              { label: 'Verde', value: 'green', default: false },
            ],
          },
        ],
      },
    ];
    render(<ComponentRows rows={menu} source={{ messageId: 'm2' }} />);
    const combo = screen.getByRole('combobox', { name: 'Escolha a cor' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).not.toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(combo, { key: 'Enter' });
    });
    expect(request).toHaveBeenCalledWith('POST', '/interactions', {
      type: 'component',
      customId: 'cor',
      values: ['green'],
      messageId: 'm2',
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(combo.textContent).toContain('Verde');
  });

  it('menu múltiplo: Espaço marca, Enter só confirma com o mínimo; Esc cancela sem enviar', async () => {
    request.mockResolvedValue({ id: 'i3' });
    const menu: ActionRow[] = [
      {
        type: 'row',
        components: [
          {
            type: 'select',
            customId: 'tags',
            kind: 'string',
            minValues: 2,
            maxValues: 3,
            disabled: false,
            options: [
              { label: 'A', value: 'a', default: false },
              { label: 'B', value: 'b', default: false },
              { label: 'C', value: 'c', default: false },
            ],
          },
        ],
      },
    ];
    render(<ComponentRows rows={menu} source={{ messageId: 'm3' }} />);
    const combo = screen.getByRole('combobox');
    fireEvent.keyDown(combo, { key: 'Enter' });
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    fireEvent.keyDown(combo, { key: ' ' });
    fireEvent.keyDown(combo, { key: 'Enter' }); // só 1 marcado: não envia
    expect(request).not.toHaveBeenCalled();
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: ' ' });
    expect(screen.getAllByRole('option', { selected: true })).toHaveLength(2);
    fireEvent.keyDown(combo, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    fireEvent.keyDown(combo, { key: 'Enter' });
    await act(async () => {
      fireEvent.keyDown(combo, { key: 'Enter' });
    });
    expect(request).toHaveBeenCalledWith('POST', '/interactions', {
      type: 'component',
      customId: 'tags',
      values: ['a', 'b'],
      messageId: 'm3',
    });
  });
});

describe('useBots.replied (cartões efêmeros com embeds/componentes)', () => {
  beforeEach(() => useBots.getState().reset());
  const base: ServerEvents['interaction:replied'] = {
    interactionId: 'i1',
    channelId: 'c1',
    serverId: 's1',
    bot,
    command: 'ping',
    content: null,
  };
  it('pensando → resposta substitui; `update` mantém o que o bot não mandou de novo', () => {
    const s = useBots.getState();
    s.replied(base);
    expect(useBots.getState().ephemeral['c1']?.[0]).toMatchObject({
      id: 'i1',
      content: null,
      embeds: [],
      components: [],
    });
    const comps: ActionRow[] = [
      {
        type: 'row',
        components: [{ type: 'button', style: 'secondary', label: 'Ok', customId: 'ok', disabled: false }],
      },
    ];
    s.replied({ ...base, content: 'pong', embeds: [{ title: 'T', fields: [] }], components: comps });
    expect(useBots.getState().ephemeral['c1']).toHaveLength(1);
    expect(useBots.getState().ephemeral['c1']?.[0]).toMatchObject({ content: 'pong', components: comps });
    s.replied({ ...base, content: 'pong 2', update: true });
    const after = useBots.getState().ephemeral['c1']?.[0];
    expect(after?.content).toBe('pong 2');
    expect(after?.embeds).toEqual([{ title: 'T', fields: [] }]);
    expect(after?.components).toEqual(comps);
    // outra interação vira outro cartão
    s.replied({ ...base, interactionId: 'i2', content: 'outro' });
    expect(useBots.getState().ephemeral['c1']).toHaveLength(2);
  });
});
