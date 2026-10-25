import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CatalogExercise } from '../data/types';
import { useTheme } from '../theme';
import { Body } from './ui';

/**
 * Tarjeta del catálogo: imagen del ejercicio y nombre (AC-mobile-002-01).
 * Si la imagen no carga se queda solo el nombre, sin imagen sustituta (AC-mobile-002-02);
 * expo-image guarda las ya vistas en disco para verlas sin conexión.
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
          testID={`image-${exercise.id}`}
          source={{ uri: imageUrl }}
          cachePolicy="disk"
          contentFit="cover"
          style={styles.image}
          onError={() => setFailed(true)}
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
