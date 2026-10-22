import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { FreshnessBadge, JourneyStatusBadge } from '../../components/Badges';
import { SharingActiveBanner } from '../../components/Banners';
import { Card, KeyValue } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MapPanel } from '../../components/MapPanel';
import { Screen } from '../../components/Screen';
import { SOSButton } from '../../components/SOSButton';
import { LoadingState } from '../../components/States';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { useLocationStatus } from '../../hooks/useLocationStatus';
import { useNow } from '../../hooks/useNow';
import { useRealtimeTable } from '../../hooks/useRealtime';
import { endJourney, EndAction, fetchMyActiveJourney } from '../../services/journeys/journeyService';
import { isCollecting } from '../../services/location/controller';
import { getLocationDiagnostics, LocationDiagnostics } from '../../services/location/permissions';
import { flushQueue } from '../../services/location/uploader';
import { raiseSos } from '../../services/sos/sosService';
import { spacing, typography } from '../../theme';
import type { Journey } from '../../types/db';
import type { StaffStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';
import { freshnessOf } from '../../utils/freshness';
import { formatAge, formatTime, formatRemaining } from '../../utils/time';

type Props = NativeStackScreenProps<StaffStackParamList, 'ActiveJourney'>;
type Dialog = null | 'arrive' | 'stop' | 'sos';

export function ActiveJourneyScreen({ navigation }: Props) {
  const { profile } = useAuth();
  const { online } = useNetwork();
  const now = useNow(1000);
  const { status: loc, journey: local } = useLocationStatus();
  const [server, setServer] = useState<Journey | null | undefined>(undefined);
  const [collecting, setCollecting] = useState<boolean | null>(null);
  const [diag, setDiag] = useState<LocationDiagnostics | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<EndAction | 'sos' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = useRef(false);
  const goCompleted = useCallback((params: StaffStackParamList['JourneyCompleted']) => {
    if (left.current) return;
    left.current = true;
    navigation.replace('JourneyCompleted', params);
  }, [navigation]);

  const refresh = useCallback(async () => {
    if (!profile) return;
    try {
      setServer(await fetchMyActiveJourney(profile.id));
    } catch {
      // Offline: keep showing the device state; never claim server confirmation.
      setServer((s) => (s === undefined ? null : s));
    }
    setCollecting(await isCollecting());
    setDiag(await getLocationDiagnostics());
  }, [profile]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void getLocationDiagnostics().then(setDiag), 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  useRealtimeTable('my-journey', 'journeys', (c) => {
    const row = c.new as unknown as Journey;
    if (row?.id && row.status !== 'active') void refresh();
    else if (row?.id) setServer(row);
  }, refresh, profile ? `employee_id=eq.${profile.id}` : undefined, !!profile);

  // Journey ended elsewhere (expiry, server) -> completion screen.
  const journeyId = local?.id ?? server?.id;
  useEffect(() => {
    if (local && local.status !== 'active' && !busy) {
      goCompleted({ journeyId: local.id, status: local.status, confirmed: !local.pendingEnd });
    }
  }, [local, busy, goCompleted]);

  // Android back: leave the screen, never ends sharing by accident.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      navigation.navigate('StaffTabs', { screen: 'Home' });
      return true;
    });
    return () => sub.remove();
  }, [navigation]);

  const finish = async (action: EndAction) => {
    if (!journeyId) return;
    setBusy(action);
    setError(null);
    try {
      const row = await endJourney(journeyId, action);
      setDialog(null);
      goCompleted({
        journeyId,
        status: row?.status ?? (action === 'safe_arrival' ? 'safely_arrived' : 'stopped'),
        confirmed: !!row,
      });
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const sos = async () => {
    if (!journeyId || busy === 'sos') return;
    setBusy('sos');
    setDialog(null);
    try {
      const item = await raiseSos(journeyId);
      navigation.navigate('SOSStatus', { clientRequestId: item.clientRequestId });
    } finally {
      setBusy(null);
    }
  };

  if (server === undefined && !local) return <LoadingState label="Loading your journey…" />;
  const journey = server ?? null;
  const label = journey?.label ?? local?.label ?? 'Journey';
  const expiresAt = journey?.expires_at ?? local?.expiresAt;
  const fixFreshness = freshnessOf(loc?.lastFixAt, now);
  const serverFreshness = freshnessOf(journey?.last_observed_at, now);
  const sharingOnDevice = collecting && local?.status === 'active';

  return (
    <Screen
      testID="active-journey"
      footer={
        <View style={styles.footerRow}>
          <AppButton title="I Have Arrived Safely" variant="safe" onPress={() => setDialog('arrive')} style={styles.flex} testID="arrived-button" />
          <AppButton title="Stop Sharing" variant="secondary" onPress={() => setDialog('stop')} style={styles.flex} testID="stop-button" />
        </View>
      }
    >
      {sharingOnDevice ? <SharingActiveBanner label={label} /> : (
        <Card tone="warning" title="Sharing is not running on this phone">
          <Text style={typography.body}>No location is being collected right now. Use Stop Sharing or confirm arrival to end this journey, or resume from the home screen.</Text>
        </Card>
      )}

      <SOSButton onActivate={sos} onAccessibleActivate={() => setDialog('sos')} disabled={busy === 'sos'} />

      <MapPanel
        points={loc?.lastFix ? [{ id: 'me', latitude: loc.lastFix.latitude, longitude: loc.lastFix.longitude, accuracyM: loc.lastFixAccuracyM, title: 'Your last GPS fix', freshness: fixFreshness }] : []}
        emptyText="Waiting for the first GPS fix. Stay near a window or outdoors if this takes long."
      />

      <Card title={label}>
        <View style={styles.badges}><JourneyStatusBadge status={journey?.status ?? 'active'} /><FreshnessBadge freshness={fixFreshness} /></View>
        {expiresAt ? <KeyValue label="Sharing ends in" value={formatRemaining(expiresAt, now)} testID="expiry-countdown" /> : null}
        {journey?.estimated_arrival_at ? <KeyValue label="Expected arrival" value={formatTime(journey.estimated_arrival_at)} /> : null}
        <KeyValue label="Last GPS fix" value={loc?.lastFixAt ? `${formatTime(loc.lastFixAt)} (${formatAge(loc.lastFixAt, now)})` : 'None yet'} />
        <KeyValue label="Accuracy" value={loc?.lastFixAccuracyM != null ? `± ${Math.round(loc.lastFixAccuracyM)} m` : '—'} />
        <KeyValue label="Last confirmed upload" value={loc?.lastUploadAt ? `${formatTime(loc.lastUploadAt)} (${formatAge(loc.lastUploadAt, now)})` : 'None yet'} testID="last-upload" />
        <KeyValue label="Safety team sees" value={<FreshnessBadge freshness={serverFreshness} />} />
        {loc && loc.pending > 0 ? <KeyValue label="Waiting to upload" value={`${loc.pending} update(s)`} /> : null}
      </Card>

      {online === false || loc?.lastUploadError === 'offline' ? (
        <Card tone="warning" title="Not connected">
          <Text style={typography.body}>Updates are kept on this phone and sent when the connection returns. The safety team sees your last confirmed update time, not a live position.</Text>
          <AppButton title="Retry now" variant="secondary" onPress={() => void flushQueue()} style={styles.mt} />
        </Card>
      ) : null}
      {loc?.lastUploadError === 'session' ? (
        <Card tone="warning" title="Signed out on the server"><Text style={typography.body}>Your session expired. Sign in again to continue sharing.</Text></Card>
      ) : null}
      {diag && diag.foreground !== 'granted' ? (
        <Card tone="danger" title="Location permission was turned off">
          <Text style={typography.body}>Nothing can be collected. Turn location back on for this app, or stop sharing.</Text>
          <AppButton title="Troubleshoot" variant="secondary" onPress={() => navigation.navigate('Troubleshooting')} style={styles.mt} />
        </Card>
      ) : diag && !diag.servicesEnabled ? (
        <Card tone="warning" title="Location services are off">
          <Text style={typography.body}>GPS is unavailable, so updates are paused.</Text>
          <AppButton title="Troubleshoot" variant="secondary" onPress={() => navigation.navigate('Troubleshooting')} style={styles.mt} />
        </Card>
      ) : diag && diag.background !== 'granted' ? (
        <Card tone="warning" title="Sharing may pause when the screen is locked">
          <Text style={typography.body}>“Allow all the time” is not granted, so Android may stop updates when you leave the app.</Text>
          <AppButton title="Troubleshoot" variant="secondary" onPress={() => navigation.navigate('Troubleshooting')} style={styles.mt} />
        </Card>
      ) : null}
      {error ? <Card tone="danger"><Text style={typography.body}>{error}</Text></Card> : null}

      <Text style={typography.small}>Update frequency depends on your phone, Android version, battery settings and signal. It is not guaranteed to be continuous.</Text>

      <ConfirmDialog visible={dialog === 'arrive'} title="Confirm safe arrival?" tone="safe" confirmLabel="Yes, I have arrived safely"
        message="Location sharing will stop now and the safety team will see that you arrived." loading={busy === 'safe_arrival'}
        onConfirm={() => finish('safe_arrival')} onCancel={() => setDialog(null)} />
      <ConfirmDialog visible={dialog === 'stop'} title="Stop sharing?" tone="primary" confirmLabel="Stop sharing now"
        message="Location collection stops immediately on this phone. The safety team will see that you stopped sharing." loading={busy === 'stop'}
        onConfirm={() => finish('stop')} onCancel={() => setDialog(null)} />
      <ConfirmDialog visible={dialog === 'sos'} title="Raise an SOS?" tone="danger" confirmLabel="Send SOS now"
        message="This alerts your school safety team with your latest available location. It does not call emergency services."
        loading={busy === 'sos'} onConfirm={sos} onCancel={() => setDialog(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  badges: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  mt: { marginTop: spacing.md },
});
