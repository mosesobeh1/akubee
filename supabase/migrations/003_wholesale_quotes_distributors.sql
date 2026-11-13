-- Phase 4: wholesale approval, quotations, distributor applications, wholesale-aware ordering.
alter table public.orders add column if not exists is_wholesale boolean not null default false;
create sequence if not exists public.quote_seq start 1000;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid, action text not null,
  entity text, entity_id uuid, details jsonb, created_at timestamptz not null default now());
alter table public.audit_logs enable row level security;
create policy "admin read audit" on public.audit_logs for select using (public.is_admin());

create table public.wholesale_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null, contact_name text not null, phone text not null, email text not null,
  business_address text not null, business_type text not null, state text not null,
  registration_details text, products_interest text, estimated_volume text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_notes text, reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz not null default now());
create unique index one_pending_application on public.wholesale_applications (user_id) where status = 'pending';

create table public.quotation_requests (
  id uuid primary key default gen_random_uuid(), reference text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  contact_name text not null, phone text not null, email text, business_name text, requirements text,
  status text not null default 'new' check (status in ('new','in_review','quoted','closed')),
  internal_notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create trigger quotes_updated before update on public.quotation_requests for each row execute function public.set_updated_at();
create table public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotation_requests(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null, quantity int not null check (quantity > 0));
create index on public.quotation_items (quotation_id);

create table public.distributor_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_name text not null, business_name text not null, phone text not null, email text,
  location text not null, business_type text, areas_of_interest text, comments text,
  status text not null default 'new' check (status in ('new','in_review','accepted','declined')),
  internal_notes text, created_at timestamptz not null default now());

alter table public.wholesale_applications enable row level security;
alter table public.quotation_requests enable row level security;
alter table public.quotation_items enable row level security;
alter table public.distributor_applications enable row level security;
-- No insert policies: the browser submits only through the functions below.
create policy "own application read" on public.wholesale_applications for select using (user_id = auth.uid() or public.is_admin());
create policy "admin applications" on public.wholesale_applications for update using (public.is_admin()) with check (public.is_admin());
create policy "own quotes read" on public.quotation_requests for select using (user_id = auth.uid() or public.is_admin());
create policy "admin quotes update" on public.quotation_requests for update using (public.is_admin()) with check (public.is_admin());
create policy "own quote items read" on public.quotation_items for select using (
  exists (select 1 from public.quotation_requests q where q.id = quotation_id and (q.user_id = auth.uid() or public.is_admin())));
create policy "admin distributor read" on public.distributor_applications for select using (public.is_admin());
create policy "admin distributor update" on public.distributor_applications for update using (public.is_admin()) with check (public.is_admin());

