import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, radius, spacing, typography, TOUCH_TARGET } from '../theme';

export function ToggleRow({ label, description, value, onValueChange, disabled }: {
  label: string; description?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <Text style={typography.label}>{label}</Text>
        {description ? <Text style={typography.small}>{description}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={label}
        trackColor={{ true: colors.safe, false: colors.border }} />
    </View>
  );
}

export function Chips<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: string }[]; value: T | undefined; onChange: (v: T) => void; label: string;
}) {
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} accessibilityRole="radio"
            accessibilityState={{ selected }} accessibilityLabel={o.label}
            style={[styles.chip, selected && styles.chipSelected]}>
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ListRow({ title, subtitle, right, onPress, testID, accessibilityLabel }: {
  title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; testID?: string; accessibilityLabel?: string;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} testID={testID} accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? title} style={({ pressed }) => [styles.row, pressed && onPress ? { opacity: 0.8 } : null]}>
      <View style={styles.flex}>
        <Text style={typography.label} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={typography.small} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md, minHeight: TOUCH_TARGET },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.navy, backgroundColor: colors.navyLight },
  chipText: { color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: colors.navy },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, minHeight: TOUCH_TARGET + 8,
  },
});
