import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDeps } from '../data/DataContext';
import { useAuthState } from '../data/hooks';
import { useTheme } from '../theme';
import { Body, Button, Muted, Title } from './ui';

/** «Más → Cuenta»: usuario, cambiar contraseña y cerrar sesión (AC-mobile-004-08 y 09). */
export function AccountPanel() {
  const router = useRouter();
  const { colors } = useTheme();
  const { auth } = useDeps();
  const state = useAuthState();
  const [pending, setPending] = useState<number | null>(null); // null = sin pedir confirmación

  if (state.status !== 'signedIn') return null;

  return (
    <View style={styles.box} testID="account-panel">
      <Title>Cuenta</Title>
      <Body testID="account-username">{`Sesión iniciada como ${state.user.username}`}</Body>
      <Button title="Cambiar contraseña" variant="secondary" onPress={() => router.push('/change-password')} testID="go-change-password" />

      {pending === null ? (
        <Button title="Cerrar sesión" variant="secondary" testID="sign-out" onPress={() => void auth.pendingChanges().then(setPending)} />
      ) : (
        <View style={[styles.card, { borderColor: colors.warning, backgroundColor: colors.surface }]} testID="signout-warning">
          <Body>
            {pending > 0
              ? `Tienes ${pending} ${pending === 1 ? 'cambio' : 'cambios'} sin enviar. Si cierras sesión se perderán.`
              : 'Se borrarán los datos de este teléfono. Volverán a descargarse cuando entres otra vez.'}
          </Body>
          <Button title="Cerrar sesión y borrar" variant="danger" testID="confirm-sign-out" onPress={() => void auth.signOut()} />
          <Button title="Cancelar" variant="secondary" testID="cancel-sign-out" onPress={() => setPending(null)} />
        </View>
      )}
      <Muted>Si olvidas tu contraseña, pídele al administrador que la restablezca.</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
});
