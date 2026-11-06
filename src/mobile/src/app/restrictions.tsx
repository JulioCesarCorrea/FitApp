import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { RestrictionsManager } from '../components/RestrictionsManager';
import { Title } from '../components/ui';

/** «Más → Restricciones» (SPEC-profile-001, AC-18). */
export default function RestrictionsScreen() {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Title>Mis restricciones</Title>
        <RestrictionsManager />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 10 },
});
