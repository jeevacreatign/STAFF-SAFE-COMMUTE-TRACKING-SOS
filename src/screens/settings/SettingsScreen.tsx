import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card, KeyValue } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ListRow } from '../../components/Controls';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { useLocationStatus } from '../../hooks/useLocationStatus';
import { typography } from '../../theme';
import type { StaffStackParamList } from '../../types/navigation';

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<StaffStackParamList>>();
  const { profile, signOut } = useAuth();
  const { journey } = useLocationStatus();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const sharing = journey?.status === 'active';

  return (
    <Screen>
      <Card title="Account">
        <KeyValue label="Name" value={profile?.full_name ?? '—'} />
        {profile?.employee_ref ? <KeyValue label="Staff ID" value={profile.employee_ref} /> : null}
        <KeyValue label="Role" value="Staff" />
      </Card>
      <ListRow title="Profile" subtitle="Change your display name" onPress={() => navigation.navigate('Profile')} />
      <ListRow title="Privacy and data retention" subtitle="What is collected and how long it is kept" onPress={() => navigation.navigate('Privacy')} />
      <ListRow title="Notification preferences" subtitle="Reminders and SOS updates" onPress={() => navigation.navigate('NotificationPrefs')} />
      <ListRow title="Location troubleshooting" subtitle="Permissions, GPS, battery settings" onPress={() => navigation.navigate('Troubleshooting')} />
      <AppButton title="Sign out" variant="secondary" onPress={() => setConfirm(true)} style={{ marginTop: 16 }} testID="sign-out" />
      <ConfirmDialog visible={confirm} title="Sign out?" confirmLabel="Sign out" loading={busy}
        message={sharing ? 'You have an active journey. Signing out stops sharing your location now.' : 'You will need your password to sign in again.'}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => { setBusy(true); await signOut(); setBusy(false); }}>
        {sharing ? <Text style={[typography.small, { marginBottom: 12 }]}>The safety team will see that you stopped sharing.</Text> : null}
      </ConfirmDialog>
    </Screen>
  );
}
