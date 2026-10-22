import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { flushQueue } from '../services/location/uploader';
import { retryPendingSos } from '../services/sos/sosService';
import { logger } from '../utils/logger';

interface NetworkValue {
  /** null while unknown. Reachability is a hint: only a server response proves delivery. */
  online: boolean | null;
  lastChangeAt: number;
}

const NetworkContext = createContext<NetworkValue>({ online: null, lastChangeAt: Date.now() });

export function isOnline(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean | null {
  if (state.isConnected === false || state.isInternetReachable === false) return false;
  if (state.isConnected === true) return true;
  return null;
}

export function NetworkProvider({ children, onReconnect }: { children: React.ReactNode; onReconnect?: () => void }) {
  const [value, setValue] = useState<NetworkValue>(() => ({ online: null, lastChangeAt: Date.now() }));
  const prev = useRef<boolean | null>(null);
  const reconnectRef = useRef(onReconnect);
  useEffect(() => {
    reconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const online = isOnline(state);
      if (online !== prev.current) {
        if (online && prev.current === false) {
          logger.info('network_restored');
          // Reconnected: send anything waiting. Order matters: SOS first.
          void retryPendingSos().finally(() => void flushQueue());
          reconnectRef.current?.();
        }
        prev.current = online;
        setValue({ online, lastChangeAt: Date.now() });
      }
    });
    return unsub;
  }, []);

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export const useNetwork = () => useContext(NetworkContext);
