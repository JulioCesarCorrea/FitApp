import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chips } from '../components/Chips';
import { Body, Button, Field, Muted, Title } from '../components/ui';
import { useDeps } from '../data/DataContext';
import { aiErrorText } from '../data/aiService';
import { MAX_TEXT, type ChatStorage } from '../data/chatService';
import type { LocalChatMessage, LocalConversation } from '../data/types';
import { useTheme } from '../theme';

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1000))} KB`;

/** Preguntas a la IA (SPEC-ai-004, AC-18): respuesta en streaming, conversaciones solo en este teléfono y avisos fijos en temas médicos. */
export default function ChatScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { chat } = useDeps();
  const [conversations, setConversations] = useState<LocalConversation[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [text, setText] = useState('');
  const [useMyData, setUseMyData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [storage, setStorage] = useState<ChatStorage>({ conversations: 0, messages: 0, bytes: 0 });

  const reload = useCallback(async (id: string | null) => {
    setConversations(await chat.conversations());
    setMessages(id ? await chat.messages(id) : []);
    setStorage(await chat.storage());
  }, [chat]);
  useFocusEffect(useCallback(() => { void reload(current); }, [reload, current]));

  const open = (id: string | null) => {
    setCurrent(id);
    setMessage(null);
    void reload(id);
  };

  const send = async () => {
    if (busy || text.trim() === '') return;
    const question = text;
    setBusy(true);
    setMessage(null);
    setText('');
    const savedMessages = current ? await chat.messages(current) : [];
    const pendingUser: LocalChatMessage = {
      id: 'pendiente', conversationId: current ?? '', role: 'user', text: question.trim(), createdAt: new Date().toISOString(), complete: true, notice: null, kind: 'normal',
    };
    setMessages([...savedMessages, pendingUser]);

    const result = await chat.ask(current, question, useMyData, (reply) => setMessages([...savedMessages, pendingUser, reply]));
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      setText(question);
    } else {
      setCurrent(result.conversationId);
      if (result.outcome.kind === 'offline') setMessage('La IA necesita conexión: tu pregunta se guardó, pero no hay respuesta.');
      else if (result.outcome.kind === 'error') setMessage(aiErrorText(result.outcome));
      await reload(result.conversationId);
    }
  };

  const remove = async () => {
    if (!current) return;
    await chat.deleteConversation(current);
    open(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>Preguntas a la IA</Title>
      <Muted testID="chat-disclaimer">
        Las respuestas son orientativas y no sustituyen a un profesional de la salud. No escribas tu nombre, tu ubicación ni datos clínicos
        detallados. Las conversaciones se guardan solo en este teléfono.
      </Muted>

      <Chips
        options={conversations.map((c) => ({ value: c.id, label: c.title }))}
        selected={current ? [current] : []}
        onToggle={(id) => open(id)}
        testIDPrefix="conversation"
        showHint={false}
      />
      <Button title="Nueva conversación" variant="secondary" testID="new-conversation" onPress={() => open(null)} />

      {messages.map((m) => (
        <View
          key={m.id}
          testID={`message-${m.role}-${m.id}`}
          style={[styles.card, { borderColor: m.kind === 'emergency' ? colors.danger : colors.border, backgroundColor: m.role === 'user' ? colors.background : colors.surface }]}
        >
          <Muted>{m.role === 'user' ? 'Tú' : 'IA'}</Muted>
          <Body>{m.text === '' && m.role === 'assistant' ? '…' : m.text}</Body>
          {m.role === 'assistant' && !m.complete && m.text !== '' && m.kind !== 'emergency' && (
            <Muted testID={`incomplete-${m.id}`}>Respuesta incompleta: se cortó.</Muted>
          )}
          {m.notice && <Body testID={`notice-${m.id}`} style={{ color: colors.warning }}>{m.notice}</Body>}
        </View>
      ))}

      {message && <Body testID="chat-message" style={{ color: colors.warning }}>{message}</Body>}
      {message?.includes('Inteligencia artificial') && (
        <Button title="Ir a Inteligencia artificial" variant="secondary" testID="go-ai-settings" onPress={() => router.push('/ai')} />
      )}

      <Field label="Tu pregunta" value={text} onChangeText={setText} maxLength={MAX_TEXT} multiline testID="chat-input" />
      <Chips
        options={[{ value: 'data', label: 'Usar mis datos (agregados, sin tu nombre)' }]}
        selected={useMyData ? ['data'] : []}
        onToggle={() => setUseMyData((v) => !v)}
        testIDPrefix="use-data"
        showHint={false}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title={busy ? 'Respondiendo…' : 'Preguntar'} disabled={busy} testID="chat-send" onPress={() => void send()} />
        </View>
        {busy && (
          <View style={styles.flex}>
            <Button title="Cortar" variant="secondary" testID="chat-stop" onPress={() => chat.stop()} />
          </View>
        )}
      </View>

      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Muted testID="chat-storage">
          {`Guardado en este teléfono: ${storage.conversations} conversaciones, ${storage.messages} mensajes (${kb(storage.bytes)}).`}
        </Muted>
        <View style={styles.row}>
          {current && (
            <View style={styles.flex}>
              <Button title="Borrar esta conversación" variant="secondary" testID="delete-conversation" onPress={() => void remove()} />
            </View>
          )}
          <View style={styles.flex}>
            <Button title="Borrar todo" variant="secondary" testID="delete-all-chat" onPress={() => void chat.deleteAll().then(() => open(null))} />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
