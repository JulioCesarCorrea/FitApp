import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Button, FlatList, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { apiConfigured, postWeight } from './src/api';
import { openStore } from './src/db';
import { Scanner } from './src/Scanner';
import { syncPending, type LocalWeight } from './src/sync';

type Store = Awaited<ReturnType<typeof openStore>>;

const STATUS_LABEL = { pending: 'pendiente', synced: 'sincronizado', rejected: 'rechazado' } as const;

export default function App() {
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
    await store.current.add(kg); // AC-01: solo SQLite local
    setInput('');
    await refresh();
    await sync(); // intento inmediato; si falla, queda pendiente
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.title}>Spike: registro de peso</Text>
        {!apiConfigured && <Text style={styles.warn}>Falta EXPO_PUBLIC_API_URL / EXPO_PUBLIC_DEV_USER_ID</Text>}

        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            keyboardType="decimal-pad"
            placeholder="Peso en kg"
          />
          <Button title="Guardar" onPress={save} />
        </View>
        <Button title="Sincronizar ahora" onPress={sync} />
        {message !== '' && <Text style={styles.msg}>{message}</Text>}

        <FlatList
          style={styles.list}
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <Text style={styles.item}>
              {`${item.weightKg} kg · ${STATUS_LABEL[item.status]}${item.error ? ` (${item.error})` : ''}`}
            </Text>
          )}
          ListEmptyComponent={<Text>Sin registros todavía.</Text>}
        />

        <Scanner />
        <StatusBar style="auto" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, padding: 16, gap: 10 },
  title: { fontSize: 20, fontWeight: '700' },
  warn: { color: '#b45309' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: '#999', borderRadius: 6, padding: 8 },
  msg: { color: '#374151' },
  list: { flex: 1 },
  item: { paddingVertical: 4 },
});
