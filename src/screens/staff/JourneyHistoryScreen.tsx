import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { JourneyStatusBadge } from '../../components/Badges';
import { ListRow } from '../../components/Controls';
import { OfflineBanner } from '../../components/Banners';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { useAuth } from '../../context/AuthContext';
import { listMyJourneys, PAGE_SIZE } from '../../services/journeys/journeyService';
import { colors, spacing } from '../../theme';
import type { Journey } from '../../types/db';
import type { StaffStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/time';

export function JourneyHistoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<StaffStackParamList>>();
  const { profile } = useAuth();
  const [items, setItems] = useState<Journey[]>([]);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    if (!profile) return;
    setLoading(true);
    try {
      const rows = await listMyJourneys(profile.id, p);
      setItems((prev) => (p === 0 ? rows : [...prev, ...rows.filter((r) => !prev.some((x) => x.id === r.id))]));
      setDone(rows.length < PAGE_SIZE);
      setPage(p);
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void load(0);
  }, [load]);

  if (error && items.length === 0) return <ErrorState message={error} onRetry={() => load(0)} />;
  if (loading && items.length === 0) return <LoadingState />;

  return (
    <View style={styles.wrap}>
      <OfflineBanner />
      <FlatList
        contentContainerStyle={styles.list}
        data={items}
        keyExtractor={(j) => j.id}
        refreshControl={<RefreshControl refreshing={loading && page === 0} onRefresh={() => load(0)} />}
        onEndReached={() => !done && !loading && load(page + 1)}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={<EmptyState title="No journeys yet" message="Journeys you start appear here." />}
        renderItem={({ item }) => (
          <ListRow
            title={item.label}
            subtitle={`${formatDateTime(item.sharing_started_at)}${item.ended_at ? ` → ${formatDateTime(item.ended_at)}` : ''}`}
            right={<JourneyStatusBadge status={item.status} />}
            onPress={() => navigation.navigate('JourneyDetails', { journeyId: item.id })}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flex: 1, backgroundColor: colors.background }, list: { padding: spacing.lg } });
