import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { Chips } from '../../components/Chips';
import { Body, Button, Field, Muted, Title } from '../../components/ui';
import { useDeps } from '../../data/DataContext';
import { FIXED_MEALS } from '../../data/nutritionRules';
import { localDate, type FoodIssue, type RawFoodInput } from '../../data/nutritionService';
import type { LocalFood, ScannedProduct } from '../../data/types';
import { useTheme } from '../../theme';

const OTHER = 'otra';
const MEAL_OPTIONS = [
  ...FIXED_MEALS.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) })),
  { value: OTHER, label: 'Otra' },
];

const EMPTY_FOOD: RawFoodInput = { name: '', brand: '', barcode: '', kcal: '', protein: '', fat: '', carbs: '', source: 'manual' };

const text = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','));

const fromProduct = (p: ScannedProduct): RawFoodInput => ({
  name: p.name ?? '', brand: p.brand ?? '', barcode: p.barcode, kcal: text(p.kcalPer100g), protein: text(p.proteinPer100g),
  fat: text(p.fatPer100g), carbs: text(p.carbsPer100g), source: 'openfoodfacts',
});

/**
 * Añadir lo comido (SPEC-nutrition-001, AC-16, 17 y 19): elegir la comida, un alimento propio (buscarlo, escanearlo o
 * crearlo a mano) y la cantidad. Con `entryId` se edita una entrada ya registrada: solo la comida y los gramos.
 */
