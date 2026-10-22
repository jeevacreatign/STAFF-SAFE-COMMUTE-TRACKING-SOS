import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { FreshnessBadge, JourneyStatusBadge, SosStatusBadge, sosStatusLabel } from '../../components/Badges';
import { Card, KeyValue } from '../../components/Card';
import { MapPanel, openInMaps } from '../../components/MapPanel';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/States';
import { TextField } from '../../components/TextField';
import { useAsync } from '../../hooks/useAsync';
import { useNow } from '../../hooks/useNow';
import { useRealtimeTable } from '../../hooks/useRealtime';
import { sosNoteSchema } from '../../schemas/admin';
import { getSosDetail, SOS_NEXT, updateSosStatus } from '../../services/admin/adminService';
import { colors, spacing, typography } from '../../theme';
import type { SosStatus } from '../../types/db';
import type { AdminStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';
import { freshnessOf } from '../../utils/freshness';
import { formatAge, formatDateTime, formatTime } from '../../utils/time';

type Props = NativeStackScreenProps<AdminStackParamList, 'SOSDetail'>;

const ACTION_LABEL: Record<SosStatus, string> = {
  new: 'New',
  acknowledged: 'Acknowledge alert',
  responding: 'Mark as responding',
  resolved: 'Mark resolved',
  closed: 'Close alert',
};

export function SOSDetailScreen({ route }: Props) {
  const { alertId } = route.params;
  const now = useNow(1000);
  const { data, error, loading, reload, refresh, refreshing } = useAsync(() => getSosDetail(alertId), alertId);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();
  const [busy, setBusy] = useState<SosStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useRealtimeTable(`admin-sos-${alertId}`, 'sos_alerts', () => void refresh(), refresh, `id=eq.${alertId}`);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return null;
  const a = data.alert;
  const j = data.journey;
  const journeyLive = j?.status === 'active' && j.last_latitude != null;

  const act = async (status: SosStatus) => {
    const v = sosNoteSchema.safeParse({ note });
    if (!v.success) return setNoteError(v.error.issues[0]?.message);
    setNoteError(undefined);
    setBusy(status);
    setActionError(null);
    try {
      await updateSosStatus(a.id, status, v.data.note || null);
      setNote('');
      await refresh();
    } catch (e) {
      setActionError(userMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const points = [];
  if (a.latitude != null && a.longitude != null) {
    points.push({ id: 'alert', latitude: a.latitude, longitude: a.longitude, accuracyM: a.accuracy_m,
      title: 'Location at SOS', description: `Observed ${formatTime(a.location_observed_at)}`, freshness: freshnessOf(a.location_observed_at, Date.parse(a.created_at)) });
  }
  if (journeyLive && j) {
    points.push({ id: 'live', latitude: j.last_latitude!, longitude: j.last_longitude!, accuracyM: j.last_accuracy_m,
      title: 'Latest journey update', description: `Observed ${formatTime(j.last_observed_at)}`, freshness: freshnessOf(j.last_observed_at, now) });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} testID="sos-detail">
      <Card tone={a.alert_status === 'new' ? 'danger' : undefined} title={`SOS · ${data.employee.full_name}`}>
        <View style={styles.badges}><SosStatusBadge status={a.alert_status} /></View>
        <KeyValue label="Alert ID" value={a.id.slice(0, 8)} />
        {data.employee.employee_ref ? <KeyValue label="Staff ID" value={data.employee.employee_ref} /> : null}
        <KeyValue label="Raised" value={`${formatDateTime(a.created_at)} (${formatAge(a.created_at, now)})`} />
        <KeyValue label="Journey" value={j ? `${j.label} (${j.id.slice(0, 8)})` : '—'} />
        {j ? <KeyValue label="Journey status" value={<JourneyStatusBadge status={j.status} />} /> : null}
        {a.acknowledged_at ? <KeyValue label="Acknowledged" value={formatDateTime(a.acknowledged_at)} /> : null}
        {a.resolved_at ? <KeyValue label="Resolved" value={formatDateTime(a.resolved_at)} /> : null}
      </Card>

      <Card title="Location at time of SOS">
        <View style={styles.badges}><FreshnessBadge freshness={a.location_freshness} /></View>
        {a.latitude != null && a.longitude != null ? (
          <>
            <KeyValue label="Observed" value={formatDateTime(a.location_observed_at)} />
            <KeyValue label="Accuracy" value={a.accuracy_m != null ? `± ${Math.round(a.accuracy_m)} m` : 'Unknown'} />
            <KeyValue label="Source" value={a.location_source === 'device' ? 'Sent by the phone with the SOS' : 'Last position the server had'} />
            <AppButton title="Open in maps" variant="secondary" style={{ marginTop: spacing.sm }}
              onPress={() => openInMaps(a.latitude!, a.longitude!, data.employee.full_name)} />
          </>
        ) : <Text style={typography.body}>No location was available when this SOS was raised.</Text>}
      </Card>
      <MapPanel points={points} emptyText="No location to show." />
      {journeyLive && j ? (
        <Card title="Latest journey update (live sharing)">
          <KeyValue label="Observed" value={`${formatTime(j.last_observed_at)} (${formatAge(j.last_observed_at, now)})`} />
          <KeyValue label="Freshness" value={<FreshnessBadge freshness={freshnessOf(j.last_observed_at, now)} />} />
        </Card>
      ) : null}

      <Card title="Emergency response">
        <TextField label="Response note (optional)" value={note} onChangeText={setNote} multiline maxLength={1000}
          error={noteError} style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }} />
        {actionError ? <Text style={{ color: colors.danger, marginBottom: spacing.sm }} accessibilityRole="alert">{actionError}</Text> : null}
        <View style={{ gap: spacing.sm }}>
          {SOS_NEXT[a.alert_status].map((s) => (
            <AppButton key={s} title={ACTION_LABEL[s]} variant={s === 'acknowledged' ? 'danger' : s === 'resolved' ? 'safe' : 'primary'}
              loading={busy === s} disabled={!!busy && busy !== s} onPress={() => act(s)} testID={`sos-action-${s}`} />
          ))}
          {a.alert_status !== 'closed' ? (
            <AppButton title="Add note only" variant="secondary" disabled={!note.trim() || !!busy} loading={busy === a.alert_status}
              onPress={() => act(a.alert_status)} />
          ) : null}
        </View>
        <Text style={[typography.small, { marginTop: spacing.sm }]}>This app does not contact emergency services. Call them directly if needed.</Text>
      </Card>

      <Card title="History">
        {data.events.map((e) => (
          <View key={e.id} style={styles.event}>
            <Text style={typography.label}>
              {e.from_status === e.to_status ? 'Note added' : e.from_status ? `${sosStatusLabel[e.from_status]} → ${sosStatusLabel[e.to_status]}` : 'Alert raised'}
            </Text>
            <Text style={typography.small}>{formatDateTime(e.created_at)}{e.actor_name ? ` · ${e.actor_name}` : ''}</Text>
            {e.note ? <Text style={typography.body}>{e.note}</Text> : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  event: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.border, gap: 2 },
});
