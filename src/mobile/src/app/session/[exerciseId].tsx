import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Field, Muted, Title } from '../../components/ui';
import { useDeps } from '../../data/DataContext';
import { describeAdvice } from '../../data/format';
import { findExercise, useCatalog } from '../../data/hooks';
import { todayLocal, type LogIssue, type RawLogInput, type SessionAdvice } from '../../data/sessionService';
import type { LocalExerciseLog } from '../../data/types';
import { useTheme } from '../../theme';

const EMPTY: RawLogInput = { date: '', load: '', first: '', second: '', assisted: '' };

const toRaw = (l: LocalExerciseLog): RawLogInput => ({
  date: l.date,
  load: String(l.loadKg),
  first: String(l.firstSetReps),
  second: String(l.secondSetReps),
  assisted: String(l.secondSetAssistedReps),
});

/** Registrar o editar una sesión de un ejercicio: fecha, carga y las 2 series (AC-mobile-003-01, 02, 04, 08). */
export default function SessionFormScreen() {
  const { exerciseId, logId } = useLocalSearchParams<{ exerciseId: string; logId?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { store, sessions } = useDeps();
  const { sections } = useCatalog();
  const exercise = findExercise(sections, exerciseId);

  const [raw, setRaw] = useState<RawLogInput>({ ...EMPTY, date: todayLocal() });
  const [issues, setIssues] = useState<LogIssue[]>([]);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ log: LocalExerciseLog; advice: SessionAdvice | null } | null>(null);

  // Al editar, el formulario arranca con los datos del registro.
  useEffect(() => {
    if (!logId) return;
    void store.getLog(logId).then((log) => log && setRaw(toRaw(log)));
  }, [store, logId]);

  if (!exercise) return <ActivityIndicator style={styles.center} />;

  const bodyweight = exercise.equipment === 'PesoCorporal';
  const set = (key: keyof RawLogInput) => (value: string) => setRaw((r) => ({ ...r, [key]: value }));

  const save = async () => {
    const result = await sessions.save(exercise, raw, logId);
    if (!result.ok) {
      setIssues(result.issues);
      setDuplicateOf(result.duplicateOf ?? null);
      return;
    }
    setIssues([]);
    setDuplicateOf(null);
    setSaved({ log: result.log, advice: await sessions.getAdvice(exercise) });
  };

  if (saved) {
    const { log, advice } = saved;
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Title>{exercise.name}</Title>
        <Body style={{ color: log.status === 'rejected' ? colors.danger : colors.success }} testID="saved-message">
          {log.status === 'synced' && 'Sesión guardada.'}
          {log.status === 'pending' && 'Sesión guardada en el teléfono; se enviará cuando haya conexión.'}
          {log.status === 'rejected' && `Sesión guardada, pero el servidor la rechazó: ${log.message}`}
        </Body>
        {advice && describeAdvice(advice).map((line) => <Body key={line}>{line}</Body>)}
        {advice?.stagnation.message && (
          <Text style={{ color: colors.warning, fontWeight: '600' }}>{advice.stagnation.message}</Text>
        )}
        <Button title="Listo" onPress={() => router.back()} testID="saved-done" />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>{exercise.name}</Title>
      <Muted>2 series efectivas con tempo de 4 s de bajada y 1 s de subida.</Muted>

      <Field label="Fecha (AAAA-MM-DD)" value={raw.date} onChangeText={set('date')} autoCapitalize="none" />
      <Field
        label={bodyweight ? 'Lastre en kg (opcional)' : 'Carga en kg'}
        value={raw.load}
        onChangeText={set('load')}
        keyboardType="decimal-pad"
      />
      <Field label="Serie 1: repeticiones (hasta 12)" value={raw.first} onChangeText={set('first')} keyboardType="number-pad" />
      <Field label="Serie 2: repeticiones propias hasta el fallo" value={raw.second} onChangeText={set('second')} keyboardType="number-pad" />
      <Field
        label="Serie 2: repeticiones asistidas (opcional)"
        value={raw.assisted}
        onChangeText={set('assisted')}
        keyboardType="number-pad"
      />

      {issues.length > 0 && (
        <View testID="form-issues" style={styles.issues}>
          {issues.map((i) => (
            <Body key={`${i.field}-${i.message}`} style={{ color: colors.danger }}>{i.message}</Body>
          ))}
        </View>
      )}
      {duplicateOf && (
        <Button
          title="Editar el registro existente"
          variant="secondary"
          testID="edit-existing"
          onPress={() => router.replace(`/session/${exercise.id}?logId=${duplicateOf}`)}
        />
      )}

      <Button title="Guardar sesión" onPress={() => void save()} testID="save-session" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  content: { padding: 16, gap: 10 },
  issues: { gap: 4 },
});
