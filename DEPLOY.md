# Deploying AkuBee Auto Care (GitHub + Cloudflare Pages + Supabase)

## 1. Supabase
1. Create a project. In the SQL editor run, in order: migrations 001 to 007, then `supabase/seed.sql`.
2. Auth settings: enable email confirmation; set Site URL to your Cloudflare Pages URL and add it to Redirect URLs (needed for password reset).
3. Make yourself admin (see README, Phase 6).
4. Install the Supabase CLI, then `supabase link --project-ref <ref>`.
5. Secrets: copy `.env.example` to `.env`, fill it in, run `supabase secrets set --env-file .env`.
6. Deploy functions: `supabase functions deploy payment-init payment-verify paystack-webhook flutterwave-webhook submit-form`
   (`supabase/config.toml` already turns off JWT checks for the webhooks and payment-verify).

## 2. Cloudflare Turnstile
Create a Turnstile widget. Put the **site key** in `config/config.js` (TURNSTILE_SITEKEY) and the **secret** in Supabase secrets (TURNSTILE_SECRET).
The submit-form function refuses requests if the secret is missing.

## 3. Cloudflare Pages
1. Push this folder to a GitHub repository (the `.gitignore` keeps `.env` out).
2. Cloudflare Pages: Create project, connect the repository.
3. Framework preset: None. Two options:
   - Simple: build command empty, output directory `/` (repo root, no minification).
   - Production (minified JS and CSS): build command `npm install && npm run build`, output directory `dist`. The build was tested locally; test it once on Cloudflare before relying on it.
4. Edit `config/config.js` with your Supabase URL, anon key and Turnstile site key (these are public values) and commit.
5. Replace YOUR-DOMAIN in `robots.txt` and `sitemap.xml`. Set `SITE_URL` (Supabase secret) to the live address.

## 4. Payments
Follow README Phase 5: webhook URLs, provider switch in Admin > Settings. Use TEST keys first.

## 5. Test before launch (none of these have been run yet)
- [ ] Guest checkout, registered checkout, login and password reset
- [ ] Wholesale registration, approval, wholesale prices and minimum quantities
- [ ] Cart totals and stock changes
- [ ] Payment success, failure, cancel, duplicate click, webhook retry (test keys)
- [ ] Order status updates in the admin; quotations; distributor applications
- [ ] Admin permissions: a normal account must not open admin data
- [ ] Direct calls to place_order etc. from the browser console must be refused
- [ ] Image upload limits (type and 2 MB)
- [ ] Phones (Android) and desktop; slow network
- [ ] Turnstile blocks a request with no token
- [ ] Staff account: cannot open Settings, delete products, approve wholesale or edit price tiers
- [ ] A discount lowers the shop price AND the price charged at checkout

## Not done
Real end-to-end testing with your accounts and payment providers, a separate image-optimisation step, and hero/promo banner images managed from the admin (text is managed, images are not).
