# AkuBee Auto Care - Phase 1 (static homepage)
Open index.html, or connect the repo to Cloudflare Pages (build command: none, output dir: /).
Edit PRODUCTS, prices and WHATSAPP in assets/js/main.js. Supabase, payments, accounts and admin are NOT built yet.

## Phase 2-3 notes
1. Run supabase/migrations/001 then 002, then supabase/seed.sql in the Supabase SQL editor.
2. Put SUPABASE_URL and the anon key in config/config.js. Enable email confirmation in Supabase Auth.
3. Orders are created only through the place_order() function; prices are read from the database.
4. NOT yet done: online payments (Phase 5), admin dashboard (Phase 6), Turnstile and rate limiting (Phase 7), wholesale approval and prices (Phase 4).

## Phase 5: payments
1. Run migration 004. Deploy: `supabase functions deploy payment-init payment-verify paystack-webhook flutterwave-webhook`.
2. Set secrets (see .env.example): `supabase secrets set --env-file .env`. Secret keys live only in Supabase, never in the browser.
3. Webhook URLs: `https://<project>.supabase.co/functions/v1/paystack-webhook` (Paystack dashboard) and `.../flutterwave-webhook` (Flutterwave dashboard, secret hash = FLW_SECRET_HASH).
4. Enable a provider: `update site_settings set value = '{"paystack": true, "flutterwave": false}' where key = 'payment_providers';`
5. An order is marked paid only by the database function record_payment_result(), after the Edge Function has confirmed the transaction with the provider and the amount and NGN currency match.
Status: written but NOT yet run against Paystack/Flutterwave test accounts. Test with test keys before going live.

## Phase 6: admin dashboard
1. Run migration 005. Create your own account on login.html, then make it admin in the SQL editor:
   `insert into public.user_roles(user_id, role) select id, 'admin' from auth.users where email = 'YOUR-EMAIL';`
2. Open /admin/login.html. Pages: dashboard, orders, products, customers (wholesale approvals), quotations (plus distributors), settings.
3. Without Supabase configured, the admin runs in clearly marked DEMO mode with sample data and saves nothing.
4. `_headers` sets security headers and caching for Cloudflare Pages. Replace YOUR-DOMAIN in robots.txt and sitemap.xml.
Admin permissions are enforced by database Row Level Security (is_admin()), not by the page code.

## Phase 8
- Migration 007: promotions (discounts) and owner-vs-staff permissions. Owner = role `admin`; `staff` can manage orders, quotations, distributor applications and products, but not settings, wholesale price tiers, wholesale approvals, account status, discounts or product deletion.
- Discounts are applied by the database in place_order(), so the price charged matches the price shown. The deal countdown appears only for a discount that has an end time and "Show countdown" ticked.
- The storefront now reads store details, announcement text and homepage headline/text from Admin > Settings.
- Optional minified build: `npm install && npm run build` (output in dist/).
