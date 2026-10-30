import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Muted, Title } from '../../components/ui';
import { useDeps } from '../../data/DataContext';
import { findExercise, useCatalog, useDays } from '../../data/hooks';
import { DAY_NAMES, type DayState, type SyncStatus } from '../../data/types';
import { useTheme } from '../../theme';

const STATUS_LABEL: Record<SyncStatus, string> = {
  pending: 'pendiente de enviar',
  synced: 'sincronizado',
  rejected: 'rechazado',
  needs_confirmation: 'necesita confirmación',
};

/** Mi rutina: ejercicios por día; se pueden reordenar y quitar (AC-mobile-002-06). */
export default function RoutineScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { service } = useDeps();
  const { sections } = useCatalog();
  const { days, reload, refresh } = useDays();

  const act = (run: () => Promise<unknown>) => () => void run().then(reload);

  const statusColor = (s: DayState['status']) =>
    s === 'synced' ? colors.success : s === 'rejected' ? colors.danger : colors.warning;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {days.length === 0 && (
        <Muted>Aún no tienes ejercicios en tu rutina. Añádelos desde el catálogo.</Muted>
      )}

      {days.map((d) => (
        <View key={d.day} testID={`day-section-${d.day}`} style={[styles.day, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Title>{DAY_NAMES[d.day]}</Title>
          <Text style={{ color: statusColor(d.status), fontWeight: '600' }}>{STATUS_LABEL[d.status]}</Text>
          {d.message && <Muted>{d.message}</Muted>}

          {d.entries.map((e, i) => {
            const name = findExercise(sections, e.exerciseId)?.name ?? e.exerciseId;
            return (
              <View key={e.id} style={styles.entry}>
                <Body style={styles.name}>{`${i + 1}. ${name}`}</Body>
                <Pressable
                  testID={`log-${e.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Registrar ${name}`}
                  onPress={() => router.push(`/session/${e.exerciseId}`)}
                  style={[styles.register, { borderColor: colors.primary }]}
                >
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>Registrar</Text>
                </Pressable>
                <IconButton label={`Subir ${name}`} glyph="↑" testID={`up-${e.id}`} onPress={act(() => service.move(d.day, e.id, -1))} />
                <IconButton label={`Bajar ${name}`} glyph="↓" testID={`down-${e.id}`} onPress={act(() => service.move(d.day, e.id, 1))} />
                <IconButton label={`Quitar ${name}`} glyph="✕" testID={`remove-${e.id}`} onPress={act(() => service.remove(d.day, e.id))} />
              </View>
            );
          })}

          {d.status === 'needs_confirmation' && (
            <Button title="Confirmar aviso y guardar" onPress={act(() => service.confirmDay(d.day))} testID={`confirm-${d.day}`} />
          )}
        </View>
      ))}

      <Button title="Sincronizar ahora" variant="secondary" onPress={() => void refresh()} />
    </ScrollView>
  );
}

function IconButton({ label, glyph, onPress, testID }: { label: string; glyph: string; onPress: () => void; testID: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.icon, { borderColor: colors.border, backgroundColor: colors.background }]}
    >
      <Text style={{ color: colors.text, fontSize: 18 }}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  day: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1 },
  register: { height: 40, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
