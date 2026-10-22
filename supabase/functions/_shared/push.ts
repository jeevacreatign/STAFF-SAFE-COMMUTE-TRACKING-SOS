// Pure helpers for building Expo push messages from outbox rows. No I/O, so they are unit-tested.

export type OutboxRow = {
  id: string;
  recipient_id: string;
  event_type: string;
  related_journey_id: string | null;
  related_alert_id: string | null;
  tokens: string[];
  attempts: number;
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  channelId: string;
  priority: 'default' | 'high';
  sound?: 'default';
};

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

// Notification text is deliberately generic: no names, places or coordinates on a lock screen.
const TEMPLATES: Record<string, { title: string; body: string; channelId: string; priority: 'default' | 'high' }> = {
  sos_created: {
    title: 'SOS alert raised',
    body: 'A staff member has raised an SOS. Open the app to respond.',
    channelId: 'sos-alerts',
    priority: 'high',
  },
  sos_status_changed: {
    title: 'SOS update',
    body: 'The safety team has updated your alert. Open the app for details.',
    channelId: 'journey-updates',
    priority: 'high',
  },
  journey_safely_arrived: {
    title: 'Safe arrival confirmed',
    body: 'A staff member confirmed safe arrival.',
    channelId: 'journey-updates',
    priority: 'default',
  },
  journey_stopped: {
    title: 'Location sharing stopped',
    body: 'A staff member stopped sharing their journey.',
    channelId: 'journey-updates',
    priority: 'default',
  },
  journey_expired: {
    title: 'Journey expired',
    body: 'A journey reached its expiry time without safe-arrival confirmation.',
    channelId: 'journey-updates',
    priority: 'default',
  },
  journey_reminder: {
    title: 'Have you arrived?',
    body: 'Your journey is still sharing location. Confirm safe arrival or stop sharing.',
    channelId: 'journey-updates',
    priority: 'default',
  },
  account_status_changed: {
    title: 'Account update',
    body: 'Your account status has changed.',
    channelId: 'journey-updates',
    priority: 'default',
  },
};

export function buildMessages(row: OutboxRow): ExpoMessage[] {
  const t = TEMPLATES[row.event_type];
  if (!t) return [];
  const data: Record<string, string> = { type: row.event_type, notificationId: row.id };
  if (row.related_alert_id) data.alertId = row.related_alert_id;
  if (row.related_journey_id) data.journeyId = row.related_journey_id;
  return row.tokens.map((to) => ({
    to,
    title: t.title,
    body: t.body,
    data,
    channelId: t.channelId,
    priority: t.priority,
    ...(t.priority === 'high' ? { sound: 'default' as const } : {}),
  }));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type Outcome = { status: 'sent' | 'failed' | 'pending' | 'skipped'; error: string | null; deadTokens: string[] };

/**
 * Decide a notification's outcome from its tickets. "sent" means Expo accepted at least one
 * message; it is not proof the device displayed it.
 */
export function summarise(tokens: string[], tickets: (ExpoTicket | undefined)[]): Outcome {
  if (tokens.length === 0) return { status: 'skipped', error: 'no_registered_device', deadTokens: [] };
  const dead: string[] = [];
  let ok = 0;
  let transient = 0;
  const errors = new Set<string>();
  tickets.forEach((ticket, i) => {
    if (!ticket) {
      transient++;
      errors.add('no_ticket');
    } else if (ticket.status === 'ok') {
      ok++;
    } else if (ticket.details?.error === 'DeviceNotRegistered') {
      dead.push(tokens[i]);
      errors.add('DeviceNotRegistered');
    } else {
      transient++;
      errors.add(ticket.details?.error ?? 'expo_error');
    }
  });
  if (ok > 0) return { status: 'sent', error: null, deadTokens: dead };
  if (transient > 0) return { status: 'pending', error: [...errors].join(','), deadTokens: dead };
  return { status: 'failed', error: [...errors].join(','), deadTokens: dead };
}
