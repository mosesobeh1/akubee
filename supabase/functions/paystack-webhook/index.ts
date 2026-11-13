import { admin, hmacSha512Hex, safeEqual, verifyAndRecord } from "../_shared/pay.ts";

Deno.serve(async (req) => {
  const raw = await req.text();
  const sig = req.headers.get("x-paystack-signature") ?? "";
  if (!safeEqual(sig, await hmacSha512Hex(Deno.env.get("PAYSTACK_SECRET_KEY")!, raw))) return new Response("invalid signature", { status: 401 });
  const ev = JSON.parse(raw);
  const reference = ev?.data?.reference;
  if (!String(ev?.event ?? "").startsWith("charge.") || !reference) return new Response("ignored", { status: 200 });
  const db = admin(), id = `paystack:${ev.event}:${ev.data.id ?? reference}`;
  const { error: dup } = await db.from("webhook_events").insert({ id, provider: "paystack" });
  if (dup) return new Response("duplicate", { status: 200 });                     // already handled
  try { await verifyAndRecord(reference); return new Response("ok", { status: 200 }); }
  catch (e) { console.error("paystack-webhook", e); await db.from("webhook_events").delete().eq("id", id); return new Response("retry", { status: 500 }); }
});
