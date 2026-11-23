import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export interface Bar {
  key: string;
  /** Texto bajo la barra (p. ej. el inicio de la semana). */
  label: string;
  value: number;
}

const HEIGHT = 140;

/**
 * Gráfico de barras sin dependencias (SPEC-nutrition-006, AC-08): una barra por valor y, si se indica, una línea de referencia
 * (p. ej. las calorías objetivo). El significado no depende solo del color: cada barra lleva su valor escrito.
 */
export function BarChart({
  bars, reference, referenceLabel, valueSuffix = '', accessibilityLabel, testID,
}: {
  bars: Bar[];
  reference?: number | null;
  referenceLabel?: string;
  valueSuffix?: string;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const top = Math.max(1, ...bars.map((b) => b.value), reference ?? 0);
  const y = (value: number) => (value / top) * HEIGHT;

  return (
    <View testID={testID} accessible accessibilityLabel={accessibilityLabel} style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={[styles.plot, { height: HEIGHT + 18 }]}>
        {bars.map((b) => (
          <View key={b.key} style={styles.column}>
            <Text style={{ color: colors.text, fontSize: 11 }}>{`${b.value}${valueSuffix}`}</Text>
            <View style={{ height: Math.max(2, y(b.value)), width: '70%', backgroundColor: colors.primary, borderRadius: 3 }} />
          </View>
        ))}
        {reference != null && (
          <View pointerEvents="none" style={[styles.reference, { bottom: y(reference), borderColor: colors.danger }]} />
        )}
      </View>
      <View style={styles.labels}>
        {bars.map((b) => (
          <Text key={b.key} style={[styles.label, { color: colors.textMuted }]}>{b.label}</Text>
        ))}
      </View>
      {reference != null && referenceLabel && <Text style={{ color: colors.danger }}>{`— ${referenceLabel}`}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, padding: 8, gap: 4 },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  reference: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, borderStyle: 'dashed' },
  labels: { flexDirection: 'row', gap: 4 },
  label: { flex: 1, fontSize: 10, textAlign: 'center' },
});
