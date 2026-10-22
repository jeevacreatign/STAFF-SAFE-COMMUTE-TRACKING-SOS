import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActiveJourneysScreen } from '../screens/admin/ActiveJourneysScreen';
import { AdminDashboardScreen } from '../screens/admin/AdminDashboardScreen';
import { AdminJourneyDetailScreen } from '../screens/admin/AdminJourneyDetailScreen';
import { AdminMoreScreen } from '../screens/admin/AdminMoreScreen';
import { AuditLogScreen } from '../screens/admin/AuditLogScreen';
import { EmployeeDetailScreen } from '../screens/admin/EmployeeDetailScreen';
import { InviteEmployeeScreen } from '../screens/admin/InviteEmployeeScreen';
import { LiveMapScreen } from '../screens/admin/LiveMapScreen';
import { NotificationFailuresScreen } from '../screens/admin/NotificationFailuresScreen';
import { SOSAlertsScreen } from '../screens/admin/SOSAlertsScreen';
import { SOSDetailScreen } from '../screens/admin/SOSDetailScreen';
import { StaffListScreen } from '../screens/admin/StaffListScreen';
import { ProfileScreen } from '../screens/settings/ProfileScreen';
import type { AdminStackParamList, AdminTabParamList } from '../types/navigation';
import { stackOptions, tabOptions } from './options';

const Tab = createBottomTabNavigator<AdminTabParamList>();
const Stack = createNativeStackNavigator<AdminStackParamList>();

function AdminTabs() {
  return (
    <Tab.Navigator screenOptions={tabOptions}>
      <Tab.Screen name="Dashboard" component={AdminDashboardScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="Journeys" component={ActiveJourneysScreen} options={{ title: 'Active journeys' }} />
      <Tab.Screen name="Alerts" component={SOSAlertsScreen} options={{ title: 'SOS alerts' }} />
      <Tab.Screen name="Staff" component={StaffListScreen} options={{ title: 'Staff' }} />
      <Tab.Screen name="More" component={AdminMoreScreen} options={{ title: 'More' }} />
    </Tab.Navigator>
  );
}

/**
 * Mounted only when the server-side profile role is "safety_admin". Even so, every admin
 * screen's data comes from RLS-protected queries and functions that re-check the role.
 */
export function AdminNavigator() {
  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="AdminTabs" component={AdminTabs} options={{ headerShown: false }} />
      <Stack.Screen name="LiveMap" component={LiveMapScreen} options={{ title: 'Live map' }} />
      <Stack.Screen name="AdminJourneyDetail" component={AdminJourneyDetailScreen} options={{ title: 'Journey' }} />
      <Stack.Screen name="SOSDetail" component={SOSDetailScreen} options={{ title: 'SOS alert', headerStyle: { backgroundColor: '#B3261E' } }} />
      <Stack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} options={{ title: 'Staff member' }} />
      <Stack.Screen name="InviteEmployee" component={InviteEmployeeScreen} options={{ title: 'Invite staff' }} />
      <Stack.Screen name="AuditLog" component={AuditLogScreen} options={{ title: 'Audit log' }} />
      <Stack.Screen name="NotificationFailures" component={NotificationFailuresScreen} options={{ title: 'Delivery problems' }} />
      <Stack.Screen name="AdminProfile" component={ProfileScreen} options={{ title: 'Profile and settings' }} />
    </Stack.Navigator>
  );
}
