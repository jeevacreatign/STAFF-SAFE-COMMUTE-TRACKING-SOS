import { Text } from 'react-native';
import { Card, KeyValue } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { listFailedNotifications } from '../../services/admin/adminService';
import { typography } from '../../theme';
import { formatDateTime } from '../../utils/time';

const REASONS: Record<string, string> = {
  no_registered_device: 'Recipient has no device registered for notifications',
  DeviceNotRegistered: 'Device uninstalled the app or revoked notifications',
};

export function NotificationFailuresScreen() {
  const { data, error, loading, reload, refresh, refreshing } = useAsync(() => listFailedNotifications(0));
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text style={[typography.bodyMuted, { marginBottom: 12 }]}>
        “Sent” means the push service accepted the message; it does not prove the phone displayed it. Alerts always remain visible in the app.
      </Text>
      {data && data.length === 0 ? <EmptyState title="No delivery problems" /> : null}
      {data?.map((n) => (
        <Card key={n.id} title={n.event_type}>
          <KeyValue label="Status" value={n.delivery_status} />
          <KeyValue label="Created" value={formatDateTime(n.created_at)} />
          <KeyValue label="Attempts" value={String(n.attempts)} />
          <KeyValue label="Reason" value={(n.last_error && (REASONS[n.last_error] ?? n.last_error)) ?? '—'} />
        </Card>
      ))}
    </Screen>
  );
}
