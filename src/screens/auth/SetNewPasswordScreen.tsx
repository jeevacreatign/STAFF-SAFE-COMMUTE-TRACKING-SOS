import { useState } from 'react';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { newPasswordSchema } from '../../schemas/auth';
import { fieldErrors } from '../../schemas/validate';
import { updatePassword } from '../../services/auth/authService';
import { colors, spacing, typography } from '../../theme';
import { userMessage } from '../../utils/errors';

/** Reached from a password-reset or invitation link. */
export function SetNewPasswordScreen() {
  const { finishRecovery, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const v = fieldErrors(newPasswordSchema, { password, confirm });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setBusy(true);
    try {
      await updatePassword(v.data.password);
      finishRecovery();
    } catch (e) {
      setFormError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card title="Choose a new password">
        <Text style={[typography.bodyMuted, { marginBottom: spacing.lg }]}>At least 10 characters with upper and lower case letters and a number.</Text>
        <TextField label="New password" value={password} onChangeText={setPassword} secureTextEntry error={errors.password} autoComplete="new-password" />
        <TextField label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry error={errors.confirm} />
        {formError ? <Text style={{ color: colors.danger, marginBottom: spacing.md }}>{formError}</Text> : null}
        <AppButton title="Save password" onPress={submit} loading={busy} />
      </Card>
      <AppButton title="Cancel and sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
