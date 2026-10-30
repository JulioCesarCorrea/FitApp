import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import {
  ActivityFields, AllergiesFields, BirthFields, BodyFields, ExperienceFields, GoalFields, MethodologyFields, NameFields,
} from '../components/ProfileFields';
import { Body, Button, Muted, Title } from '../components/ui';
import { useDeps } from '../data/DataContext';
import { draftToProfile, profileToDraft, type ProfileDraft } from '../data/profileForms';
import { todayLocal } from '../data/sessionService';
import type { ProfileState } from '../data/types';
import { useTheme } from '../theme';

/** «Más → Perfil»: ver y editar los datos del perfil (SPEC-profile-001, AC-17). El peso se registra en el panel de peso de «Más». */
export default function ProfileScreen() {
  const { colors } = useTheme();
  const { profile } = useDeps();
  const [state, setState] = useState<ProfileState | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const current = await profile.getProfile();
    setState(current);
    if (current.profile) setDraft(profileToDraft(current.profile));
  }, [profile]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!draft) return <Muted style={styles.content}>Cargando tu perfil…</Muted>;

  const change = (patch: Partial<ProfileDraft>) => {
    setDraft({ ...draft, ...patch });
    setMessages([]);
    setSaved(null);
  };

  const save = async () => {
    const result = draftToProfile(draft, todayLocal(), { withWeight: false });
    if (!result.ok) {
      setMessages(result.issues.map((i) => i.message));
      return;
    }

    const outcome = await profile.save(result.profile);
    setMessages(outcome.kind === 'rejected' ? [outcome.message] : []);
    setSaved(
      outcome.kind === 'ok' ? 'Guardado y sincronizado.'
        : outcome.kind === 'pending' ? 'Guardado en el teléfono; se enviará cuando haya conexión.'
        : null,
    );
    await load();
  };

  const status =
    state?.status === 'pending' ? 'Cambios guardados en el teléfono, pendientes de enviar.'
      : state?.status === 'rejected' ? `Rechazado: ${state.message ?? ''}`
      : null;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Title>Mi perfil</Title>

        <NameFields draft={draft} onChange={change} />
        <BirthFields draft={draft} onChange={change} />
        <BodyFields draft={draft} onChange={change} withWeight={false} />
        <Title>Objetivo</Title>
        <GoalFields draft={draft} onChange={change} />
        <Title>Actividad diaria</Title>
        <ActivityFields draft={draft} onChange={change} />
        <Title>Entrenamiento</Title>
        <ExperienceFields draft={draft} onChange={change} />
        <MethodologyFields draft={draft} onChange={change} />
        <Title>Comida</Title>
        <AllergiesFields draft={draft} onChange={change} />

        {messages.map((m) => (
          <Body key={m} style={{ color: colors.danger }} testID="profile-message">{m}</Body>
        ))}
        <Button title="Guardar cambios" onPress={() => void save()} testID="save-profile" />
        {saved && <Body style={{ color: colors.success }} testID="profile-saved">{saved}</Body>}
        {status && <Muted testID="profile-status">{status}</Muted>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 10 },
});
