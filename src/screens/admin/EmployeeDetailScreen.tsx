import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { JourneyStatusBadge } from '../../components/Badges';
import { Card, KeyValue } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ListRow } from '../../components/Controls';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/States';
import { TextField } from '../../components/TextField';
import { useAsync } from '../../hooks/useAsync';
import { ADMIN_PAGE_SIZE, getEmployee, listEmployeeJourneys, setAccountStatus } from '../../services/admin/adminService';
import { colors, spacing, typography } from '../../theme';
import type { AccountStatus, Journey } from '../../types/db';
import type { AdminStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/time';
import { accountStatusLabel } from './StaffListScreen';

type Props = NativeStackScreenProps<AdminStackParamList, 'EmployeeDetail'>;
type Target = Exclude<AccountStatus, 'invited'>;

export function EmployeeDetailScreen({ route, navigation }: Props) {
  const { userId } = route.params;
  const { data: profile, error, loading, reload } = useAsync(() => getEmployee(userId), userId);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [page, setPage] = useState(-1);
  const [more, setMore] = useState(true);
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadJourneys = async (p: number) => {
    const rows = await listEmployeeJourneys(userId, p);
    setJourneys((prev) => (p === 0 ? rows : [...prev, ...rows]));
    setPage(p);
    setMore(rows.length === ADMIN_PAGE_SIZE);
  };
  React.useEffect(() => {
    void loadJourneys(0).catch((e) => setMsg(userMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (loading && !profile) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!profile) return <ErrorState message="Staff member not found or outside your schools." />;

  const apply = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await setAccountStatus(userId, target, reason.trim());
      setTarget(null);
      setReason('');
      setMsg('Account status updated.');
      await reload();
      await loadJourneys(0);
    } catch (e) {
      setMsg(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card title={profile.full_name}>
        {profile.employee_ref ? <KeyValue label="Staff ID" value={profile.employee_ref} /> : null}
        <KeyValue label="Account" value={accountStatusLabel[profile.account_status]} />
        <KeyValue label="Created" value={formatDateTime(profile.created_at)} />
      </Card>
      <Card title="Account access">
        <Text style={[typography.bodyMuted, { marginBottom: spacing.md }]}>
          Suspending or flagging an account for review immediately ends any live sharing. Administrators can never start or resume sharing for staff.
        </Text>
        {profile.account_status === 'active' ? (
          <>
            <AppButton title="Flag for account review" variant="secondary" onPress={() => setTarget('pending_review')} style={{ marginBottom: spacing.sm }} />
            <AppButton title="Suspend access" variant="danger" onPress={() => setTarget('suspended')} />
          </>
        ) : (
          <AppButton title="Restore access" variant="primary" onPress={() => setTarget('active')} />
        )}
        {msg ? <Text style={{ marginTop: spacing.sm, color: colors.textMuted }} accessibilityLiveRegion="polite">{msg}</Text> : null}
      </Card>
      <Card title="Journeys (metadata only)">
        {journeys.length === 0 ? <Text style={typography.bodyMuted}>No journeys.</Text> : null}
        {journeys.map((j) => (
          <ListRow key={j.id} title={j.label} subtitle={`${formatDateTime(j.consented_at)} · consent ${j.consent_version}`}
            right={<JourneyStatusBadge status={j.status} />} onPress={() => navigation.navigate('AdminJourneyDetail', { journeyId: j.id })} />
        ))}
        {more && page >= 0 ? <AppButton title="Load more" variant="ghost" onPress={() => loadJourneys(page + 1)} /> : null}
      </Card>
      <ConfirmDialog visible={!!target} title={target === 'active' ? 'Restore access?' : target === 'suspended' ? 'Suspend access?' : 'Flag for review?'}
        message="This is recorded in the audit log." confirmLabel="Confirm" tone={target === 'suspended' ? 'danger' : 'primary'}
        loading={busy} onConfirm={apply} onCancel={() => setTarget(null)}>
        <TextField label="Reason (recorded in the audit log)" value={reason} onChangeText={setReason} maxLength={200} />
      </ConfirmDialog>
    </Screen>
  );
}
