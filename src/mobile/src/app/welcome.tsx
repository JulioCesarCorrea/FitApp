import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { EquipmentForm } from '../components/EquipmentForm';
import {
  ActivityFields, AllergiesFields, BirthFields, BodyFields, ExperienceFields, GoalFields, MethodologyFields, NameFields,
} from '../components/ProfileFields';
import { RestrictionsManager } from '../components/RestrictionsManager';
import { Body, Button, Muted, Title } from '../components/ui';
import type { FormIssue } from '../data/authForms';
import { useDeps } from '../data/DataContext';
import { METHODOLOGY_OPTIONS } from '../data/labels';
import {
  DEFAULT_METHODOLOGY, draftToProfile, emptyDraft, validateBirthStep, validateBodyStep, validateGoalStep,
  validateNameStep, validateOptionalStep, type ProfileDraft,
} from '../data/profileForms';
import { todayLocal } from '../data/sessionService';
import { useTheme } from '../theme';

type StepKey = 'name' | 'birth' | 'body' | 'goal' | 'activity' | 'experience' | 'methodology' | 'equipment' | 'restrictions' | 'allergies';

interface Step {
  key: StepKey;
  title: string;
  intro: string;
  required: boolean;
}

// Los cuatro primeros son obligatorios; los demás se pueden omitir y completar luego desde «Más» (AC-profile-001-12 y 13).
const STEPS: Step[] = [
  { key: 'name', title: '¿Cómo te llamas?', intro: 'Tu nombre o un apodo, para saludarte en la app.', required: true },
  { key: 'birth', title: 'Sexo y fecha de nacimiento', intro: 'Hacen falta para calcular tus metas más adelante.', required: true },
  { key: 'body', title: 'Estatura y peso', intro: 'Tu peso de hoy será el primer registro de tu historial.', required: true },
  { key: 'goal', title: '¿Cuál es tu objetivo?', intro: 'Elige el que más se acerque a lo que buscas.', required: true },
  { key: 'activity', title: 'Tu actividad diaria', intro: 'Sin contar el entrenamiento. Si lo omites usaremos «Ligero».', required: false },
  { key: 'experience', title: 'Tu experiencia', intro: 'Cuánto llevas entrenando y cuántos días a la semana puedes ir.', required: false },
  { key: 'methodology', title: 'Tu método de entrenamiento', intro: 'Por ahora la app trabaja con un método.', required: false },
  { key: 'equipment', title: 'El equipo de tu gimnasio', intro: 'Con estos pesos la app calcula tu siguiente carga.', required: false },
  { key: 'restrictions', title: 'Lesiones o restricciones', intro: 'Zonas o movimientos que debes cuidar.', required: false },
  { key: 'allergies', title: 'Alergias o preferencias de comida', intro: 'Las guardamos para cuando llegue la parte de nutrición.', required: false },
];

/** Lo que vale cada paso al omitirlo: se vuelve al valor por defecto. */
const CLEARED: Partial<Record<StepKey, Partial<ProfileDraft>>> = {
  activity: { activityLevel: null },
  experience: { experienceLevel: null, daysPerWeek: '' },
  methodology: { methodology: DEFAULT_METHODOLOGY },
  allergies: { allergies: '' },
};

/**
 * Asistente de bienvenida (SPEC-profile-001, AC-11 a 16): se muestra a las cuentas sin perfil. Pasos obligatorios 1 a 4;
 * el resto tiene «Omitir». Al terminar, el perfil se guarda en el teléfono y se envía; el peso entra a la cola de pesos.
 */
export default function WelcomeScreen() {
  const { colors } = useTheme();
  const { profile } = useDeps();
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft());
  const [index, setIndex] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const today = todayLocal();

  const change = (patch: Partial<ProfileDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setMessages([]);
  };

  const validate = (): FormIssue[] => {
    switch (step.key) {
      case 'name': return validateNameStep(draft);
      case 'birth': return validateBirthStep(draft, today);
      case 'body': return validateBodyStep(draft);
      case 'goal': return validateGoalStep(draft);
      case 'experience':
      case 'allergies': return validateOptionalStep(draft);
      default: return [];
    }
  };

  const finish = async (final: ProfileDraft) => {
    const result = draftToProfile(final, today);
    if (!result.ok) {
      setMessages(result.issues.map((i) => i.message));
      return;
    }

    setBusy(true);
    const outcome = await profile.finishOnboarding(result.profile, result.weightKg as number);
    setBusy(false);
    if (outcome.kind === 'rejected') setMessages([outcome.message]);
    // Con «ok» o «pending» el estado cambia y Expo Router abre la app solo.
  };

  const advance = async (next: ProfileDraft) => {
    if (last) await finish(next);
    else {
      setIndex(index + 1);
      setMessages([]);
    }
  };

  const onNext = async () => {
    const issues = validate();
    if (issues.length > 0) {
      setMessages(issues.map((i) => i.message));
      return;
    }
    await advance(draft);
  };

  const onSkip = async () => {
    const cleared = { ...draft, ...CLEARED[step.key] };
    setDraft(cleared);
    await advance(cleared);
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Muted testID="wizard-progress">{`Paso ${index + 1} de ${STEPS.length}`}</Muted>
        <Title testID="wizard-title">{step.title}</Title>
        <Muted>{step.intro}</Muted>

        {step.key === 'name' && <NameFields draft={draft} onChange={change} />}
        {step.key === 'birth' && <BirthFields draft={draft} onChange={change} />}
        {step.key === 'body' && <BodyFields draft={draft} onChange={change} />}
        {step.key === 'goal' && <GoalFields draft={draft} onChange={change} />}
        {step.key === 'activity' && <ActivityFields draft={draft} onChange={change} />}
        {step.key === 'experience' && <ExperienceFields draft={draft} onChange={change} />}
        {step.key === 'methodology' && <MethodologyFields draft={draft} onChange={change} />}
        {step.key === 'equipment' && <EquipmentForm />}
        {step.key === 'restrictions' && <RestrictionsManager />}
        {step.key === 'allergies' && <AllergiesFields draft={draft} onChange={change} />}
        {step.key === 'methodology' && METHODOLOGY_OPTIONS.length === 1 && <Muted>Más métodos llegarán más adelante.</Muted>}

        {messages.length > 0 && (
          <View testID="wizard-messages" style={styles.messages}>
            {messages.map((m) => (
              <Body key={m} style={{ color: colors.danger }}>{m}</Body>
            ))}
          </View>
        )}

        <Button title={last ? 'Terminar' : 'Siguiente'} onPress={() => void onNext()} disabled={busy} testID={last ? 'wizard-finish' : 'wizard-next'} />
        {!step.required && <Button title="Omitir" variant="secondary" onPress={() => void onSkip()} disabled={busy} testID="wizard-skip" />}
        {index > 0 && (
          <Button title="Atrás" variant="secondary" onPress={() => { setIndex(index - 1); setMessages([]); }} disabled={busy} testID="wizard-back" />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 10 },
  messages: { gap: 4 },
});
