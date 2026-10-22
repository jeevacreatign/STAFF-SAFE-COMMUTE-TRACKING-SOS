import { useState } from 'react';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { resetRequestSchema } from '../../schemas/auth';
import { fieldErrors } from '../../schemas/validate';
import { requestPasswordReset } from '../../services/auth/authService';
import { colors, spacing, typography } from '../../theme';
import { userMessage } from '../../utils/errors';

export function ResetPasswordScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const v = fieldErrors(resetRequestSchema, { email });
    if (!v.ok) return setError(v.errors.email);
    setError(undefined);
    setBusy(true);
    try {
      await requestPasswordReset(v.data.email);
      setSent(true);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card title="Reset your password">
        {sent ? (
          <Text style={typography.body} accessibilityLiveRegion="polite">
            If an account exists for that address, an email with a reset link is on its way. Open the link on this phone to choose a new password.
          </Text>
        ) : (
          <>
            <Text style={[typography.bodyMuted, { marginBottom: spacing.lg }]}>Enter the email address you sign in with.</Text>
            <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" error={error} />
            <AppButton title="Send reset link" onPress={submit} loading={busy} />
          </>
        )}
      </Card>
      {!sent ? null : <Text style={{ color: colors.textMuted }}>Didn’t get it? Check spam, or ask your safety administrator.</Text>}
    </Screen>
  );
}
