import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chips } from '../components/Chips';
import { Body, Button, Field, Muted, Title } from '../components/ui';
import { CONTEXT_FREQUENCIES, CONTEXT_TYPES, isActive, looksPersonal, MAX_NOTE } from '../data/contextRules';
import type { RawContextInput } from '../data/contextService';
import { useDeps } from '../data/DataContext';
import { localDate } from '../data/nutritionService';
import type { LocalContextItem } from '../data/types';
import { useTheme } from '../theme';

const TYPE_LABEL: Record<string, string> = { suplemento: 'Suplemento', habito: 'Hábito', medicacion: 'Medicación', nota: 'Nota' };
const FREQUENCY_LABEL: Record<string, string> = {
  diario: 'A diario', dias_alternos: 'Días alternos', semanal: 'Semanal', segun_necesidad: 'Según necesidad',
};
const TYPE_OPTIONS = CONTEXT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }));
const FREQUENCY_OPTIONS = CONTEXT_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }));

const EMPTY: RawContextInput = {
  type: 'suplemento', name: '', brand: '', dose: '', frequency: '', startedOn: '', endedOn: '', note: '', shareWithAi: false,
};

const describe = (i: LocalContextItem) =>
  [TYPE_LABEL[i.type] ?? i.type, i.brand, i.dose, i.frequency ? FREQUENCY_LABEL[i.frequency] : null, i.note].filter(Boolean).join(' · ');

/**
 * Mi contexto (SPEC-profile-002, AC-12, 13 y 15): lo que tomas y haces (suplementos, hábitos, medicación, notas). Sirve por sí mismo; solo lo que
 * marques con «compartir con la IA» llega a la IA, y la medicación nunca. Funciona sin conexión.
 */
