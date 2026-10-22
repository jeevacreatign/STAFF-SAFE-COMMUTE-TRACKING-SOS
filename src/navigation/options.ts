import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { colors } from '../theme';

export const stackOptions: NativeStackNavigationOptions = {
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: '#FFFFFF',
  headerTitleStyle: { fontWeight: '700' },
  contentStyle: { backgroundColor: colors.background },
  // No transition animation: nothing may delay reaching SOS or Stop Sharing.
  animation: 'none',
};

export const tabOptions: BottomTabNavigationOptions = {
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: '#FFFFFF',
  tabBarActiveTintColor: colors.navy,
  tabBarInactiveTintColor: colors.textMuted,
  tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
  tabBarIcon: () => null,
  tabBarIconStyle: { display: 'none' },
  tabBarStyle: { minHeight: 56 },
};
