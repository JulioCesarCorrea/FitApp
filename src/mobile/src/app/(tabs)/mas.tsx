import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Muted, Title } from '../../components/ui';
import { Scanner } from '../../Scanner';
import { WeightPanel } from '../../components/WeightPanel';
import type { ThemeMode } from '../../themeColors';
import { useTheme } from '../../theme';

const MODES: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: 'Sistema' },
  { mode: 'light', label: 'Claro' },
  { mode: 'dark', label: 'Oscuro' },
];

/** Más: tema, registro de peso y escáner del spike de SPEC-mobile-001. */
export default function MoreScreen() {
  const { mode, setMode } = useTheme();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Title>Tema</Title>
      <Muted>Por defecto sigue al sistema.</Muted>
      <View style={styles.row}>
        {MODES.map((m) => (
          <View key={m.mode} style={styles.flex}>
            <Button
              title={m.label}
              testID={`theme-${m.mode}`}
              variant={mode === m.mode ? 'primary' : 'secondary'}
              onPress={() => setMode(m.mode)}
            />
          </View>
        ))}
      </View>

      <WeightPanel />
      <Scanner />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
