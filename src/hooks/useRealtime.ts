import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase/client';
import { backoffDelay } from '../utils/backoff';
import { logger } from '../utils/logger';

type Change = { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Record<string, unknown>; old: Record<string, unknown> };

/**
 * Subscribe to Postgres changes on a table. Supabase Realtime applies the subscriber's RLS,
 * so only rows this user may SELECT are delivered. Duplicate deliveries (same id + updated_at)
 * are ignored; on channel errors it resubscribes with backoff and calls onResync so the screen
 * refetches anything missed while disconnected. The channel is removed on unmount / sign-out.
 */
export function useRealtimeTable(
  key: string,
  table: 'journeys' | 'sos_alerts',
  onChange: (c: Change) => void,
  onResync: () => void,
  filter?: string,
  enabled = true,
) {
  const onChangeRef = useRef(onChange);
  const onResyncRef = useRef(onResync);
  useEffect(() => {
    onChangeRef.current = onChange;
    onResyncRef.current = onResync;
  });

  useEffect(() => {
    if (!enabled) return;
    let channel: RealtimeChannel | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const seen = new Map<string, string>();

    const subscribe = () => {
      if (disposed) return;
      channel = supabase
        .channel(`${key}:${table}:${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, (payload) => {
          const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as Record<string, unknown>;
          const id = String(row.id ?? '');
          const version = String(row.updated_at ?? payload.commit_timestamp ?? '');
          if (id && seen.get(id) === version && payload.eventType !== 'DELETE') return;
          if (id) seen.set(id, version);
          onChangeRef.current(payload as unknown as Change);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            if (attempt > 0) onResyncRef.current();
            attempt = 0;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (disposed) return;
            logger.warn('realtime_channel_issue', { table, status });
            const ch = channel;
            channel = null;
            if (ch) void supabase.removeChannel(ch);
            clearTimeout(timer);
            timer = setTimeout(subscribe, Math.max(1000, backoffDelay(attempt++, 1000, 30_000)));
          }
        });
    };
    subscribe();

    return () => {
      disposed = true;
      clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [key, table, filter, enabled]);
}
