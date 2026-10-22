import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, shadow, spacing, typography } from '../theme';

export function Card({ title, children, style, tone }: { title?: string; children: React.ReactNode; style?: ViewStyle; tone?: 'danger' | 'warning' | 'safe' }) {
  const toneStyle = tone === 'danger'
    ? { borderColor: colors.danger, backgroundColor: colors.dangerLight }
    : tone === 'warning'
      ? { borderColor: colors.warningBorder, backgroundColor: colors.warningBg }
      : tone === 'safe'
        ? { borderColor: colors.safe, backgroundColor: colors.safeLight }
        : null;
  return (
    <View style={[styles.card, toneStyle, style]}>
      {title ? <Text style={styles.title} accessibilityRole="header">{title}</Text> : null}
      {children}
    </View>
  );
}

export function KeyValue({ label, value, testID }: { label: string; value: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.kv} testID={testID}>
      <Text style={styles.k}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? <Text style={styles.v}>{value}</Text> : value}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow,
  },
  title: { ...typography.heading, marginBottom: spacing.sm },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: spacing.md },
  k: { ...typography.small, flexShrink: 0 },
  v: { ...typography.body, fontSize: 15, flexShrink: 1, textAlign: 'right' },
});
