import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { Muted } from './ui';

export interface ChipOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Opciones en forma de botones. Con `single` se elige una (y `allowClear` permite desmarcarla); sin `single`
 * se pueden marcar varias. Se muestra la explicación de la opción elegida, si la tiene.
 */
export function Chips({
  options, selected, onToggle, testIDPrefix, showHint = true,
}: {
  options: ChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
  testIDPrefix: string;
  showHint?: boolean;
}) {
  const { colors } = useTheme();
  const hint = options.find((o) => selected.includes(o.value) && o.hint)?.hint;

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <Pressable
              key={o.value}
              testID={`${testIDPrefix}-${o.value}`}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: on }}
              onPress={() => onToggle(o.value)}
              style={[
                styles.chip,
                { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface },
              ]}
            >
              <Text style={{ color: on ? colors.primaryText : colors.text, fontWeight: on ? '700' : '500' }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {showHint && hint && <Muted>{hint}</Muted>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1 },
});