export default function AddFoodScreen() {
  const { entryId } = useLocalSearchParams<{ entryId?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { nutrition, products, store } = useDeps();

  const [mealKey, setMealKey] = useState<string>('desayuno');
  const [freeMeal, setFreeMeal] = useState('');
  const [grams, setGrams] = useState('');
  const [query, setQuery] = useState('');
  const [foods, setFoods] = useState<LocalFood[]>([]);
  const [selected, setSelected] = useState<LocalFood | null>(null);
  const [mode, setMode] = useState<'pick' | 'scan' | 'create'>('pick');
  const [draft, setDraft] = useState<RawFoodInput>(EMPTY_FOOD);
  const [foodIssues, setFoodIssues] = useState<FoodIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ name: string; foodId: string | null; date: string } | null>(null);

  const reloadFoods = useCallback(async () => setFoods(await nutrition.searchFoods(query)), [nutrition, query]);
  useEffect(() => { void reloadFoods(); }, [reloadFoods]);

  // Al editar, el formulario arranca con los datos de la entrada.
  useEffect(() => {
    if (!entryId) return;
    void store.getFoodEntry(entryId).then((e) => {
      if (!e) return;
      setEditing({ name: e.name, foodId: e.foodId, date: e.date });
      setGrams(String(e.grams));
      const fixed = (FIXED_MEALS as readonly string[]).includes(e.meal);
      setMealKey(fixed ? e.meal : OTHER);
      setFreeMeal(fixed ? '' : e.meal);
    });
  }, [store, entryId]);

  const meal = mealKey === OTHER ? freeMeal : mealKey;
  const setField = (key: keyof RawFoodInput) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  // AC-nutrition-001-17: solo viaja el código; sin conexión o sin datos completos se sigue a mano con el código puesto.
  const scanned = async (code: string) => {
    setMode('pick');
    const own = await nutrition.findByBarcode(code);
    if (own) {
      setSelected(own);
      setNotice('Ya tenías este alimento: lo he seleccionado.');
      return;
    }
    const result = await products.lookup(code);
    if (result.kind === 'found') {
      setDraft(fromProduct(result.product));
      setNotice('Valores de Open Food Facts: revísalos antes de guardar.');
    } else if (result.kind === 'incomplete') {
      setDraft(fromProduct(result.product));
      setNotice('Open Food Facts no tiene todos los datos de este producto: complétalos.');
    } else {
      setDraft({ ...EMPTY_FOOD, barcode: code });
      setNotice(result.kind === 'notFound' ? 'No encuentro ese producto: escribe sus valores.' : 'Sin conexión: escribe los valores del producto.');
    }
    setFoodIssues([]);
    setMode('create');
  };

  const saveFood = async () => {
    const result = await nutrition.saveFood(draft);
    if (!result.ok) {
      setFoodIssues(result.issues);
      if (result.duplicateOf) {
        const existing = (await nutrition.searchFoods()).find((f) => f.id === result.duplicateOf);
        if (existing) setSelected(existing);
      }
      return;
    }
    setSelected(result.food);
    setFoodIssues([]);
    setNotice(null);
    setMode('pick');
    await reloadFoods();
  };

  const saveEntry = async () => {
    const foodId = editing ? editing.foodId : selected?.id;
    const result = await nutrition.saveEntry(
      { date: editing?.date ?? localDate(), meal, grams, foodId: foodId ?? '' }, entryId,
    );
    if (!result.ok) {
      setProblems(result.issues.map((i) => i.message));
      return;
    }
    router.back();
  };

  const chosenLabel = editing ? editing.name : selected?.name;
  const canPickFood = !editing;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>{editing ? editing.name : 'Añadir alimento'}</Title>

      <Muted>Comida</Muted>
      <Chips options={MEAL_OPTIONS} selected={[mealKey]} onToggle={setMealKey} testIDPrefix="meal" showHint={false} />
      {mealKey === OTHER && <Field label="Nombre de la comida" value={freeMeal} onChangeText={setFreeMeal} maxLength={30} />}

      {canPickFood && (
        <>
          <Muted>Alimento</Muted>
          {selected && (
            <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.surface }]} testID="selected-food">
              <Body style={styles.bold}>{selected.name}</Body>
              <Muted>{`${text(selected.kcalPer100g)} kcal por 100 g`}</Muted>
            </View>
          )}
          {notice && <Body testID="food-notice" style={{ color: colors.warning }}>{notice}</Body>}

          {mode === 'scan' && <BarcodeScanner onScanned={(code) => void scanned(code)} onCancel={() => setMode('pick')} />}

          {mode === 'create' && (
            <View style={styles.form} testID="food-form">
              <Field label="Nombre del alimento" value={draft.name} onChangeText={setField('name')} />
              <Field label="Marca (opcional)" value={draft.brand} onChangeText={setField('brand')} />
              <Field label="Código de barras (opcional)" value={draft.barcode} onChangeText={setField('barcode')} keyboardType="number-pad" />
              <Field label="Calorías por 100 g" value={draft.kcal} onChangeText={setField('kcal')} keyboardType="decimal-pad" />
              <Field label="Proteína por 100 g" value={draft.protein} onChangeText={setField('protein')} keyboardType="decimal-pad" />
              <Field label="Grasa por 100 g" value={draft.fat} onChangeText={setField('fat')} keyboardType="decimal-pad" />
              <Field label="Carbohidratos por 100 g" value={draft.carbs} onChangeText={setField('carbs')} keyboardType="decimal-pad" />
              {foodIssues.length > 0 && (
                <View testID="food-issues" style={styles.issues}>
                  {foodIssues.map((i) => (
                    <Body key={`${i.field}-${i.message}`} style={{ color: colors.danger }}>{i.message}</Body>
                  ))}
                </View>
              )}
              <Button title="Guardar alimento" testID="save-food" onPress={() => void saveFood()} />
              <Button title="Cancelar" variant="secondary" onPress={() => { setMode('pick'); setNotice(null); }} />
            </View>
          )}

          {mode === 'pick' && (
            <>
              <Field label="Buscar en tus alimentos" value={query} onChangeText={setQuery} autoCapitalize="none" />
              {foods.map((f) => (
                <Pressable
                  key={f.id}
                  testID={`food-${f.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={f.name}
                  onPress={() => { setSelected(f); setNotice(null); }}
                  style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{f.name}</Text>
                  <Muted>{`${f.brand ? `${f.brand} · ` : ''}${text(f.kcalPer100g)} kcal por 100 g`}</Muted>
                </Pressable>
              ))}
              {foods.length === 0 && <Muted>Aún no tienes alimentos con ese nombre.</Muted>}
              <Button title="Escanear código de barras" variant="secondary" testID="scan-food" onPress={() => setMode('scan')} />
              <Button
                title="Crear alimento a mano"
                variant="secondary"
                testID="create-food"
                onPress={() => { setDraft(EMPTY_FOOD); setFoodIssues([]); setNotice(null); setMode('create'); }}
              />
            </>
          )}
        </>
      )}

      {mode === 'pick' && (
        <>
          <Field label="Cantidad en gramos" value={grams} onChangeText={setGrams} keyboardType="number-pad" />
          {problems.length > 0 && (
            <View testID="entry-issues" style={styles.issues}>
              {problems.map((p) => <Body key={p} style={{ color: colors.danger }}>{p}</Body>)}
            </View>
          )}
          <Button
            title={chosenLabel ? `Guardar ${chosenLabel}` : 'Guardar'}
            testID="save-entry"
            onPress={() => void saveEntry()}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  form: { gap: 8 },
  issues: { gap: 4 },
  bold: { fontWeight: '600' },
});
