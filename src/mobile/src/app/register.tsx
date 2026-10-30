import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Body, Button, Field, Muted, Title } from '../components/ui';
import { useDeps } from '../data/DataContext';
import type { SignInOutcome } from '../data/authService';
import { useTheme } from '../theme';

/** Crear cuenta con código de invitación (AC-mobile-004-03, 07 y 12). */
export default function RegisterScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { auth } = useDeps();
  const [form, setForm] = useState({ username: '', password: '', confirm: '', inviteCode: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const show = (outcome: SignInOutcome) => {
    if (outcome.kind === 'invalid') setMessage(outcome.issues.map((i) => i.message).join('\n'));
    else if (outcome.kind === 'confirmReplace') setPending(outcome.pending);
    else if (outcome.kind !== 'ok') setMessage(outcome.message);
  };

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    show(await auth.register(form));
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>Crear cuenta</Title>
      <Muted>Necesitas el código de invitación que te dio el administrador.</Muted>

      <Field
        label="Nombre de usuario"
        value={form.username}
        onChangeText={set('username')}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
      />
      <Field
        label="Contraseña"
        value={form.password}
        onChangeText={set('password')}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
      />
      <Field
        label="Repite la contraseña"
        value={form.confirm}
        onChangeText={set('confirm')}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
      />
      <Field label="Código de invitación" value={form.inviteCode} onChangeText={set('inviteCode')} autoCapitalize="none" autoCorrect={false} />

      {message && <Body style={{ color: colors.danger }} testID="register-message">{message}</Body>}

      {pending !== null && (
        <View style={[styles.card, { borderColor: colors.warning, backgroundColor: colors.surface }]} testID="replace-warning">
          <Body>
            {`Este teléfono tiene ${pending} ${pending === 1 ? 'cambio' : 'cambios'} sin enviar de otra cuenta. ` +
              'Si continúas se borrarán.'}
          </Body>
          <Button
            title="Continuar y borrar"
            variant="danger"
            testID="confirm-replace"
            onPress={() => {
              setPending(null);
              void auth.confirmReplace().then(show);
            }}
          />
          <Button
            title="Cancelar"
            variant="secondary"
            testID="cancel-replace"
            onPress={() => {
              setPending(null);
              void auth.cancelReplace();
            }}
          />
        </View>
      )}

      <Button title="Crear cuenta" onPress={() => void submit()} disabled={busy} testID="register-submit" />
      <Button title="Ya tengo cuenta" variant="secondary" onPress={() => router.back()} testID="go-login" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
});
