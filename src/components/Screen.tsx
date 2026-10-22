import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';
import { DemoBanner, OfflineBanner } from './Banners';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: React.ReactNode;
  contentStyle?: ViewStyle;
  testID?: string;
}

/** Standard screen: safe area, offline + demo banners, optional pull-to-refresh, sticky footer. */
export function Screen({ children, scroll = true, refreshing, onRefresh, footer, contentStyle, testID }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']} testID={testID}>
      <DemoBanner />
      <OfflineBanner />
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, contentStyle]}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
});
