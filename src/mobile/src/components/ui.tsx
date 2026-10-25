import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, type TextProps } from 'react-native';
import { useTheme } from '../theme';

export function Body(props: TextProps) {
  const { colors } = useTheme();
  return <Text {...props} style={[{ color: colors.text, fontSize: 16 }, props.style]} />;
}

export function Muted(props: TextProps) {
  const { colors } = useTheme();
  return <Text {...props} style={[{ color: colors.textMuted, fontSize: 14 }, props.style]} />;
}

export function Title(props: TextProps) {
  const { colors } = useTheme();
  return <Text {...props} accessibilityRole="header" style={[{ color: colors.text, fontSize: 22, fontWeight: '700' }, props.style]} />;
}

export function Button({
  title, onPress, disabled, variant = 'primary', testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  testID?: string;
}) {
  const { colors } = useTheme();
  const background = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.surface;
  const color = variant === 'secondary' ? colors.text : variant === 'danger' ? colors.background : colors.primaryText;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: background, borderColor: colors.border, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={{ color, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return (
    <>
      <Muted>{label}</Muted>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        {...props}
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }, props.style]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16 },
});
