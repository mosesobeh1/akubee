-- Phase 8: promotions (discounts), and owner-vs-staff permissions.

-- Owner = 'admin' role only. Staff (role 'staff') keep day-to-day access via is_admin().
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') $$;

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  discount_percent int not null check (discount_percent between 1 and 90),
  starts_at timestamptz, ends_at timestamptz,
  show_countdown boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at));
create index on public.promotions (product_id);
alter table public.promotions enable row level security;
create policy "read live promotions" on public.promotions for select using (
  public.is_owner() or (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())));
create policy "owner promotions" on public.promotions for all using (public.is_owner()) with check (public.is_owner());

-- The discounted retail price. Used by place_order so the price charged equals the price shown.
create or replace function public.promo_price(p_product uuid, p_price numeric) returns numeric language sql stable as $$
  select case when p_price is null then null else round(p_price * (100 - coalesce((
    select max(discount_percent) from public.promotions
    where product_id = p_product and is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())), 0)) / 100, 2) end $$;

create or replace function public.place_order(p_customer jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text; v_sub numeric := 0; v_priced boolean := true; v_fee numeric; r record; it jsonb; v_qty int; v_ws boolean := public.is_wholesale(); v_unit numeric; v_tier numeric;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Cart is empty or invalid'; end if;
  if length(coalesce(p_customer->>'name','')) < 2 or length(coalesce(p_customer->>'phone','')) < 7 or length(coalesce(p_customer->>'address','')) < 5
     or coalesce(p_customer->>'state','') = '' or coalesce(p_customer->>'city','') = '' then raise exception 'Missing delivery details'; end if;
  v_ref := 'AKB-' || to_char(now(),'YYMMDD') || '-' || nextval('public.order_seq');
  select fee into v_fee from public.delivery_zones where lower(state) = lower(p_customer->>'state') and is_active;
  insert into public.orders(reference,user_id,customer_name,phone,email,address,state,city,notes,delivery_fee,is_wholesale)
  values (v_ref, auth.uid(), left(p_customer->>'name',120), left(p_customer->>'phone',30), nullif(left(p_customer->>'email',160),''), left(p_customer->>'address',300),
          left(p_customer->>'state',60), left(p_customer->>'city',80), nullif(left(p_customer->>'notes',500),''), v_fee, v_ws) returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    if v_qty < 1 or v_qty > 10000 then raise exception 'Invalid quantity'; end if;
    select p.id, p.name, p.sku, p.retail_price, p.min_wholesale_qty as moq, i.track_stock, i.quantity as stock into r
      from public.products p left join public.inventory i on i.product_id = p.id where p.slug = it->>'slug' and p.is_active;
    if not found then raise exception 'Product unavailable'; end if;
    if coalesce(r.track_stock,false) and r.stock < v_qty then raise exception 'Insufficient stock for %', r.name; end if;
    v_unit := public.promo_price(r.id, r.retail_price);
    if v_ws then
      if r.moq is not null and v_qty < r.moq then raise exception 'Minimum wholesale quantity for % is %', r.name, r.moq; end if;
      select unit_price into v_tier from public.pricing_tiers where product_id = r.id and min_qty <= v_qty order by min_qty desc limit 1;
      v_unit := coalesce(v_tier, v_unit);
    end if;
    insert into public.order_items(order_id, product_id, product_name, sku, unit_price, quantity) values (v_id, r.id, r.name, r.sku, v_unit, v_qty);
    if v_unit is null then v_priced := false; else v_sub := v_sub + v_unit * v_qty; end if;
  end loop;
  if v_priced then update public.orders set subtotal = v_sub, total = v_sub + coalesce(v_fee,0) where id = v_id; end if;
  return jsonb_build_object('reference', v_ref, 'priced', v_priced);
end $$;

-- Owner-only: prices tiers, settings, delivery fees, wholesale approval, account status, product deletion.
drop policy "admin write tiers" on public.pricing_tiers;
create policy "owner write tiers" on public.pricing_tiers for all using (public.is_owner()) with check (public.is_owner());
drop policy "admin write settings" on public.site_settings;
create policy "owner write settings" on public.site_settings for all using (public.is_owner()) with check (public.is_owner());
drop policy "admin zones" on public.delivery_zones;
create policy "owner zones" on public.delivery_zones for all using (public.is_owner()) with check (public.is_owner());
drop policy "admin manage profiles" on public.profiles;
create policy "owner manage profiles" on public.profiles for all using (public.is_owner()) with check (public.is_owner());
drop policy "admin write products" on public.products;
create policy "staff insert products" on public.products for insert with check (public.is_admin());
create policy "staff update products" on public.products for update using (public.is_admin()) with check (public.is_admin());
create policy "owner delete products" on public.products for delete using (public.is_owner());
drop policy "admin applications" on public.wholesale_applications;
create policy "owner applications" on public.wholesale_applications for update using (public.is_owner()) with check (public.is_owner());

create or replace function public.review_wholesale(p_id uuid, p_approve boolean, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_owner() then raise exception 'Not allowed'; end if;
  update public.wholesale_applications set status = case when p_approve then 'approved' else 'rejected' end, admin_notes = p_notes,
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_id and status = 'pending' returning user_id into v_user;
  if v_user is null then raise exception 'Application not found or already reviewed'; end if;
  update public.profiles set wholesale_status = case when p_approve then 'approved' else 'rejected' end where id = v_user;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details) values (auth.uid(), case when p_approve then 'wholesale_approved' else 'wholesale_rejected' end, 'wholesale_application', p_id, jsonb_build_object('notes', p_notes));
end $$;
-- Add a staff member (cannot change prices tiers, settings, approvals or delete products):
--   insert into public.user_roles(user_id, role) select id, 'staff' from auth.users where email = 'staff@example.com';
