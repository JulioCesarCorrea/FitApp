import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Body, Button, Field, Muted, Title } from '../../components/ui';
import { useDeps } from '../../data/DataContext';
import { aiErrorText } from '../../data/aiService';
import { allergenLabel } from '../../data/allergens';
import type { FoodPhotoItem } from '../../data/foodPhotoService';
import { FIXED_MEALS } from '../../data/nutritionRules';
import { localDate } from '../../data/nutritionService';
import { useTheme } from '../../theme';

const MEAL_OPTIONS = FIXED_MEALS.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }));

interface Row {
  name: string;
  grams: string;
  item: FoodPhotoItem;
}

/**
 * Foto de comida con IA (SPEC-ai-003, AC-05, 07 y 10): la IA estima lo que ve; tú corriges cada alimento y cada cantidad y solo entonces se
 * registra. La foto se envía sin ubicación y no se guarda. Necesita conexión: el registro a mano y el escáner siguen funcionando sin ella.
 */
export default function FoodPhotoScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { photo } = useDeps();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meal, setMeal] = useState<string>('almuerzo');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const take = async () => {
    setMessage(null);
    setBusy(true);
    const captured = await photo.takePhoto();
    if (captured.kind === 'denied') {
      setMessage(captured.canAskAgain
        ? 'Sin el permiso de la cámara no puedo hacer la foto.'
        : 'Sin el permiso de la cámara no puedo hacer la foto. Actívalo en los ajustes del sistema, en Permisos de la app.');
    } else if (captured.kind === 'ok') {
      const result = await photo.analyze(captured.base64);
      if (result.kind === 'offline') setMessage('Esta función necesita conexión. Puedes registrar la comida a mano o escanear su código.');
      else if (result.kind === 'error') setMessage(aiErrorText(result));
      else if (result.value.items.length === 0) setMessage('No he reconocido comida en la foto. Prueba con otra o registra a mano.');
      else setRows(result.value.items.map((item) => ({ name: item.name, grams: String(item.grams), item })));
    }
    setBusy(false);
  };

  const register = async () => {
    if (!rows) return;
    setBusy(true);
    const result = await photo.register(rows, meal, localDate());
    setBusy(false);
    if (result.ok) { if (router.canGoBack()) router.back(); else router.replace('/'); }
    else setProblems(result.issues);
  };

  const change = (index: number, patch: Partial<Row>) => setRows((list) => list?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? null);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>Foto de la comida</Title>

      {!rows && (
        <>
          <Muted testID="photo-notice">
            Se envía la foto del plato a la IA para estimar los alimentos y las cantidades. La foto va sin ubicación ni datos de la propia foto y
            no se guarda. Cada foto gasta parte de tu cuota de IA (hasta 10 al día). Es una estimación: tú la corriges antes de registrar.
          </Muted>
          <Button title={busy ? 'Analizando…' : 'Hacer foto'} disabled={busy} testID="photo-take" onPress={() => void take()} />
        </>
      )}

      {message && <Body testID="photo-message" style={{ color: colors.warning }}>{message}</Body>}
      {message?.includes('Inteligencia artificial') && (
        <Button title="Ir a Inteligencia artificial" variant="secondary" testID="go-ai-settings" onPress={() => router.push('/ai')} />
      )}

      {rows && (
        <>
          <Muted>Estimación de la IA: revisa y corrige cada alimento y su cantidad. Nada se registra hasta que lo confirmes.</Muted>
          {rows.map((r, i) => (
            <View key={i} testID={`photo-item-${i}`} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Field label={`Nombre del alimento ${i + 1}`} value={r.name} onChangeText={(name) => change(i, { name })} />
              <Field label={`Gramos de ${i + 1}`} value={r.grams} onChangeText={(grams) => change(i, { grams })} keyboardType="number-pad" />
              <Muted>
                {`Estimación (confianza ${r.item.confidence}) · ${r.item.kcalPer100g} kcal, P ${r.item.proteinPer100g} g, G ${r.item.fatPer100g} g, C ${r.item.carbsPer100g} g por 100 g`}
              </Muted>
              {r.item.possibleAllergens.length > 0 && (
                <Body testID={`photo-allergen-${i}`} style={{ color: colors.danger }}>
                  {`⚠ Podría contener ${r.item.possibleAllergens.map(allergenLabel).join(', ')}, que figura en tus alergias. Es orientativo: revisa siempre lo que comes.`}
                </Body>
              )}
              <Button title="Quitar" variant="secondary" testID={`photo-remove-${i}`} onPress={() => setRows((list) => list?.filter((_, k) => k !== i) ?? null)} />
            </View>
          ))}

          <Muted>Comida</Muted>
          <Chips options={MEAL_OPTIONS} selected={[meal]} onToggle={setMeal} testIDPrefix="photo-meal" showHint={false} />
          {problems.length > 0 && (
            <View testID="photo-issues" style={styles.issues}>
              {problems.map((p) => <Body key={p} style={{ color: colors.danger }}>{p}</Body>)}
            </View>
          )}
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button title="Registrar" disabled={busy || rows.length === 0} testID="photo-register" onPress={() => void register()} />
            </View>
            <View style={styles.flex}>
              <Button title="Descartar" variant="secondary" testID="photo-discard" onPress={() => { setRows(null); setProblems([]); }} />
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  issues: { gap: 4 },
});
