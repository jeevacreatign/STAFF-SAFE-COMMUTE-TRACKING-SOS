import * as Crypto from 'expo-crypto';

/** RFC 4122 v4 UUID from the platform CSPRNG; used as idempotency keys. */
export function newRequestId(): string {
  return Crypto.randomUUID();
}
