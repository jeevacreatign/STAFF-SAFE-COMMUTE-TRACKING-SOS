import { Text } from 'react-native';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { CONSENT_SECTIONS, CONSENT_VERSION } from '../../constants/consent';
import { spacing, typography } from '../../theme';

const RETENTION = [
  ['Precise location points', '7 days after the journey ends (default; your school may set 1–90 days). Never kept for active journeys beyond need.'],
  ['Journey records', 'Status and times kept 180 days by default; the label and destination are then removed.'],
  ['SOS alerts', 'Kept 2 years by default for safety follow-up; coordinates and notes are then removed.'],
  ['Consent records', 'Kept 2 years by default as proof of what you agreed to.'],
  ['Security audit log', 'Kept 2 years by default. Does not contain your coordinates.'],
  ['Notification records', '90 days by default.'],
];

export function PrivacyScreen() {
  return (
    <Screen>
      <Card title="How location sharing works">
        {CONSENT_SECTIONS.map((s) => (
          <Text key={s.title} style={[typography.body, { marginBottom: spacing.sm }]}><Text style={typography.label}>{s.title}: </Text>{s.body}</Text>
        ))}
        <Text style={typography.small}>Consent text version {CONSENT_VERSION}</Text>
      </Card>
      <Card title="What is never done">
        <Text style={typography.body}>• No location is collected outside a journey you approved.</Text>
        <Text style={typography.body}>• Administrators cannot start or resume sharing for you.</Text>
        <Text style={typography.body}>• Location is not used for attendance, productivity or any other purpose.</Text>
        <Text style={typography.body}>• Other staff cannot see your location.</Text>
      </Card>
      <Card title="How long data is kept">
        {RETENTION.map(([k, v]) => (
          <Text key={k} style={[typography.body, { marginBottom: spacing.sm }]}><Text style={typography.label}>{k}: </Text>{v}</Text>
        ))}
        <Text style={typography.small}>These are the system defaults. Your organisation’s approved policy may differ; ask your safety administrator.</Text>
      </Card>
    </Screen>
  );
}
