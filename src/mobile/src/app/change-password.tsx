import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Body, Button, Field, Muted, Title } from '../components/ui';
import { useDeps } from '../data/DataContext';
import { useAuthState } from '../data/hooks';
import { useTheme } from '../theme';

/** Cambiar la contraseña, desde «Más» o de forma obligatoria tras un restablecimiento (AC-mobile-004-09 y 10). */
export default function ChangePasswordScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { auth } = useDeps();
  const state = useAuthState();
  const forced = state.status === 'signedIn' && state.user.mustChangePassword;

  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const wasForced = forced;
    setBusy(true);
    setMessage(null);
    const outcome = await auth.changePassword(form);
    setBusy(false);

    if (outcome.kind === 'ok') {
      // Si era obligatorio, la app ya está disponible: se entra en ella. Si no, se confirma y se vuelve a «Más».
      if (wasForced) router.replace('/');
      else setDone(true);
    } else if (outcome.kind === 'invalid') setMessage(outcome.issues.map((i) => i.message).join('\n'));
    else setMessage(outcome.message);
  };

  if (done) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Title>Cambiar contraseña</Title>
        <Body style={{ color: colors.success }} testID="password-changed">Contraseña cambiada.</Body>
        <Button title="Listo" onPress={() => router.back()} testID="password-done" />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>Cambiar contraseña</Title>
      {forced && (
        <Body style={{ color: colors.warning }} testID="forced-notice">
          Debes elegir una contraseña nueva antes de continuar.
        </Body>
      )}
      <Muted>De 10 a 128 caracteres y distinta de tu nombre de usuario.</Muted>

      <Field label="Contraseña actual" value={form.current} onChangeText={set('current')} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      <Field label="Contraseña nueva" value={form.next} onChangeText={set('next')} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" />
      <Field label="Repite la contraseña nueva" value={form.confirm} onChangeText={set('confirm')} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" />

      {message && <Body style={{ color: colors.danger }} testID="password-message">{message}</Body>}

      <Button title="Cambiar contraseña" onPress={() => void submit()} disabled={busy} testID="change-password-submit" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
});
