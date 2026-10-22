import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card, KeyValue } from '../../components/Card';
import { Chips } from '../../components/Controls';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { JOURNEY_LIMITS } from '../../constants/location';
import { journeySetupSchema, parseMinutes } from '../../schemas/journey';
import { fieldErrors } from '../../schemas/validate';
import { colors, spacing, typography } from '../../theme';
import type { StaffStackParamList } from '../../types/navigation';
import { addMinutes, formatDuration } from '../../utils/time';

type Props = NativeStackScreenProps<StaffStackParamList, 'JourneySetup'>;

const EXPIRY_OPTIONS = [30, 60, 90, 120, 180].map((m) => ({ value: m, label: formatDuration(m) }));
const ETA_OPTIONS = [15, 30, 45, 60].map((m) => ({ value: m, label: `${m} min` }));

export function JourneySetupScreen({ navigation }: Props) {
  const [label, setLabel] = useState('Commute home');
  const [destination, setDestination] = useState('');
  const [etaText, setEtaText] = useState('');
  const [expiryText, setExpiryText] = useState(String(JOURNEY_LIMITS.defaultExpiryMinutes));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const expiryMinutes = parseMinutes(expiryText);
  const preview = useMemo(() => {
    if (!expiryMinutes || Number.isNaN(expiryMinutes)) return null;
    return addMinutes(new Date(), expiryMinutes);
  }, [expiryMinutes]);

  const next = () => {
    const v = fieldErrors(journeySetupSchema, {
      label,
      destination,
      etaMinutes: parseMinutes(etaText),
      expiryMinutes: parseMinutes(expiryText),
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    navigation.navigate('Consent', { setup: v.data });
  };

  return (
    <Screen footer={<AppButton title="Review and decide" onPress={next} testID="setup-next" />}>
      <Card title="Journey details">
        <TextField label="Journey label" value={label} onChangeText={setLabel} maxLength={80} error={errors.label} testID="label-input" />
        <TextField label="Destination (optional)" value={destination} onChangeText={setDestination} maxLength={120}
          hint="A place name is enough, for example “Home” or “Station”." error={errors.destination} />
      </Card>
      <Card title="Expected arrival (optional)">
        <Chips label="Expected arrival" options={ETA_OPTIONS} value={parseMinutes(etaText)} onChange={(v) => setEtaText(String(v))} />
        <TextField label="Minutes from now" value={etaText} onChangeText={setEtaText} keyboardType="number-pad" error={errors.etaMinutes} testID="eta-input" />
      </Card>
      <Card title="Stop sharing automatically after">
        <Chips label="Sharing duration" options={EXPIRY_OPTIONS} value={expiryMinutes} onChange={(v) => setExpiryText(String(v))} />
        <TextField label="Minutes from now" value={expiryText} onChangeText={setExpiryText} keyboardType="number-pad"
          hint="Between 5 minutes and 12 hours." error={errors.expiryMinutes} testID="expiry-input" />
        {preview ? (
          <KeyValue label="Proposed sharing" value={`${formatDuration(expiryMinutes!)} (until about ${preview.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`} />
        ) : null}
      </Card>
      <Text style={[typography.small, { color: colors.textMuted, marginTop: spacing.sm }]}>
        Times are counted from when you approve on the next screen.
      </Text>
    </Screen>
  );
}
