import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { JourneyStatusBadge } from '../../components/Badges';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { spacing, typography } from '../../theme';
import type { StaffStackParamList } from '../../types/navigation';

type Props = NativeStackScreenProps<StaffStackParamList, 'JourneyCompleted'>;

const MESSAGE = {
  safely_arrived: 'Safe arrival recorded. Location sharing has stopped.',
  stopped: 'Location sharing has stopped.',
  expired: 'This journey reached its expiry time and sharing ended automatically. Start a new journey if you need to share again.',
  cancelled: 'The journey was cancelled before any location was shared.',
  active: 'This journey is still active.',
};

export function JourneyCompletedScreen({ route, navigation }: Props) {
  const { journeyId, status, confirmed } = route.params;
  return (
    <Screen footer={<>
      <AppButton title="Back to home" onPress={() => navigation.reset({ index: 0, routes: [{ name: 'StaffTabs' }] })} testID="completed-home" />
      <AppButton title="View journey details" variant="secondary" onPress={() => navigation.navigate('JourneyDetails', { journeyId })} />
    </>}>
      <Card tone={status === 'safely_arrived' ? 'safe' : undefined} title="Journey ended">
        <JourneyStatusBadge status={status} />
        <Text style={[typography.body, { marginTop: spacing.md }]}>{MESSAGE[status]}</Text>
      </Card>
      {!confirmed ? (
        <Card tone="warning" title="Waiting for server confirmation">
          <Text style={typography.body}>
            Sharing has stopped on this phone, but the server has not confirmed yet because you are offline. It will be sent automatically when you reconnect. The server also ends the journey at its expiry time regardless.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
