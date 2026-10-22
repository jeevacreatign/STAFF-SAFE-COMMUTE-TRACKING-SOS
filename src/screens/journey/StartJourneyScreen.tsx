import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { spacing, typography } from '../../theme';
import type { StaffStackParamList } from '../../types/navigation';

type Props = NativeStackScreenProps<StaffStackParamList, 'StartJourney'>;

export function StartJourneyScreen({ navigation }: Props) {
  return (
    <Screen
      footer={
        <>
          <AppButton title="Continue" onPress={() => navigation.navigate('JourneySetup')} testID="start-continue" />
          <AppButton title="Not now" variant="ghost" onPress={() => navigation.goBack()} />
        </>
      }
    >
      <Text style={[typography.title, { marginBottom: spacing.lg }]} accessibilityRole="header">Start Safe Journey</Text>
      <Card title="What happens next">
        <Text style={typography.body}>1. Describe the journey and choose when sharing should end.</Text>
        <Text style={typography.body}>2. Read exactly what is shared and with whom, then decide.</Text>
        <Text style={typography.body}>3. Only if you approve, Android asks for location permission and sharing begins.</Text>
      </Card>
      <Card>
        <Text style={typography.bodyMuted}>
          Nothing is collected until you approve. You can stop sharing, confirm safe arrival, or raise an SOS at any time during the journey.
        </Text>
      </Card>
    </Screen>
  );
}
