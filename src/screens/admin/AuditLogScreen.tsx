import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { OfflineBanner } from '../../components/Banners';
import { Chips } from '../../components/Controls';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { ADMIN_PAGE_SIZE, listAuditLogs } from '../../services/admin/adminService';
import { colors, radius, spacing, typography } from '../../theme';
import type { AuditLog } from '../../types/db';
import { userMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/time';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'sos.', label: 'SOS' },
  { value: 'journey.', label: 'Journeys' },
  { value: 'consent.', label: 'Consent' },
  { value: 'location_sharing.', label: 'Sharing' },
  { value: 'account.', label: 'Accounts' },
  { value: 'admin.', label: 'Admin access' },
  { value: 'auth.', label: 'Sign-in' },
  { value: 'notification.', label: 'Notifications' },
];

export function AuditLogScreen() {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<AuditLog[] | null>(null);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const rows = await listAuditLogs(p, filter || undefined);
      setItems((prev) => (p === 0 || !prev ? rows : [...prev, ...rows]));
      setPage(p);
      setDone(rows.length < ADMIN_PAGE_SIZE);
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <View style={styles.wrap}>
      <OfflineBanner />
      <View style={styles.filters}><Chips label="Event type" options={FILTERS} value={filter} onChange={(v) => { setItems(null); setFilter(v); }} /></View>
      {!items && error ? <ErrorState message={error} onRetry={() => load(0)} /> : !items ? <LoadingState /> : (
        <FlatList
          contentContainerStyle={styles.list}
          data={items}
          keyExtractor={(a) => String(a.id)}
          refreshControl={<RefreshControl refreshing={loading && page === 0} onRefresh={() => load(0)} />}
          onEndReached={() => !done && !loading && load(page + 1)}
          ListEmptyComponent={<EmptyState title="No audit events" />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={typography.label}>{item.action}</Text>
              <Text style={typography.small}>{formatDateTime(item.created_at)} · {item.resource_type}{item.resource_id ? ` ${item.resource_id.slice(0, 8)}` : ''}</Text>
              <Text style={typography.small}>Actor: {item.actor_id ? item.actor_id.slice(0, 8) : 'system'}</Text>
              {Object.keys(item.metadata ?? {}).length > 0 ? <Text style={styles.meta}>{JSON.stringify(item.metadata)}</Text> : null}
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
  row: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, gap: 2 },
  meta: { fontSize: 12, color: colors.textMuted, fontFamily: 'monospace' },
});
