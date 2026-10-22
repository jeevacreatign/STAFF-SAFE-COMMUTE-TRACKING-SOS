import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { AppButton } from '../../components/AppButton';
import { Card, KeyValue } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ListRow } from '../../components/Controls';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { listMyOrganisations } from '../../services/admin/adminService';
import type { AdminStackParamList } from '../../types/navigation';

export function AdminMoreScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AdminStackParamList>>();
  const { profile, signOut } = useAuth();
  const { data: orgs } = useAsync(listMyOrganisations);
  const [confirm, setConfirm] = useState(false);
  return (
    <Screen>
      <Card title={profile?.full_name ?? 'Administrator'}>
        <KeyValue label="Role" value="Safety administrator" />
        <KeyValue label="Schools" value={orgs ? orgs.map((o) => o.name).join(', ') || '—' : '…'} />
      </Card>
      <ListRow title="Audit log" subtitle="Security-relevant events in your schools" onPress={() => navigation.navigate('AuditLog')} />
      <ListRow title="Notification delivery problems" subtitle="Failed or skipped push notifications" onPress={() => navigation.navigate('NotificationFailures')} />
      <ListRow title="Profile and settings" subtitle="Display name and account details" onPress={() => navigation.navigate('AdminProfile')} />
      <AppButton title="Sign out" variant="secondary" onPress={() => setConfirm(true)} style={{ marginTop: 16 }} />
      <ConfirmDialog visible={confirm} title="Sign out?" message="This phone will stop receiving SOS notifications for your account."
        confirmLabel="Sign out" onCancel={() => setConfirm(false)} onConfirm={signOut} />
    </Screen>
  );
}
