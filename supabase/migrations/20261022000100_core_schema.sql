-- Staff Safe Commute: core schema
-- Tables, enums, constraints and indexes. Access control lives in 20261022000200_security.sql.

create type public.user_role as enum ('employee', 'safety_admin');
create type public.account_status as enum ('invited', 'active', 'suspended', 'pending_review');
create type public.journey_status as enum ('active', 'safely_arrived', 'stopped', 'expired', 'cancelled');
create type public.journey_end_reason as enum ('safe_arrival', 'stopped_by_employee', 'expired', 'cancelled', 'account_suspended');
create type public.sos_status as enum ('new', 'acknowledged', 'responding', 'resolved', 'closed');
create type public.location_freshness as enum ('fresh', 'delayed', 'stale', 'none');
create type public.delivery_status as enum ('pending', 'sent', 'failed', 'skipped');

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  employee_ref text check (employee_ref is null or char_length(employee_ref) <= 40),
  role public.user_role not null default 'employee',
  organisation_id uuid references public.organisations (id) on delete restrict,
  account_status public.account_status not null default 'pending_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint active_requires_org check (account_status <> 'active' or organisation_id is not null)
);
create index profiles_org_idx on public.profiles (organisation_id);

-- Which organisations a safety admin may oversee. Written only by trusted backend code.
create table public.admin_assignments (
  admin_id uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (admin_id, organisation_id)
);
create index admin_assignments_org_idx on public.admin_assignments (organisation_id);

-- Versioned consent text. The app shows the active version and sends its id back on journey start.
create table public.consent_versions (
  version text primary key check (char_length(version) between 1 and 20),
  purpose text not null,
  summary text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index consent_versions_one_active on public.consent_versions (is_active) where is_active;

create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  client_request_id uuid not null,
  label text not null check (char_length(label) between 1 and 80),
  destination_label text check (destination_label is null or char_length(destination_label) <= 120),
  estimated_arrival_at timestamptz,
  consented_at timestamptz not null,
  consent_version text not null references public.consent_versions (version),
  sharing_started_at timestamptz not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason public.journey_end_reason,
  safe_arrival_at timestamptz,
  status public.journey_status not null default 'active',
  -- Latest known position. Cleared when the journey ends so ended journeys are never shown as live.
  last_latitude double precision check (last_latitude between -90 and 90),
  last_longitude double precision check (last_longitude between -180 and 180),
  last_accuracy_m real check (last_accuracy_m >= 0),
  last_observed_at timestamptz,
  last_received_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journey_client_request_unique unique (employee_id, client_request_id),
  constraint expiry_after_start check (expires_at > sharing_started_at),
  constraint expiry_max_window check (expires_at <= sharing_started_at + interval '12 hours'),
  constraint eta_within_window check (
    estimated_arrival_at is null
    or (estimated_arrival_at > consented_at and estimated_arrival_at <= expires_at)
  ),
  constraint consent_before_sharing check (consented_at <= sharing_started_at),
  constraint terminal_state_consistent check (
    (status = 'active' and ended_at is null and end_reason is null)
    or (status <> 'active' and ended_at is not null and end_reason is not null)
  ),
  constraint ended_journey_has_no_live_position check (
    status = 'active' or (last_latitude is null and last_longitude is null)
  ),
  constraint arrival_timestamp_consistent check (
    (status = 'safely_arrived') = (safe_arrival_at is not null)
  )
);
-- At most one active journey per employee.
create unique index journeys_one_active_per_employee on public.journeys (employee_id) where status = 'active';
create index journeys_org_status_idx on public.journeys (organisation_id, status);
create index journeys_active_expiry_idx on public.journeys (expires_at) where status = 'active';
create index journeys_employee_created_idx on public.journeys (employee_id, created_at desc);

create table public.journey_locations (
  id bigint generated always as identity primary key,
  journey_id uuid not null references public.journeys (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m real check (accuracy_m >= 0),
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint journey_location_dedupe unique (journey_id, observed_at)
);
create index journey_locations_journey_observed_idx on public.journey_locations (journey_id, observed_at desc);
create index journey_locations_received_idx on public.journey_locations (received_at);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null unique references public.journeys (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  consent_version text not null references public.consent_versions (version),
  purpose text not null,
  consented_at timestamptz not null,
  revoked_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index consent_records_employee_idx on public.consent_records (employee_id, consented_at desc);

create table public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  client_request_id uuid not null,
  alert_status public.sos_status not null default 'new',
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  accuracy_m real check (accuracy_m >= 0),
  location_observed_at timestamptz,
  location_freshness public.location_freshness not null default 'none',
  location_source text check (location_source in ('device', 'server_last_known')),
  created_at timestamptz not null default now(),
  client_created_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles (id),
  responding_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  response_notes text check (response_notes is null or char_length(response_notes) <= 4000),
  updated_at timestamptz not null default now(),
  constraint sos_client_request_unique unique (employee_id, client_request_id),
  constraint sos_location_all_or_nothing check (
    (latitude is null) = (longitude is null)
    and (latitude is null) = (location_observed_at is null)
  )
);
create index sos_alerts_org_status_idx on public.sos_alerts (organisation_id, alert_status, created_at desc);
create index sos_alerts_employee_idx on public.sos_alerts (employee_id, created_at desc);

create table public.sos_alert_events (
  id bigint generated always as identity primary key,
  alert_id uuid not null references public.sos_alerts (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  from_status public.sos_status,
  to_status public.sos_status not null,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index sos_alert_events_alert_idx on public.sos_alert_events (alert_id, created_at);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  journey_reminders boolean not null default true,
  status_updates boolean not null default true,
  reminder_minutes_after_eta integer not null default 15 check (reminder_minutes_after_eta between 5 and 240),
  updated_at timestamptz not null default now()
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique check (char_length(token) <= 255),
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

-- Outbox for push notifications. Payloads never contain coordinates.
create table public.notification_records (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid references public.organisations (id) on delete cascade,
  event_type text not null check (event_type in (
    'sos_created', 'sos_status_changed', 'journey_safely_arrived', 'journey_stopped',
    'journey_expired', 'journey_reminder', 'account_status_changed'
  )),
  related_journey_id uuid references public.journeys (id) on delete set null,
  related_alert_id uuid references public.sos_alerts (id) on delete set null,
  delivery_status public.delivery_status not null default 'pending',
  attempts integer not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index notification_records_pending_idx on public.notification_records (created_at) where delivery_status = 'pending';
create index notification_records_recipient_idx on public.notification_records (recipient_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  organisation_id uuid references public.organisations (id),
  action text not null check (char_length(action) <= 80),
  resource_type text not null check (char_length(resource_type) <= 40),
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 2048),
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organisation_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at);

create table public.retention_settings (
  organisation_id uuid primary key references public.organisations (id) on delete cascade,
  location_history_days integer not null default 7 check (location_history_days between 1 and 90),
  journey_record_days integer not null default 180 check (journey_record_days between 7 and 3650),
  sos_alert_days integer not null default 730 check (sos_alert_days between 30 and 3650),
  consent_record_days integer not null default 730 check (consent_record_days between 30 and 3650),
  audit_log_days integer not null default 730 check (audit_log_days between 90 and 3650),
  notification_record_days integer not null default 90 check (notification_record_days between 7 and 365),
  updated_at timestamptz not null default now()
);
