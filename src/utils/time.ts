export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** "2 min ago", "45 s ago", "3 h ago". */
export function formatAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** Countdown "1 h 05 min" / "4 min 10 s" / "Expired". */
export function formatRemaining(untilIso: string, now: number = Date.now()): string {
  const ms = Date.parse(untilIso) - now;
  if (ms <= 0) return 'Expired';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min ${String(s).padStart(2, '0')} s`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} minutes`;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h} h ${m} min`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
