import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { signInSchema } from '../../schemas/auth';
import { fieldErrors } from '../../schemas/validate';
import { signIn } from '../../services/auth/authService';
import { colors, spacing, typography } from '../../theme';
import type { AuthStackParamList } from '../../types/navigation';
import { userMessage } from '../../utils/errors';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

/** One sign-in screen for staff and administrators; the server-side role decides the app shown. */
export function SignInScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setFormError(null);
    const v = fieldErrors(signInSchema, { email, password });
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await signIn(v.data.email, v.data.password);
    } catch (e) {
      setFormError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="sign-in-screen">
      <View style={styles.header}>
        <Text style={typography.title} accessibilityRole="header">Sign in</Text>
        <Text style={typography.bodyMuted}>Staff and safety administrators use the account they were invited with.</Text>
      </View>
      <Card>
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
          keyboardType="email-address" textContentType="emailAddress" error={errors.email} testID="email-input" />
        <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password"
          textContentType="password" error={errors.password} onSubmitEditing={submit} testID="password-input" />
        {formError ? <Text style={styles.error} accessibilityRole="alert">{formError}</Text> : null}
        <AppButton title="Sign in" onPress={submit} loading={busy} testID="sign-in-button" />
      </Card>
      <AppButton title="Forgot password?" variant="ghost" onPress={() => navigation.navigate('ResetPassword')} />
      <Text style={[typography.small, styles.note]}>
        Accounts are created by invitation from your school safety team. There is no public sign-up.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginVertical: spacing.xl, gap: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.md, fontSize: 15 },
  note: { textAlign: 'center', marginTop: spacing.lg },
});
