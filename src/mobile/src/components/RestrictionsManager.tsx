import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDeps } from '../data/DataContext';
import { useCatalog } from '../data/hooks';
import { LEVEL_OPTIONS, humanize, movementsFromCatalog, zonesFromCatalog } from '../data/labels';
import { isDueForReview } from '../data/restrictionService';
import { todayLocal } from '../data/sessionService';
import type { RestrictionItem, RestrictionLevel } from '../data/types';
import { useTheme } from '../theme';
import { Chips } from './Chips';
import { Body, Button, Field, Muted } from './ui';

const emptyForm = { id: undefined as string | undefined, zone: '', movements: [] as string[], level: null as RestrictionLevel | null, reviewOn: '' };

/**
 * Lista y formulario de restricciones (P3), en «Más → Restricciones» y en el asistente (SPEC-profile-001, AC-15 y 18).
 * Se cambian con conexión: la API las aplica al asignar ejercicios. La app no diagnostica ni sustituye a un profesional.
 */
export function RestrictionsManager() {
  const { colors } = useTheme();
  const { restrictions } = useDeps();
  const { sections } = useCatalog();

  const [items, setItems] = useState<RestrictionItem[] | null>(null); // null = aún no cargadas o sin conexión
  const [offline, setOffline] = useState(false);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [messages, setMessages] = useState<string[]>([]);

  const reload = useCallback(async () => {
    const list = await restrictions.list();
    setOffline(list === null);
    if (list) setItems(list);
  }, [restrictions]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const today = todayLocal();
  const zoneOptions = zonesFromCatalog(sections).map((z) => ({ value: z, label: humanize(z) }));
  const movementOptions = movementsFromCatalog(sections).map((m) => ({ value: m, label: humanize(m) }));

  const edit = (item: RestrictionItem) =>
    setForm({ id: item.id, zone: item.zone, movements: item.avoidedMovements, level: item.level, reviewOn: item.reviewOn ?? '' });

  const save = async () => {
    if (!form) return;
    const result = await restrictions.save({
      id: form.id, zone: form.zone, avoidedMovements: form.movements, level: form.level, reviewOn: form.reviewOn,
    });
    if (result.kind === 'ok') {
      setMessages([]);
      setForm(null);
      await reload();
    } else if (result.kind === 'invalid') {
      setMessages(result.issues.map((i) => i.message));
    } else {
      setMessages([result.message]);
    }
  };

  const remove = async (id: string) => {
    const result = await restrictions.remove(id);
    setMessages(result === 'ok' ? [] : [result.message]);
    if (result === 'ok') await reload();
  };

  const toggleMovement = (m: string) =>
    setForm((f) => f && { ...f, movements: f.movements.includes(m) ? f.movements.filter((x) => x !== m) : [...f.movements, m] });

  return (
    <View style={styles.box} testID="restrictions-manager">
      <Muted>
        Indica zonas o movimientos que debes cuidar. La app no diagnostica ni sustituye a un profesional de la salud.
      </Muted>

      {offline && <Body style={{ color: colors.warning }} testID="restrictions-offline">Necesitas conexión para ver y cambiar tus restricciones.</Body>}
      {items?.length === 0 && !form && <Muted>Aún no tienes restricciones.</Muted>}

      {items?.map((item) => (
        <View key={item.id} testID={`restriction-${item.id}`} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Body style={styles.bold}>{humanize(item.zone)}</Body>
          {item.avoidedMovements.length > 0 && <Body>{`Evitar: ${item.avoidedMovements.map(humanize).join(', ')}`}</Body>}
          <Body>{`Nivel: ${LEVEL_OPTIONS.find((l) => l.value === item.level)?.label ?? item.level}`}</Body>
          {item.reviewOn && <Muted>{`Revisar el ${item.reviewOn}`}</Muted>}
          {isDueForReview(item, today) && (
            <Body style={{ color: colors.warning, fontWeight: '600' }} testID={`due-${item.id}`}>Pendiente de revisar</Body>
          )}
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button title="Editar" variant="secondary" testID={`edit-restriction-${item.id}`} onPress={() => edit(item)} />
            </View>
            <View style={styles.flex}>
              <Button title="Borrar" variant="secondary" testID={`delete-restriction-${item.id}`} onPress={() => void remove(item.id)} />
            </View>
          </View>
        </View>
      ))}

      {form ? (
        <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.surface }]} testID="restriction-form">
          <Body style={styles.bold}>Zona</Body>
          <Chips options={zoneOptions} selected={form.zone ? [form.zone] : []} onToggle={(zone) => setForm({ ...form, zone })} testIDPrefix="zone" showHint={false} />

          <Body style={styles.bold}>Movimientos a evitar (opcional)</Body>
          <Chips options={movementOptions} selected={form.movements} onToggle={toggleMovement} testIDPrefix="movement" showHint={false} />

          <Body style={styles.bold}>Nivel</Body>
          <Chips options={LEVEL_OPTIONS} selected={form.level ? [form.level] : []} onToggle={(level) => setForm({ ...form, level: level as RestrictionLevel })} testIDPrefix="level" />

          <Field
            label="Fecha de revisión (AAAA-MM-DD, opcional)"
            value={form.reviewOn}
            onChangeText={(reviewOn) => setForm({ ...form, reviewOn })}
            autoCapitalize="none"
            placeholder="2027-01-15"
          />

          {messages.length > 0 && (
            <View testID="restriction-message" style={styles.messages}>
              {messages.map((m) => (
                <Body key={m} style={{ color: colors.danger }}>{m}</Body>
              ))}
            </View>
          )}
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button title="Guardar restricción" testID="save-restriction" onPress={() => void save()} />
            </View>
            <View style={styles.flex}>
              <Button title="Cancelar" variant="secondary" testID="cancel-restriction" onPress={() => { setForm(null); setMessages([]); }} />
            </View>
          </View>
        </View>
      ) : (
        <>
          {messages.length > 0 && (
            <View testID="restriction-message" style={styles.messages}>
              {messages.map((m) => (
                <Body key={m} style={{ color: colors.danger }}>{m}</Body>
              ))}
            </View>
          )}
          <Button title="Añadir restricción" variant="secondary" testID="add-restriction" onPress={() => { setMessages([]); setForm({ ...emptyForm }); }} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  bold: { fontWeight: '600' },
  messages: { gap: 4 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
