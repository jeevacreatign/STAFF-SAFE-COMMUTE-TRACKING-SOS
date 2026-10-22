/** Exponential backoff with full jitter. attempt starts at 0. */
export function backoffDelay(attempt: number, baseMs = 1_000, maxMs = 60_000, random: () => number = Math.random): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * cap);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
