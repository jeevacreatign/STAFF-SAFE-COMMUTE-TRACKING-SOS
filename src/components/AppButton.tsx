import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, radius, spacing, TOUCH_TARGET } from '../theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'safe' | 'ghost';

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
  testID?: string;
}

const palette: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.navy, fg: colors.onPrimary, border: colors.navy },
  secondary: { bg: colors.surface, fg: colors.navy, border: colors.navy },
  danger: { bg: colors.danger, fg: colors.onDanger, border: colors.danger },
  safe: { bg: colors.safe, fg: '#FFFFFF', border: colors.safe },
  ghost: { bg: 'transparent', fg: colors.navy, border: 'transparent' },
};

export function AppButton({ title, onPress, variant = 'primary', loading, disabled, accessibilityLabel, accessibilityHint, style, testID }: Props) {
  const p = palette[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: p.bg, borderColor: p.border, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={p.fg} /> : <Text style={[styles.text, { color: p.fg }]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 16, fontWeight: '700' },
});
