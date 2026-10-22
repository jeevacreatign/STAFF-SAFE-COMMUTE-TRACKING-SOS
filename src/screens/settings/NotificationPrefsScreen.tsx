import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card } from '../../components/Card';
import { Chips, ToggleRow } from '../../components/Controls';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/States';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { notificationPrefsSchema } from '../../schemas/admin';
import { getMyPreferences, notificationPermissionStatus, registerForPush, savePreferences } from '../../services/notifications/notificationService';
import { colors, spacing, typography } from '../../theme';
import { userMessage } from '../../utils/errors';

export function NotificationPrefsScreen() {
  const { profile } = useAuth();
  const { data, error, loading, reload } = useAsync(() => getMyPreferences(profile!.id), profile?.id);
  const [reminders, setReminders] = useState(true);
  const [updates, setUpdates] = useState(true);
  const [minutes, setMinutes] = useState(15);
  const [perm, setPerm] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setReminders(data.journey_reminders);
      setUpdates(data.status_updates);
      setMinutes(data.reminder_minutes_after_eta);
    }
  }, [data]);
  useEffect(() => {
    void notificationPermissionStatus().then(setPerm);
  }, []);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;

  const save = async () => {
    const v = notificationPrefsSchema.safeParse({ journeyReminders: reminders, statusUpdates: updates, reminderMinutesAfterEta: minutes });
    if (!v.success) return setMsg({ ok: false, text: 'Check the reminder delay.' });
    setBusy(true);
    try {
      await savePreferences(v.data);
      setMsg({ ok: true, text: 'Preferences saved.' });
    } catch (e) {
      setMsg({ ok: false, text: userMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card title="This phone" tone={perm === 'granted' ? undefined : 'warning'}>
        <Text style={typography.body}>{perm === 'granted' ? 'Notifications are allowed.' : 'Notifications are turned off for this app. You can still use every feature; you just won’t be alerted.'}</Text>
        {perm !== 'granted' ? (
          <AppButton title="Allow notifications" variant="secondary" style={{ marginTop: spacing.md }}
            onPress={async () => {
              const r = await registerForPush(true);
              setPerm(await notificationPermissionStatus());
              if (r.status === 'unsupported' || r.status === 'error') setMsg({ ok: false, text: r.reason });
            }} />
        ) : null}
      </Card>
      <Card title="What to notify me about">
        <ToggleRow label="Arrival reminders" description="If a journey is still sharing after your expected arrival time." value={reminders} onValueChange={setReminders} />
        {reminders ? (
          <>
            <Text style={[typography.label, { marginTop: spacing.sm }]}>Remind me this long after expected arrival</Text>
            <Chips label="Reminder delay" value={minutes} onChange={setMinutes}
              options={[5, 15, 30, 60].map((m) => ({ value: m, label: `${m} min` }))} />
          </>
        ) : null}
        <ToggleRow label="SOS updates" description="When the safety team acknowledges or updates your alert." value={updates} onValueChange={setUpdates} />
      </Card>
      <Text style={[typography.small, { marginBottom: spacing.md }]}>Notifications never show your location on the lock screen.</Text>
      {msg ? <Text style={{ color: msg.ok ? colors.safe : colors.danger, marginBottom: spacing.md }} accessibilityLiveRegion="polite">{msg.text}</Text> : null}
      <AppButton title="Save preferences" onPress={save} loading={busy} />
    </Screen>
  );
}
