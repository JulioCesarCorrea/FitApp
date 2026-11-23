import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chips } from '../components/Chips';
import { Body, Button, Muted, Title } from '../components/ui';
import { useDeps } from '../data/DataContext';
import { aiErrorText, type AiResult, type Analysis, type Proposal, type ProposedChange } from '../data/aiService';
import { useTheme } from '../theme';

const SCOPES = [{ value: 'training', label: 'Entrenamiento' }, { value: 'nutrition', label: 'Nutrición' }];
const KIND_LABEL = { registrado: 'Dato registrado', estimacion: 'Estimación', inferencia: 'Inferencia' } as const;
const DAY_LABEL: Record<string, string> = {
  Monday: 'lunes', Tuesday: 'martes', Wednesday: 'miércoles', Thursday: 'jueves', Friday: 'viernes', Saturday: 'sábado', Sunday: 'domingo',
};

function changeText(c: ProposedChange): string {
  return c.kind === 'replace_exercise'
    ? `El ${DAY_LABEL[c.day ?? ''] ?? c.day}: sustituir un ejercicio por «${c.toExerciseName ?? c.toExerciseId}».`
    : `Registrar hoy en ${c.meal}: ${c.foodName ?? 'un alimento tuyo'}, ${c.grams} g.`;
}

/** Análisis y planes con IA (SPEC-ai-002, AC-06 y 10): sugerencias con sus fuentes que solo se aplican si las aceptas. */
export default function AssistantScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { assistant } = useDeps();
  const [scope, setScope] = useState<'training' | 'nutrition'>('training');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const result = await assistant.proposals();
    if (result.kind === 'ok') setProposals(result.value);
  }, [assistant]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const run = async <T,>(call: () => Promise<AiResult<T>>, onOk: (value: T) => void) => {
    setBusy(true);
    setMessage(null);
    const result = await call();
    setBusy(false);
    if (result.kind === 'ok') onOk(result.value);
    else setMessage(result.kind === 'offline' ? 'La IA necesita conexión.' : aiErrorText(result));
  };

  const resolve = (id: string, action: 'accept' | 'reject') => void run(
    () => (action === 'accept' ? assistant.accept(id) : assistant.reject(id)),
    (result) => {
      setMessage(action === 'accept' ? `Aplicado: ${result.applied} cambio(s)${result.skipped ? `, ${result.skipped} ya no se podía(n) aplicar` : ''}.` : 'Propuesta rechazada.');
      void reload();
    },
  );

  const pending = proposals.filter((p) => p.status === 'pending');
  const past = proposals.filter((p) => p.status !== 'pending');

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Title>Análisis y planes</Title>
      <Muted>
        Sugerencias de la IA con tus datos agregados (sin tu nombre). Nada se aplica solo: tú aceptas o rechazas. No es consejo médico ni
        sustituye a un profesional de la salud.
      </Muted>
      <Chips options={SCOPES} selected={[scope]} onToggle={(v) => setScope(v as 'training' | 'nutrition')} testIDPrefix="scope" showHint={false} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title="Pedir análisis" disabled={busy} testID="ask-analysis" onPress={() => void run(() => assistant.analyze(scope), setAnalysis)} />
        </View>
        <View style={styles.flex}>
          <Button
            title="Proponer cambios"
            variant="secondary"
            disabled={busy}
            testID="ask-plan"
            onPress={() => void run(() => assistant.propose(scope), () => void reload())}
          />
        </View>
      </View>
      {message && (
        <View>
          <Body testID="assistant-message" style={{ color: colors.warning }}>{message}</Body>
          {message.includes('Inteligencia artificial') && (
            <Button title="Ir a Inteligencia artificial" variant="secondary" testID="go-ai-settings" onPress={() => router.push('/ai')} />
          )}
        </View>
      )}

      {analysis && (
        <View testID="analysis" style={styles.block}>
          <Title>Análisis</Title>
          <Muted>Sugerencia de IA: {analysis.disclaimer}</Muted>
          {analysis.sections.map((s) => (
            <View key={s.title} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Body style={styles.bold}>{s.title}</Body>
              {s.claims.map((c, i) => (
                <View key={i} testID={`claim-${s.title}-${i}`} style={styles.claim}>
                  <Body>{c.text}</Body>
                  <Muted>
                    {`${KIND_LABEL[c.kind]}${c.source ? ` · fuente: ${c.source}` : ''}${c.verified ? '' : ' · no se pudo comprobar con tus datos'}`}
                  </Muted>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      {pending.length > 0 && <Title>Propuestas pendientes</Title>}
      {pending.map((p) => (
        <View key={p.id} testID={`proposal-${p.id}`} style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
          <Muted>Sugerencia de IA · {p.scope === 'training' ? 'entrenamiento' : 'nutrición'}</Muted>
          <Body style={styles.bold}>{p.summary}</Body>
          {p.changes.map((c, i) => (
            <View key={i}>
              <Body>{changeText(c)}</Body>
              {c.reason ? <Muted>{c.reason}</Muted> : null}
            </View>
          ))}
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button title="Aceptar" disabled={busy} testID={`accept-${p.id}`} onPress={() => resolve(p.id, 'accept')} />
            </View>
            <View style={styles.flex}>
              <Button title="Rechazar" variant="secondary" disabled={busy} testID={`reject-${p.id}`} onPress={() => resolve(p.id, 'reject')} />
            </View>
          </View>
        </View>
      ))}

      {past.length > 0 && (
        <View style={styles.block} testID="proposal-history">
          <Title>Historial de propuestas</Title>
          {past.map((p) => (
            <Muted key={p.id} testID={`past-${p.id}`}>{`${p.status === 'accepted' ? 'Aceptada' : 'Rechazada'} · ${p.scope === 'training' ? 'entrenamiento' : 'nutrición'}: ${p.summary}`}</Muted>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  block: { gap: 8 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  claim: { gap: 2 },
  bold: { fontWeight: '600' },
});
