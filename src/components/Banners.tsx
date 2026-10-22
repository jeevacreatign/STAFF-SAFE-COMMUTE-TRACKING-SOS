import { StyleSheet, Text, View } from 'react-native';
import { config } from '../constants/config';
import { useNetwork } from '../context/NetworkContext';
import { colors, spacing } from '../theme';

export function OfflineBanner() {
  const { online } = useNetwork();
  if (online !== false) return null;
  return (
    <View style={[styles.banner, styles.offline]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="offline-banner">
      <Text style={styles.offlineText}>You are offline. Nothing is confirmed as sent until the connection returns.</Text>
    </View>
  );
}

export function DemoBanner() {
  if (!config.demoMode) return null;
  return (
    <View style={[styles.banner, styles.demo]} testID="demo-banner">
      <Text style={styles.demoText}>DEMO MODE · development build · synthetic data only</Text>
    </View>
  );
}

/** Unmistakable indicator that this device is sharing location for an approved journey. */
export function SharingActiveBanner({ label }: { label: string }) {
  return (
    <View style={[styles.banner, styles.sharing]} accessibilityRole="summary" accessibilityLabel={`Location sharing active for ${label}`} testID="sharing-active-banner">
      <View style={styles.dot} />
      <Text style={styles.sharingText}>Location Sharing Active</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  offline: { backgroundColor: colors.warningBg, borderBottomWidth: 1, borderColor: colors.warningBorder },
  offlineText: { color: colors.warning, fontWeight: '600', fontSize: 14, flex: 1 },
  demo: { backgroundColor: '#5B2A86' },
  demoText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12, textAlign: 'center', flex: 1 },
  sharing: { backgroundColor: colors.safe, borderRadius: 12, marginBottom: spacing.md, paddingVertical: spacing.md },
  sharingText: { color: '#FFFFFF', fontWeight: '800', fontSize: 17 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFFFFF', marginRight: spacing.sm },
});
