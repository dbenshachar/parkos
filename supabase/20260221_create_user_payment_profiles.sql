create extension if not exists pgcrypto;

create table if not exists public.user_payment_profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  email text not null,
  car_make text not null,
  car_model text not null,
  car_color text,
  license_plate text not null,
  license_plate_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_payment_profiles_username_not_empty check (length(trim(username)) > 0),
  constraint user_payment_profiles_password_hash_not_empty check (length(trim(password_hash)) > 0),
  constraint user_payment_profiles_email_not_empty check (length(trim(email)) > 0),
  constraint user_payment_profiles_make_not_empty check (length(trim(car_make)) > 0),
  constraint user_payment_profiles_model_not_empty check (length(trim(car_model)) > 0),
  constraint user_payment_profiles_plate_not_empty check (length(trim(license_plate)) > 0)
);

create index if not exists user_payment_profiles_license_plate_idx
  on public.user_payment_profiles(license_plate);

create or replace function public.set_user_payment_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_payment_profiles_updated_at on public.user_payment_profiles;
create trigger trg_user_payment_profiles_updated_at
before update on public.user_payment_profiles
for each row
execute function public.set_user_payment_profiles_updated_at();

alter table public.user_payment_profiles disable row level security;
