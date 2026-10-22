import { useState } from 'react';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card, KeyValue } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { profileSchema } from '../../schemas/auth';
import { fieldErrors } from '../../schemas/validate';
import { updateMyName } from '../../services/auth/authService';
import { colors, spacing, typography } from '../../theme';
import { userMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/time';

/** Shared by staff and administrators. Role and organisation are read-only here by design. */
export function ProfileScreen() {
  const { profile, session, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const v = fieldErrors(profileSchema, { fullName: name });
    if (!v.ok) return setError(v.errors.fullName);
    setBusy(true);
    setSaved(false);
    try {
      await updateMyName(v.data.fullName);
      await refreshProfile();
      setError(undefined);
      setSaved(true);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card title="Your profile">
        <TextField label="Display name" value={name} onChangeText={(t) => { setName(t); setSaved(false); }} error={error} maxLength={120} />
        <AppButton title="Save" onPress={save} loading={busy} />
        {saved ? <Text style={{ color: colors.safe, marginTop: spacing.sm }} accessibilityLiveRegion="polite">Saved.</Text> : null}
      </Card>
      <Card title="Account details">
        <KeyValue label="Email" value={session?.user.email ?? '—'} />
        <KeyValue label="Role" value={profile?.role === 'safety_admin' ? 'Safety administrator' : 'Staff'} />
        <KeyValue label="Account created" value={formatDateTime(profile?.created_at)} />
        <Text style={[typography.small, { marginTop: spacing.sm }]}>Role and organisation can only be changed by the platform operator.</Text>
      </Card>
    </Screen>
  );
}
