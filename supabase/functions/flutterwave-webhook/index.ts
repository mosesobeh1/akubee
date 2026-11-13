import { admin, safeEqual, verifyAndRecord } from "../_shared/pay.ts";

Deno.serve(async (req) => {
  const hash = req.headers.get("verif-hash") ?? "";
  if (!safeEqual(hash, Deno.env.get("FLW_SECRET_HASH") ?? "\u0000")) return new Response("invalid signature", { status: 401 });
  const ev = await req.json();
  const reference = ev?.data?.tx_ref;
  if (!reference) return new Response("ignored", { status: 200 });
  const db = admin(), id = `flutterwave:${ev?.data?.id ?? reference}:${ev?.data?.status ?? ""}`;
  const { error: dup } = await db.from("webhook_events").insert({ id, provider: "flutterwave" });
  if (dup) return new Response("duplicate", { status: 200 });
  try { await verifyAndRecord(reference); return new Response("ok", { status: 200 }); }
  catch (e) { console.error("flutterwave-webhook", e); await db.from("webhook_events").delete().eq("id", id); return new Response("retry", { status: 500 }); }
});
