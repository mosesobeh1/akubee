-- Phase 7: rate limiting, Turnstile gate, wishlist, order tracking.
create table public.rate_limits (id bigserial primary key, scope text not null, key text not null, created_at timestamptz not null default now());
create index on public.rate_limits (scope, key, created_at);
alter table public.rate_limits enable row level security; -- no policies: internal only

create or replace function public.client_key() returns text language sql stable as $$
  select coalesce(split_part(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'cf-connecting-ip',
                                      nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for'), ',', 1), 'unknown') $$;

create or replace function public.rate_limit(p_scope text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = public as $$
declare k text := public.client_key(); n int;
begin
  if k = 'unknown' or k = '' then return; end if;          -- e.g. SQL editor
  if random() < 0.02 then delete from public.rate_limits where created_at < now() - interval '1 day'; end if;
  select count(*) into n from public.rate_limits where scope = p_scope and key = k and created_at > now() - p_window;
  if n >= p_max then raise exception 'Too many requests. Please try again later.'; end if;
  insert into public.rate_limits(scope, key) values (p_scope, k);
end $$;

create or replace function public.enforce_rate_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.rate_limit(tg_argv[0], tg_argv[1]::int, tg_argv[2]::interval); return new; end $$;
create trigger orders_rl before insert on public.orders for each row execute function public.enforce_rate_limit('order', '10', '1 hour');
create trigger quotes_rl before insert on public.quotation_requests for each row execute function public.enforce_rate_limit('quote', '10', '1 hour');
create trigger distributors_rl before insert on public.distributor_applications for each row execute function public.enforce_rate_limit('distributor', '5', '1 hour');
create trigger wholesale_rl before insert on public.wholesale_applications for each row execute function public.enforce_rate_limit('wholesale', '5', '1 hour');

-- The browser can no longer call the public form functions directly. They run only through the
-- submit-form Edge Function, which verifies Cloudflare Turnstile first and passes the caller's identity.
create or replace function public.gate_call(p_fn text, p_user uuid, p_ip text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', case when p_user is null then 'anon' else 'authenticated' end)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.headers', jsonb_build_object('x-forwarded-for', coalesce(p_ip, 'unknown'))::text, true);
  if p_fn = 'place_order' then return public.place_order(p_args->'p_customer', p_args->'p_items'); end if;
  if p_fn = 'submit_quotation' then return public.submit_quotation(p_args->'p_contact', p_args->'p_items'); end if;
  if p_fn = 'submit_distributor' then return public.submit_distributor(p_args->'p'); end if;
  if p_fn = 'apply_wholesale' then return public.apply_wholesale(p_args->'p'); end if;
  raise exception 'Unknown action';
end $$;
revoke all on function public.gate_call(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.gate_call(text, uuid, text, jsonb) to service_role;
revoke execute on function public.place_order(jsonb, jsonb), public.submit_quotation(jsonb, jsonb), public.submit_distributor(jsonb), public.apply_wholesale(jsonb) from anon, authenticated;

create table public.wishlist_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (user_id, product_id));
alter table public.wishlist_items enable row level security;
create policy "own wishlist" on public.wishlist_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Guest-friendly order tracking: needs the order reference AND the phone number on the order.
create or replace function public.track_order(p_ref text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform public.rate_limit('track', 20, interval '1 hour');
  select * into o from public.orders where reference = upper(trim(p_ref))
    and right(regexp_replace(phone, '\D', '', 'g'), 10) = right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
  if not found then raise exception 'Order not found'; end if;
  return jsonb_build_object('reference', o.reference, 'status', o.status, 'payment_status', o.payment_status, 'created_at', o.created_at, 'tracking_info', o.tracking_info,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', product_name, 'qty', quantity)), '[]') from public.order_items where order_id = o.id));
end $$;
revoke all on function public.track_order(text, text) from public;
grant execute on function public.track_order(text, text) to anon, authenticated;
