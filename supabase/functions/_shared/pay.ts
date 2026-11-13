import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

export const normPhone = (p: string) => {
  let d = (p ?? "").replace(/\D/g, "");
  if (d.startsWith("234")) d = "0" + d.slice(3);
  if (d.length === 10) d = "0" + d;
  return d;
};
export const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};
export async function hmacSha512Hex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Asks the provider for the truth, then lets the database decide (amount, currency, duplicates).
// Never trusts a browser redirect or a webhook body on its own.
export async function verifyAndRecord(reference: string) {
  const db = admin();
  const { data: pay } = await db.from("payments").select("provider,status,orders(reference)").eq("reference", reference).maybeSingle();
  if (!pay) return { status: "unknown" };
  const orderRef = (pay as any).orders?.reference;
  if (pay.status === "success") return { status: "paid", order_reference: orderRef };

  let status: "success" | "failed" | "pending" = "pending", amountMinor = 0, currency = "", providerRef = "", raw: unknown = null;
  if (pay.provider === "paystack") {
    const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}` } });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.status && j.data) {
      const d = j.data; raw = d;
      status = d.status === "success" ? "success" : ["failed", "reversed"].includes(d.status) ? "failed" : "pending";
      amountMinor = Number(d.amount); currency = d.currency; providerRef = String(d.id);
    }
  } else {
    const r = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("FLW_SECRET_KEY")}` } });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.status === "success" && j.data) {
      const d = j.data; raw = d;
      status = d.status === "successful" ? "success" : d.status === "failed" ? "failed" : "pending";
      amountMinor = Math.round(Number(d.amount) * 100); currency = d.currency; providerRef = String(d.id);
    }
  }
  if (status === "pending") return { status: "pending", order_reference: orderRef };
  const { data, error } = await db.rpc("record_payment_result", {
    p_reference: reference, p_status: status, p_amount_minor: amountMinor, p_currency: currency, p_provider_reference: providerRef, p_raw: raw });
  if (error) throw error;
  return { status: data.status === "success" ? "paid" : data.status, order_reference: orderRef };
}
