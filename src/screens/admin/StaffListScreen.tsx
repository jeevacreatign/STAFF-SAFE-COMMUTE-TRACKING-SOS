import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { OfflineBanner } from '../../components/Banners';
import { ListRow } from '../../components/Controls';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { TextField } from '../../components/TextField';
import { ADMIN_PAGE_SIZE, listEmployees } from '../../services/admin/adminService';
import { colors, spacing } from '../../theme';
import type { AccountStatus, Profile } from '../../types/db';
import type { AdminStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';

export const accountStatusLabel: Record<AccountStatus, string> = {
  active: 'Active',
  invited: 'Invited',
  suspended: 'Suspended',
  pending_review: 'Under review',
};

export function StaffListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AdminStackParamList>>();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Profile[] | null>(null);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const rows = await listEmployees(p, query);
      setItems((prev) => (p === 0 || !prev ? rows : [...prev, ...rows]));
      setPage(p);
      setDone(rows.length < ADMIN_PAGE_SIZE);
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [query]);
  useFocusEffect(useCallback(() => void load(0), [load]));

  return (
    <View style={styles.wrap}>
      <OfflineBanner />
      <View style={styles.header}>
        <TextField label="Search staff" value={search} onChangeText={setSearch} placeholder="Name or staff ID" autoCapitalize="none" />
        <AppButton title="Invite staff member" variant="secondary" onPress={() => navigation.navigate('InviteEmployee')} />
      </View>
      {!items && error ? <ErrorState message={error} onRetry={() => load(0)} /> : !items ? <LoadingState /> : (
        <FlatList
          contentContainerStyle={styles.list}
          data={items}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={loading && page === 0} onRefresh={() => load(0)} />}
          onEndReached={() => !done && !loading && load(page + 1)}
          ListEmptyComponent={<EmptyState title="No staff found" />}
          renderItem={({ item }) => (
            <ListRow title={item.full_name} subtitle={item.employee_ref ?? undefined}
              right={<Text style={{ color: item.account_status === 'active' ? colors.safe : colors.warning, fontWeight: '700' }}>{accountStatusLabel[item.account_status]}</Text>}
              onPress={() => navigation.navigate('EmployeeDetail', { userId: item.id })} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, paddingBottom: 0 },
  list: { padding: spacing.lg },
});
