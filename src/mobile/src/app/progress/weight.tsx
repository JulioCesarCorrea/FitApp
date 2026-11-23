import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { LineChart } from '../../components/LineChart';
import { Body, Muted, Title } from '../../components/ui';
import { useDeps } from '../../data/DataContext';
import { recentWeeks, summarize, type WeightRange } from '../../data/weightStats';
import { useTheme } from '../../theme';

const RANGES: { value: WeightRange; label: string }[] = [
  { value: '30d', label: '30 días' },
  { value: '90d', label: '90 días' },
  { value: '1y', label: '1 año' },
  { value: 'all', label: 'Todo' },
];

const kg = (n: number | null): string => (n === null ? '—' : `${String(n).replace('.', ',')} kg`);
const signed = (n: number): string => `${n > 0 ? '+' : ''}${String(n).replace('.', ',')} kg`;
const DAY_MS = 86_400_000;

/** Progreso de peso (SPEC-progress-002, AC-07 a 09): gráfico con la tendencia, cambio, mínimo y máximo y resumen semanal. */
export default function WeightProgressScreen() {
  const { colors } = useTheme();
  const { weights } = useDeps();
  const [range, setRange] = useState<WeightRange>('90d');
  const [entries, setEntries] = useState<{ measuredAt: string; weightKg: number }[] | null>(null);

  // Todo sale de los pesos guardados en el teléfono, también los pendientes de enviar (AC-08); lo rechazado no cuenta.
  useFocusEffect(
    useCallback(() => {
      void weights.list().then((all) => setEntries(all.filter((w) => w.status !== 'rejected')));
    }, [weights]),
  );

  const today = new Date().toISOString().slice(0, 10);
  const summary = useMemo(() => (entries ? summarize(entries, range, today) : null), [entries, range, today]);
  const weeks = useMemo(() => (entries ? recentWeeks(entries, 12, today).reverse() : []), [entries, today]);

  if (!summary) return null;
  const day = (date: string) => new Date(`${date}T00:00:00Z`).getTime() / DAY_MS;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Title>Progreso de peso</Title>
      <Chips options={RANGES} selected={[range]} onToggle={(v) => setRange(v as WeightRange)} testIDPrefix="range" showHint={false} />

      {summary.points.length < 3 ? (
        <Muted testID="weight-empty">
          {summary.points.length === 0
            ? 'Aún no hay pesos en este periodo. Registra tu peso para ver cómo evoluciona.'
            : 'Con menos de 3 pesos el gráfico no dice nada: sigue registrando tu peso.'}
        </Muted>
      ) : (
        <>
          <LineChart
            testID="weight-chart"
            accessibilityLabel={`Gráfico de peso: ${summary.points.length} pesos, de ${kg(summary.min)} a ${kg(summary.max)}`}
            yLabels={{ min: kg(summary.min), max: kg(summary.max) }}
            series={[
              { key: 'trend', color: colors.textMuted, points: summary.trend.map((p) => ({ x: day(p.date), y: p.weightKg })) },
              { key: 'weights', color: colors.primary, dots: true, points: summary.points.map((p) => ({ x: day(p.date), y: p.weightKg })) },
            ]}
          />
          <Muted>● Pesos registrados · línea: tendencia (estimación calculada, no un dato registrado)</Muted>
        </>
      )}

      {summary.points.length > 0 && (
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="weight-summary">
          <Body>{`Último: ${kg(summary.points[summary.points.length - 1].weightKg)}`}</Body>
          <Body testID="weight-change">{summary.change === null ? 'Cambio: —' : `Cambio en el periodo: ${signed(summary.change)}`}</Body>
          <Body>{`Mínimo ${kg(summary.min)} · Máximo ${kg(summary.max)}`}</Body>
          {summary.trend.length > 0 && <Body>{`Tendencia actual: ${kg(summary.trend[summary.trend.length - 1].weightKg)}`}</Body>}
        </View>
      )}

      {weeks.length > 0 && (
        <View style={styles.weeks} testID="weight-weeks">
          <Title>Por semana</Title>
          {weeks.map((w) => (
            <Body key={w.weekStart} testID={`week-${w.weekStart}`}>
              {`Semana del ${w.weekStart}: ${kg(w.avgKg)} de media (${w.count} ${w.count === 1 ? 'peso' : 'pesos'}, ${kg(w.minKg)}–${kg(w.maxKg)})${w.changeKg === null ? '' : `, ${signed(w.changeKg)}`}`}
            </Body>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  weeks: { gap: 6 },
});
