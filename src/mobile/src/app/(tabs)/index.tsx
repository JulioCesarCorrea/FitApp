import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { Body, Button, Title } from '../../components/ui';
import { ExerciseCard } from '../../components/ExerciseCard';
import { useDeps } from '../../data/DataContext';
import { useCatalog } from '../../data/hooks';

/** Catálogo: secciones por zona con tarjetas de imagen y nombre (AC-mobile-002-01). */
export default function CatalogScreen() {
  const router = useRouter();
  const { remote } = useDeps();
  const { sections, needsConnection, loading, reload } = useCatalog();

  // AC-mobile-002-08: sin conexión y sin catálogo descargado.
  if (needsConnection) {
    return (
      <View style={styles.center}>
        <Title>Necesitas conexión</Title>
        <Body style={styles.text}>La primera vez hay que descargar el catálogo de ejercicios. Conéctate e inténtalo de nuevo.</Body>
        <Button title="Reintentar" onPress={() => void reload()} />
      </View>
    );
  }

  if (!sections) {
    return loading ? <ActivityIndicator style={styles.center} /> : null;
  }

  return (
    <FlatList
      data={sections}
      keyExtractor={(s) => s.name}
      contentContainerStyle={styles.list}
      renderItem={({ item: section }) => (
        <View style={styles.section}>
          <Title>{section.name}</Title>
          <View style={styles.grid}>
            {section.exercises.map((e) => (
              <ExerciseCard
                key={e.id}
                exercise={e}
                imageUrl={e.images[0] ? remote.imageUrl(e.images[0]) : null}
                onPress={() => router.push(`/exercise/${e.id}`)}
              />
            ))}
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  text: { textAlign: 'center' },
  list: { padding: 16, gap: 20 },
  section: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
});
