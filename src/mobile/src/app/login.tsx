import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Body, Button, Field, Muted, Title } from '../components/ui';
import { useDeps } from '../data/DataContext';
import { useAuthState } from '../data/hooks';
import type { SignInOutcome } from '../data/authService';
import { useTheme } from '../theme';

/** Entrar con nombre de usuario y contraseña (AC-mobile-004-02, 06, 07 y 12). */
export default function LoginScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { auth } = useDeps();
  const state = useAuthState();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);

  // AC-mobile-004-06: aviso cuando la sesión terminó (sin borrar nada del teléfono).
  const notice = state.status === 'signedOut' ? state.notice : null;

  const show = (outcome: SignInOutcome) => {
    if (outcome.kind === 'invalid') setMessage(outcome.issues.map((i) => i.message).join('\n'));
    else if (outcome.kind === 'confirmReplace') setPending(outcome.pending);
    else if (outcome.kind !== 'ok') setMessage(outcome.message);
    // Con «ok» la sesión cambia y Expo Router abre la app solo.
  };

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    show(await auth.signIn(username, password));
    setBusy(false);
  };

  const confirmReplace = async () => {
    setPending(null);
    show(await auth.confirmReplace());
  };

  const cancelReplace = async () => {
    setPending(null);
    await auth.cancelReplace();
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>Entrar</Title>
      {notice && <Body style={{ color: colors.warning }} testID="session-notice">{notice}</Body>}

      <Field
        label="Nombre de usuario"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
      />
      <Field
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
      />

      {message && <Body style={{ color: colors.danger }} testID="login-message">{message}</Body>}

      {pending !== null && (
        <View style={[styles.card, { borderColor: colors.warning, backgroundColor: colors.surface }]} testID="replace-warning">
          <Body>
            {`Este teléfono tiene ${pending} ${pending === 1 ? 'cambio' : 'cambios'} sin enviar de otra cuenta. ` +
              'Si continúas se borrarán.'}
          </Body>
          <Button title="Continuar y borrar" variant="danger" onPress={() => void confirmReplace()} testID="confirm-replace" />
          <Button title="Cancelar" variant="secondary" onPress={() => void cancelReplace()} testID="cancel-replace" />
        </View>
      )}

      <Button title="Entrar" onPress={() => void submit()} disabled={busy} testID="login-submit" />
      <Muted>¿Todavía no tienes cuenta?</Muted>
      <Button title="Crear cuenta" variant="secondary" onPress={() => router.push('/register')} testID="go-register" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
});
