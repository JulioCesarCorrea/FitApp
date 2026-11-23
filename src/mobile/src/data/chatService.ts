// Preguntas a la IA (SPEC-ai-004). Las conversaciones viven solo en el teléfono, con topes de espacio (el hosting es gratuito y limitado).
// La API no guarda nada del chat: cada pregunta lleva la conversación reciente.

import type { ChatApi, ChatOutcome } from './aiService';
import type { LocalChatMessage, LocalConversation, LocalStore } from './types';

export const MAX_TEXT = 1000;
export const MAX_HISTORY = 10;
/** Topes de lo que se guarda (AC-ai-004-15). */
export const MAX_CONVERSATIONS = 20;
export const MAX_MESSAGES_PER_CONVERSATION = 40;
export const EXPIRY_DAYS = 90;
export const MAX_BYTES = 1_000_000;

export interface ChatStorage {
  conversations: number;
  messages: number;
  bytes: number;
}

export type AskResult =
  | { ok: false; message: string }
  | { ok: true; conversationId: string; outcome: ChatOutcome | { kind: 'stopped' } };

const DAY_MS = 86_400_000;

export class ChatService {
  private stopRequested = false;

  constructor(
    private readonly store: LocalStore,
    private readonly remote: ChatApi,
    private readonly newId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  conversations(): Promise<LocalConversation[]> {
    return this.store.getConversations();
  }

  messages(conversationId: string): Promise<LocalChatMessage[]> {
    return this.store.getChatMessages(conversationId);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.store.deleteConversation(id);
  }

  async deleteAll(): Promise<void> {
    await this.store.deleteAllChat();
  }

  /** AC-ai-004-18: cuánto ocupa lo guardado (aproximado: el largo de los textos). */
  async storage(): Promise<ChatStorage> {
    const all = await this.store.getConversations();
    let messages = 0;
    let bytes = 0;
    for (const c of all) {
      for (const m of await this.store.getChatMessages(c.id)) {
        messages += 1;
        bytes += m.text.length + (m.notice?.length ?? 0);
      }
      bytes += c.title.length;
    }
    return { conversations: all.length, messages, bytes };
  }

  /** Corta la respuesta en curso (AC-ai-004-18): se conserva lo recibido hasta ese momento. */
  stop(): void {
    this.stopRequested = true;
  }

  /**
   * AC-ai-004-01, 05, 06, 12, 15: guarda la pregunta, pide la respuesta en streaming y la va entregando con `onUpdate` (el mensaje del
   * asistente con lo recibido hasta ahora). Un corte o un error deja lo recibido marcado como incompleto; una emergencia deja el texto fijo.
   */
  async ask(
    conversationId: string | null, rawText: string, useMyData: boolean, onUpdate: (message: LocalChatMessage) => void,
  ): Promise<AskResult> {
    const text = rawText.trim();
    if (text.length < 1 || text.length > MAX_TEXT) return { ok: false, message: `La pregunta lleva entre 1 y ${MAX_TEXT} caracteres.` };

    const now = this.now().toISOString();
    let conversation = conversationId ? (await this.store.getConversations()).find((c) => c.id === conversationId) : undefined;
    if (!conversation) conversation = { id: this.newId(), title: text.slice(0, 40), updatedAt: now };

    // El contexto son los últimos mensajes completos y normales, antes de añadir la pregunta nueva.
    const history = (await this.store.getChatMessages(conversation.id))
      .filter((m) => m.complete && m.kind === 'normal').slice(-MAX_HISTORY).map((m) => ({ role: m.role, text: m.text }));

    await this.store.saveConversation({ ...conversation, updatedAt: now });
    await this.store.saveChatMessage({
      id: this.newId(), conversationId: conversation.id, role: 'user', text, createdAt: now, complete: true, notice: null, kind: 'normal',
    });
    let reply: LocalChatMessage = {
      id: this.newId(), conversationId: conversation.id, role: 'assistant', text: '', createdAt: this.now().toISOString(), complete: false, notice: null, kind: 'normal',
    };
    onUpdate(reply);

    this.stopRequested = false;
    const outcome = await this.remote.chat(
      { text, history, useMyData },
      (event) => {
        if (event.type === 'meta') reply = { ...reply, notice: event.medical ? event.notice : null };
        else if (event.type === 'delta') reply = { ...reply, text: reply.text + event.text };
        else if (event.type === 'done') reply = { ...reply, complete: true };
        else if (event.type === 'error') reply = { ...reply, kind: 'error', complete: false };
        onUpdate(reply);
      },
      () => this.stopRequested,
    );

    if (outcome.kind === 'emergency') {
      reply = { ...reply, text: outcome.text, kind: 'emergency', complete: true, notice: null };
    } else if (outcome.kind !== 'stream') {
      // Sin respuesta (sin conexión, límite, consentimiento...): la pregunta se queda, la respuesta vacía no.
      if (reply.text.length === 0) {
        await this.prune(conversation.id);
        return { ok: true, conversationId: conversation.id, outcome };
      }
    }
    if (outcome.kind === 'stream' && this.stopRequested && !reply.complete) reply = { ...reply, complete: false };

    if (reply.text.length > 0 || reply.kind === 'emergency') await this.store.saveChatMessage(reply);
    await this.store.saveConversation({ ...conversation, updatedAt: this.now().toISOString() });
    onUpdate(reply);
    await this.prune(conversation.id);
    return { ok: true, conversationId: conversation.id, outcome: this.stopRequested && outcome.kind === 'stream' ? { kind: 'stopped' } : outcome };
  }

  /** AC-ai-004-15: caducidad a los 90 días, 20 conversaciones, 40 mensajes cada una y 1 MB en total (lo más antiguo se borra primero). */
  async prune(keepId?: string): Promise<void> {
    const limit = this.now().getTime() - EXPIRY_DAYS * DAY_MS;
    for (const c of await this.store.getConversations()) {
      if (c.id !== keepId && new Date(c.updatedAt).getTime() < limit) await this.store.deleteConversation(c.id);
    }
    const kept = await this.store.getConversations(); // más reciente primero
    for (const c of kept.slice(MAX_CONVERSATIONS)) if (c.id !== keepId) await this.store.deleteConversation(c.id);

    for (const c of (await this.store.getConversations())) {
      const messages = await this.store.getChatMessages(c.id);
      for (const m of messages.slice(0, Math.max(0, messages.length - MAX_MESSAGES_PER_CONVERSATION))) await this.store.deleteChatMessage(m.id);
    }

    while ((await this.storage()).bytes > MAX_BYTES) {
      const oldest = [...(await this.store.getConversations())].reverse().find((c) => c.id !== keepId);
      if (!oldest) break;
      await this.store.deleteConversation(oldest.id);
    }
  }
}