create or replace function public.apply_wholesale(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  if length(coalesce(p->>'business_name','')) < 2 or length(coalesce(p->>'contact_name','')) < 2 or length(coalesce(p->>'phone','')) < 7
     or length(coalesce(p->>'email','')) < 5 or length(coalesce(p->>'business_address','')) < 5 or coalesce(p->>'business_type','') = '' or coalesce(p->>'state','') = ''
  then raise exception 'Missing business details'; end if;
  insert into public.wholesale_applications(user_id,business_name,contact_name,phone,email,business_address,business_type,state,registration_details,products_interest,estimated_volume)
  values (auth.uid(), left(p->>'business_name',160), left(p->>'contact_name',120), left(p->>'phone',30), left(p->>'email',160), left(p->>'business_address',300),
          left(p->>'business_type',80), left(p->>'state',60), left(p->>'registration_details',200), left(p->>'products_interest',500), left(p->>'estimated_volume',120))
  returning id into v_id;
  update public.profiles set wholesale_status = 'pending' where id = auth.uid() and wholesale_status in ('none','rejected');
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.review_wholesale(p_id uuid, p_approve boolean, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  update public.wholesale_applications set status = case when p_approve then 'approved' else 'rejected' end, admin_notes = p_notes,
    reviewed_by = auth.uid(), reviewed_at = now() where id = p_id and status = 'pending' returning user_id into v_user;
  if v_user is null then raise exception 'Application not found or already reviewed'; end if;
  update public.profiles set wholesale_status = case when p_approve then 'approved' else 'rejected' end where id = v_user;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details) values (auth.uid(), case when p_approve then 'wholesale_approved' else 'wholesale_rejected' end, 'wholesale_application', p_id, jsonb_build_object('notes', p_notes));
end $$;

create or replace function public.submit_quotation(p_contact jsonb, p_items jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text; it jsonb; r record;
begin
  if length(coalesce(p_contact->>'name','')) < 2 or length(coalesce(p_contact->>'phone','')) < 7 then raise exception 'Name and phone required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Add at least one product'; end if;
  v_ref := 'QT-' || to_char(now(),'YYMMDD') || '-' || nextval('public.quote_seq');
  insert into public.quotation_requests(reference,user_id,contact_name,phone,email,business_name,requirements)
  values (v_ref, auth.uid(), left(p_contact->>'name',120), left(p_contact->>'phone',30), nullif(left(p_contact->>'email',160),''), nullif(left(p_contact->>'business',160),''), nullif(left(p_contact->>'requirements',1000),''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    if (it->>'qty')::int < 1 or (it->>'qty')::int > 100000 then raise exception 'Invalid quantity'; end if;
    select id, name into r from public.products where slug = it->>'slug' and is_active;
    if not found then raise exception 'Product unavailable'; end if;
    insert into public.quotation_items(quotation_id, product_id, product_name, quantity) values (v_id, r.id, r.name, (it->>'qty')::int);
  end loop;
  return jsonb_build_object('reference', v_ref);
end $$;

create or replace function public.submit_distributor(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p->>'applicant_name','')) < 2 or length(coalesce(p->>'business_name','')) < 2 or length(coalesce(p->>'phone','')) < 7 or length(coalesce(p->>'location','')) < 2
  then raise exception 'Missing details'; end if;
  insert into public.distributor_applications(applicant_name,business_name,phone,email,location,business_type,areas_of_interest,comments)
  values (left(p->>'applicant_name',120), left(p->>'business_name',160), left(p->>'phone',30), nullif(left(p->>'email',160),''), left(p->>'location',200), left(p->>'business_type',80), left(p->>'areas_of_interest',500), left(p->>'comments',1000));
  return jsonb_build_object('ok', true);
end $$;

-- Orders: approved wholesale accounts get tier prices and must meet the minimum quantity.
create or replace function public.place_order(p_customer jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text; v_sub numeric := 0; v_priced boolean := true; v_fee numeric; r record; it jsonb; v_qty int; v_ws boolean := public.is_wholesale(); v_unit numeric;
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
    v_unit := r.retail_price;
    if v_ws then
      if r.moq is not null and v_qty < r.moq then raise exception 'Minimum wholesale quantity for % is %', r.name, r.moq; end if;
      select unit_price into v_unit from public.pricing_tiers where product_id = r.id and min_qty <= v_qty order by min_qty desc limit 1;
      v_unit := coalesce(v_unit, r.retail_price);
    end if;
    insert into public.order_items(order_id, product_id, product_name, sku, unit_price, quantity) values (v_id, r.id, r.name, r.sku, v_unit, v_qty);
    if v_unit is null then v_priced := false; else v_sub := v_sub + v_unit * v_qty; end if;
  end loop;
  if v_priced then update public.orders set subtotal = v_sub, total = v_sub + coalesce(v_fee,0) where id = v_id; end if;
  return jsonb_build_object('reference', v_ref, 'priced', v_priced);
end $$;

revoke all on function public.apply_wholesale(jsonb), public.review_wholesale(uuid, boolean, text), public.submit_quotation(jsonb, jsonb), public.submit_distributor(jsonb) from public;
grant execute on function public.apply_wholesale(jsonb) to authenticated;
grant execute on function public.review_wholesale(uuid, boolean, text) to authenticated; -- checks is_admin() inside
grant execute on function public.submit_quotation(jsonb, jsonb), public.submit_distributor(jsonb) to anon, authenticated;
