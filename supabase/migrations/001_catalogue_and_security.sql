-- Phase 2: catalogue, roles, wholesale-price protection. Run in the Supabase SQL editor or via `supabase db push`.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Profiles and roles --------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, phone text,
  wholesale_status text not null default 'none'
    check (wholesale_status in ('none','pending','approved','rejected','suspended')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table public.user_roles (
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','staff')),
  primary key (user_id, role));

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin','staff')) $$;

create or replace function public.is_wholesale() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and wholesale_status = 'approved') $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as
$$ begin insert into public.profiles(id, full_name) values (new.id, new.raw_user_meta_data->>'full_name'); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Catalogue -----------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete set null,
  name text not null, slug text not null unique,
  sort_order int not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now());

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text not null unique,
  is_active boolean not null default true, created_at timestamptz not null default now());

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique, slug text not null unique,
  name text not null, description text,
  category_id uuid references public.categories(id) on delete set null,
  brand_id uuid references public.brands(id) on delete set null,
  retail_price numeric(12,2) check (retail_price is null or retail_price >= 0),
  min_wholesale_qty int check (min_wholesale_qty is null or min_wholesale_qty > 0),
  specs jsonb not null default '{}',
  is_featured boolean not null default false, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index on public.products (category_id);
create index on public.products (brand_id);
create index on public.products using gin (to_tsvector('simple', name || ' ' || coalesce(description,'')));
create trigger products_updated before update on public.products for each row execute function public.set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null, alt text, sort_order int not null default 0);
create index on public.product_images (product_id);

-- Wholesale prices live in their own table so RLS can hide them from the public.
create table public.pricing_tiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  min_qty int not null check (min_qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unique (product_id, min_qty));

create table public.inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  track_stock boolean not null default false,
  quantity int not null default 0 check (quantity >= 0),
  low_stock_threshold int not null default 5, updated_at timestamptz not null default now());

create table public.site_settings (
  key text primary key, value jsonb not null, is_public boolean not null default false);

-- Row Level Security ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.pricing_tiers enable row level security;
alter table public.inventory enable row level security;
alter table public.site_settings enable row level security;

create policy "own profile read" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "own profile update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "admin manage profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
-- Customers may edit only name and phone; wholesale_status changes need an admin.
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create policy "own roles read" on public.user_roles for select using (user_id = auth.uid());
-- No insert/update/delete policy on user_roles: roles are granted with the service role only.

create policy "public read categories" on public.categories for select using (is_active or public.is_admin());
create policy "public read brands" on public.brands for select using (is_active or public.is_admin());
create policy "public read products" on public.products for select using (is_active or public.is_admin());
create policy "public read images" on public.product_images for select using (
  exists (select 1 from public.products p where p.id = product_id and (p.is_active or public.is_admin())));
create policy "public read inventory" on public.inventory for select using (true);
create policy "public read settings" on public.site_settings for select using (is_public or public.is_admin());
create policy "wholesale read tiers" on public.pricing_tiers for select using (public.is_wholesale() or public.is_admin());

create policy "admin write categories" on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write brands" on public.brands for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write products" on public.products for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write images" on public.product_images for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write tiers" on public.pricing_tiers for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write inventory" on public.inventory for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write settings" on public.site_settings for all using (public.is_admin()) with check (public.is_admin());

-- Storage: public-read product images, admin-only uploads, 2 MB, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images','product-images', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "admin upload product images" on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_admin());
create policy "admin modify product images" on storage.objects for update
  using (bucket_id = 'product-images' and public.is_admin());
create policy "admin delete product images" on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_admin());
