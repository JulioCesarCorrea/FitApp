import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AccountPanel } from '../../components/AccountPanel';
import { Button, Muted, Title } from '../../components/ui';
import { Scanner } from '../../Scanner';
import { StagnationSetting } from '../../components/StagnationSetting';
import { WeightPanel } from '../../components/WeightPanel';
import type { ThemeMode } from '../../themeColors';
import { useTheme } from '../../theme';

const MODES: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: 'Sistema' },
  { mode: 'light', label: 'Claro' },
  { mode: 'dark', label: 'Oscuro' },
];

/** Más: cuenta (SPEC-mobile-004), perfil y restricciones (SPEC-profile-001), tema, umbral de estancamiento (SPEC-mobile-003), registro de peso y escáner del spike de SPEC-mobile-001. */
export default function MoreScreen() {
  const { mode, setMode } = useTheme();
  const router = useRouter();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <AccountPanel />

      <Title>Mi perfil</Title>
      <Muted>Tus datos, tu objetivo y las lesiones o restricciones que debes cuidar.</Muted>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title="Perfil" variant="secondary" testID="go-profile" onPress={() => router.push('/profile')} />
        </View>
        <View style={styles.flex}>
          <Button title="Restricciones" variant="secondary" testID="go-restrictions" onPress={() => router.push('/restrictions')} />
        </View>
      </View>

      <Title>Inteligencia artificial</Title>
      <Muted>Opcional: tú decides qué funciones usar y qué se envía.</Muted>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title="Ajustes de IA" variant="secondary" testID="go-ai" onPress={() => router.push('/ai')} />
        </View>
        <View style={styles.flex}>
          <Button title="Análisis y planes" variant="secondary" testID="go-assistant" onPress={() => router.push('/assistant')} />
        </View>
      </View>
      <Button title="Preguntas a la IA" variant="secondary" testID="go-chat" onPress={() => router.push('/chat')} />

      <Title>Mi contexto</Title>
      <Muted>Suplementos, hábitos, medicación y notas. Tú decides qué se comparte con la IA.</Muted>
      <Button title="Mi contexto" variant="secondary" testID="go-context" onPress={() => router.push('/context')} />

      <Title>Recordatorios</Title>
      <Muted>Avisos en este teléfono para entrenar, registrar comidas y pesarte.</Muted>
      <Button title="Recordatorios" variant="secondary" testID="go-reminders" onPress={() => router.push('/reminders')} />

      <Title>Progreso</Title>
      <Muted>Cómo evolucionan tu peso y tu entrenamiento.</Muted>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title="Peso" variant="secondary" testID="go-weight-progress" onPress={() => router.push('/progress/weight')} />
        </View>
        <View style={styles.flex}>
          <Button title="Entrenamiento" variant="secondary" testID="go-training-progress" onPress={() => router.push('/progress/training')} />
        </View>
      </View>

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

      <StagnationSetting />
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
