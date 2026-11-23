import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Body, Button, Muted, Title } from '../components/ui';
import { useDeps } from '../data/DataContext';
import type { AiView } from '../data/aiService';
import { useTheme } from '../theme';

const money = (n: number) => `${n.toFixed(2).replace('.', ',')} USD`;

/** Inteligencia artificial (SPEC-ai-001, AC-13): consentimiento por función, qué se envía y el gasto del mes. Sin conexión no se usa. */
export default function AiScreen() {
  const { colors } = useTheme();
  const { ai } = useDeps();
  const [view, setView] = useState<AiView | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => setView(await ai.load()), [ai]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  if (!view) return null;

  const toggle = async (feature: string, on: boolean) => {
    const ok = await ai.setConsent(feature, on);
    setMessage(ok ? null : 'No se pudo guardar: necesitas conexión para cambiar esto.');
    await reload();
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Title>Inteligencia artificial</Title>
      <Muted>
        La IA es opcional: todo lo básico (registro, cálculos, progresión) funciona sin ella. Nunca recibe tu nombre, tu correo ni tu
        ubicación. Sus respuestas son orientativas y no sustituyen a un profesional de la salud.
      </Muted>

      {view.offline && <Muted testID="ai-offline">Sin conexión: la IA necesita conexión y aquí no se puede cambiar nada.</Muted>}

      {view.features.map((f) => (
        <View key={f.feature} testID={`ai-${f.feature}`} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Title>{f.title}</Title>
          <Muted>{f.explanation}</Muted>
          {!f.available && <Muted testID={`ai-unavailable-${f.feature}`}>No disponible ahora mismo.</Muted>}
          <Button
            title={f.consented ? 'Activada: tocar para desactivar' : 'Desactivada: tocar para activar'}
            variant={f.consented ? 'primary' : 'secondary'}
            disabled={!f.available && !f.consented}
            testID={`ai-toggle-${f.feature}`}
            onPress={() => void toggle(f.feature, !f.consented)}
          />
        </View>
      ))}

      {message && <Body style={{ color: colors.danger }} testID="ai-message">{message}</Body>}

      {view.usage && (
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="ai-usage">
          <Title>Uso</Title>
          <Body testID="ai-usage-today">{`Hoy: ${view.usage.tokensToday} de ${view.usage.dailyTokenCap} unidades de uso (tokens).`}</Body>
          <Body testID="ai-usage-month">{`Gasto del mes: ${money(view.usage.monthCostUsd)} de ${money(view.usage.monthlyCapUsd)}.`}</Body>
          <Muted>Al llegar a tu límite la IA se pausa y el resto de la app sigue funcionando.</Muted>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
});
