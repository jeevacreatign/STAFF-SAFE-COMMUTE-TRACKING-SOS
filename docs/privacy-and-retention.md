# Privacy and retention

## Principles implemented

| Principle | How it is enforced |
|---|---|
| Explicit, per-journey consent | `start_journey` refuses without `p_consent_given = true` and the active `consent_versions` row; a `consent_records` row is written in the same transaction. |
| No collection before consent | The OS location service starts only after the server created the journey (unit-tested order). The task also drops any fix observed before `sharing_started_at` (client and server). |
| Stop any time, no approval | Stop / safe arrival stop the service on the device first, then tell the server; offline stops are queued and retried. |
| Expiry enforced server-side | `record_locations` checks `expires_at` on every call and marks the journey expired; `pg_cron` expires the rest every minute. |
| Admins cannot start or resume tracking | No function lets an admin create, extend or resume a journey. `start_journey` rejects admin accounts. |
| Ended journeys are not live | Live coordinates are cleared from `journeys` when a journey ends; admins can only read breadcrumbs for active journeys (RLS). |
| Minimal data | Location: lat, lng, accuracy, observed/received time. No speed, heading, altitude, address or device identifiers. |
| No coordinates in logs/notifications | Audit metadata never includes coordinates (tested). Push text is generic. App logger redacts location keys. |
| Purpose limitation | Data is used for safety only; there is no attendance or productivity feature, and none should be added. |
| Declining has no effect | Declining returns home; nothing is created or recorded. |

## Retention (defaults; per organisation in `retention_settings`)

| Data | Default | What happens |
|---|---|---|
| `journey_locations` (precise breadcrumbs) | 7 days after receipt, only for ended journeys | Deleted |
| `journeys` | 180 days after end | Label and destination replaced; status and timestamps kept |
| `sos_alerts` (resolved/closed) | 730 days | Coordinates and notes removed; event history notes removed |
| `consent_records` | 730 days after journey end | Deleted |
| `notification_records` | 90 days | Deleted (non-pending) |
| `audit_logs` | 730 days | Deleted by the retention job only (trigger blocks all other deletes/updates) |

`run_retention_cleanup()` runs daily via `pg_cron` and writes a `retention.cleanup` audit entry with counts. Change values with SQL (service role) after the data-protection owner approves them. Ranges are constrained in the table definition.

These defaults are engineering placeholders, **not legal advice**. The school's data-protection owner must approve the values, the consent wording and the privacy notice before a pilot.

## Data subject requests

- Access: staff can see their own journeys, consent records and SOS alerts in the app. A full export can be produced with SQL filtered by `employee_id`.
- Deletion: deleting the auth user cascades to profile, journeys, locations, consent records and SOS alerts. Audit entries keep the actor id (no personal data) unless removed by retention.

## Audit events

`account.created`, `account.invited`, `account.invitation_applied`, `account.status_changed`, `auth.sign_in`, `auth.sign_out` (client-reported; Supabase Auth also keeps its own server-side log), `journey.created`, `consent.granted`, `location_sharing.started`, `location_sharing.ended`, `journey.ended`, `sos.created`, `sos.status_changed`, `sos.note_added`, `admin.viewed_journey`, `admin.viewed_sos`, `notification.failed`, `retention.cleanup`.
