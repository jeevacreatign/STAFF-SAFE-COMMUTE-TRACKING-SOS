import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError, toAppError } from '../utils/errors';

/**
 * Load data on mount and whenever `key` changes. The latest `load` function is always used.
 * Results from superseded requests and from unmounted components are dropped.
 */
export function useAsync<T>(load: () => Promise<T>, key: string | number | undefined = '') {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const seq = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const run = useCallback(async (mode: 'initial' | 'reload' | 'refresh') => {
    const id = ++seq.current;
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'reload') setLoading(true);
    try {
      const result = await loadRef.current();
      if (mounted.current && id === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (mounted.current && id === seq.current) setError(toAppError(e));
    } finally {
      if (mounted.current && id === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void run('initial');
    return () => {
      mounted.current = false;
    };
  }, [run, key]);

  return {
    data,
    error,
    loading,
    refreshing,
    reload: () => run('reload'),
    refresh: () => run('refresh'),
    setData,
  };
}
