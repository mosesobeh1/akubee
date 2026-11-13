-- Phase 5: payments. Only server-side code (service role) can create or change payment records.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null check (provider in ('paystack','flutterwave')),
  reference text not null unique,
  provider_reference text,
  amount_minor bigint not null check (amount_minor > 0),   -- kobo
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'pending' check (status in ('pending','success','failed','amount_mismatch')),
  raw jsonb, paid_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index on public.payments (order_id, created_at desc);
create unique index one_successful_payment_per_order on public.payments (order_id) where status = 'success';
create trigger payments_updated before update on public.payments for each row execute function public.set_updated_at();
alter table public.payments enable row level security;
create policy "own payments read" on public.payments for select using (
  public.is_admin() or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
-- no insert/update/delete policies

create table public.webhook_events (id text primary key, provider text not null, received_at timestamptz not null default now());
alter table public.webhook_events enable row level security; -- no policies: service role only

insert into public.site_settings(key, value, is_public) values ('payment_providers', '{"paystack": false, "flutterwave": false}', true)
on conflict (key) do nothing;
-- Admin enables a provider with:
--   update public.site_settings set value = '{"paystack": true, "flutterwave": false}' where key = 'payment_providers';

-- Called only by Edge Functions after they have verified the transaction with the provider's API.
create or replace function public.record_payment_result(p_reference text, p_status text, p_amount_minor bigint, p_currency text, p_provider_reference text, p_raw jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay public.payments; ord public.orders;
begin
  select * into pay from public.payments where reference = p_reference for update;
  if not found then raise exception 'Unknown payment reference'; end if;
  if pay.status = 'success' then return jsonb_build_object('status','success','duplicate',true,'order_id',pay.order_id); end if;
  select * into ord from public.orders where id = pay.order_id for update;
  if p_status = 'success' then
    if p_currency <> 'NGN' or p_amount_minor <> pay.amount_minor or ord.total is null or pay.amount_minor <> round(ord.total * 100)::bigint then
      update public.payments set status = 'amount_mismatch', raw = p_raw, provider_reference = p_provider_reference where id = pay.id;
      return jsonb_build_object('status','amount_mismatch','order_id',pay.order_id);
    end if;
    if exists (select 1 from public.payments where order_id = pay.order_id and status = 'success') then
      update public.payments set status = 'failed', raw = p_raw where id = pay.id;
      return jsonb_build_object('status','already_paid','order_id',pay.order_id);
    end if;
    update public.payments set status = 'success', provider_reference = p_provider_reference, raw = p_raw, paid_at = now() where id = pay.id;
    update public.orders set payment_status = 'paid', status = case when status in ('pending','awaiting_payment') then 'paid' else status end where id = ord.id;
    update public.inventory i set quantity = greatest(i.quantity - oi.quantity, 0), updated_at = now()
      from public.order_items oi where oi.order_id = ord.id and i.product_id = oi.product_id and i.track_stock;
    return jsonb_build_object('status','success','order_id',ord.id);
  elsif p_status = 'failed' then
    update public.payments set status = 'failed', raw = p_raw where id = pay.id;
    update public.orders set payment_status = 'failed' where id = ord.id and payment_status <> 'paid';
    return jsonb_build_object('status','failed','order_id',ord.id);
  end if;
  return jsonb_build_object('status','pending','order_id',ord.id);
end $$;
revoke all on function public.record_payment_result(text, text, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_payment_result(text, text, bigint, text, text, jsonb) to service_role;
