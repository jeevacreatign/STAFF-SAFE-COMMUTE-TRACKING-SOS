import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card } from '../../components/Card';
import { Chips } from '../../components/Controls';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/States';
import { TextField } from '../../components/TextField';
import { useAsync } from '../../hooks/useAsync';
import { inviteSchema } from '../../schemas/admin';
import { fieldErrors } from '../../schemas/validate';
import { inviteEmployee, listMyOrganisations } from '../../services/admin/adminService';
import { colors, spacing, typography } from '../../theme';
import type { AdminStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';

type Props = NativeStackScreenProps<AdminStackParamList, 'InviteEmployee'>;

export function InviteEmployeeScreen({ navigation }: Props) {
  const { data: orgs, error, loading, reload } = useAsync(listMyOrganisations);
  const [org, setOrg] = useState<string | undefined>();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [employeeRef, setEmployeeRef] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !orgs) return <LoadingState />;
  if (error || !orgs) return <ErrorState message={error?.message ?? 'Unavailable'} onRetry={reload} />;
  const organisationId = org ?? (orgs.length === 1 ? orgs[0].id : undefined);

  const submit = async () => {
    const v = fieldErrors(inviteSchema, { email, fullName, employeeRef: employeeRef || undefined });
    if (!v.ok) return setErrors(v.errors);
    if (!organisationId) return setErrors({ org: 'Choose a school' });
    setErrors({});
    setBusy(true);
    setResult(null);
    try {
      const r = await inviteEmployee({ ...v.data, organisationId });
      setResult({ ok: true, text: r.email_sent ? 'Invitation sent. They will receive an email to set a password.' : 'Account created, but the email could not be sent. Ask them to use “Forgot password”.' });
      setEmail(''); setFullName(''); setEmployeeRef('');
    } catch (e) {
      setResult({ ok: false, text: userMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<AppButton title="Send invitation" onPress={submit} loading={busy} />}>
      <Card title="Invite a staff member">
        {orgs.length > 1 ? (
          <>
            <Text style={typography.label}>School</Text>
            <Chips label="School" value={organisationId} onChange={setOrg} options={orgs.map((o) => ({ value: o.id, label: o.name }))} />
            {errors.org ? <Text style={{ color: colors.danger, marginBottom: spacing.md }}>{errors.org}</Text> : null}
          </>
        ) : <Text style={[typography.bodyMuted, { marginBottom: spacing.md }]}>School: {orgs[0]?.name ?? '—'}</Text>}
        <TextField label="Full name" value={fullName} onChangeText={setFullName} error={errors.fullName} maxLength={120} />
        <TextField label="Work email" value={email} onChangeText={setEmail} error={errors.email} autoCapitalize="none" keyboardType="email-address" />
        <TextField label="Staff ID (optional)" value={employeeRef} onChangeText={setEmployeeRef} error={errors.employeeRef} maxLength={40} />
        <Text style={typography.small}>Invited accounts are staff accounts. Administrator accounts are created by the platform operator.</Text>
      </Card>
      {result ? <Card tone={result.ok ? 'safe' : 'warning'}><Text style={typography.body}>{result.text}</Text></Card> : null}
      {result?.ok ? <AppButton title="Done" variant="ghost" onPress={() => navigation.goBack()} /> : null}
    </Screen>
  );
}
