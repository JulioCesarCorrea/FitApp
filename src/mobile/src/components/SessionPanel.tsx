import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useDeps } from '../data/DataContext';
import { describeAdvice, formatLogLine } from '../data/format';
import { useSessions } from '../data/hooks';
import type { CatalogExercise, LocalExerciseLog, SyncStatus } from '../data/types';
import { useTheme } from '../theme';
import { Body, Button, Muted, Title } from './ui';

const STATUS_LABEL: Record<SyncStatus, string> = {
  pending: 'pendiente de enviar',
  synced: 'sincronizado',
  rejected: 'rechazado',
  needs_confirmation: 'necesita confirmación',
};

/**
 * Mis sesiones de un ejercicio (SPEC-mobile-003): consejo de carga, aviso de estancamiento, historial con su estado
 * de envío y acceso para registrar, editar y borrar (AC-mobile-003-09 a 12).
 */
export function SessionPanel({ exercise }: { exercise: CatalogExercise }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { sessions } = useDeps();
  const { logs, advice, reload } = useSessions(exercise);
  const [confirming, setConfirming] = useState<string | null>(null);

  const run = (action: () => Promise<unknown>) => () => void action().then(reload);
  const edit = (log: LocalExerciseLog) => router.push(`/session/${exercise.id}?logId=${log.id}`);

  return (
    <View style={styles.box} testID="session-panel">
      <Title>Mis sesiones</Title>

      {advice && (
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="advice-card">
          {describeAdvice(advice).map((line) => (
            <Body key={line}>{line}</Body>
          ))}
          {advice.stagnation.message && (
            <Text style={{ color: colors.warning, fontWeight: '600' }} testID="stagnation-message">
              {advice.stagnation.message}
            </Text>
          )}
        </View>
      )}

      <Button title="Registrar sesión" onPress={() => router.push(`/session/${exercise.id}`)} testID="log-session" />

      {logs.length === 0 && <Muted>Aún no has registrado sesiones de este ejercicio.</Muted>}

      {logs.map((log) => (
        <View key={log.id} testID={`log-${log.id}`} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Body style={styles.bold}>{log.date}</Body>
          <Body>{formatLogLine(log)}</Body>
          <Text
            style={{ color: log.status === 'synced' ? colors.success : log.status === 'rejected' ? colors.danger : colors.warning }}
          >
            {STATUS_LABEL[log.status]}
          </Text>
          {log.message && <Muted>{log.message}</Muted>}

          {confirming === log.id ? (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button
                  title="Sí, borrar"
                  variant="danger"
                  testID={`confirm-delete-${log.id}`}
                  onPress={() => {
                    setConfirming(null);
                    run(() => sessions.remove(log.id))();
                  }}
                />
              </View>
              <View style={styles.flex}>
                <Button title="Cancelar" variant="secondary" onPress={() => setConfirming(null)} />
              </View>
            </View>
          ) : (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button title="Editar" variant="secondary" testID={`edit-${log.id}`} onPress={() => edit(log)} />
              </View>
              {log.status === 'rejected' && (
                <View style={styles.flex}>
                  <Button
                    title="Descartar"
                    variant="secondary"
                    testID={`discard-${log.id}`}
                    onPress={run(() => sessions.discard(log.id))}
                  />
                </View>
              )}
              <View style={styles.flex}>
                <Button title="Borrar" variant="secondary" testID={`delete-${log.id}`} onPress={() => setConfirming(log.id)} />
              </View>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10, marginTop: 8 },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 6 },
  bold: { fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
