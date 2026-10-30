import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { EquipmentForm } from '../../components/EquipmentForm';
import { Muted, Title } from '../../components/ui';

/** Perfil de equipamiento: pesos que existen en tu gimnasio (AC-mobile-002-04). */
export default function EquipmentScreen() {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Title>Mi equipo</Title>
        <Muted>Con estos pesos la app calcula la siguiente carga de cada ejercicio.</Muted>
        <EquipmentForm />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 8 },
});
