import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { JourneyStatusBadge } from '../../components/Badges';
import { SharingActiveBanner } from '../../components/Banners';
import { Card, KeyValue } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { reconcile, ReconcileOutcome, resumeCollection } from '../../services/journeys/journeyService';
import { notificationPermissionStatus, registerForPush } from '../../services/notifications/notificationService';
import { getSosItems, SosOutboxItem, subscribeSos } from '../../services/sos/sosService';
import { spacing, typography } from '../../theme';
import type { StaffStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';
import { formatDateTime, formatRemaining } from '../../utils/time';
import { useNow } from '../../hooks/useNow';

type Nav = NativeStackNavigationProp<StaffStackParamList>;

export function StaffHomeScreen() {
  const navigation = useNavigation<Nav>();
  const { profile } = useAuth();
  const { online } = useNetwork();
  const now = useNow(1000);
  const [state, setState] = useState<ReconcileOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [pendingSos, setPendingSos] = useState<SosOutboxItem[]>([]);
  const [notifStatus, setNotifStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setRefreshing(true);
    try {
      setState(await reconcile(profile.id));
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, [profile]);

  useFocusEffect(useCallback(() => {
    void load();
    void notificationPermissionStatus().then(setNotifStatus);
  }, [load]));
  useEffect(() => {
    if (online) void load();
  }, [online, load]);
  useEffect(() => {
    void getSosItems().then((i) => setPendingSos(i.filter((x) => x.state !== 'confirmed')));
    const unsub = subscribeSos((i) => setPendingSos(i.filter((x) => x.state !== 'confirmed')));
    return () => {
      unsub();
    };
  }, []);

  const active = state?.kind === 'active' ? state : null;

  const resume = async () => {
    if (!active) return;
    setResuming(true);
    const r = await resumeCollection(active.journey);
    setResuming(false);
    if (r.ok) navigation.navigate('ActiveJourney');
    else setError(r.message);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={load} testID="staff-home">
      <Text style={[typography.title, styles.hello]} accessibilityRole="header">Hello, {profile?.full_name ?? ''}</Text>

      {pendingSos.map((s) => (
        <Card key={s.clientRequestId} tone="danger" title="SOS not yet confirmed">
          <Text style={typography.body}>An SOS from {formatDateTime(s.createdAt)} has not been confirmed by the server.</Text>
          <AppButton title="View SOS status" variant="danger" onPress={() => navigation.navigate('SOSStatus', { clientRequestId: s.clientRequestId })} style={styles.mt} />
        </Card>
      ))}

      {active ? (
        <>
          {active.collecting ? <SharingActiveBanner label={active.journey.label} /> : null}
          <Card title={active.journey.label}>
            <View style={styles.row}><JourneyStatusBadge status="active" /></View>
            <KeyValue label="Expires in" value={formatRemaining(active.journey.expires_at, now)} />
            {active.collecting ? (
              <AppButton title="Open active journey" onPress={() => navigation.navigate('ActiveJourney')} style={styles.mt} testID="open-active" />
            ) : (
              <>
                <Text style={[typography.body, styles.mt]}>
                  This journey is still active, but location sharing is not running on this phone (for example after a restart). Nothing is being shared right now.
                </Text>
                <AppButton title="Resume sharing for this journey" onPress={resume} loading={resuming} style={styles.mt} />
                <AppButton title="Open journey to stop or confirm arrival" variant="secondary" onPress={() => navigation.navigate('ActiveJourney')} style={styles.mt} />
              </>
            )}
          </Card>
        </>
      ) : (
        <Card title="Start a safe journey">
          <Text style={typography.bodyMuted}>
            Share your location with the school safety team for one commute. You approve each journey, and you can stop at any time.
          </Text>
          <AppButton title="Start Safe Journey" onPress={() => navigation.navigate('StartJourney')} style={styles.mt}
            disabled={state?.kind === 'pending_end'} testID="start-journey-button" />
        </Card>
      )}

      {state?.kind === 'pending_end' ? (
        <Card tone="warning" title="Waiting to confirm your last journey ended">
          <Text style={typography.body}>Sharing stopped on this phone. The server will be told as soon as you are back online.</Text>
        </Card>
      ) : null}
      {state?.kind === 'ended' && state.journey ? (
        <Card title="Your last journey ended">
          <JourneyStatusBadge status={state.status} />
          <AppButton title="View details" variant="secondary" style={styles.mt}
            onPress={() => navigation.navigate('JourneyDetails', { journeyId: state.journey!.id })} />
        </Card>
      ) : null}

      {notifStatus && notifStatus !== 'granted' ? (
        <Card tone="warning" title="Notifications are off">
          <Text style={typography.body}>You won’t get reminders or SOS updates. Location sharing still works.</Text>
          <AppButton title="Turn on notifications" variant="secondary" style={styles.mt}
            onPress={async () => {
              await registerForPush(true);
              setNotifStatus(await notificationPermissionStatus());
            }} />
        </Card>
      ) : null}

      {error ? <Card tone="warning"><Text style={typography.body}>{error}</Text></Card> : null}

      <AppButton title="Location not updating? Troubleshoot" variant="ghost" onPress={() => navigation.navigate('Troubleshooting')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hello: { marginBottom: spacing.lg },
  row: { flexDirection: 'row', marginBottom: spacing.sm },
  mt: { marginTop: spacing.md },
});
