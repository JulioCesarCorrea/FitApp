import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatApi, ChatEvent, ChatOutcome } from './aiService';
import {
  ChatService, EXPIRY_DAYS, MAX_BYTES, MAX_CONVERSATIONS, MAX_HISTORY, MAX_MESSAGES_PER_CONVERSATION,
} from './chatService';
import { MemoryStore } from './memoryStore';
import { parseSse } from './sse';

describe('lectura de eventos (SPEC-ai-004)', () => {
  it('AC-ai-004-01 separa los eventos completos y deja lo que está a medias para el siguiente trozo', () => {
    const first = parseSse('data: {"type":"meta","medical":false,"category":null,"notice":null}\n\ndata: {"type":"delta","text":"Ho');

    expect(first.events).toEqual([{ type: 'meta', medical: false, category: null, notice: null }]);
    const second = parseSse(`${first.rest}la"}\n\ndata: {"type":"done","usage":{"promptTokens":10,"completionTokens":5}}\n\n`);
    expect(second.events).toEqual([{ type: 'delta', text: 'Hola' }, { type: 'done', usage: { promptTokens: 10, completionTokens: 5 } }]);
    expect(second.rest).toBe('');
  });

  it('AC-ai-004-12 un evento corrupto o sin tipo se ignora sin romper los demás', () => {
    const { events } = parseSse('data: {no es json}\n\ndata: {"sin":"tipo"}\n\n: comentario\n\ndata: {"type":"delta","text":"ok"}\n\n');

    expect(events).toEqual([{ type: 'delta', text: 'ok' }]);
  });
});

function fakeApi() {
  const state: { events: ChatEvent[]; outcome: ChatOutcome | null; requests: { text: string; history: { role: string; text: string }[]; useMyData: boolean }[] } = {
    events: [], outcome: null, requests: [],
  };
  const api: ChatApi = {
    chat: async (request, onEvent, shouldStop) => {
      state.requests.push(request);
      if (state.outcome && state.outcome.kind !== 'stream') return state.outcome;
      for (const e of state.events) {
        if (shouldStop()) break;
        onEvent(e);
      }
      return { kind: 'stream' };
    },
  };
  return { state, api };
}

const reply = (...parts: string[]): ChatEvent[] => [
  { type: 'meta', medical: false, category: null, notice: null },
  ...parts.map((text): ChatEvent => ({ type: 'delta', text })),
  { type: 'done', usage: { promptTokens: 10, completionTokens: 5 } },
];

