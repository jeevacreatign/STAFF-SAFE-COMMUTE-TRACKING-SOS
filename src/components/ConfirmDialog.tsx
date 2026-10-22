import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { AppButton } from './AppButton';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger' | 'safe';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export function ConfirmDialog({ visible, title, message, confirmLabel, cancelLabel = 'Cancel', tone = 'primary', loading, onConfirm, onCancel, children }: Props) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal accessibilityRole="alert">
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {children}
          <View style={styles.actions}>
            <AppButton title={confirmLabel} variant={tone} onPress={onConfirm} loading={loading} testID="confirm-dialog-confirm" />
            <AppButton title={cancelLabel} variant="ghost" onPress={onCancel} disabled={loading} testID="confirm-dialog-cancel" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,20,40,0.55)', justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
  title: { ...typography.title, fontSize: 21, marginBottom: spacing.sm },
  message: { ...typography.body, marginBottom: spacing.lg },
  actions: { gap: spacing.sm },
});
