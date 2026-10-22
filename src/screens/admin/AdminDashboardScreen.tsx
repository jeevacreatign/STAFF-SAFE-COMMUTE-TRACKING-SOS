import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { SosStatusBadge } from '../../components/Badges';
import { Card } from '../../components/Card';
import { ListRow } from '../../components/Controls';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/States';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeTable } from '../../hooks/useRealtime';
import { getDashboardSummary, listSosAlerts } from '../../services/admin/adminService';
import { notificationPermissionStatus, registerForPush } from '../../services/notifications/notificationService';
import { colors, radius, shadow, spacing, typography } from '../../theme';
import type { DashboardSummary, SosAlertWithEmployee } from '../../types/db';
import type { AdminStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';
import { formatAge, formatTime } from '../../utils/time';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

function Stat({ label, value, tone, onPress, testID }: { label: string; value: number; tone?: 'danger' | 'safe' | 'warning'; onPress?: () => void; testID?: string }) {
  const color = tone === 'danger' ? colors.danger : tone === 'safe' ? colors.safe : tone === 'warning' ? colors.warning : colors.navy;
  return (
    <Pressable onPress={onPress} style={styles.stat} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

export function AdminDashboardScreen() {
  const navigation = useNavigation<Nav>();
  const { profile } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [newAlerts, setNewAlerts] = useState<SosAlertWithEmployee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notifStatus, setNotifStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, a] = await Promise.all([getDashboardSummary(), listSosAlerts(['new'], 0)]);
      setSummary(s);
      setNewAlerts(a);
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    void notificationPermissionStatus().then(setNotifStatus);
  }, [load]));
  useEffect(() => {
    // Admins need SOS pushes; register (without prompting) whenever the dashboard opens.
    void registerForPush(false);
  }, []);

  useRealtimeTable('admin-dash-sos', 'sos_alerts', () => void load(), load, undefined, !!profile);
  useRealtimeTable('admin-dash-journeys', 'journeys', () => void load(), load, undefined, !!profile);

  if (!summary && !error) return <LoadingState label="Loading dashboard…" />;
  if (!summary && error) return <ErrorState message={error} onRetry={load} />;

  return (
    <Screen refreshing={refreshing} onRefresh={load} testID="admin-dashboard">
      {newAlerts.length > 0 ? (
        <Card tone="danger" title={`${newAlerts.length} new SOS alert${newAlerts.length > 1 ? 's' : ''}`}>
          {newAlerts.slice(0, 5).map((a) => (
            <ListRow key={a.id} title={a.employee?.full_name ?? 'Staff member'} subtitle={`Raised ${formatTime(a.created_at)} (${formatAge(a.created_at)})`}
              right={<SosStatusBadge status={a.alert_status} />} onPress={() => navigation.navigate('SOSDetail', { alertId: a.id })} testID={`new-sos-${a.id}`} />
          ))}
        </Card>
      ) : null}

      {notifStatus && notifStatus !== 'granted' ? (
        <Card tone="warning" title="SOS notifications are off on this phone">
          <Text style={typography.body}>You will only see new alerts while this app is open.</Text>
          <AppButton title="Allow notifications" variant="secondary" style={{ marginTop: spacing.md }}
            onPress={async () => { await registerForPush(true); setNotifStatus(await notificationPermissionStatus()); }} />
        </Card>
      ) : null}

      {summary ? (
        <View style={styles.grid}>
          <Stat label="Active journeys" value={summary.active_journeys} onPress={() => navigation.navigate('AdminTabs', { screen: 'Journeys' })} testID="stat-active" />
          <Stat label="Open SOS" value={summary.open_sos} tone={summary.open_sos > 0 ? 'danger' : undefined} onPress={() => navigation.navigate('AdminTabs', { screen: 'Alerts' })} testID="stat-sos" />
          <Stat label="Safely completed today" value={summary.safely_completed_today} tone="safe" />
          <Stat label="Expired today" value={summary.expired_today} tone={summary.expired_today > 0 ? 'warning' : undefined} />
        </View>
      ) : null}
      {summary && summary.failed_notifications_24h > 0 ? (
        <ListRow title={`${summary.failed_notifications_24h} notification(s) failed in 24 h`} subtitle="Review delivery problems"
          onPress={() => navigation.navigate('NotificationFailures')} />
      ) : null}

      <AppButton title="Open live map" onPress={() => navigation.navigate('LiveMap')} style={{ marginTop: spacing.md }} />
      {summary ? <Text style={[typography.small, { marginTop: spacing.md }]}>Updated {formatTime(summary.generated_at)}. Counts cover only your assigned schools.</Text> : null}
      {error ? <Text style={{ color: colors.danger, marginTop: spacing.sm }}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadow },
  statValue: { fontSize: 32, fontWeight: '800' },
  statLabel: { ...typography.small, marginTop: 4 },
});
