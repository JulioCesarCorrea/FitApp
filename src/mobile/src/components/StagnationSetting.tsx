import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDeps } from '../data/DataContext';
import { MAX_THRESHOLD, MIN_THRESHOLD } from '../data/sessionService';
import type { SyncStatus } from '../data/types';
import { useTheme } from '../theme';
import { Body, Button, Field, Muted, Title } from './ui';

const STATUS_LABEL: Record<SyncStatus, string> = {
  pending: 'pendiente de enviar',
  synced: 'sincronizado',
  rejected: 'rechazado',
  needs_confirmation: 'necesita confirmación',
};

/** Umbral de estancamiento de la persona: de 2 a 10 sesiones sin mejorar (AC-mobile-003-11). */
export function StagnationSetting() {
  const { colors } = useTheme();
  const { sessions } = useDeps();
  const [text, setText] = useState('3');
  const [status, setStatus] = useState<{ status: SyncStatus; message: string | null }>({ status: 'synced', message: null });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setText(String(await sessions.getThreshold()));
    setStatus(await sessions.getThresholdStatus());
  }, [sessions]);

  // Al entrar: envía el cambio pendiente, si lo hay, y toma el valor del servidor si no hay uno propio por enviar.
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await load();
        await sessions.syncSettings();
        await sessions.hydrateSettings();
        await load();
      })();
    }, [sessions, load]),
  );

  const save = async () => {
    const result = await sessions.setThreshold(text);
    setError(result.ok ? null : result.message);
    await load();
  };

  return (
    <View style={styles.box}>
      <Title>Aviso de estancamiento</Title>
      <Muted>{`Avisa cuando llevas este número de sesiones seguidas sin mejorar en un ejercicio (de ${MIN_THRESHOLD} a ${MAX_THRESHOLD}).`}</Muted>
      <Field label="Sesiones sin mejorar" value={text} onChangeText={setText} keyboardType="number-pad" />
      {error && <Body style={{ color: colors.danger }}>{error}</Body>}
      <Button title="Guardar umbral" onPress={() => void save()} testID="save-threshold" />
      <Muted testID="threshold-status">{STATUS_LABEL[status.status]}</Muted>
      {status.message && <Muted>{status.message}</Muted>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
});
