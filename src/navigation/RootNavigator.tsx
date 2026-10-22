import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import React, { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { AccountInactiveScreen, ConfigMissingScreen, ProfileErrorScreen } from '../screens/auth/AccountStateScreens';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { SetNewPasswordScreen } from '../screens/auth/SetNewPasswordScreen';
import { SignInScreen } from '../screens/auth/SignInScreen';
import { SplashScreen } from '../screens/auth/SplashScreen';
import type { AuthStackParamList } from '../types/navigation';
import { AdminNavigator } from './AdminNavigator';
import { navigationRef } from './navigationRef';
import { stackOptions } from './options';
import { StaffNavigator } from './StaffNavigator';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={stackOptions}>
      <AuthStack.Screen name="SignIn" component={SignInScreen} options={{ title: 'Staff Safe Commute' }} />
      <AuthStack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: 'Reset password' }} />
    </AuthStack.Navigator>
  );
}

/** Opens the relevant screen when a notification is tapped, within the current role only. */
function useNotificationRouting(role: 'admin' | 'employee' | null) {
  useEffect(() => {
    if (!role) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: string; alertId?: string; journeyId?: string };
      if (!navigationRef.isReady()) return;
      const nav = navigationRef as unknown as { navigate: (name: string, params?: object) => void };
      if (role === 'admin' && data.alertId) nav.navigate('SOSDetail', { alertId: data.alertId });
      else if (role === 'admin' && data.journeyId) nav.navigate('AdminJourneyDetail', { journeyId: data.journeyId });
      else if (role === 'employee' && data.type === 'journey_reminder') nav.navigate('ActiveJourney');
      else if (role === 'employee' && data.journeyId) nav.navigate('JourneyDetails', { journeyId: data.journeyId });
    });
    return () => sub.remove();
  }, [role]);
}

export function RootNavigator() {
  const { status } = useAuth();
  useNotificationRouting(status === 'admin' ? 'admin' : status === 'employee' ? 'employee' : null);

  let content: React.ReactNode;
  switch (status) {
    case 'loading': content = <SplashScreen />; break;
    case 'needs_config': content = <ConfigMissingScreen />; break;
    case 'signed_out': content = <AuthNavigator />; break;
    case 'recovery': content = <SetNewPasswordScreen />; break;
    case 'inactive': content = <AccountInactiveScreen />; break;
    case 'profile_error': content = <ProfileErrorScreen />; break;
    case 'admin': content = <AdminNavigator key="admin" />; break;
    case 'employee': content = <StaffNavigator key="employee" />; break;
  }
  return <NavigationContainer ref={navigationRef}>{content}</NavigationContainer>;
}
