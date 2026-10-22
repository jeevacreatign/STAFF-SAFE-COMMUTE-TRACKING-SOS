import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { OfflineBanner } from '../../components/Banners';
import { FreshnessBadge, SosStatusBadge } from '../../components/Badges';
import { Chips, ListRow } from '../../components/Controls';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { useRealtimeTable } from '../../hooks/useRealtime';
import { ADMIN_PAGE_SIZE, listSosAlerts } from '../../services/admin/adminService';
import { colors, spacing } from '../../theme';
import type { SosAlertWithEmployee, SosStatus } from '../../types/db';
import type { AdminStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';
import { formatAge, formatDateTime } from '../../utils/time';

type Filter = 'new' | 'acknowledged' | 'responding' | 'resolved';
const FILTERS: { value: Filter; label: string; statuses: SosStatus[] }[] = [
  { value: 'new', label: 'New', statuses: ['new'] },
  { value: 'acknowledged', label: 'Acknowledged', statuses: ['acknowledged'] },
  { value: 'responding', label: 'Being handled', statuses: ['responding'] },
  { value: 'resolved', label: 'Resolved', statuses: ['resolved', 'closed'] },
];

export function SOSAlertsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AdminStackParamList>>();
  const [filter, setFilter] = useState<Filter>('new');
  const [items, setItems] = useState<SosAlertWithEmployee[] | null>(null);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const statuses = FILTERS.find((f) => f.value === filter)!.statuses;
      const rows = await listSosAlerts(statuses, p);
      setItems((prev) => (p === 0 || !prev ? rows : [...prev, ...rows.filter((r) => !prev.some((x) => x.id === r.id))]));
      setPage(p);
      setDone(rows.length < ADMIN_PAGE_SIZE);
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => void load(0), [load]));
  useRealtimeTable('admin-sos-list', 'sos_alerts', () => void load(0), () => void load(0));

  return (
    <View style={styles.wrap}>
      <OfflineBanner />
      <View style={styles.filters}>
        <Chips label="Alert status" options={FILTERS} value={filter} onChange={(v) => { setItems(null); setFilter(v); }} />
      </View>
      {!items && error ? <ErrorState message={error} onRetry={() => load(0)} /> : !items ? <LoadingState /> : (
        <FlatList
          contentContainerStyle={styles.list}
          data={items}
          keyExtractor={(a) => a.id}
          refreshControl={<RefreshControl refreshing={loading && page === 0} onRefresh={() => load(0)} />}
          onEndReached={() => !done && !loading && load(page + 1)}
          ListEmptyComponent={<EmptyState title="No alerts here" />}
          renderItem={({ item }) => (
            <View style={item.alert_status === 'new' ? styles.newRow : undefined}>
              <ListRow
                testID={`sos-row-${item.id}`}
                title={item.employee?.full_name ?? 'Staff member'}
                subtitle={`${formatDateTime(item.created_at)} (${formatAge(item.created_at)}) · ID ${item.id.slice(0, 8)}`}
                right={<View style={{ gap: 4, alignItems: 'flex-end' }}><SosStatusBadge status={item.alert_status} /><FreshnessBadge freshness={item.location_freshness} /></View>}
                onPress={() => navigation.navigate('SOSDetail', { alertId: item.id })}
              />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  newRow: { borderLeftWidth: 5, borderLeftColor: colors.danger, borderRadius: 12, marginBottom: 0 },
});
