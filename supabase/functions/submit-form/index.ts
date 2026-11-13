import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { admin, cors, json } from "../_shared/pay.ts";

const ALLOWED = ["place_order", "submit_quotation", "submit_distributor", "apply_wholesale"];

// Public forms go through here: Turnstile is verified server-side, then the database function runs as the caller.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { fn, args, token } = await req.json();
    if (!ALLOWED.includes(fn) || typeof args !== "object" || args === null) return json({ error: "Invalid request" }, 400);
    const ip = req.headers.get("cf-connecting-ip") ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

    const secret = Deno.env.get("TURNSTILE_SECRET");
    if (!secret) return json({ error: "Server is not configured" }, 500); // fail closed
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", String(token ?? ""));
    if (ip) form.append("remoteip", ip);
    const v = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form })).json();
    if (!v.success) return json({ error: "Spam check failed. Please try again." }, 400);

    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await anon.auth.getUser();

    const { data, error } = await admin().rpc("gate_call", { p_fn: fn, p_user: user?.id ?? null, p_ip: ip || null, p_args: args });
    if (error) {
      // Messages we raise ourselves (code P0001) are safe to show; anything else stays internal.
      if (error.code === "P0001") return json({ error: error.message }, 400);
      console.error("submit-form", fn, error);
      return json({ error: "Something went wrong" }, 500);
    }
    return json(data);
  } catch (e) {
    console.error("submit-form", e);
    return json({ error: "Something went wrong" }, 500);
  }
});
