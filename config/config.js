// Public settings only. The Supabase anon key is safe in the browser because Row Level Security protects the data.
// Never put service-role keys or payment secret keys here.
window.APP_CONFIG = {
  SUPABASE_URL: "",       // e.g. https://xxxx.supabase.co  (leave empty to use data/products.json)
  SUPABASE_ANON_KEY: "",  // Supabase publishable / anon key
  WHATSAPP: "2348089036605",
  TURNSTILE_SITEKEY: ""   // Cloudflare Turnstile site key (public). Dev test key: 1x00000000000000000000AA
};
