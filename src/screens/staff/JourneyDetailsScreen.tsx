import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { JourneyStatusBadge, SosStatusBadge } from '../../components/Badges';
import { Card, KeyValue } from '../../components/Card';
import { ListRow } from '../../components/Controls';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { getMyJourney } from '../../services/journeys/journeyService';
import { spacing, typography } from '../../theme';
import type { JourneyEndReason } from '../../types/db';
import type { StaffStackParamList } from '../../types/navigation';
import { formatDateTime } from '../../utils/time';

type Props = NativeStackScreenProps<StaffStackParamList, 'JourneyDetails'>;

export const endReasonLabel: Record<JourneyEndReason, string> = {
  safe_arrival: 'Safe arrival confirmed',
  stopped_by_employee: 'Stopped by you',
  expired: 'Expired automatically',
  cancelled: 'Cancelled before sharing',
  account_suspended: 'Ended because the account was suspended',
};

export function JourneyDetailsScreen({ route, navigation }: Props) {
  const { data, error, loading, reload, refresh, refreshing } = useAsync(() => getMyJourney(route.params.journeyId), route.params.journeyId);
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  const j = data?.journey;
  if (!j) return <ErrorState message="Journey not found." />;
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Card title={j.label}>
        <JourneyStatusBadge status={j.status} />
        <KeyValue label="Destination" value={j.destination_label ?? '—'} />
        <KeyValue label="Sharing started" value={formatDateTime(j.sharing_started_at)} />
        <KeyValue label="Expiry" value={formatDateTime(j.expires_at)} />
        {j.estimated_arrival_at ? <KeyValue label="Expected arrival" value={formatDateTime(j.estimated_arrival_at)} /> : null}
        <KeyValue label="Ended" value={formatDateTime(j.ended_at)} />
        {j.end_reason ? <KeyValue label="End reason" value={endReasonLabel[j.end_reason]} /> : null}
        {j.safe_arrival_at ? <KeyValue label="Safe arrival" value={formatDateTime(j.safe_arrival_at)} /> : null}
        {j.status === 'active' ? (
          <AppButton title="Open active journey" onPress={() => navigation.navigate('ActiveJourney')} style={{ marginTop: spacing.md }} />
        ) : null}
      </Card>
      <Card title="Consent record">
        {data?.consent ? (
          <>
            <KeyValue label="Approved" value={formatDateTime(data.consent.consented_at)} />
            <KeyValue label="Consent version" value={data.consent.consent_version} />
            <KeyValue label="Ended" value={formatDateTime(data.consent.ended_at)} />
            <Text style={[typography.small, { marginTop: spacing.sm }]}>{data.consent.purpose}</Text>
          </>
        ) : <Text style={typography.bodyMuted}>Removed under the retention policy.</Text>}
      </Card>
      {data && data.alerts.length > 0 ? (
        <Card title="SOS alerts on this journey">
          {data.alerts.map((a) => (
            <ListRow key={a.id} title={formatDateTime(a.created_at)} right={<SosStatusBadge status={a.alert_status} />} />
          ))}
        </Card>
      ) : null}
      <Text style={typography.small}>Location history for finished journeys is not shown and is deleted under the retention policy.</Text>
    </Screen>
  );
}
