import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card, KeyValue } from '../../components/Card';
import { ToggleRow } from '../../components/Controls';
import { Screen } from '../../components/Screen';
import { CONSENT_SECTIONS, CONSENT_VERSION } from '../../constants/consent';
import { startJourney } from '../../services/journeys/journeyService';
import { getLocationDiagnostics, openAppSettings, requestBackgroundLocation, requestForegroundLocation } from '../../services/location/permissions';
import { spacing, typography } from '../../theme';
import type { StaffStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';
import { newRequestId } from '../../utils/id';
import { formatDuration } from '../../utils/time';

type Props = NativeStackScreenProps<StaffStackParamList, 'Consent'>;
type Step = 'review' | 'foreground_denied' | 'background' | 'starting';

/**
 * Per-journey disclosure and consent. Nothing is requested from Android and no journey exists
 * until the employee approves here.
 */
export function ConsentScreen({ navigation, route }: Props) {
  const { setup } = route.params;
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState<Step>('review');
  const [error, setError] = useState<string | null>(null);
  const [backgroundRefused, setBackgroundRefused] = useState(false);
  // One idempotency key per consent screen: double taps / retries never create two journeys.
  const requestId = useRef(newRequestId());

  const create = async () => {
    setStep('starting');
    setError(null);
    try {
      await startJourney(setup, requestId.current, agreed);
      navigation.reset({ index: 1, routes: [{ name: 'StaffTabs' }, { name: 'ActiveJourney' }] });
    } catch (e) {
      setError(userMessage(e));
      setStep('review');
    }
  };

  const approve = async () => {
    if (!agreed) return;
    setError(null);
    const fg = await requestForegroundLocation();
    if (fg !== 'granted') {
      setStep('foreground_denied');
      return;
    }
    const diag = await getLocationDiagnostics();
    if (!diag.servicesEnabled) {
      setError('Location services are turned off. Turn them on and try again.');
      return;
    }
    if (diag.background === 'granted') {
      await create();
      return;
    }
    setStep('background');
  };

  const askBackground = async () => {
    // On Android 11+ this opens Settings and resolves when the employee returns.
    const status = await requestBackgroundLocation();
    if (status === 'granted') await create();
    else setBackgroundRefused(true);
  };

  if (step === 'foreground_denied') {
    return (
      <Screen footer={<>
        <AppButton title="Open app settings" onPress={openAppSettings} />
        <AppButton title="Try again" variant="secondary" onPress={approve} />
        <AppButton title="Cancel journey" variant="ghost" onPress={() => navigation.popToTop()} />
      </>}>
        <Card title="Location permission needed" tone="warning">
          <Text style={typography.body}>
            Android did not grant location permission, so no journey was started and nothing was shared. To share this journey, allow location “while using the app” in settings.
          </Text>
        </Card>
      </Screen>
    );
  }

  if (step === 'background') {
    return (
      <Screen footer={<>
        <AppButton title="Allow all the time" onPress={askBackground} testID="allow-background" />
        <AppButton title="Share only while the app is open" variant="secondary" onPress={create} testID="foreground-only" />
        <AppButton title="Cancel journey" variant="ghost" onPress={() => navigation.popToTop()} />
      </>}>
        <Card title="Keep sharing when your screen is locked?">
          <Text style={[typography.body, styles.gap]}>
            To keep updating while the phone is locked or you use other apps, Android needs “Allow all the time” for this app. Android will open a settings page; choose “Allow all the time”, then come back.
          </Text>
          <Text style={[typography.body, styles.gap]}>
            This permission is only used during journeys you approve. A notification stays visible the whole time sharing is on.
          </Text>
          {backgroundRefused ? (
            <Text style={[typography.body, styles.gap]} accessibilityRole="alert">
              “Allow all the time” was not granted. You can still share while the app is open.
            </Text>
          ) : null}
          <Text style={typography.bodyMuted}>
            If you choose “only while the app is open”, updates may pause when you lock the phone or switch apps, and the safety team will see your location as delayed.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <AppButton title="Approve and start sharing" onPress={approve} disabled={!agreed} loading={step === 'starting'} testID="approve-consent" />
          <AppButton title="Decline" variant="ghost" onPress={() => navigation.popToTop()} testID="decline-consent"
            accessibilityHint="Returns home without sharing anything. Declining has no penalty." />
        </>
      }
    >
      <Text style={[typography.title, styles.gap]} accessibilityRole="header">Location sharing for this journey</Text>
      <Card title="This journey">
        <KeyValue label="Label" value={setup.label} />
        {setup.destination ? <KeyValue label="Destination" value={setup.destination} /> : null}
        {setup.etaMinutes !== undefined ? <KeyValue label="Expected arrival" value={`in ${formatDuration(setup.etaMinutes)}`} /> : null}
        <KeyValue label="Sharing lasts at most" value={formatDuration(setup.expiryMinutes)} testID="consent-duration" />
      </Card>
      {CONSENT_SECTIONS.map((s) => (
        <View key={s.title} style={styles.section}>
          <Text style={typography.label}>{s.title}</Text>
          <Text style={typography.bodyMuted}>{s.body}</Text>
        </View>
      ))}
      <Card>
        <ToggleRow
          label="I approve sharing my location for this journey only"
          description={`Consent version ${CONSENT_VERSION}`}
          value={agreed}
          onValueChange={setAgreed}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginBottom: spacing.md },
  section: { marginBottom: spacing.md, gap: 2 },
  error: { color: '#B3261E', fontSize: 15 },
});