describe('preguntas a la IA guardadas en el teléfono (SPEC-ai-004)', () => {
  let store: MemoryStore;
  let now: Date;
  let n: number;
  let fake: ReturnType<typeof fakeApi>;
  let chat: ChatService;

  beforeEach(() => {
    store = new MemoryStore();
    now = new Date('2026-11-23T10:00:00Z');
    n = 0;
    fake = fakeApi();
    chat = new ChatService(store, fake.api, () => `id-${++n}`, () => now);
  });

  const ask = async (conversationId: string | null, text: string, useMyData = false) => {
    const updates: string[] = [];
    const result = await chat.ask(conversationId, text, useMyData, (m) => updates.push(m.text));
    if (!result.ok) throw new Error(result.message);
    return { ...result, updates };
  };

  it('AC-ai-004-01 guarda la pregunta y la respuesta que llega por fragmentos, y entrega lo recibido a medida que llega', async () => {
    fake.state.events = reply('Come ', 'algo ', 'ligero.');

    const { conversationId, updates } = await ask(null, '¿Qué como antes de entrenar?');

    expect(updates.filter((u) => u !== '')).toContain('Come algo ');
    const [conversation] = await chat.conversations();
    expect(conversation).toMatchObject({ id: conversationId, title: '¿Qué como antes de entrenar?' });
    const messages = await chat.messages(conversationId);
    expect(messages.map((m) => [m.role, m.text, m.complete])).toEqual([['user', '¿Qué como antes de entrenar?', true], ['assistant', 'Come algo ligero.', true]]);
  });

  it('AC-ai-004-01 rechaza una pregunta vacía o de más de 1000 caracteres sin guardar nada', async () => {
    expect((await chat.ask(null, '   ', false, () => {})).ok).toBe(false);
    expect((await chat.ask(null, 'a'.repeat(1001), false, () => {})).ok).toBe(false);

    expect(await chat.conversations()).toEqual([]);
    expect(fake.state.requests).toEqual([]);
  });

  it('AC-ai-004-03 y 13 la petición lleva «usar mis datos» y solo los últimos 10 mensajes completos de la conversación', async () => {
    fake.state.events = reply('Ok');
    const first = await ask(null, 'Pregunta 1');
    for (let i = 2; i <= 8; i++) await ask(first.conversationId, `Pregunta ${i}`);

    await ask(first.conversationId, 'Pregunta 9', true);

    const last = fake.state.requests[fake.state.requests.length - 1];
    expect(last.useMyData).toBe(true);
    expect(last.history).toHaveLength(MAX_HISTORY);
    expect(last.history[0]).toEqual({ role: 'user', text: 'Pregunta 4' });
    expect(fake.state.requests[0].history).toEqual([]);
    expect(fake.state.requests[1].useMyData).toBe(false);
  });

  it('AC-ai-004-05 el aviso fijo de un tema médico se guarda con la respuesta', async () => {
    fake.state.events = [{ type: 'meta', medical: true, category: 'dolor_lesion', notice: 'Consulta a un profesional sanitario.' }, { type: 'delta', text: 'Descansa.' }, { type: 'done', usage: { promptTokens: 1, completionTokens: 1 } }];

    const { conversationId } = await ask(null, 'Me duele la rodilla');

    const [, answer] = await chat.messages(conversationId);
    expect(answer.notice).toBe('Consulta a un profesional sanitario.');
  });

  it('AC-ai-004-06 una emergencia se guarda con el texto fijo y no se manda como contexto después', async () => {
    fake.state.outcome = { kind: 'emergency', category: 'emergencia', text: 'Acude ya a los servicios de emergencia de tu país.' };
    const { conversationId, outcome } = await ask(null, 'Me falta el aire');
    expect(outcome.kind).toBe('emergency');
    const [, answer] = await chat.messages(conversationId);
    expect(answer).toMatchObject({ kind: 'emergency', complete: true, text: 'Acude ya a los servicios de emergencia de tu país.' });

    fake.state.outcome = null;
    fake.state.events = reply('Ok');
    await ask(conversationId, 'Otra cosa');
    expect(fake.state.requests[1].history).toEqual([{ role: 'user', text: 'Me falta el aire' }]); // la respuesta fija no entra
  });

  it('AC-ai-004-12 un error a mitad conserva lo recibido como incompleto y no lo envía como contexto', async () => {
    fake.state.events = [{ type: 'delta', text: 'Empiezo ' }, { type: 'error', code: 'provider_error', message: 'x' }];
    const { conversationId } = await ask(null, 'Cuéntame');

    const [, partial] = await chat.messages(conversationId);
    expect(partial).toMatchObject({ text: 'Empiezo ', complete: false, kind: 'error' });

    fake.state.events = reply('Ok');
    await ask(conversationId, 'Sigue');
    expect(fake.state.requests[1].history).toEqual([{ role: 'user', text: 'Cuéntame' }]); // la respuesta cortada no entra
  });

  it('AC-ai-004-18 cortar la respuesta conserva lo recibido hasta ese momento', async () => {
    fake.state.events = [{ type: 'delta', text: 'Uno ' }, { type: 'delta', text: 'dos ' }, { type: 'delta', text: 'tres ' }];
    let count = 0;
    const result = await chat.ask(null, 'Cuenta', false, () => { if (++count === 3) chat.stop(); });

    expect(result.ok && result.outcome.kind).toBe('stopped');
    const [, partial] = await chat.messages(result.ok ? result.conversationId : '');
    expect(partial.text).toMatch(/^Uno /);
    expect(partial.text).not.toContain('tres');
    expect(partial.complete).toBe(false);
  });

  it('AC-ai-004-11 sin conexión o con un límite la pregunta se guarda y no queda una respuesta vacía', async () => {
    fake.state.outcome = { kind: 'offline' };

    const { conversationId, outcome } = await ask(null, 'Hola');

    expect(outcome.kind).toBe('offline');
    expect((await chat.messages(conversationId)).map((m) => m.role)).toEqual(['user']);
    fake.state.outcome = { kind: 'error', code: 'rate_limited', message: 'x', retryAfterSeconds: 600 };
    expect((await ask(conversationId, 'Otra')).outcome).toMatchObject({ kind: 'error', code: 'rate_limited' });
  });

  it('AC-ai-004-15 guarda como máximo 20 conversaciones: se borra la más antigua', async () => {
    fake.state.events = reply('Ok');
    for (let i = 0; i < MAX_CONVERSATIONS + 3; i++) {
      now = new Date(now.getTime() + 1000);
      await ask(null, `Pregunta ${i}`);
    }

    const titles = (await chat.conversations()).map((c) => c.title);
    expect(titles).toHaveLength(MAX_CONVERSATIONS);
    expect(titles).not.toContain('Pregunta 0');
    expect(titles[0]).toBe(`Pregunta ${MAX_CONVERSATIONS + 2}`);
  });

  it('AC-ai-004-15 guarda como máximo 40 mensajes por conversación: se borran los más antiguos', async () => {
    fake.state.events = reply('Ok');
    let id: string | null = null;
    for (let i = 0; i < 25; i++) {
      now = new Date(now.getTime() + 1000);
      id = (await ask(id, `P${i}`)).conversationId;
    }

    const messages = await chat.messages(id as string);
    expect(messages).toHaveLength(MAX_MESSAGES_PER_CONVERSATION);
    expect(messages[messages.length - 2].text).toBe('P24');
    expect(messages[0].text).not.toBe('P0');
  });

  it('AC-ai-004-15 las conversaciones sin actividad en 90 días caducan', async () => {
    fake.state.events = reply('Ok');
    const old = await ask(null, 'Vieja');
    now = new Date(now.getTime() + (EXPIRY_DAYS + 1) * 86_400_000);

    await ask(null, 'Nueva');

    expect((await chat.conversations()).map((c) => c.title)).toEqual(['Nueva']);
    expect(await chat.messages(old.conversationId)).toEqual([]);
  });

  it('AC-ai-004-15 si lo guardado pasa de 1 MB se borran las conversaciones más antiguas y se muestra cuánto ocupa', async () => {
    fake.state.events = reply('x'.repeat(5000));
    for (let i = 0; i < 18; i++) {
      now = new Date(now.getTime() + 1000);
      await ask(null, `Pregunta ${i} ${'y'.repeat(900)}`);
    }
    const before = await chat.storage();
    expect(before.bytes).toBeGreaterThan(MAX_BYTES * 0.1);

    fake.state.events = reply('z'.repeat(20000));
    for (let i = 0; i < 40; i++) {
      now = new Date(now.getTime() + 1000);
      await ask(null, `Grande ${i}`);
    }

    const after = await chat.storage();
    expect(after.bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(after.conversations).toBeLessThanOrEqual(MAX_CONVERSATIONS);
  });

  it('AC-ai-004-16 borrar una conversación o todo lo guardado, y los datos de la cuenta se borran con el resto de los datos locales', async () => {
    fake.state.events = reply('Ok');
    const one = await ask(null, 'Una');
    await ask(null, 'Dos');

    await chat.deleteConversation(one.conversationId);
    expect((await chat.conversations()).map((c) => c.title)).toEqual(['Dos']);

    await ask(null, 'Tres');
    await store.clearUserData();
    expect(await chat.conversations()).toEqual([]);
    await ask(null, 'Cuatro');
    await chat.deleteAll();
    expect(await chat.storage()).toEqual({ conversations: 0, messages: 0, bytes: 0 });
  });
});
