import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useDeps } from '../data/DataContext';
import { useSuggestions } from '../data/hooks';
import type { Suggestion } from '../data/types';
import { useTheme } from '../theme';
import { Body, Button, Muted, Title } from './ui';

/**
 * Sugerencias de la rutina y del método (SPEC-training-005, AC-15 y 16). Las calcula la API sin IA: la persona
 * elige una alternativa y acepta, o descarta. Necesitan conexión; sin ella solo se avisa.
 */
export function SuggestionsPanel({ onPlanChanged }: { onPlanChanged: () => void }) {
  const { colors } = useTheme();
  const { suggestions } = useDeps();
  const { state, reload } = useSuggestions();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  if (state === null) return null;
  if (state.status === 'offline') {
    return <Muted testID="suggestions-offline">Las sugerencias necesitan conexión con el servidor.</Muted>;
  }
  if (state.items.length === 0) return null;

  const accept = async (s: Suggestion) => {
    const replacement = chosen[s.key];
    if (!replacement) return;
    const result = await suggestions.accept(s, replacement);
    setNotice(result.ok ? 'Cambio aplicado en tu rutina.' : result.message);
    if (result.ok) onPlanChanged();
    await reload();
  };

  const dismiss = async (s: Suggestion) => {
    setNotice((await suggestions.dismiss(s.key)) ? null : 'Sin conexión: no se pudo descartar. Inténtalo de nuevo con conexión.');
    await reload();
  };

  return (
    <View style={styles.box} testID="suggestions-panel">
      <Title>Sugerencias</Title>
      <Muted>Se calculan con tus registros y tus restricciones. Tú decides: no cambian nada sin que las aceptes.</Muted>
      {notice && <Body testID="suggestions-notice" style={{ color: colors.warning }}>{notice}</Body>}

      {state.items.map((s) => (
        <View key={s.key} testID={`suggestion-${s.key}`} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Body>{s.message}</Body>

          {s.alternatives && s.alternatives.length > 0 && (
            <View style={styles.alternatives}>
              <Muted>Sustituir por:</Muted>
              {s.alternatives.map((a) => {
                const on = chosen[s.key] === a.exerciseId;
                return (
                  <Pressable
                    key={a.exerciseId}
                    testID={`alt-${s.key}-${a.exerciseId}`}
                    accessibilityRole="button"
                    accessibilityLabel={a.name}
                    accessibilityState={{ selected: on }}
                    onPress={() => setChosen((c) => ({ ...c, [s.key]: a.exerciseId }))}
                    style={[styles.alt, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.background }]}
                  >
                    <Text style={{ color: on ? colors.primaryText : colors.text, fontWeight: on ? '700' : '500' }}>{a.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {s.alternatives && s.alternatives.length === 0 && <Muted>No hay alternativas que cumplan tus restricciones y tu rutina.</Muted>}

          <View style={styles.row}>
            {s.alternatives && s.alternatives.length > 0 && (
              <View style={styles.flex}>
                <Button
                  title="Aceptar"
                  testID={`accept-${s.key}`}
                  disabled={!chosen[s.key]}
                  onPress={() => void accept(s)}
                />
              </View>
            )}
            <View style={styles.flex}>
              <Button title="Descartar" variant="secondary" testID={`dismiss-${s.key}`} onPress={() => void dismiss(s)} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  alternatives: { gap: 6 },
  alt: { borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
