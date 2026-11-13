import { cors, json, verifyAndRecord } from "../_shared/pay.ts";

// Called by the payment-status page after the customer returns from the provider.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { reference } = await req.json();
    if (typeof reference !== "string" || !/^AKBPAY-[A-Za-z0-9-]{6,80}$/.test(reference)) return json({ error: "Invalid reference" }, 400);
    return json(await verifyAndRecord(reference));
  } catch (e) { console.error("payment-verify", e); return json({ error: "Something went wrong" }, 500); }
});
