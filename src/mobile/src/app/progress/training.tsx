import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { BarChart } from '../../components/BarChart';
import { Chips } from '../../components/Chips';
import { LineChart } from '../../components/LineChart';
import { Body, Muted, Title } from '../../components/ui';
import { useDeps } from '../../data/DataContext';
import type { ExerciseWithHistory, TrainingProgress } from '../../data/sessionService';
import { logVolume, setReps } from '../../data/trainingHistory';
import type { LocalExerciseLog } from '../../data/types';
import { useTheme } from '../../theme';

const num = (n: number) => String(n).replace('.', ',');
const DAY_MS = 86_400_000;

/** Progreso de entrenamiento (SPEC-training-006, AC-07 a 09): volumen y sesiones por semana y la progresión de cada ejercicio. */
export default function TrainingProgressScreen() {
  const { colors } = useTheme();
  const { sessions } = useDeps();
  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  const [exercises, setExercises] = useState<ExerciseWithHistory[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<LocalExerciseLog[]>([]);

  useFocusEffect(
    useCallback(() => {
      void sessions.loadTrainingWeeks().then(setProgress);
      void sessions.exercisesWithHistory().then(setExercises);
    }, [sessions]),
  );

  const choose = (id: string) => {
    setSelected(id);
    // De la más antigua a la más reciente, sin lo rechazado.
    void sessions.loadHistory(id).then((rows) => setHistory(rows.filter((r) => r.status !== 'rejected').reverse()));
  };

  if (!progress) return null;
  const total = progress.weeks.reduce((acc, w) => acc + w.sessions, 0);
  const day = (date: string) => new Date(`${date}T00:00:00Z`).getTime() / DAY_MS;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Title>Progreso de entrenamiento</Title>
      {progress.source === 'local' && <Muted testID="training-local">Calculado con los registros de este teléfono.</Muted>}

      {total === 0 ? (
        <Muted testID="training-empty">Aún no has registrado sesiones en estas semanas.</Muted>
      ) : (
        <>
          <BarChart
            testID="training-chart"
            accessibilityLabel={`Volumen por semana: ${progress.weeks.map((w) => `${w.weekStart} ${num(w.volumeKg)} kg`).join(', ')}`}
            bars={progress.weeks.map((w) => ({ key: w.weekStart, label: w.weekStart.slice(5), value: Math.round(w.volumeKg) }))}
            valueSuffix=""
          />
          <Muted>Volumen = carga × repeticiones de las series, en kg. La última barra es la semana en curso y puede estar incompleta.</Muted>
          <View style={styles.weeks}>
            <Title>Por semana</Title>
            {[...progress.weeks].reverse().map((w) => (
              <Body key={w.weekStart} testID={`training-week-${w.weekStart}`}>
                {`Semana del ${w.weekStart}${w.partial ? ' (en curso)' : ''}: ${w.sessions} ${w.sessions === 1 ? 'sesión' : 'sesiones'}, ${w.sets} series, ${num(w.volumeKg)} kg de volumen`}
              </Body>
            ))}
          </View>
        </>
      )}

      {exercises.length > 0 && (
        <>
          <Title>Progresión por ejercicio</Title>
          <Chips
            options={exercises.map((e) => ({ value: e.id, label: e.name }))}
            selected={selected ? [selected] : []}
            onToggle={choose}
            testIDPrefix="exercise"
            showHint={false}
          />
        </>
      )}

      {selected && history.length > 0 && (
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="exercise-progress">
          {history.length >= 2 ? (
            <LineChart
              testID="exercise-chart"
              accessibilityLabel={`Carga por sesión: ${history.map((l) => `${l.date} ${num(l.loadKg)} kg`).join(', ')}`}
              yLabels={{ min: `${num(Math.min(...history.map((l) => l.loadKg)))} kg`, max: `${num(Math.max(...history.map((l) => l.loadKg)))} kg` }}
              series={[{ key: 'load', color: colors.primary, dots: true, points: history.map((l) => ({ x: day(l.date), y: l.loadKg })) }]}
            />
          ) : (
            <Muted testID="exercise-single">Con una sola sesión aún no hay progresión que mostrar.</Muted>
          )}
          {[...history].reverse().map((l) => (
            <Body key={l.id} testID={`exercise-session-${l.id}`}>
              {`${l.date}: ${num(l.loadKg)} kg · series ${setReps(l).join('/')} · volumen ${num(logVolume(l))} kg`}
            </Body>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  weeks: { gap: 6 },
});
