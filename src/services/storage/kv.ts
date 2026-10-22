import AsyncStorage from '@react-native-async-storage/async-storage';

// Non-secret app state (queues, active journey pointer). Available to the background task.
export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function remove(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

export const KEYS = {
  activeJourney: 'ssc.activeJourney.v1',
  locationQueue: 'ssc.locationQueue.v1',
  locationStatus: 'ssc.locationStatus.v1',
  sosOutbox: 'ssc.sosOutbox.v1',
  pushToken: 'ssc.pushToken.v1',
};
