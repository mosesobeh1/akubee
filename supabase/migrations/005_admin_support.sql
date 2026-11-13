-- Phase 6: admin support. Fulfilment fields and audit-log writes from the dashboard.
alter table public.orders add column if not exists tracking_info text;
alter table public.orders add column if not exists fulfilment_notes text;
-- Admins may add audit entries, but only under their own user id.
create policy "admin write audit" on public.audit_logs for insert with check (public.is_admin() and actor_id = auth.uid());
-- Grant the first admin (run once in the SQL editor, using the email of an existing account):
--   insert into public.user_roles(user_id, role) select id, 'admin' from auth.users where email = 'owner@example.com';
