import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentType, type ButtonInteraction, type Interaction, type Message } from '../src/index.js';
import {
  CHANNEL_ID,
  CONV_ID,
  INTERACTION_ID,
  VOICE_ID,
  interactionDto,
  messageDto,
  person2,
  setup,
} from './helpers.js';

async function emitMessage(s: ReturnType<typeof setup>, dto: ReturnType<typeof messageDto>): Promise<Message> {
  const p = new Promise<Message>((r) => s.client.once('messageCreate', r));
  s.socket().fire('chat:message:created', dto);
  return p;
}

const row = {
  type: 'row' as const,
  components: [{ type: 'button' as const, style: 'primary' as const, label: 'A', customId: 'a', disabled: false }],
};

describe('coletores', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('message.createMessageComponentCollector: filtra pela mensagem, max e time', async () => {
    const s = setup();
    await s.ready();
    const got: Interaction[] = [];
    s.client.on('interactionCreate', (i) => got.push(i));
    const msg = messageDto({ components: [row] });
    const message = await emitMessage(s, msg);
    const collector = message.createMessageComponentCollector<ButtonInteraction>({
      componentType: ComponentType.Button,
      time: 5000,
      max: 2,
    });
    const collected: string[] = [];
    collector.on('collect', (i) => collected.push(i.user.id));
    const end = vi.fn();
    collector.on('end', end);
    // outra mensagem: ignorado
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666601',
        type: 'component',
        customId: 'a',
        componentType: 'button',
        targetMessage: messageDto({ id: '55555555-5555-4555-8555-555555555599', components: [row] }),
      }),
    );
    // comando: ignorado (tipo)
    s.socket().fire('interaction:created', interactionDto({ id: '66666666-6666-4666-8666-666666666602' }));
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666603',
        type: 'component',
        customId: 'a',
        componentType: 'button',
        targetMessage: msg,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(collected).toHaveLength(1);
    expect(end).not.toHaveBeenCalled();
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666604',
        type: 'component',
        customId: 'a',
        componentType: 'button',
        targetMessage: msg,
        user: person2,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(collected).toHaveLength(2);
    expect(end).toHaveBeenCalledWith(expect.any(Map), 'limit');
    expect(collector.ended).toBe(true);
    expect(collector.collected.size).toBe(2);
    expect(s.client.listenerCount('interactionCreate')).toBe(1);

    const timed = message.createMessageComponentCollector({ time: 1000 });
    const ended = new Promise<string>((r) => timed.on('end', (_c, reason) => r(reason)));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await ended).toBe('time');
  });

  it('filter, idle, stop manual e iteração assíncrona', async () => {
    const s = setup();
    await s.ready();
    const msg = messageDto({ components: [row] });
    const message = await emitMessage(s, msg);
    const collector = message.createMessageComponentCollector({ filter: (i) => i.user.id === person2.id, idle: 2000 });
    const ignored = vi.fn();
    collector.on('ignore', ignored);
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666611',
        type: 'component',
        customId: 'a',
        componentType: 'button',
        targetMessage: msg,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(ignored).toHaveBeenCalledTimes(1);
    expect(collector.collected.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666612',
        type: 'component',
        customId: 'a',
        componentType: 'button',
        targetMessage: msg,
        user: person2,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(collector.collected.size).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(collector.ended).toBe(false); // o idle reiniciou ao coletar
    await vi.advanceTimersByTimeAsync(600);
    expect(collector.endReason).toBe('idle');

    const manual = message.createMessageComponentCollector();
    manual.stop('cansei');
    expect(manual.endReason).toBe('cansei');
    await expect(manual.next).rejects.toMatchObject({ code: 'cansei' });
  });

  it('awaitMessageComponent resolve com o clique ou rejeita com time; encerra se a mensagem for apagada', async () => {
    const s = setup();
    await s.ready();
    const msg = messageDto({ components: [row] });
    const message = await emitMessage(s, msg);
    const p = message.awaitMessageComponent({ time: 5000 });
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666621',
        type: 'component',
        customId: 'a',
        componentType: 'button',
        targetMessage: msg,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect((await p).customId).toBe('a');
    const late = message.awaitMessageComponent({ time: 1000 }).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await late).toMatchObject({ name: 'CollectorError', code: 'time' });
    const deleted = message.awaitMessageComponent({ time: 10_000 }).catch((e: { code: string }) => e.code);
    s.socket().fire('chat:message:deleted', { messageId: msg.id, channelId: CHANNEL_ID, conversationId: null });
    expect(await deleted).toBe('messageDelete');
  });

  it('cartão efêmero: InteractionResponse.awaitMessageComponent casa pelo ephemeralOf', async () => {
    const s = setup();
    await s.ready();
    const got: Interaction[] = [];
    s.client.on('interactionCreate', (i) => got.push(i));
    s.socket().fire('interaction:created', interactionDto());
    const i = got[0]!;
    if (!i.isChatInputCommand()) throw new Error('tipo errado');
    const res = await i.reply({ content: 'escolha', components: [row], ephemeral: true });
    const p = res.awaitMessageComponent({ time: 5000 });
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666631',
        type: 'component',
        customId: 'a',
        componentType: 'button',
        ephemeralOf: INTERACTION_ID,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const click = await p;
    expect(click.ephemeralOf).toBe(INTERACTION_ID);
    expect(click.isButton()).toBe(true);
  });

  it('channel.createMessageCollector / awaitMessages com errors: ["time"]; coletor de componentes por canal', async () => {
    const s = setup();
    await s.ready();
    const channel = s.client.channels.cache.get(CHANNEL_ID)!;
    const c = channel.createMessageCollector({ filter: (m) => !m.author.bot, max: 2, time: 5000 });
    const texts: string[] = [];
    c.on('collect', (m) => texts.push(m.content));
    s.socket().fire('chat:message:created', messageDto({ id: '55555555-5555-4555-8555-555555555601', body: 'um' }));
    s.socket().fire(
      'chat:message:created',
      messageDto({ id: '55555555-5555-4555-8555-555555555602', body: 'outro canal', channelId: VOICE_ID }),
    );
    s.socket().fire(
      'chat:message:created',
      messageDto({ id: '55555555-5555-4555-8555-555555555603', body: 'dm', channelId: null, conversationId: CONV_ID }),
    );
    s.socket().fire('chat:message:created', messageDto({ id: '55555555-5555-4555-8555-555555555604', body: 'dois' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(texts).toEqual(['um', 'dois']);
    expect(c.endReason).toBe('limit');

    const waiting = channel
      .awaitMessages({ max: 1, time: 1000, errors: ['time'] })
      .catch((e: { code: string }) => e.code);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await waiting).toBe('time');
    const ok = channel.awaitMessages({ max: 1, time: 1000 });
    s.socket().fire('chat:message:created', messageDto({ id: '55555555-5555-4555-8555-555555555605', body: 'três' }));
    await vi.advanceTimersByTimeAsync(0);
    expect((await ok).first()?.content).toBe('três');

    const byChannel = channel.createMessageComponentCollector({ time: 5000 });
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666641',
        type: 'component',
        customId: 'a',
        componentType: 'button',
        targetMessage: messageDto({ components: [row] }),
      }),
    );
    s.socket().fire(
      'interaction:created',
      interactionDto({
        id: '66666666-6666-4666-8666-666666666642',
        type: 'component',
        customId: 'a',
        componentType: 'button',
        channelId: VOICE_ID,
        targetMessage: messageDto({ channelId: VOICE_ID, components: [row] }),
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(byChannel.collected.size).toBe(1);
    byChannel.stop();
    const dm = await new Promise<Message>((r) => {
      s.client.once('messageCreate', r);
      s.socket().fire(
        'chat:message:created',
        messageDto({
          id: '55555555-5555-4555-8555-555555555606',
          body: 'dm',
          channelId: null,
          conversationId: CONV_ID,
        }),
      );
    });
    const dmWait = dm.channel.awaitMessages({ max: 1, time: 1000 });
    s.socket().fire(
      'chat:message:created',
      messageDto({ id: '55555555-5555-4555-8555-555555555607', body: 'dm2', channelId: null, conversationId: CONV_ID }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect((await dmWait).first()?.content).toBe('dm2');
  });
});
