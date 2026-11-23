import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Body, Button, Muted, Title } from '../../components/ui';
import { useDeps } from '../../data/DataContext';
import { recipeTotal, scaleRecipe } from '../../data/nutritionRules';
import type { LocalRecipe } from '../../data/types';
import { useTheme } from '../../theme';

const grams = (n: number | null) => (n === null ? 'sin dato' : `${String(n).replace('.', ',')} g`);

/** Mis recetas (SPEC-nutrition-005, AC-08): platos compuestos de alimentos propios, con sus valores por ración. */
export default function RecipesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { nutrition } = useDeps();
  const [recipes, setRecipes] = useState<LocalRecipe[] | null>(null);

  const reload = useCallback(async () => setRecipes(await nutrition.listRecipes()), [nutrition]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const act = (run: () => Promise<unknown>) => () => void run().then(reload);

  if (!recipes) return null;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Button title="Nueva receta" testID="new-recipe" onPress={() => router.push('/recipes/edit')} />
      {recipes.length === 0 && <Muted>Aún no tienes recetas. Crea una con tus alimentos para registrarla por raciones.</Muted>}
      {recipes.map((r) => {
        const perServing = scaleRecipe(recipeTotal(r.ingredients), r.servings, 1);
        return (
          <View key={r.id} testID={`recipe-${r.id}`} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Title>{r.name}</Title>
            <Body testID={`recipe-values-${r.id}`}>
              {`Por ración: ${perServing.kcal} kcal · P ${grams(perServing.proteinG)} · G ${grams(perServing.fatG)} · C ${grams(perServing.carbsG)}`}
            </Body>
            <Muted>{`${r.servings} raciones · ${r.ingredients.map((i) => `${i.name}${i.foodId === null ? ' (alimento eliminado)' : ''} ${i.grams} g`).join(', ')}`}</Muted>
            {r.status === 'rejected' && <Muted>{r.message}</Muted>}
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button title="Editar" variant="secondary" testID={`edit-recipe-${r.id}`} onPress={() => router.push(`/recipes/edit?id=${r.id}`)} />
              </View>
              {r.status === 'rejected' && (
                <View style={styles.flex}>
                  <Button title="Descartar" variant="secondary" testID={`discard-recipe-${r.id}`} onPress={act(() => nutrition.discardRecipe(r.id))} />
                </View>
              )}
              <View style={styles.flex}>
                <Button title="Borrar" variant="secondary" testID={`delete-recipe-${r.id}`} onPress={act(() => nutrition.deleteRecipe(r.id))} />
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
