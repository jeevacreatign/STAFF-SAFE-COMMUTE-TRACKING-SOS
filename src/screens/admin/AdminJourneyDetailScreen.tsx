import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { FreshnessBadge, JourneyStatusBadge, SosStatusBadge } from '../../components/Badges';
import { Card, KeyValue } from '../../components/Card';
import { ListRow } from '../../components/Controls';
import { MapPanel } from '../../components/MapPanel';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { useNow } from '../../hooks/useNow';
import { useRealtimeTable } from '../../hooks/useRealtime';
import { getJourneyDetail } from '../../services/admin/adminService';
import { spacing, typography } from '../../theme';
import type { AdminStackParamList } from '../../types/navigation';
import { freshnessOf } from '../../utils/freshness';
import { formatAge, formatDateTime, formatRemaining, formatTime } from '../../utils/time';
import { endReasonLabel } from '../staff/JourneyDetailsScreen';

type Props = NativeStackScreenProps<AdminStackParamList, 'AdminJourneyDetail'>;

export function AdminJourneyDetailScreen({ route, navigation }: Props) {
  const { journeyId } = route.params;
  const now = useNow(1000);
  // Every open of this screen is written to the audit log by the server function.
  const { data, error, loading, reload, refresh, refreshing } = useAsync(() => getJourneyDetail(journeyId), journeyId);
  useRealtimeTable(`admin-journey-${journeyId}`, 'journeys', () => void refresh(), refresh, `id=eq.${journeyId}`);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return null;
  const j = data.journey;
  const live = j.status === 'active' && Date.parse(j.expires_at) > now;
  const freshness = freshnessOf(j.last_observed_at, now);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Card title={data.employee.full_name}>
        <View style={styles.badges}><JourneyStatusBadge status={j.status} />{live ? <FreshnessBadge freshness={freshness} /> : null}</View>
        {data.employee.employee_ref ? <KeyValue label="Staff ID" value={data.employee.employee_ref} /> : null}
        <KeyValue label="Journey" value={j.label} />
        <KeyValue label="Destination" value={j.destination_label ?? '—'} />
        <KeyValue label="Started sharing" value={formatDateTime(j.sharing_started_at)} />
        <KeyValue label="Expected arrival" value={formatDateTime(j.estimated_arrival_at)} />
        <KeyValue label={live ? 'Expires in' : 'Expiry'} value={live ? formatRemaining(j.expires_at, now) : formatDateTime(j.expires_at)} />
        {!live ? <KeyValue label="Ended" value={formatDateTime(j.ended_at)} /> : null}
        {j.end_reason ? <KeyValue label="End reason" value={endReasonLabel[j.end_reason]} /> : null}
        {j.safe_arrival_at ? <KeyValue label="Safe arrival" value={formatDateTime(j.safe_arrival_at)} /> : null}
      </Card>

      {live ? (
        <>
          <MapPanel
            emptyText="No location received yet for this journey."
            points={j.last_latitude != null && j.last_longitude != null ? [{
              id: j.id, latitude: j.last_latitude, longitude: j.last_longitude, accuracyM: j.last_accuracy_m,
              title: data.employee.full_name, description: `Updated ${formatTime(j.last_observed_at)}`, freshness,
            }] : []}
          />
          <Card title="Location">
            <KeyValue label="Last observed" value={j.last_observed_at ? `${formatTime(j.last_observed_at)} (${formatAge(j.last_observed_at, now)})` : 'None'} />
            <KeyValue label="Accuracy" value={j.last_accuracy_m != null ? `± ${Math.round(j.last_accuracy_m)} m` : '—'} />
            <KeyValue label="Points in last 50" value={String(data.recent_locations.length)} />
            {freshness === 'stale' ? <Text style={[typography.body, { marginTop: spacing.sm }]}>This position is old and is not a live location.</Text> : null}
          </Card>
        </>
      ) : (
        <Card><Text style={typography.bodyMuted}>This journey is not live. Location is not shown for ended journeys.</Text></Card>
      )}

      <Card title="Consent">
        {data.consent ? (
          <>
            <KeyValue label="Approved by employee" value={formatDateTime(data.consent.consented_at)} />
            <KeyValue label="Version" value={data.consent.consent_version} />
            <KeyValue label="Ended" value={formatDateTime(data.consent.ended_at)} />
          </>
        ) : <Text style={typography.bodyMuted}>Removed under the retention policy.</Text>}
      </Card>

      {data.sos_alerts.length > 0 ? (
        <Card title="SOS alerts">
          {data.sos_alerts.map((a) => (
            <ListRow key={a.id} title={formatDateTime(a.created_at)} right={<SosStatusBadge status={a.alert_status} />}
              onPress={() => navigation.navigate('SOSDetail', { alertId: a.id })} />
          ))}
        </Card>
      ) : null}
      <Text style={typography.small}>Opening this record was logged in the audit trail.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({ badges: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm } });
