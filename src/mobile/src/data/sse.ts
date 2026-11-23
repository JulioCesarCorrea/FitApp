// Lectura de eventos del servidor (text/event-stream) de las preguntas a la IA (SPEC-ai-004). Sin dependencias de React Native.

import type { ChatEvent } from './aiService';

/**
 * Separa lo recibido hasta ahora en eventos completos (`data: {...}` terminados en línea en blanco) y el resto, que todavía está a
 * medias. Un evento mal formado se ignora: no debe romper la respuesta que ya se está mostrando.
 */
export function parseSse(buffer: string): { events: ChatEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events: ChatEvent[] = [];
  for (const part of parts) {
    const data = part.split('\n').find((line) => line.startsWith('data:'));
    if (!data) continue;
    try {
      const event = JSON.parse(data.slice(5).trim()) as ChatEvent;
      if (event && typeof event.type === 'string') events.push(event);
    } catch {
      // evento corrupto: se ignora
    }
  }
  return { events, rest };
}
