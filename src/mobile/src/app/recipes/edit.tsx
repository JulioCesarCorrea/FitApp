import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Field, Muted, Title } from '../../components/ui';
import { useDeps } from '../../data/DataContext';
import type { RawRecipeInput } from '../../data/nutritionService';
import { recipeTotal, scaleRecipe } from '../../data/nutritionRules';
import type { LocalFood } from '../../data/types';
import { useTheme } from '../../theme';

const grams = (n: number | null) => (n === null ? 'sin dato' : `${String(n).replace('.', ',')} g`);

/** Crear o editar una receta (SPEC-nutrition-005, AC-01, 02, 08 y 09): nombre, raciones e ingredientes de tus alimentos con sus gramos. */
export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { nutrition, store } = useDeps();

  const [name, setName] = useState('');
  const [servings, setServings] = useState('1');
  const [ingredients, setIngredients] = useState<{ foodId: string; grams: string }[]>([]);
  const [foods, setFoods] = useState<LocalFood[]>([]);
  const [query, setQuery] = useState('');
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => { void nutrition.searchFoods(query).then(setFoods); }, [nutrition, query]);

  useEffect(() => {
    if (!id) return;
    void store.getRecipe(id).then((r) => {
      if (!r) return;
      setName(r.name);
      setServings(String(r.servings));
      // Un ingrediente cuyo alimento se borró no se puede reenviar: se quita y la persona elige otro.
      setIngredients(r.ingredients.filter((i) => i.foodId !== null).map((i) => ({ foodId: i.foodId as string, grams: String(i.grams) })));
    });
  }, [store, id]);

  const foodName = (foodId: string) => foods.find((f) => f.id === foodId)?.name ?? '';
  const [known, setKnown] = useState<Record<string, LocalFood>>({});
  useEffect(() => { void store.getFoods().then((all) => setKnown(Object.fromEntries(all.map((f) => [f.id, f])))); }, [store, foods]);

  const preview = (() => {
    const rows = ingredients.flatMap((i) => {
      const food = known[i.foodId];
      const g = Number(i.grams);
      return food && Number.isInteger(g) && g > 0
        ? [{ ...food, grams: g, fiberPer100g: food.fiberPer100g ?? null, sugarsPer100g: food.sugarsPer100g ?? null, sodiumMgPer100g: food.sodiumMgPer100g ?? null }]
        : [];
    });
    const count = Number(servings);
    if (rows.length === 0 || !Number.isInteger(count) || count < 1) return null;
    return scaleRecipe(recipeTotal(rows), count, 1);
  })();

  const save = async () => {
    const raw: RawRecipeInput = { name, servings, ingredients };
    const result = await nutrition.saveRecipe(raw, id);
    if (!result.ok) {
      setProblems(result.issues.map((i) => i.message));
      return;
    }
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>{id ? 'Editar receta' : 'Nueva receta'}</Title>
      <Field label="Nombre de la receta" value={name} onChangeText={setName} maxLength={80} />
      <Field label="Número de raciones" value={servings} onChangeText={setServings} keyboardType="number-pad" />

      <Muted>Ingredientes</Muted>
      {ingredients.length === 0 && <Muted>Añade alimentos de tu lista.</Muted>}
      {ingredients.map((i, index) => (
        <View key={i.foodId} testID={`ingredient-${i.foodId}`} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Body style={styles.bold}>{known[i.foodId]?.name ?? foodName(i.foodId)}</Body>
          <Field
            label={`Gramos de ${known[i.foodId]?.name ?? 'ingrediente'}`}
            value={i.grams}
            keyboardType="number-pad"
            onChangeText={(value) => setIngredients((list) => list.map((x, k) => (k === index ? { ...x, grams: value } : x)))}
          />
          <Button
            title="Quitar"
            variant="secondary"
            testID={`remove-ingredient-${i.foodId}`}
            onPress={() => setIngredients((list) => list.filter((_, k) => k !== index))}
          />
        </View>
      ))}

      <Muted>Tus alimentos</Muted>
      <Field label="Buscar en tus alimentos" value={query} onChangeText={setQuery} autoCapitalize="none" />
      {foods.filter((f) => !ingredients.some((i) => i.foodId === f.id)).map((f) => (
        <Pressable
          key={f.id}
          testID={`pick-food-${f.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Añadir ${f.name}`}
          onPress={() => setIngredients((list) => [...list, { foodId: f.id, grams: '' }])}
          style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <Text style={{ color: colors.text, fontWeight: '600' }}>{f.name}</Text>
        </Pressable>
      ))}
      {foods.length === 0 && <Muted>Aún no tienes alimentos con ese nombre.</Muted>}

      {preview && (
        <Body testID="recipe-preview">
          {`Por ración: ${preview.kcal} kcal · P ${grams(preview.proteinG)} · G ${grams(preview.fatG)} · C ${grams(preview.carbsG)}`}
        </Body>
      )}
      {problems.length > 0 && (
        <View testID="recipe-issues" style={styles.issues}>
          {problems.map((p) => <Body key={p} style={{ color: colors.danger }}>{p}</Body>)}
        </View>
      )}
      <Button title="Guardar receta" testID="save-recipe" onPress={() => void save()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 6 },
  issues: { gap: 4 },
  bold: { fontWeight: '600' },
});
