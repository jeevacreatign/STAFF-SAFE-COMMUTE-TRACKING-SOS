import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { FreshnessBadge, SosStatusBadge } from '../../components/Badges';
import { Card, KeyValue } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { LoadingState } from '../../components/States';
import { useAuth } from '../../context/AuthContext';
import { useNow } from '../../hooks/useNow';
import { useRealtimeTable } from '../../hooks/useRealtime';
import {
  describeSosLocation, fetchMyAlert, getSosItems, retrySos, SosDeliveryState, SosOutboxItem, subscribeSos,
} from '../../services/sos/sosService';
import { colors, spacing, typography } from '../../theme';
import type { SosAlert } from '../../types/db';
import type { StaffStackParamList } from '../../types/navigation';
import { freshnessOf } from '../../utils/freshness';
import { formatAge, formatDateTime, formatTime } from '../../utils/time';

type Props = NativeStackScreenProps<StaffStackParamList, 'SOSStatus'>;

const STATE_TEXT: Record<SosDeliveryState, { title: string; body: string; tone: 'danger' | 'warning' | 'safe' }> = {
  saved_locally: {
    title: 'Saved on this phone — not sent yet',
    body: 'Your SOS is stored on this phone and is being sent now.',
    tone: 'warning',
  },
  sending: {
    title: 'Sending SOS…',
    body: 'Submitting to the server. It is not confirmed until the server replies.',
    tone: 'warning',
  },
  waiting_retry: {
    title: 'NOT YET DELIVERED',
    body: 'The server has not confirmed your SOS. The app keeps retrying automatically. If you are in immediate danger, contact emergency services directly.',
    tone: 'danger',
  },
  confirmed: {
    title: 'SOS received by the server',
    body: 'Your school safety team has been alerted through the app. Keep your phone with you.',
    tone: 'safe',
  },
  failed: {
    title: 'SOS was not accepted',
    body: 'The server refused this alert. Try again, or contact your safety team or emergency services directly.',
    tone: 'danger',
  },
};

export function SOSStatusScreen({ route, navigation }: Props) {
  const { clientRequestId } = route.params;
  const { profile } = useAuth();
  const now = useNow(1000);
  const [item, setItem] = useState<SosOutboxItem | null | undefined>(undefined);
  const [server, setServer] = useState<SosAlert | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const pick = (items: SosOutboxItem[]) => setItem(items.find((i) => i.clientRequestId === clientRequestId) ?? null);
    void getSosItems().then(pick);
    const unsub = subscribeSos(pick);
    return () => {
      unsub();
    };
  }, [clientRequestId]);

  const alertId = item?.serverAlert?.id;
  useEffect(() => {
    if (alertId) void fetchMyAlert(alertId).then(setServer);
  }, [alertId]);
  useRealtimeTable('my-sos', 'sos_alerts', (c) => {
    const row = c.new as unknown as SosAlert;
    if (row?.id === alertId) setServer(row);
  }, () => alertId && void fetchMyAlert(alertId).then(setServer), profile ? `employee_id=eq.${profile.id}` : undefined, !!alertId);

  if (item === undefined) return <LoadingState />;
  if (item === null) {
    return (
      <Screen><Card title="SOS not found"><Text style={typography.body}>This alert is no longer stored on this phone.</Text></Card></Screen>
    );
  }
  const s = STATE_TEXT[item.state];
  const loc = item.location;

  return (
    <Screen footer={<>
      {item.state === 'waiting_retry' || item.state === 'failed' ? (
        <AppButton title="Retry sending now" variant="danger" loading={retrying}
          onPress={async () => { setRetrying(true); await retrySos(item.clientRequestId); setRetrying(false); }} testID="sos-retry" />
      ) : null}
      <AppButton title="Back to journey" variant="secondary" onPress={() => navigation.goBack()} />
    </>}>
      <Card tone={s.tone} title={s.title}>
        <Text style={typography.body} accessibilityLiveRegion="assertive" testID="sos-state-text">{s.body}</Text>
      </Card>

      <Card title="Delivery">
        <KeyValue label="Raised on this phone" value={formatDateTime(item.createdAt)} />
        <KeyValue label="Attempts" value={String(item.attempts)} />
        {item.lastAttemptAt ? <KeyValue label="Last attempt" value={`${formatTime(item.lastAttemptAt)} (${formatAge(item.lastAttemptAt, now)})`} /> : null}
        {item.nextAttemptAt && item.state === 'waiting_retry' ? <KeyValue label="Next automatic retry" value={formatTime(item.nextAttemptAt)} /> : null}
        {item.lastError && item.state !== 'confirmed' ? <KeyValue label="Last problem" value={item.lastError} /> : null}
        {item.serverAlert ? (
          <>
            <KeyValue label="Server confirmed at" value={formatDateTime(item.serverAlert.created_at)} testID="sos-confirmed-at" />
            <KeyValue label="Alert ID" value={item.serverAlert.id.slice(0, 8)} />
          </>
        ) : null}
      </Card>

      {server ? (
        <Card title="Safety team response">
          <View style={styles.row}><SosStatusBadge status={server.alert_status} /></View>
          {server.acknowledged_at ? <KeyValue label="Acknowledged" value={formatTime(server.acknowledged_at)} /> : (
            <Text style={typography.bodyMuted}>Not yet acknowledged. This updates automatically.</Text>
          )}
        </Card>
      ) : null}

      <Card title="Location sent with the alert">
        {loc ? (
          <>
            <View style={styles.row}><FreshnessBadge freshness={freshnessOf(loc.observedAt, now)} /></View>
            <KeyValue label="Observed" value={`${formatTime(loc.observedAt)} (${formatAge(loc.observedAt, now)})`} />
            <KeyValue label="Accuracy" value={loc.accuracyM != null ? `± ${Math.round(loc.accuracyM)} m` : 'Unknown'} />
          </>
        ) : null}
        <Text style={typography.bodyMuted}>{describeSosLocation(loc)}</Text>
      </Card>

      <Text style={[typography.small, { color: colors.textMuted, marginTop: spacing.sm }]}>
        This app alerts your school safety team only. It does not contact police, ambulance or other emergency services.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', marginBottom: spacing.sm } });
