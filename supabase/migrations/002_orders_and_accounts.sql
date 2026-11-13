-- Phase 3: addresses, delivery zones, orders, guest-safe order placement.
create sequence if not exists public.order_seq start 1000;

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text, full_name text not null, phone text not null,
  address text not null, state text not null, city text not null,
  is_default boolean not null default false, created_at timestamptz not null default now());
create index on public.customer_addresses (user_id);

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  state text not null unique, fee numeric(12,2) not null check (fee >= 0), is_active boolean not null default true);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null, phone text not null, email text,
  address text not null, state text not null, city text not null, notes text,
  status text not null default 'pending' check (status in ('pending','awaiting_payment','paid','processing','ready_for_dispatch','shipped','delivered','cancelled','refunded')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','failed','refunded')),
  subtotal numeric(12,2), delivery_fee numeric(12,2), total numeric(12,2),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index on public.orders (user_id);
create index on public.orders (phone);
create index on public.orders (status, created_at desc);
create trigger orders_updated before update on public.orders for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null, sku text, unit_price numeric(12,2),
  quantity int not null check (quantity > 0));
create index on public.order_items (order_id);

alter table public.customer_addresses enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "own addresses" on public.customer_addresses for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "read zones" on public.delivery_zones for select using (is_active or public.is_admin());
create policy "admin zones" on public.delivery_zones for all using (public.is_admin()) with check (public.is_admin());
-- No INSERT policy on orders/order_items: the browser can only create orders through place_order().
create policy "own orders read" on public.orders for select using (user_id = auth.uid() or public.is_admin());
create policy "admin orders update" on public.orders for update using (public.is_admin()) with check (public.is_admin());
create policy "own items read" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));

-- Prices and totals are always computed here from the database, never trusted from the browser.
create or replace function public.place_order(p_customer jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text; v_sub numeric := 0; v_priced boolean := true; v_fee numeric; r record; it jsonb; v_qty int;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Cart is empty or invalid'; end if;
  if length(coalesce(p_customer->>'name','')) < 2 or length(coalesce(p_customer->>'phone','')) < 7
     or length(coalesce(p_customer->>'address','')) < 5 or coalesce(p_customer->>'state','') = '' or coalesce(p_customer->>'city','') = ''
  then raise exception 'Missing delivery details'; end if;
  v_ref := 'AKB-' || to_char(now(), 'YYMMDD') || '-' || nextval('public.order_seq');
  select fee into v_fee from public.delivery_zones where lower(state) = lower(p_customer->>'state') and is_active;
  insert into public.orders(reference, user_id, customer_name, phone, email, address, state, city, notes, delivery_fee)
  values (v_ref, auth.uid(), left(p_customer->>'name',120), left(p_customer->>'phone',30), nullif(left(p_customer->>'email',160),''),
          left(p_customer->>'address',300), left(p_customer->>'state',60), left(p_customer->>'city',80), nullif(left(p_customer->>'notes',500),''), v_fee)
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    if v_qty < 1 or v_qty > 10000 then raise exception 'Invalid quantity'; end if;
    select p.id, p.name, p.sku, p.retail_price, i.track_stock, i.quantity as stock into r
      from public.products p left join public.inventory i on i.product_id = p.id where p.slug = it->>'slug' and p.is_active;
    if not found then raise exception 'Product unavailable'; end if;
    if coalesce(r.track_stock,false) and r.stock < v_qty then raise exception 'Insufficient stock for %', r.name; end if;
    insert into public.order_items(order_id, product_id, product_name, sku, unit_price, quantity) values (v_id, r.id, r.name, r.sku, r.retail_price, v_qty);
    if r.retail_price is null then v_priced := false; else v_sub := v_sub + r.retail_price * v_qty; end if;
  end loop;
  if v_priced then update public.orders set subtotal = v_sub, total = v_sub + coalesce(v_fee,0) where id = v_id; end if;
  return jsonb_build_object('reference', v_ref, 'priced', v_priced);
end $$;
revoke all on function public.place_order(jsonb, jsonb) from public;
grant execute on function public.place_order(jsonb, jsonb) to anon, authenticated;
