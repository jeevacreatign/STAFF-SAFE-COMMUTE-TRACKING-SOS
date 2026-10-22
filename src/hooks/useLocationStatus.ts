import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getLocalJourney, getLocationStatus, LocalJourney, LocationStatus, subscribeLocationState } from '../services/location/state';

export function useLocationStatus() {
  const [status, setStatus] = useState<LocationStatus | null>(null);
  const [journey, setJourney] = useState<LocalJourney | null>(null);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const [s, j] = await Promise.all([getLocationStatus(), getLocalJourney()]);
      if (alive) {
        setStatus(s);
        setJourney(j);
      }
    };
    void read();
    const unsub = subscribeLocationState(() => void read());
    // Background task writes happen in the same storage; re-read when returning to the app.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void read());
    const poll = setInterval(read, 5000);
    return () => {
      alive = false;
      unsub();
      sub.remove();
      clearInterval(poll);
    };
  }, []);
  return { status, journey };
}
