import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Body, Button, Muted, Title } from '../components/ui';
import { useDeps } from '../data/DataContext';

/** Cuenta sin perfil local y sin poder consultar el servidor: no se enseña el asistente para no pisar un perfil existente (AC-profile-001-19). */
export default function ConnectScreen() {
  const { profile } = useDeps();
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    await profile.resolve();
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Title>Necesitas conexión</Title>
      <Body testID="connect-message">No pudimos cargar tu perfil desde el servidor.</Body>
      <Muted>Comprueba tu conexión y vuelve a intentarlo. Así evitamos pisar un perfil que ya hayas hecho en otro teléfono.</Muted>
      <Button title="Reintentar" onPress={() => void retry()} disabled={busy} testID="connect-retry" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
});
