alter table public.user_payment_profiles enable row level security;
alter table public.parking_sessions enable row level security;
alter table public.parking_notifications enable row level security;
alter table public.parking_rule_cache enable row level security;

drop policy if exists service_role_full_access_user_payment_profiles on public.user_payment_profiles;
create policy service_role_full_access_user_payment_profiles
on public.user_payment_profiles
for all
to service_role
using (true)
with check (true);

drop policy if exists service_role_full_access_parking_sessions on public.parking_sessions;
create policy service_role_full_access_parking_sessions
on public.parking_sessions
for all
to service_role
using (true)
with check (true);

drop policy if exists service_role_full_access_parking_notifications on public.parking_notifications;
create policy service_role_full_access_parking_notifications
on public.parking_notifications
for all
to service_role
using (true)
with check (true);

drop policy if exists service_role_full_access_parking_rule_cache on public.parking_rule_cache;
create policy service_role_full_access_parking_rule_cache
on public.parking_rule_cache
for all
to service_role
using (true)
with check (true);
