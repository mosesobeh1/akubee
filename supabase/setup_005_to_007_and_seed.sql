-- Run AFTER migrations 001-004 are already applied. Contains 005, 006, 007 and the product seed.

-- ===== migrations/005_admin_support.sql =====
-- Phase 6: admin support. Fulfilment fields and audit-log writes from the dashboard.
alter table public.orders add column if not exists tracking_info text;
alter table public.orders add column if not exists fulfilment_notes text;
-- Admins may add audit entries, but only under their own user id.
create policy "admin write audit" on public.audit_logs for insert with check (public.is_admin() and actor_id = auth.uid());
-- Grant the first admin (run once in the SQL editor, using the email of an existing account):
--   insert into public.user_roles(user_id, role) select id, 'admin' from auth.users where email = 'owner@example.com';

-- ===== migrations/006_hardening_wishlist_tracking.sql =====
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

-- ===== migrations/007_promotions_and_roles.sql =====
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

-- ===== seed.sql =====
-- Seed data (development). SKUs are placeholders; retail prices left NULL until the owner sets them.
insert into public.categories(name,slug,sort_order) values('Car wash products','car-wash',0),('Cleaning products','cleaning',1),('Spray paints','spray-paints',2),('Microfibre towels','towels',3),('Wax & polish','wax-polish',4),('Coolants & additives','coolants',5),('Air fresheners','air-fresheners',6),('Car care kits','car-care-kits',7),('Detailing accessories','accessories',8) on conflict (slug) do nothing;
-- Brands read from product packaging in the owner's posts. CONFIRM before publishing.
insert into public.brands(name,slug) values('AkuBee','akubee'),('Coscharis','coscharis'),('Deramech','deramech'),('Flamingo','flamingo'),('Ikeda','ikeda'),('PP Densa','pp-densa'),('Virshen','virshen') on conflict (slug) do nothing;
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-001','spray-paint-virshen-450ml','Spray Paint 450ml (Virshen)','Quick-drying, easy-to-use spray paint. Available in several colours including white, black, grey, yellow, green and chrome. Confirm colours in stock before ordering.',(select id from public.categories where slug='spray-paints'),(select id from public.brands where name='Virshen'),24,'{"size": "450ml"}'::jsonb,true on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/spray-paint.jpg','Spray Paint 450ml (Virshen)' from public.products where slug='spray-paint-virshen-450ml' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-002','spray-paint-deramech-450ml','Spray Paint 450ml (Deramech)','Fast-drying all-purpose spray paint for interior and exterior use. Confirm colours in stock before ordering.',(select id from public.categories where slug='spray-paints'),(select id from public.brands where name='Deramech'),24,'{"size": "450ml"}'::jsonb,false on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/spray-paint-deramech.jpg','Spray Paint 450ml (Deramech)' from public.products where slug='spray-paint-deramech-450ml' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-003','auto-under-coating-650ml','Auto Under Coating 650ml','Underbody coating that is fast drying and easy to apply. Printed claims: antirust, sound insulation, wear resistance, waterproof.',(select id from public.categories where slug='spray-paints'),(select id from public.brands where name='Deramech'),null,'{"size": "650ml"}'::jsonb,true on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/undercoating.jpg','Auto Under Coating 650ml' from public.products where slug='auto-under-coating-650ml' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-004','tyre-polish','Tyre Polish','Spray tyre polish for a deep shine.',(select id from public.categories where slug='wax-polish'),(select id from public.brands where name='Deramech'),null,'{}'::jsonb,true on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/tyre-polish.jpg','Tyre Polish' from public.products where slug='tyre-polish' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-005','silicone-dashboard-polish-250ml','Silicone Dashboard Polish 250ml','Silicone polish for dashboards, seats and door panels.',(select id from public.categories where slug='wax-polish'),(select id from public.brands where name='Deramech'),24,'{"size": "250ml"}'::jsonb,false on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/dashboard-polish.jpg','Silicone Dashboard Polish 250ml' from public.products where slug='silicone-dashboard-polish-250ml' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-006','dashboard-wax-spray','Dashboard Wax Spray','Care spray for vinyl, plastic and rubber surfaces.',(select id from public.categories where slug='wax-polish'),(select id from public.brands where name='Virshen'),null,'{}'::jsonb,false on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/dashboard-wax.jpg','Dashboard Wax Spray' from public.products where slug='dashboard-wax-spray' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-007','car-wax-and-cleaner-tin-350ml','Car Wax & Cleaner (Tin) 350ml','Heavy-duty silicone car wax and cleaner in a tin.',(select id from public.categories where slug='wax-polish'),(select id from public.brands where name='Deramech'),24,'{"size": "350ml"}'::jsonb,true on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/car-wax-tin.jpg','Car Wax & Cleaner (Tin) 350ml' from public.products where slug='car-wax-and-cleaner-tin-350ml' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-008','car-wash-wax-1l','Car Wash Super Concentrate Wash ''n'' Wax 1 Litre','Concentrated one-step wash and wax car shampoo.',(select id from public.categories where slug='car-wash'),null,24,'{"size": "1 litre"}'::jsonb,true on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/car-wash-wax.jpg','Car Wash Super Concentrate Wash ''n'' Wax 1 Litre' from public.products where slug='car-wash-wax-1l' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-009','flamingo-wash-wax-shampoo-1l','Flamingo Wash & Wax Car Shampoo 1 Litre','Ultra-shine car wash and wax shampoo.',(select id from public.categories where slug='car-wash'),(select id from public.brands where name='Flamingo'),24,'{"size": "1 litre"}'::jsonb,true on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/flamingo-shampoo.jpg','Flamingo Wash & Wax Car Shampoo 1 Litre' from public.products where slug='flamingo-wash-wax-shampoo-1l' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-010','foam-cleaner-multi-purpose-650ml','Multi-Purpose Foam Cleaner 650ml','Foam cleaner with brush top for fabric, carpet and upholstery.',(select id from public.categories where slug='cleaning'),null,24,'{"size": "650ml"}'::jsonb,true on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/foam-cleaner.jpg','Multi-Purpose Foam Cleaner 650ml' from public.products where slug='foam-cleaner-multi-purpose-650ml' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-011','radiator-coolant','Radiator Coolant','Radiator coolant used in place of plain water to help prevent overheating.',(select id from public.categories where slug='coolants'),(select id from public.brands where name='PP Densa'),null,'{}'::jsonb,false on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/radiator-coolant.jpg','Radiator Coolant' from public.products where slug='radiator-coolant' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-012','microfibre-towel-40x30','Microfibre Towel 40x30','Everyday microfibre drying and cleaning towel. A larger 60x70 size is also supplied.',(select id from public.categories where slug='towels'),null,50,'{"size": "40x30"}'::jsonb,false on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/microfibre-towel.jpg','Microfibre Towel 40x30' from public.products where slug='microfibre-towel-40x30' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-013','twin-towel-absorbent-microfibre','Absorbent Twin Microfibre Towel','Two-sided absorbent microfibre towel in blue, yellow, purple and green. Sizes such as 40x30, 40x40 and 40x70.',(select id from public.categories where slug='towels'),null,50,'{"size": "Several sizes and weights"}'::jsonb,true on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/twin-towel.jpg','Absorbent Twin Microfibre Towel' from public.products where slug='twin-towel-absorbent-microfibre' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-014','akubee-branded-microfibre-towel','AkuBee Branded Microfibre Towel','Yellow microfibre towel with black edging and AkuBee branding.',(select id from public.categories where slug='towels'),(select id from public.brands where name='AkuBee'),null,'{}'::jsonb,false on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/towel-branded.jpg','AkuBee Branded Microfibre Towel' from public.products where slug='akubee-branded-microfibre-towel' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-015','professional-washing-mitt-800g','Professional Washing Mitt / Sponge 800g','Chenille microfibre wash mitt.',(select id from public.categories where slug='accessories'),null,50,'{"size": "800g"}'::jsonb,false on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/wash-mitt.jpg','Professional Washing Mitt / Sponge 800g' from public.products where slug='professional-washing-mitt-800g' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-016','ikeda-liquid-air-freshener','Ikeda Liquid Air Freshener','Mini liquid air fresheners in several scents.',(select id from public.categories where slug='air-fresheners'),(select id from public.brands where name='Ikeda'),null,'{"size": "Small and big, sold in 12-piece packs"}'::jsonb,false on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/ikeda-scent.jpg','Ikeda Liquid Air Freshener' from public.products where slug='ikeda-liquid-air-freshener' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
insert into public.products(sku,slug,name,description,category_id,brand_id,min_wholesale_qty,specs,is_featured) select 'AKB-017','coscharis-jasmine-car-scent','Coscharis Scents Car Air Freshener (Jasmine)','Canned car air freshener, printed ''lasts 60 days''.',(select id from public.categories where slug='air-fresheners'),(select id from public.brands where name='Coscharis'),null,'{}'::jsonb,false on conflict (slug) do nothing;
insert into public.product_images(product_id,url,alt) select id,'assets/images/car-scent.jpg','Coscharis Scents Car Air Freshener (Jasmine)' from public.products where slug='coscharis-jasmine-car-scent' and not exists (select 1 from public.product_images pi where pi.product_id=products.id);
