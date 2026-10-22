import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card, KeyValue } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/States';
import { useNetwork } from '../../context/NetworkContext';
import { useAsync } from '../../hooks/useAsync';
import { useLocationStatus } from '../../hooks/useLocationStatus';
import { isCollecting } from '../../services/location/controller';
import {
  getLocationDiagnostics, openAppSettings, openBatteryOptimisationSettings, openLocationSettings,
} from '../../services/location/permissions';
import { spacing, typography } from '../../theme';
import { formatDateTime } from '../../utils/time';

const ok = (v: boolean | null | undefined, yes = 'Yes', no = 'No') => (v == null ? 'Unknown' : v ? yes : no);

export function TroubleshootingScreen() {
  const { online } = useNetwork();
  const { status } = useLocationStatus();
  const { data, error, loading, reload, refresh, refreshing } = useAsync(async () => ({
    diag: await getLocationDiagnostics(),
    collecting: await isCollecting(),
  }));
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error?.message ?? 'Unavailable'} onRetry={reload} />;
  const { diag, collecting } = data;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Card title="Current status">
        <KeyValue label="Location permission" value={diag.foreground === 'granted' ? 'Allowed' : 'Not allowed'} />
        <KeyValue label="Allow all the time" value={diag.background === 'granted' ? 'Allowed' : 'Not allowed'} />
        <KeyValue label="Location services" value={ok(diag.servicesEnabled, 'On', 'Off')} />
        <KeyValue label="GPS provider" value={ok(diag.gpsAvailable, 'Available', 'Unavailable')} />
        <KeyValue label="Network" value={online == null ? 'Unknown' : online ? 'Connected' : 'Offline'} />
        <KeyValue label="Sharing running on this phone" value={collecting ? 'Yes' : 'No'} />
        <KeyValue label="Last GPS fix" value={formatDateTime(status?.lastFixAt)} />
        <KeyValue label="Last confirmed upload" value={formatDateTime(status?.lastUploadAt)} />
        {status?.lastTaskError ? <KeyValue label="Last location error" value={status.lastTaskError} /> : null}
        {diag.androidVersion ? <KeyValue label="Android API level" value={String(diag.androidVersion)} /> : null}
      </Card>

      <Card title="Why updates can be delayed">
        <Text style={typography.body}>• The phone is locked and “Allow all the time” is not granted.</Text>
        <Text style={typography.body}>• Battery saver or battery optimisation limits background apps.</Text>
        <Text style={typography.body}>• Some manufacturers (for example Xiaomi, Huawei, Samsung, OnePlus, Oppo, Vivo) stop background apps aggressively.</Text>
        <Text style={typography.body}>• The app was swiped away or the phone restarted. Open the app and resume the journey.</Text>
        <Text style={typography.body}>• GPS signal is weak indoors or underground, or mobile data is off.</Text>
        <Text style={[typography.bodyMuted, { marginTop: spacing.sm }]}>
          Continuous tracking cannot be guaranteed on every phone. The app always shows the last confirmed update rather than pretending to be live.
        </Text>
      </Card>

      <Card title="Fixes">
        <AppButton title="Open app permission settings" variant="secondary" onPress={openAppSettings} style={{ marginBottom: spacing.sm }} />
        <AppButton title="Open location settings" variant="secondary" onPress={openLocationSettings} style={{ marginBottom: spacing.sm }} />
        <AppButton title="Battery optimisation settings" variant="secondary" onPress={openBatteryOptimisationSettings} />
        <Text style={[typography.small, { marginTop: spacing.sm }]}>
          In battery settings, set Staff Safe Commute to “Unrestricted” / “Don’t optimise”. This is optional and only matters during journeys.
        </Text>
      </Card>
    </Screen>
  );
}
