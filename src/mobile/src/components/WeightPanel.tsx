import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { apiConfigured, postWeight } from '../api';
import { openStore } from '../db';
import { syncPending, type LocalWeight } from '../sync';
import { Body, Button, Field, Muted, Title } from './ui';

type Store = Awaited<ReturnType<typeof openStore>>;

const STATUS_LABEL = { pending: 'pendiente', synced: 'sincronizado', rejected: 'rechazado' } as const;

/** Registro de peso del spike (SPEC-mobile-001): guarda en local y sincroniza. */
export function WeightPanel() {
  const store = useRef<Store | null>(null);
  const [rows, setRows] = useState<LocalWeight[]>([]);
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => setRows((await store.current?.listAll()) ?? []), []);

  const sync = useCallback(async () => {
    if (!store.current) return;
    const s = await syncPending(store.current, postWeight);
    setMessage(
      s.stoppedByError
        ? `Sin conexión o error del servidor: quedan pendientes (enviados ${s.synced}).`
        : `Enviados ${s.synced}, rechazados ${s.rejected}.`,
    );
    await refresh();
  }, [refresh]);

  useEffect(() => {
    openStore().then(async (s) => {
      store.current = s;
      await refresh();
    });
  }, [refresh]);

  const save = async () => {
    const kg = Number(input.replace(',', '.'));
    if (!store.current || !Number.isFinite(kg)) {
      Alert.alert('Peso inválido', 'Escribe un número, por ejemplo 80.5');
      return;
    }
    await store.current.add(kg); // AC-mobile-001-01: solo SQLite local
    setInput('');
    await refresh();
    await sync(); // intento inmediato; si falla, queda pendiente
  };

  return (
    <View style={styles.box}>
      <Title>Registro de peso</Title>
      {!apiConfigured && <Muted>Falta EXPO_PUBLIC_API_URL</Muted>}
      <Field label="Peso en kg" value={input} onChangeText={setInput} keyboardType="decimal-pad" placeholder="80.5" />
      <Button title="Guardar peso" onPress={save} />
      <Button title="Sincronizar ahora" onPress={sync} variant="secondary" />
      {message !== '' && <Muted>{message}</Muted>}
      <FlatList
        scrollEnabled={false}
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <Body>{`${item.weightKg} kg · ${STATUS_LABEL[item.status]}${item.error ? ` (${item.error})` : ''}`}</Body>
        )}
        ListEmptyComponent={<Muted>Sin registros todavía.</Muted>}
      />
    </View>
  );
}

const styles = StyleSheet.create({ box: { gap: 8 } });
