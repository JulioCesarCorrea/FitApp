import { View } from 'react-native';
import {
  ACTIVITY_OPTIONS, EXPERIENCE_OPTIONS, GOAL_OPTIONS, METHODOLOGY_OPTIONS, SEX_OPTIONS,
} from '../data/labels';
import type { ProfileDraft } from '../data/profileForms';
import { Chips } from './Chips';
import { Field, Muted } from './ui';

interface FieldsProps {
  draft: ProfileDraft;
  onChange: (patch: Partial<ProfileDraft>) => void;
}

// Los campos del perfil, por grupos. El asistente los muestra de uno en uno y «Perfil» todos juntos (SPEC-profile-001).

export function NameFields({ draft, onChange }: FieldsProps) {
  return (
    <Field label="Nombre o apodo" value={draft.displayName} onChangeText={(displayName) => onChange({ displayName })} autoCorrect={false} />
  );
}

export function BirthFields({ draft, onChange }: FieldsProps) {
  return (
    <View style={{ gap: 8 }}>
      <Muted>Sexo</Muted>
      <Chips
        options={SEX_OPTIONS}
        selected={draft.sex ? [draft.sex] : []}
        onToggle={(value) => onChange({ sex: value as ProfileDraft['sex'] })}
        testIDPrefix="sex"
      />
      <Field
        label="Fecha de nacimiento (AAAA-MM-DD)"
        value={draft.birthDate}
        onChangeText={(birthDate) => onChange({ birthDate })}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="1995-05-20"
      />
    </View>
  );
}

export function BodyFields({ draft, onChange, withWeight = true }: FieldsProps & { withWeight?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      <Field label="Estatura en cm" value={draft.height} onChangeText={(height) => onChange({ height })} keyboardType="number-pad" placeholder="178" />
      {withWeight && (
        <Field label="Peso actual en kg" value={draft.weight} onChangeText={(weight) => onChange({ weight })} keyboardType="decimal-pad" placeholder="80.5" />
      )}
    </View>
  );
}

export function GoalFields({ draft, onChange }: FieldsProps) {
  return (
    <Chips
      options={GOAL_OPTIONS}
      selected={draft.goal ? [draft.goal] : []}
      onToggle={(value) => onChange({ goal: value as ProfileDraft['goal'] })}
      testIDPrefix="goal"
    />
  );
}

export function ActivityFields({ draft, onChange }: FieldsProps) {
  return (
    <Chips
      options={ACTIVITY_OPTIONS}
      selected={draft.activityLevel ? [draft.activityLevel] : []}
      onToggle={(value) => onChange({ activityLevel: draft.activityLevel === value ? null : (value as ProfileDraft['activityLevel']) })}
      testIDPrefix="activity"
    />
  );
}

export function ExperienceFields({ draft, onChange }: FieldsProps) {
  return (
    <View style={{ gap: 8 }}>
      <Muted>Experiencia entrenando</Muted>
      <Chips
        options={EXPERIENCE_OPTIONS}
        selected={draft.experienceLevel ? [draft.experienceLevel] : []}
        onToggle={(value) => onChange({ experienceLevel: draft.experienceLevel === value ? null : (value as ProfileDraft['experienceLevel']) })}
        testIDPrefix="experience"
      />
      <Field
        label="Días de entrenamiento por semana (de 1 a 7)"
        value={draft.daysPerWeek}
        onChangeText={(daysPerWeek) => onChange({ daysPerWeek })}
        keyboardType="number-pad"
        placeholder="4"
      />
    </View>
  );
}

export function MethodologyFields({ draft, onChange }: FieldsProps) {
  return (
    <Chips
      options={METHODOLOGY_OPTIONS}
      selected={[draft.methodology]}
      onToggle={(methodology) => onChange({ methodology })}
      testIDPrefix="methodology"
    />
  );
}

export function AllergiesFields({ draft, onChange }: FieldsProps) {
  return (
    <Field
      label="Alergias o preferencias de comida (separadas por comas)"
      value={draft.allergies}
      onChangeText={(allergies) => onChange({ allergies })}
      placeholder="nueces, lactosa"
    />
  );
}
