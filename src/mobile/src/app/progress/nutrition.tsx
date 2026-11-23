import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { BarChart } from '../../components/BarChart';
import { Chips } from '../../components/Chips';
import { Body, Muted, Title } from '../../components/ui';
import { useDeps } from '../../data/DataContext';
import type { HistoryView } from '../../data/nutritionService';
import { useTheme } from '../../theme';

const OPTIONS = [
  { value: '4', label: '4 semanas' },
  { value: '8', label: '8 semanas' },
  { value: '12', label: '12 semanas' },
];

const g = (n: number) => `${String(n).replace('.', ',')} g`;

/** Progreso de nutrición (SPEC-nutrition-006, AC-08 y 09): calorías medias por semana frente al objetivo, macros y adherencia. */
export default function NutritionProgressScreen() {
  const { colors } = useTheme();
  const { nutrition } = useDeps();
  const [weeks, setWeeks] = useState('8');
  const [view, setView] = useState<HistoryView | null>(null);

  useFocusEffect(useCallback(() => { void nutrition.loadHistory(Number(weeks)).then(setView); }, [nutrition, weeks]));

  if (!view) return null;
  const totalLogged = view.weeks.reduce((acc, w) => acc + w.daysLogged, 0);
  const totalOnTarget = view.weeks.reduce((acc, w) => acc + (w.daysOnTarget ?? 0), 0);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Title>Progreso de nutrición</Title>
      <Chips options={OPTIONS} selected={[weeks]} onToggle={setWeeks} testIDPrefix="weeks" showHint={false} />
      {view.offline && <Muted testID="history-offline">Sin conexión: se muestra lo último recibido y lo que hay en el teléfono.</Muted>}

      {view.weeks.length === 0 ? (
        <Muted testID="history-empty">Aún no has registrado comidas en este periodo.</Muted>
      ) : (
        <>
          <BarChart
            testID="nutrition-chart"
            accessibilityLabel={`Calorías medias por semana: ${view.weeks.map((w) => `${w.weekStart} ${w.avgKcal} kcal`).join(', ')}`}
            bars={view.weeks.map((w) => ({ key: w.weekStart, label: w.weekStart.slice(5), value: w.avgKcal }))}
            reference={view.targetKcal}
            referenceLabel={view.targetKcal === null ? undefined : `Objetivo de hoy: ${view.targetKcal} kcal`}
            valueSuffix=""
          />
          <Muted>Calorías medias de los días con registro. Los días sin registro no cuentan como cero.</Muted>

          {view.targetKcal !== null ? (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="history-adherence">
              <Body>{`Adherencia: ${totalOnTarget} de ${totalLogged} días registrados dentro de ±10 % de ${view.targetKcal} kcal`}</Body>
              <Muted>El objetivo de hoy se aplica a todo el periodo. Es orientativo y no sustituye a un profesional de la salud.</Muted>
            </View>
          ) : (
            <Muted testID="history-no-target">Sin objetivo calculado (falta el perfil o el peso): no hay adherencia que mostrar.</Muted>
          )}

          <View style={styles.weeks}>
            <Title>Por semana</Title>
            {[...view.weeks].reverse().map((w) => (
              <Body key={w.weekStart} testID={`nutrition-week-${w.weekStart}`}>
                {`Semana del ${w.weekStart}: ${w.avgKcal} kcal · P ${g(w.avgProteinG)} · G ${g(w.avgFatG)} · C ${g(w.avgCarbsG)} de media (${w.daysLogged} ${w.daysLogged === 1 ? 'día' : 'días'} registrados${w.daysOnTarget === null ? '' : `, ${w.daysOnTarget} dentro del margen`})`}
              </Body>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  weeks: { gap: 6 },
});
