import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { FreshnessBadge } from '../../components/Badges';
import { Card } from '../../components/Card';
import { ListRow } from '../../components/Controls';
import { MapPanel } from '../../components/MapPanel';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/States';
import { typography } from '../../theme';
import type { AdminStackParamList } from '../../types/navigation';
import { freshnessOf } from '../../utils/freshness';
import { formatAge, formatRemaining, formatTime } from '../../utils/time';
import { useActiveJourneys } from './ActiveJourneysScreen';

type Props = NativeStackScreenProps<AdminStackParamList, 'LiveMap'>;

export function LiveMapScreen({ navigation }: Props) {
  const { items, error, load, loading, now } = useActiveJourneys();
  if (!items && error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <LoadingState />;
  const located = items.filter((j) => j.last_latitude != null && j.last_longitude != null);
  const unlocated = items.filter((j) => j.last_latitude == null);
  return (
    <Screen refreshing={loading} onRefresh={load}>
      <MapPanel
        height={360}
        emptyText="No active journey has shared a location yet."
        onSelect={(id) => navigation.navigate('AdminJourneyDetail', { journeyId: id })}
        points={located.map((j) => ({
          id: j.id,
          latitude: j.last_latitude!,
          longitude: j.last_longitude!,
          accuracyM: j.last_accuracy_m,
          title: j.employee?.full_name ?? 'Staff member',
          description: `${j.label} · updated ${formatAge(j.last_observed_at, now)} · expires in ${formatRemaining(j.expires_at, now)}`,
          freshness: freshnessOf(j.last_observed_at, now),
        }))}
      />
      <Text style={[typography.small, { marginBottom: 8 }]}>Green: updated within 2 min. Amber: 2–10 min. Red: older than 10 min (not live).</Text>
      {located.map((j) => (
        <ListRow key={j.id} title={j.employee?.full_name ?? 'Staff member'}
          subtitle={`${j.label} · ${formatTime(j.last_observed_at)} · ETA ${formatTime(j.estimated_arrival_at)} · expires ${formatTime(j.expires_at)}`}
          right={<FreshnessBadge freshness={freshnessOf(j.last_observed_at, now)} />}
          onPress={() => navigation.navigate('AdminJourneyDetail', { journeyId: j.id })} />
      ))}
      {unlocated.length > 0 ? (
        <Card title="Active, location unavailable">
          {unlocated.map((j) => (
            <ListRow key={j.id} title={j.employee?.full_name ?? 'Staff member'} subtitle={`${j.label} · started ${formatTime(j.sharing_started_at)}`}
              right={<FreshnessBadge freshness="none" />} onPress={() => navigation.navigate('AdminJourneyDetail', { journeyId: j.id })} />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
