import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';

export const SOS_HOLD_MS = 1500;

interface Props {
  onActivate: () => void;
  disabled?: boolean;
  /** Screen readers: a double-tap opens a confirmation instead of requiring a hold. */
  onAccessibleActivate: () => void;
}

/**
 * Press and hold to raise an SOS (prevents pocket / accidental taps). No animation library: the
 * progress fill is a plain width update so nothing can delay activation.
 */
export function SOSButton({ onActivate, disabled, onAccessibleActivate }: Props) {
  const [progress, setProgress] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const onPressIn = () => {
    if (disabled) return;
    fired.current = false;
    startedAt.current = Date.now();
    clear();
    timer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - startedAt.current) / SOS_HOLD_MS);
      setProgress(p);
      if (p >= 1 && !fired.current) {
        fired.current = true;
        clear();
        onActivate();
      }
    }, 50);
  };
  const onPressOut = () => {
    clear();
    if (!fired.current) setProgress(0);
  };

  return (
    <Pressable
      testID="sos-button"
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="SOS emergency alert"
      accessibilityHint="Press and hold for one and a half seconds to alert the school safety team. Screen reader users can double tap to open a confirmation."
      accessibilityActions={[{ name: 'activate', label: 'Raise SOS' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && onAccessibleActivate()}
      style={[styles.button, disabled && styles.disabled]}
    >
      <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
      <Text style={styles.title}>SOS</Text>
      <Text style={styles.sub}>{progress > 0 && progress < 1 ? 'Keep holding…' : 'Press and hold for help'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 96,
    borderRadius: radius.lg,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: colors.dangerDark,
    marginBottom: spacing.md,
  },
  disabled: { opacity: 0.5 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.dangerDark },
  title: { color: '#FFFFFF', fontSize: 34, fontWeight: '900', letterSpacing: 2 },
  sub: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
