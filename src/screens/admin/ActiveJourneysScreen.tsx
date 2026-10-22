import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { OfflineBanner } from '../../components/Banners';
import { FreshnessBadge } from '../../components/Badges';
import { ListRow } from '../../components/Controls';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { useNow } from '../../hooks/useNow';
import { useRealtimeTable } from '../../hooks/useRealtime';
import { listActiveJourneys } from '../../services/admin/adminService';
import { colors, spacing } from '../../theme';
import type { Journey, JourneyWithEmployee } from '../../types/db';
import type { AdminStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';
import { freshnessOf } from '../../utils/freshness';
import { formatAge, formatRemaining, formatTime } from '../../utils/time';

/** Shared loader + realtime for the list and the map. Ended / expired journeys drop out. */
export function useActiveJourneys() {
  const [items, setItems] = useState<JourneyWithEmployee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listActiveJourneys());
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));
  useRealtimeTable('admin-active-journeys', 'journeys', (c) => {
    const row = c.new as unknown as Journey;
    if (!row?.id) return void load();
    setItems((prev) => {
      if (!prev) return prev;
      if (row.status !== 'active') return prev.filter((j) => j.id !== row.id);
      const existing = prev.find((j) => j.id === row.id);
      if (!existing) {
        void load(); // new journey: fetch with employee name
        return prev;
      }
      return prev.map((j) => (j.id === row.id ? { ...j, ...row, employee: j.employee } : j));
    });
  }, load);
  const now = useNow(5000);
  // Hide journeys whose expiry passed even before the server job marks them.
  const visible = (items ?? []).filter((j) => Date.parse(j.expires_at) > now);
  return { items: items ? visible : null, error, loading, load, now };
}

export function ActiveJourneysScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AdminStackParamList>>();
  const { items, error, loading, load, now } = useActiveJourneys();
  if (!items && error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <LoadingState />;
  return (
    <View style={styles.wrap}>
      <OfflineBanner />
      <FlatList
        contentContainerStyle={styles.list}
        data={items}
        keyExtractor={(j) => j.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={<AppButton title="Open live map" variant="secondary" onPress={() => navigation.navigate('LiveMap')} style={{ marginBottom: spacing.md }} />}
        ListEmptyComponent={<EmptyState title="No active journeys" message="Only staff who have started and approved a journey appear here." />}
        renderItem={({ item }) => (
          <ListRow
            testID={`journey-row-${item.id}`}
            title={item.employee?.full_name ?? 'Staff member'}
            subtitle={[
              item.label,
              `Last update ${item.last_observed_at ? `${formatTime(item.last_observed_at)} (${formatAge(item.last_observed_at, now)})` : 'none'}`,
              item.estimated_arrival_at ? `ETA ${formatTime(item.estimated_arrival_at)}` : null,
              `Expires in ${formatRemaining(item.expires_at, now)}`,
            ].filter(Boolean).join(' · ')}
            right={<FreshnessBadge freshness={freshnessOf(item.last_observed_at, now)} />}
            onPress={() => navigation.navigate('AdminJourneyDetail', { journeyId: item.id })}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flex: 1, backgroundColor: colors.background }, list: { padding: spacing.lg } });
