import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CatalogExercise } from '../data/types';
import { useTheme } from '../theme';
import { Body } from './ui';

/** AC-mobile-002-02: si la imagen no carga se reintenta más tarde, hasta este número de veces. */
export const IMAGE_RETRY_MS = 5000;
export const IMAGE_MAX_RETRIES = 3;

/**
 * Tarjeta del catálogo: imagen del ejercicio y nombre (AC-mobile-002-01).
 * Si la imagen no carga se queda solo el nombre, sin imagen sustituta, y se reintenta cada pocos
 * segundos (AC-mobile-002-02); expo-image guarda las ya vistas en disco para verlas sin conexión.
 */
export function ExerciseCard({
  exercise, imageUrl, onPress,
}: {
  exercise: CatalogExercise;
  imageUrl: string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!failed || attempt >= IMAGE_MAX_RETRIES) return;
    const timer = setTimeout(() => {
      setAttempt((a) => a + 1);
      setFailed(false);
    }, IMAGE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [failed, attempt]);

  return (
    <Pressable
      testID={`card-${exercise.id}`}
      accessibilityRole="button"
      accessibilityLabel={exercise.name}
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {imageUrl && !failed && (
        <Image
          key={attempt}
          testID={`image-${exercise.id}`}
          // En los reintentos se añade ?r=N para no reutilizar una respuesta fallida guardada en caché.
          source={{ uri: attempt === 0 ? imageUrl : `${imageUrl}?r=${attempt}` }}
          cachePolicy="disk"
          contentFit="cover"
          style={styles.image}
          onError={(e) => {
            console.warn(`[imagen] no cargó ${imageUrl} (intento ${attempt + 1}): ${e.error}`);
            setFailed(true);
          }}
        />
      )}
      <View style={styles.label}>
        <Body numberOfLines={2} style={styles.name}>{exercise.name}</Body>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: '48%', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  image: { width: '100%', aspectRatio: 1 },
  label: { padding: 8 },
  name: { fontSize: 14, fontWeight: '600' },
});
