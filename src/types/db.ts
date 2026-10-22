// Row shapes returned by the Supabase API. Kept in sync with supabase/migrations by hand
// (regenerate with `supabase gen types typescript` once a project is linked).
export type UserRole = 'employee' | 'safety_admin';
export type AccountStatus = 'invited' | 'active' | 'suspended' | 'pending_review';
export type JourneyStatus = 'active' | 'safely_arrived' | 'stopped' | 'expired' | 'cancelled';
export type JourneyEndReason = 'safe_arrival' | 'stopped_by_employee' | 'expired' | 'cancelled' | 'account_suspended';
export type SosStatus = 'new' | 'acknowledged' | 'responding' | 'resolved' | 'closed';
export type LocationFreshness = 'fresh' | 'delayed' | 'stale' | 'none';
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface Profile {
  id: string;
  full_name: string;
  employee_ref: string | null;
  role: UserRole;
  organisation_id: string | null;
  account_status: AccountStatus;
  created_at: string;
  updated_at: string;
}

export interface Journey {
  id: string;
  employee_id: string;
  organisation_id: string;
  client_request_id: string;
  label: string;
  destination_label: string | null;
  estimated_arrival_at: string | null;
  consented_at: string;
  consent_version: string;
  sharing_started_at: string;
  expires_at: string;
  ended_at: string | null;
  end_reason: JourneyEndReason | null;
  safe_arrival_at: string | null;
  status: JourneyStatus;
  last_latitude: number | null;
  last_longitude: number | null;
  last_accuracy_m: number | null;
  last_observed_at: string | null;
  last_received_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JourneyWithEmployee extends Journey {
  employee: Pick<Profile, 'id' | 'full_name' | 'employee_ref'> | null;
}

export interface JourneyLocation {
  id: number;
  journey_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  observed_at: string;
  received_at: string;
}

export interface ConsentRecord {
  id: string;
  journey_id: string;
  employee_id: string;
  consent_version: string;
  purpose: string;
  consented_at: string;
  revoked_at: string | null;
  ended_at: string | null;
}

export interface SosAlert {
  id: string;
  journey_id: string;
  employee_id: string;
  organisation_id: string;
  client_request_id: string;
  alert_status: SosStatus;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  location_observed_at: string | null;
  location_freshness: LocationFreshness;
  location_source: 'device' | 'server_last_known' | null;
  created_at: string;
  client_created_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  responding_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  response_notes: string | null;
  updated_at: string;
}

export interface SosAlertWithEmployee extends SosAlert {
  employee: Pick<Profile, 'id' | 'full_name' | 'employee_ref'> | null;
}

export interface SosEvent {
  id: number;
  from_status: SosStatus | null;
  to_status: SosStatus;
  note: string | null;
  created_at: string;
  actor_name: string | null;
}

export interface SosDetail {
  alert: SosAlert;
  employee: Pick<Profile, 'id' | 'full_name' | 'employee_ref'>;
  journey: Pick<
    Journey,
    'id' | 'label' | 'destination_label' | 'status' | 'expires_at' | 'estimated_arrival_at' |
    'last_latitude' | 'last_longitude' | 'last_accuracy_m' | 'last_observed_at'
  > | null;
  events: SosEvent[];
}

export interface JourneyDetail {
  journey: Journey;
  employee: Pick<Profile, 'id' | 'full_name' | 'employee_ref'>;
  consent: ConsentRecord | null;
  recent_locations: JourneyLocation[];
  sos_alerts: Pick<SosAlert, 'id' | 'alert_status' | 'created_at'>[];
}

export interface NotificationPreferences {
  user_id: string;
  journey_reminders: boolean;
  status_updates: boolean;
  reminder_minutes_after_eta: number;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  organisation_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DashboardSummary {
  active_journeys: number;
  safely_completed_today: number;
  expired_today: number;
  open_sos: number;
  new_sos: number;
  failed_notifications_24h: number;
  generated_at: string;
}

export interface RecordLocationsResult {
  journey_status: JourneyStatus;
  accepted: number;
  duplicates: number;
  rejected: number;
  expires_at?: string;
}