export default function ContextScreen() {
  const { colors } = useTheme();
  const { context } = useDeps();
  const [items, setItems] = useState<LocalContextItem[]>([]);
  const [draft, setDraft] = useState<RawContextInput>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const reload = useCallback(async () => setItems(await context.list()), [context]);
  useFocusEffect(useCallback(() => { void context.refresh().then(reload); void reload(); }, [context, reload]));

  const today = localDate();
  const active = items.filter((i) => isActive(i.endedOn, today));
  const ended = items.filter((i) => !isActive(i.endedOn, today));
  const set = (patch: Partial<RawContextInput>) => setDraft((d) => ({ ...d, ...patch }));
  const isMedication = draft.type === 'medicacion';
  const isNote = draft.type === 'nota';
  const personalWarning = isNote && (looksPersonal(draft.note) || looksPersonal(draft.name));

  const save = async () => {
    const result = await context.save(draft, editing ?? undefined);
    if (!result.ok) {
      setIssues(result.issues.map((i) => i.message));
      return;
    }
    setIssues([]);
    setDraft(EMPTY);
    setEditing(null);
    await reload();
  };

  const edit = (i: LocalContextItem) => {
    setEditing(i.id);
    setIssues([]);
    setDraft({
      type: i.type, name: i.name, brand: i.brand ?? '', dose: i.dose ?? '', frequency: i.frequency ?? '', startedOn: i.startedOn ?? '',
      endedOn: i.endedOn ?? '', note: i.note ?? '', shareWithAi: i.shareWithAi,
    });
  };

  const row = (i: LocalContextItem) => (
    <View key={i.id} testID={`context-${i.id}`} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Body>{i.name}</Body>
      <Muted>{describe(i)}</Muted>
      <Muted>
        {i.type === 'medicacion' ? 'Solo para ti: nunca se comparte con la IA' : i.shareWithAi ? 'Compartido con la IA' : 'No se comparte con la IA'}
      </Muted>
      {i.status === 'rejected' && <Body style={{ color: colors.danger }}>{`No se pudo guardar en tu cuenta: ${i.message ?? 'rechazado'}`}</Body>}
      {i.status === 'pending' && <Muted>Pendiente de enviar</Muted>}
      <View style={styles.row}>
        <View style={styles.flex}><Button title="Editar" variant="secondary" testID={`context-edit-${i.id}`} onPress={() => edit(i)} /></View>
        {isActive(i.endedOn, today)
          ? <View style={styles.flex}><Button title="Dar de baja" variant="secondary" testID={`context-end-${i.id}`} onPress={() => void context.end(i.id).then(reload)} /></View>
          : <View style={styles.flex}><Button title="Reactivar" variant="secondary" testID={`context-reactivate-${i.id}`} onPress={() => void context.reactivate(i.id).then(reload)} /></View>}
        <View style={styles.flex}>
          <Button
            title="Borrar" variant="danger" testID={`context-delete-${i.id}`}
            onPress={() => void (i.status === 'rejected' ? context.discard(i.id) : context.remove(i.id)).then(reload)}
          />
        </View>
      </View>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>Mi contexto</Title>
      <Muted>
        Anota lo que tomas y haces, por ejemplo «Creatina, marca X, 5 g, a diario». Es tuyo y te sirve aunque no uses la IA. Solo lo que marques con
        «compartir con la IA» se usa cuando le pides que use tus datos; la medicación nunca. No sustituye a un profesional de la salud.
      </Muted>

      <Title>Activas</Title>
      {active.length === 0 ? <Muted testID="context-empty">Todavía no has anotado nada.</Muted> : active.map(row)}
      {ended.length > 0 && <Title>De baja</Title>}
      {ended.map(row)}

      <Title>{editing ? 'Editar entrada' : 'Añadir'}</Title>
      <Chips options={TYPE_OPTIONS} selected={[draft.type]} onToggle={(type) => set({ type })} testIDPrefix="context-type" showHint={false} />
      <Field label="Nombre" value={draft.name} onChangeText={(name) => set({ name })} maxLength={60} />
      {!isNote && (
        <>
          <Field label="Marca (opcional)" value={draft.brand} onChangeText={(brand) => set({ brand })} maxLength={40} />
          <Field label="Dosis (opcional)" value={draft.dose} onChangeText={(dose) => set({ dose })} maxLength={40} />
          <Muted>Frecuencia (opcional)</Muted>
          <Chips
            options={FREQUENCY_OPTIONS} selected={draft.frequency ? [draft.frequency] : []}
            onToggle={(f) => set({ frequency: draft.frequency === f ? '' : f })} testIDPrefix="context-frequency" showHint={false}
          />
        </>
      )}
      {isNote && (
        <>
          <Field label="Texto de la nota" value={draft.note} onChangeText={(note) => set({ note })} maxLength={MAX_NOTE} multiline />
          <Muted testID="context-note-help">No escribas nombres, ubicaciones ni datos clínicos detallados: solo lo que ayude a entrenar o comer mejor.</Muted>
          {personalWarning && (
            <Body testID="context-personal-warning" style={{ color: colors.warning }}>
              Parece un dato personal (correo, teléfono o enlace). Quítalo antes de guardar.
            </Body>
          )}
        </>
      )}
      <Field label="Desde (AAAA-MM-DD, opcional)" value={draft.startedOn} onChangeText={(startedOn) => set({ startedOn })} />

      {isMedication ? (
        <Muted testID="context-medication-note">La medicación se guarda solo para ti y nunca se comparte con la IA.</Muted>
      ) : (
        <Button
          title={draft.shareWithAi ? 'Compartir con la IA: activado' : 'Compartir con la IA: desactivado'}
          variant={draft.shareWithAi ? 'primary' : 'secondary'} testID="context-share" onPress={() => set({ shareWithAi: !draft.shareWithAi })}
        />
      )}

      {issues.length > 0 && (
        <View testID="context-issues" style={styles.issues}>
          {issues.map((m) => <Body key={m} style={{ color: colors.danger }}>{m}</Body>)}
        </View>
      )}
      <View style={styles.row}>
        <View style={styles.flex}><Button title="Guardar" testID="context-save" onPress={() => void save()} /></View>
        {editing && (
          <View style={styles.flex}>
            <Button title="Cancelar" variant="secondary" testID="context-cancel" onPress={() => { setEditing(null); setDraft(EMPTY); setIssues([]); }} />
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  issues: { gap: 4 },
});
