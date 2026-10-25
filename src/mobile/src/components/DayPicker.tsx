import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DAYS, DAY_LETTERS, DAY_NAMES, type DayKey } from '../data/types';
import { useTheme } from '../theme';

/** Selector de días: botones L M X J V S D (varios a la vez, AC-mobile-002-03). */
export function DayPicker({ selected, onChange }: { selected: DayKey[]; onChange: (days: DayKey[]) => void }) {
  const { colors } = useTheme();

  const toggle = (day: DayKey) =>
    onChange(selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day]);

  return (
    <View style={styles.row}>
      {DAYS.map((day) => {
        const on = selected.includes(day);
        return (
          <Pressable
            key={day}
            testID={`day-${day}`}
            accessibilityRole="button"
            accessibilityLabel={DAY_NAMES[day]}
            accessibilityState={{ selected: on }}
            onPress={() => toggle(day)}
            style={[styles.day, { backgroundColor: on ? colors.primary : colors.surface, borderColor: colors.border }]}
          >
            <Text style={{ color: on ? colors.primaryText : colors.text, fontWeight: '700' }}>{DAY_LETTERS[day]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  day: { flex: 1, aspectRatio: 1, maxWidth: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
