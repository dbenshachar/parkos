create extension if not exists pgcrypto;

alter table public.user_payment_profiles
  add column if not exists phone_e164 text,
  add column if not exists sms_opt_in boolean not null default false,
  add column if not exists sms_opt_in_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_payment_profiles_phone_e164_format'
  ) THEN
    ALTER TABLE public.user_payment_profiles
      ADD CONSTRAINT user_payment_profiles_phone_e164_format
      CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
  END IF;
END
$$;

create table if not exists public.parking_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.user_payment_profiles(id) on delete cascade,
  status text not null,
  parked_lat double precision not null,
  parked_lng double precision not null,
  parked_accuracy_meters double precision,
  captured_zone_number text,
  captured_rate text,
  captured_category text not null default 'none',
  confirmed_zone_number text,
  duration_minutes integer,
  starts_at timestamptz,
  expires_at timestamptz,
  resume_token text not null unique,
  rules_context_json jsonb,
  rules_rundown_json jsonb,
  renew_parent_session_id uuid references public.parking_sessions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parking_sessions_status_check
    check (status in ('captured', 'active', 'renewed', 'expired', 'cancelled')),
  constraint parking_sessions_captured_category_check
    check (captured_category in ('paid', 'residential', 'none')),
  constraint parking_sessions_duration_positive
    check (duration_minutes is null or duration_minutes > 0)
);

create index if not exists parking_sessions_profile_idx
  on public.parking_sessions(profile_id, created_at desc);

create index if not exists parking_sessions_status_idx
  on public.parking_sessions(status, created_at desc);

create index if not exists parking_sessions_resume_token_idx
  on public.parking_sessions(resume_token);

create table if not exists public.parking_notifications (
  id uuid primary key default gen_random_uuid(),
  parking_session_id uuid not null references public.parking_sessions(id) on delete cascade,
  profile_id uuid not null references public.user_payment_profiles(id) on delete cascade,
  notification_type text not null,
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  last_error text,
  twilio_message_sid text,
  message_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parking_notifications_type_check
    check (notification_type in ('payment_confirmed', 'post_payment_info', 'renew_reminder', 'parking_expired')),
  constraint parking_notifications_status_check
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  constraint parking_notifications_attempt_count_non_negative
    check (attempt_count >= 0)
);

create unique index if not exists parking_notifications_unique_session_type_idx
  on public.parking_notifications(parking_session_id, notification_type);

create index if not exists parking_notifications_due_idx
  on public.parking_notifications(status, scheduled_at)
  where status = 'queued';

create index if not exists parking_notifications_profile_idx
  on public.parking_notifications(profile_id, created_at desc);

create table if not exists public.parking_rule_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null,
  source_url text not null,
  facts_json jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists parking_rule_cache_unique_idx
  on public.parking_rule_cache(cache_key, source_url);

create index if not exists parking_rule_cache_expires_idx
  on public.parking_rule_cache(expires_at desc);

create or replace function public.set_parking_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_parking_sessions_updated_at on public.parking_sessions;
create trigger trg_parking_sessions_updated_at
before update on public.parking_sessions
for each row
execute function public.set_parking_sessions_updated_at();

create or replace function public.set_parking_notifications_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_parking_notifications_updated_at on public.parking_notifications;
create trigger trg_parking_notifications_updated_at
before update on public.parking_notifications
for each row
execute function public.set_parking_notifications_updated_at();

create or replace function public.set_parking_rule_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_parking_rule_cache_updated_at on public.parking_rule_cache;
create trigger trg_parking_rule_cache_updated_at
before update on public.parking_rule_cache
for each row
execute function public.set_parking_rule_cache_updated_at();

alter table public.parking_sessions disable row level security;
alter table public.parking_notifications disable row level security;
alter table public.parking_rule_cache disable row level security;
