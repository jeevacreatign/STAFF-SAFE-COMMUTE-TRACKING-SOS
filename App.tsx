import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { NetworkProvider } from './src/context/NetworkContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { configureNotifications } from './src/services/notifications/notificationService';
import { registerAuthAppStateListener } from './src/services/supabase/client';
import { retryPendingSos } from './src/services/sos/sosService';

export default function App() {
  useEffect(() => {
    registerAuthAppStateListener();
    void configureNotifications();
    // Any SOS saved while offline or before a crash is retried on launch.
    void retryPendingSos();
  }, []);
  return (
    <SafeAreaProvider>
      <NetworkProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AuthProvider>
      </NetworkProvider>
    </SafeAreaProvider>
  );
}
