import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme';
import { AppButton } from './AppButton';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.navy} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Text style={styles.title}>Couldn’t load this</Text>
      <Text style={styles.muted}>{message}</Text>
      {onRetry ? <AppButton title="Try again" onPress={onRetry} variant="secondary" style={styles.btn} /> : null}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.muted}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  title: { ...typography.heading, textAlign: 'center' },
  muted: { ...typography.bodyMuted, textAlign: 'center' },
  btn: { marginTop: spacing.md, alignSelf: 'stretch' },
});
