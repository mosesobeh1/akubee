// Public settings only. The Supabase anon key is safe in the browser because Row Level Security protects the data.
// Never put service-role keys or payment secret keys here.
window.APP_CONFIG = {
  SUPABASE_URL: "https://htrlysaltufeggbfvzen.supabase.co",       // e.g. https://xxxx.supabase.co  (leave empty to use data/products.json)
  SUPABASE_ANON_KEY: "sb_publishable_Q3Gf3sPiFgzGCe2P5xtK7Q_Ci-5qVAH",  // Supabase publishable / anon key
  WHATSAPP: "2348089036605",
  TURNSTILE_SITEKEY: " 0x4AAAAAAGAw-bt7CbDgSlE_"   // Cloudflare Turnstile site key (public). Dev test key: 1x00000000000000000000AA
};
