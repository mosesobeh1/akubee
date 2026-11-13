import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { admin, cors, json, normPhone } from "../_shared/pay.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { order_reference, phone, provider, email } = await req.json();
    if (!["paystack", "flutterwave"].includes(provider)) return json({ error: "Unknown provider" }, 400);
    const db = admin();

    const { data: s } = await db.from("site_settings").select("value").eq("key", "payment_providers").maybeSingle();
    if (!s?.value?.[provider]) return json({ error: "This payment method is not available" }, 400);

    const { data: order } = await db.from("orders")
      .select("id,reference,user_id,phone,email,customer_name,total,payment_status").eq("reference", order_reference).maybeSingle();
    if (!order) return json({ error: "Order not found" }, 404);

    // Ownership: the logged-in owner, or a guest who knows the order's phone number.
    const authHeader = req.headers.get("Authorization") ?? "";
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await anon.auth.getUser();
    const owner = (user && order.user_id === user.id) || (phone && normPhone(phone) === normPhone(order.phone));
    if (!owner) return json({ error: "Order not found" }, 404);

    if (order.total == null) return json({ error: "The store is still confirming your total" }, 409);
    if (order.payment_status === "paid") return json({ error: "This order is already paid" }, 409);

    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("order_id", order.id).gte("created_at", since);
    if ((count ?? 0) >= 5) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);

    const mail = order.email || email;
    if (!mail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return json({ error: "A valid email is required" }, 400);

    const amountMinor = Math.round(Number(order.total) * 100);      // total always comes from the database
    const ref = `AKBPAY-${order.reference}-${crypto.randomUUID().slice(0, 8)}`;
    const site = Deno.env.get("SITE_URL")!;
    const callback = `${site}/payment-status.html?pref=${ref}`;

    const { error: insErr } = await db.from("payments").insert({ order_id: order.id, provider, reference: ref, amount_minor: amountMinor, currency: "NGN" });
    if (insErr) throw insErr;

    let url: string | undefined;
    if (provider === "paystack") {
      const r = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: mail, amount: amountMinor, currency: "NGN", reference: ref, callback_url: callback, metadata: { order_reference: order.reference } }) });
      const j = await r.json(); url = j?.data?.authorization_url;
    } else {
      const r = await fetch("https://api.flutterwave.com/v3/payments", {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("FLW_SECRET_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tx_ref: ref, amount: amountMinor / 100, currency: "NGN", redirect_url: callback,
          customer: { email: mail, phonenumber: order.phone, name: order.customer_name }, customizations: { title: "AkuBee Auto Care" } }) });
      const j = await r.json(); url = j?.data?.link;
    }
    if (!url) { await db.from("payments").update({ status: "failed" }).eq("reference", ref); return json({ error: "Could not start payment" }, 502); }
    await db.from("orders").update({ status: "awaiting_payment" }).eq("id", order.id).eq("status", "pending");
    return json({ authorization_url: url, reference: ref });
  } catch (e) {
    console.error("payment-init", e);
    return json({ error: "Something went wrong" }, 500);   // no internal details exposed
  }
});
