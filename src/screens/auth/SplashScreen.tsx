import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../theme';

export function SplashScreen() {
  return (
    <View style={styles.wrap} testID="splash">
      <Text style={styles.title} accessibilityRole="header">Staff Safe Commute</Text>
      <Text style={styles.sub}>Consent-first journey sharing and SOS</Text>
      <ActivityIndicator color="#FFFFFF" style={{ marginTop: spacing.xl }} accessibilityLabel="Loading" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '800' },
  sub: { color: '#C9D3E6', fontSize: 16, marginTop: spacing.sm, textAlign: 'center' },
});
