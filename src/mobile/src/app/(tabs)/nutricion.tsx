import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Muted, Title } from '../../components/ui';
import { useDeps } from '../../data/DataContext';
import { useNutritionDay } from '../../data/hooks';
import { localDate, type TargetState } from '../../data/nutritionService';
import type { LocalFoodEntry, SyncStatus } from '../../data/types';
import { useTheme } from '../../theme';

const STATUS_LABEL: Record<SyncStatus, string> = {
  pending: 'pendiente de enviar',
  synced: 'sincronizado',
  rejected: 'rechazado',
  needs_confirmation: 'necesita confirmación',
};

const grams = (n: number) => `${String(n).replace('.', ',')} g`;

/** Nutrición: lo comido hoy frente al objetivo diario (SPEC-nutrition-001, AC-15, 18 y 19). */
export default function NutritionScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { nutrition } = useDeps();
  const [date] = useState(() => localDate());
  const { view, reload } = useNutritionDay(date);

  const act = (run: () => Promise<unknown>) => () => void run().then(reload);

  if (!view) return null;
  const { target, totals, remaining } = view;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="nutrition-summary">
        <Title>Hoy</Title>
        <TargetLines target={target} />
        <Body testID="nutrition-totals">
          {`Consumido: ${totals.kcal} kcal · P ${grams(totals.proteinG)} · G ${grams(totals.fatG)} · C ${grams(totals.carbsG)}`}
        </Body>
        {remaining && (
          <Body testID="nutrition-remaining">
            {`${remaining.kcal >= 0 ? 'Te faltan' : 'Te pasas en'} ${Math.abs(remaining.kcal)} kcal`}
          </Body>
        )}
        <Muted>Los objetivos son orientativos y no sustituyen a un profesional de la salud.</Muted>
      </View>

      <Button title="Añadir alimento" onPress={() => router.push('/food/add')} testID="add-food" />

      {view.meals.length === 0 && <Muted>Aún no has registrado nada hoy.</Muted>}

      {view.meals.map((meal) => (
        <View key={meal.name} testID={`meal-${meal.name}`} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Title>{meal.name.charAt(0).toUpperCase() + meal.name.slice(1)}</Title>
          {meal.entries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              onEdit={() => router.push(`/food/add?entryId=${e.id}`)}
              onDelete={act(() => nutrition.deleteEntry(e.id))}
              onDiscard={act(() => nutrition.discardEntry(e.id))}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function TargetLines({ target }: { target: TargetState }) {
  if (target.kind === 'missing') {
    return (
      <Muted testID="nutrition-missing">
        {target.what === 'perfil'
          ? 'Para calcular tu objetivo falta completar tu perfil.'
          : 'Para calcular tu objetivo falta registrar tu peso.'}
      </Muted>
    );
  }
  if (target.kind === 'unknown') {
    return <Muted testID="nutrition-unknown">Tu objetivo se calcula la primera vez con conexión.</Muted>;
  }
  const t = target.target;
  return (
    <View testID="nutrition-target">
      <Body>{`Objetivo: ${t.calories} kcal · P ${grams(t.proteinG)} · G ${grams(t.fatG)} · C ${grams(t.carbsG)}`}</Body>
      <Muted>{`Calculado el ${target.calculatedAt} con ${String(t.weightKg).replace('.', ',')} kg.`}</Muted>
    </View>
  );
}

function EntryRow(
  { entry, onEdit, onDelete, onDiscard }: { entry: LocalFoodEntry; onEdit: () => void; onDelete: () => void; onDiscard: () => void },
) {
  const { colors } = useTheme();
  const statusColor = entry.status === 'synced' ? colors.success : entry.status === 'rejected' ? colors.danger : colors.warning;
  return (
    <View testID={`entry-${entry.id}`} style={styles.entry}>
      <Body style={styles.bold}>{`${entry.name} · ${entry.grams} g`}</Body>
      <Body>{`${entry.kcal} kcal · P ${grams(entry.proteinG)} · G ${grams(entry.fatG)} · C ${grams(entry.carbsG)}`}</Body>
      <Text style={{ color: statusColor }}>{STATUS_LABEL[entry.status]}</Text>
      {entry.message && <Muted>{entry.message}</Muted>}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title="Editar" variant="secondary" testID={`edit-entry-${entry.id}`} onPress={onEdit} />
        </View>
        {entry.status === 'rejected' && (
          <View style={styles.flex}>
            <Button title="Descartar" variant="secondary" testID={`discard-entry-${entry.id}`} onPress={onDiscard} />
          </View>
        )}
        <View style={styles.flex}>
          <Button title="Borrar" variant="secondary" testID={`delete-entry-${entry.id}`} onPress={onDelete} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  entry: { gap: 4 },
  bold: { fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
