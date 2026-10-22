import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActiveJourneyScreen } from '../screens/journey/ActiveJourneyScreen';
import { ConsentScreen } from '../screens/journey/ConsentScreen';
import { JourneySetupScreen } from '../screens/journey/JourneySetupScreen';
import { StartJourneyScreen } from '../screens/journey/StartJourneyScreen';
import { NotificationPrefsScreen } from '../screens/settings/NotificationPrefsScreen';
import { PrivacyScreen } from '../screens/settings/PrivacyScreen';
import { ProfileScreen } from '../screens/settings/ProfileScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { TroubleshootingScreen } from '../screens/settings/TroubleshootingScreen';
import { SOSStatusScreen } from '../screens/sos/SOSStatusScreen';
import { JourneyCompletedScreen } from '../screens/staff/JourneyCompletedScreen';
import { JourneyDetailsScreen } from '../screens/staff/JourneyDetailsScreen';
import { JourneyHistoryScreen } from '../screens/staff/JourneyHistoryScreen';
import { StaffHomeScreen } from '../screens/staff/StaffHomeScreen';
import type { StaffStackParamList, StaffTabParamList } from '../types/navigation';
import { stackOptions, tabOptions } from './options';

const Tab = createBottomTabNavigator<StaffTabParamList>();
const Stack = createNativeStackNavigator<StaffStackParamList>();

function StaffTabs() {
  return (
    <Tab.Navigator screenOptions={tabOptions}>
      <Tab.Screen name="Home" component={StaffHomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="History" component={JourneyHistoryScreen} options={{ title: 'My journeys' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

/** Mounted only when the server-side profile role is "employee". */
export function StaffNavigator() {
  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="StaffTabs" component={StaffTabs} options={{ headerShown: false }} />
      <Stack.Screen name="StartJourney" component={StartJourneyScreen} options={{ title: 'Start Safe Journey' }} />
      <Stack.Screen name="JourneySetup" component={JourneySetupScreen} options={{ title: 'Journey setup' }} />
      <Stack.Screen name="Consent" component={ConsentScreen} options={{ title: 'Review and approve' }} />
      <Stack.Screen name="ActiveJourney" component={ActiveJourneyScreen} options={{ title: 'Active journey' }} />
      <Stack.Screen name="SOSStatus" component={SOSStatusScreen} options={{ title: 'SOS status', headerStyle: { backgroundColor: '#B3261E' } }} />
      <Stack.Screen name="JourneyCompleted" component={JourneyCompletedScreen} options={{ title: 'Journey ended', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="JourneyDetails" component={JourneyDetailsScreen} options={{ title: 'Journey details' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: 'Privacy and retention' }} />
      <Stack.Screen name="NotificationPrefs" component={NotificationPrefsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="Troubleshooting" component={TroubleshootingScreen} options={{ title: 'Location troubleshooting' }} />
    </Stack.Navigator>
  );
}
