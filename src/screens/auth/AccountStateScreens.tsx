import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { missingConfig } from '../../constants/config';
import { useAuth } from '../../context/AuthContext';
import { spacing, typography } from '../../theme';

export function AccountInactiveScreen() {
  const { profile, signOut, refreshProfile } = useAuth();
  const text = profile?.account_status === 'suspended'
    ? 'Your account has been suspended. Contact your school safety administrator.'
    : 'Your account is waiting for approval by a safety administrator. You can’t share journeys until it is approved.';
  return (
    <Screen>
      <Card title="Account not active">
        <Text style={[typography.body, { marginBottom: spacing.lg }]}>{text}</Text>
        <AppButton title="Check again" variant="secondary" onPress={refreshProfile} />
      </Card>
      <AppButton title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}

export function ProfileErrorScreen() {
  const { profileError, refreshProfile, signOut } = useAuth();
  return (
    <Screen>
      <Card title="Can’t load your account">
        <Text style={[typography.body, { marginBottom: spacing.lg }]}>{profileError}</Text>
        <AppButton title="Try again" onPress={refreshProfile} />
      </Card>
      <AppButton title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}

export function ConfigMissingScreen() {
  return (
    <Screen>
      <Card title="App not configured" tone="warning">
        <Text style={typography.body}>
          This build is missing required settings: {missingConfig().join(', ')}. See docs/setup.md. No data can be sent until it is configured.
        </Text>
      </Card>
    </Screen>
  );
}
