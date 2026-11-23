import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chips } from '../components/Chips';
import { Body, Button, Field, Muted, Title } from '../components/ui';
import { useDeps } from '../data/DataContext';
import { MEAL_KEYS, WEEKDAYS, type ReminderKind, type ReminderPrefs } from '../data/reminderService';
import { useTheme } from '../theme';

const KIND_TITLE: Record<ReminderKind, string> = { training: 'Entrenar', meals: 'Registrar comidas', weight: 'Pesarte' };
const DAY_OPTIONS = WEEKDAYS.map((d) => ({ value: String(d.value), label: d.label }));

/** Recordatorios (SPEC-notify-001): avisos locales de entrenar, comidas y peso; sin servidor ni datos que salgan del teléfono. */
export default function RemindersScreen() {
  const { colors } = useTheme();
  const { reminders } = useDeps();
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useFocusEffect(useCallback(() => { void reminders.getPrefs().then(setPrefs); }, [reminders]));

  if (!prefs) return null;

  const toggle = async (kind: ReminderKind) => {
    const result = await reminders.setEnabled(kind, !prefs[kind].enabled);
    setMessages(result.ok ? [] : [result.message]);
    setPrefs(await reminders.getPrefs());
  };

  const save = async () => {
    const issues = await reminders.savePrefs(prefs);
    setMessages(issues.map((i) => i.message));
    setSaved(issues.length === 0);
  };

  const change = (next: ReminderPrefs) => { setPrefs(next); setSaved(false); };

  const Switch = ({ kind }: { kind: ReminderKind }) => (
    <Button
      title={prefs[kind].enabled ? 'Activado: tocar para desactivar' : 'Desactivado: tocar para activar'}
      variant={prefs[kind].enabled ? 'primary' : 'secondary'}
      testID={`reminder-${kind}`}
      onPress={() => void toggle(kind)}
    />
  );

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>Recordatorios</Title>
      <Muted>Se programan en este teléfono. Los avisos no incluyen datos personales y no se envían a ningún servidor. Si ya registraste algo hoy, no te avisan de lo mismo.</Muted>

      <View style={styles.block}>
        <Title>{KIND_TITLE.training}</Title>
        <Switch kind="training" />
        <Muted>Días</Muted>
        <Chips
          options={DAY_OPTIONS}
          selected={prefs.training.days.map(String)}
          onToggle={(v) => {
            const day = Number(v);
            const days = prefs.training.days.includes(day) ? prefs.training.days.filter((d) => d !== day) : [...prefs.training.days, day].sort();
            change({ ...prefs, training: { ...prefs.training, days } });
          }}
          testIDPrefix="training-day"
          showHint={false}
        />
        <Field label="Hora de entrenar (HH:MM)" value={prefs.training.time} onChangeText={(time) => change({ ...prefs, training: { ...prefs.training, time } })} />
      </View>

      <View style={styles.block}>
        <Title>{KIND_TITLE.meals}</Title>
        <Switch kind="meals" />
        {MEAL_KEYS.map((meal) => (
          <Field
            key={meal}
            label={`Hora de ${meal} (HH:MM, vacío = sin aviso)`}
            value={prefs.meals.times[meal] ?? ''}
            onChangeText={(time) => change({ ...prefs, meals: { ...prefs.meals, times: { ...prefs.meals.times, [meal]: time === '' ? null : time } } })}
          />
        ))}
      </View>

      <View style={styles.block}>
        <Title>{KIND_TITLE.weight}</Title>
        <Switch kind="weight" />
        <Muted>Día de la semana</Muted>
        <Chips
          options={DAY_OPTIONS}
          selected={[String(prefs.weight.day)]}
          onToggle={(v) => change({ ...prefs, weight: { ...prefs.weight, day: Number(v) } })}
          testIDPrefix="weight-day"
          showHint={false}
        />
        <Field label="Hora de pesarte (HH:MM)" value={prefs.weight.time} onChangeText={(time) => change({ ...prefs, weight: { ...prefs.weight, time } })} />
      </View>

      {messages.map((m) => (
        <Body key={m} style={{ color: colors.danger }} testID="reminder-message">{m}</Body>
      ))}
      <Button title="Guardar horarios" testID="save-reminders" onPress={() => void save()} />
      {saved && <Body style={{ color: colors.success }} testID="reminders-saved">Horarios guardados.</Body>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  block: { gap: 8 },
});
