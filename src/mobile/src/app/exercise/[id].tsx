import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Body, Button, Field, Muted, Title } from '../../components/ui';
import { DayPicker } from '../../components/DayPicker';
import { useDeps } from '../../data/DataContext';
import { findExercise, useCatalog } from '../../data/hooks';
import { parseKg } from '../../data/format';
import { describeHits, type DayOutcome } from '../../data/planService';
import { DAY_NAMES, type DayKey } from '../../data/types';
import { useTheme } from '../../theme';

/** Detalle del ejercicio: elegir uno o más días y añadirlo a la rutina (AC-mobile-002-03, 04, 05). */
export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { service, remote } = useDeps();
  const { sections } = useCatalog();
  const exercise = findExercise(sections, id);

  const [days, setDays] = useState<DayKey[]>([]);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<DayOutcome[] | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  if (!exercise) return <ActivityIndicator style={styles.center} />;

  const add = async () => {
    const parsed = parseKg(step);
    if (parsed === 'invalid' || (parsed !== null && !(parsed > 0))) {
      setError('El escalón debe ser un número mayor que 0.');
      return;
    }
    setError(null);
    setOutcomes(await service.assign(exercise.id, days, parsed));
  };

  const confirm = async (day: DayKey) => {
    const outcome = await service.confirmDay(day);
    setOutcomes((prev) => (prev ?? []).map((o) => (o.day === day ? outcome : o)));
  };

  const image = exercise.images[0] ? remote.imageUrl(exercise.images[0]) : null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {image && !imageFailed && (
        <Image source={{ uri: image }} cachePolicy="disk" contentFit="cover" style={styles.image} onError={() => setImageFailed(true)} />
      )}
      <Title>{exercise.name}</Title>
      <Muted>{`Zona principal: ${exercise.primaryZone}`}</Muted>

      <Body style={styles.label}>Días en que lo harás</Body>
      <DayPicker selected={days} onChange={setDays} />

      {exercise.equipment === 'Maquina' && (
        <Field
          label="Escalón de esta máquina en kg (opcional)"
          value={step}
          onChangeText={setStep}
          keyboardType="decimal-pad"
          placeholder="Si lo dejas vacío se usa el de tu perfil de equipo"
        />
      )}
      {error && <Body style={{ color: colors.danger }}>{error}</Body>}

      <Button title="Añadir a mi rutina" onPress={() => void add()} disabled={days.length === 0} testID="add-to-plan" />

      {outcomes?.map((o) => (
        <View key={o.day} style={[styles.result, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {o.result?.kind === 'ok' && <Body style={{ color: colors.success }}>{`${DAY_NAMES[o.day]}: añadido`}</Body>}
          {o.result?.kind === 'retry' && (
            <Body>{`${DAY_NAMES[o.day]}: guardado en el teléfono; se enviará cuando haya conexión.`}</Body>
          )}
          {o.result?.kind === 'warnings' && (
            <>
              <Body style={{ color: colors.warning }}>
                {`${DAY_NAMES[o.day]}: aviso de restricción — ${describeHits(o.result.hits)}`}
              </Body>
              <Button title="Confirmar y guardar" onPress={() => void confirm(o.day)} testID={`confirm-${o.day}`} />
            </>
          )}
          {o.result?.kind === 'blocked' && (
            <Body style={{ color: colors.danger }}>
              {`${DAY_NAMES[o.day]}: no se puede añadir, restricción en nivel bloqueo — ${describeHits(o.result.hits)}`}
            </Body>
          )}
          {o.result?.kind === 'rejected' && <Body style={{ color: colors.danger }}>{`${DAY_NAMES[o.day]}: ${o.result.reason}`}</Body>}
        </View>
      ))}

      {outcomes && <Button title="Ver mi rutina" variant="secondary" onPress={() => router.navigate('/rutina')} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  content: { padding: 16, gap: 12 },
  image: { width: '100%', aspectRatio: 1, borderRadius: 12 },
  label: { fontWeight: '600', marginTop: 4 },
  result: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
});
