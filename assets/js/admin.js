(() => {
"use strict";
const CFG = window.APP_CONFIG || {}, PREVIEW = !!window.PREVIEW, DEMO = !CFG.SUPABASE_URL, BASE = PREVIEW ? "" : "../";
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const naira = n => n == null ? "n/a" : "₦" + Number(n).toLocaleString("en-NG");
const dt = s => new Date(s).toLocaleDateString("en-NG", {day: "2-digit", month: "short", year: "numeric"});
const lnk = p => PREVIEW ? `admin/${p}.html` : `${p}.html`;
const go = u => PREVIEW ? (location.hash = "/" + u) : (location.href = u);
const param = k => new URLSearchParams(location.search).get(k) ?? new URLSearchParams(location.hash.split("?")[1] || "").get(k);
const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const label = s => String(s).replace(/_/g, " ");
const STATUSES = ["pending","awaiting_payment","paid","processing","ready_for_dispatch","shipped","delivered","cancelled","refunded"];
const STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT Abuja","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];
const waLink = (phone, text) => { let d = String(phone || "").replace(/\D/g, ""); if (d.startsWith("0")) d = "234" + d.slice(1); return `https://wa.me/${d}?text=${encodeURIComponent(text)}`; };
let sb, USER, OWNER = false;

// ---------- Demo client (used only when Supabase is not configured) ----------
async function demo() {
  const cat = window.__CATALOGUE__ || await (await fetch(BASE + "data/products.json")).json(), ago = d => new Date(Date.now() - d * 864e5).toISOString();
  const D = {
    user_roles: [{user_id: "demo", role: "admin"}],
    categories: cat.categories.map(c => ({id: c.slug, name: c.name, slug: c.slug})),
    brands: [...new Set(cat.products.map(p => p.brand).filter(Boolean))].map(b => ({id: b, name: b})),
    products: cat.products.map(p => ({id: p.id, sku: p.sku, slug: p.slug, name: p.name, description: p.desc, retail_price: null, min_wholesale_qty: p.moq, is_featured: p.featured, is_active: true,
      category_id: p.catSlug, brand_id: p.brand, categories: {name: p.cat}, brands: p.brand ? {name: p.brand} : null, inventory: [], pricing_tiers: [], product_images: [{id: "i" + p.id, url: p.img, sort_order: 0}]})),
    inventory: [{product_id: "x", track_stock: true, quantity: 3, low_stock_threshold: 5, products: {name: "Sample low-stock product", sku: "SAMPLE"}}],
    orders: [
      {id: "o1", reference: "AKB-DEMO-1001", customer_name: "Sample Customer A", phone: "08000000001", email: null, address: "Sample address", state: "FCT Abuja", city: "Abuja", status: "pending", payment_status: "unpaid", total: null, created_at: ago(0), is_wholesale: false, user_id: null, order_items: [{product_name: "Tyre Polish", quantity: 2, unit_price: null}]},
      {id: "o2", reference: "AKB-DEMO-1002", customer_name: "Sample Customer B", phone: "08000000002", email: null, address: "Sample address", state: "Lagos", city: "Ikeja", status: "delivered", payment_status: "paid", total: 45000, created_at: ago(3), is_wholesale: false, user_id: null, order_items: [{product_name: "Car Wash 1 Litre", quantity: 5, unit_price: 9000}]},
      {id: "o3", reference: "AKB-DEMO-1003", customer_name: "Sample Business C", phone: "08000000003", email: null, address: "Sample address", state: "Kano", city: "Kano", status: "processing", payment_status: "paid", total: 120000, created_at: ago(1), is_wholesale: true, user_id: "u3", order_items: [{product_name: "Spray Paint 450ml", quantity: 24, unit_price: 5000}]}],
    wholesale_applications: [{id: "w1", user_id: "u3", business_name: "Sample Detailing Co", contact_name: "Sample Contact", phone: "08000000003", email: "sample@example.com", business_address: "Sample address", business_type: "Auto-detailing business", state: "Kano", products_interest: "Spray paint, towels", estimated_volume: "200 pcs / month", status: "pending", created_at: ago(1)}],
    quotation_requests: [{id: "q1", reference: "QT-DEMO-1001", contact_name: "Sample Buyer", phone: "08000000004", email: null, business_name: "Sample Car Wash", requirements: "Need delivery in two weeks", status: "new", internal_notes: "", created_at: ago(0), quotation_items: [{product_name: "Foam Cleaner 650ml", quantity: 48}]}],
    distributor_applications: [{id: "d1", applicant_name: "Sample Applicant", business_name: "Sample Traders", phone: "08000000005", email: null, location: "Port Harcourt, Rivers", business_type: "Retailer / reseller", areas_of_interest: "Car care", comments: "", status: "new", internal_notes: "", created_at: ago(2)}],
    profiles: [{id: "u3", full_name: "Sample Business C", phone: "08000000003", wholesale_status: "pending", created_at: ago(5)}, {id: "u4", full_name: "Sample Retail D", phone: "08000000006", wholesale_status: "none", created_at: ago(9)}],
    site_settings: [{key: "payment_providers", value: {paystack: false, flutterwave: false}}], delivery_zones: [], promotions: [], audit_logs: [], pricing_tiers: [], product_images: []};
  const from = t => {
    const f = []; let op = "select", pay = null, lim = 1e9, ord = null, one = false;
    const api = {
      select() { return api; }, eq(k, v) { f.push(r => r[k] === v); return api; }, gte(k, v) { f.push(r => r[k] >= v); return api; },
      order(k, o) { ord = [k, o?.ascending !== false]; return api; }, limit(n) { lim = n; return api; },
      single() { one = true; return api; }, maybeSingle() { one = true; return api; },
      update(p) { op = "update"; pay = p; return api; }, insert(p) { op = "insert"; pay = p; return api; }, upsert(p) { op = "upsert"; pay = p; return api; }, delete() { op = "delete"; return api; },
      then(res, rej) {
        const rows = D[t] || (D[t] = []); let m = rows.filter(r => f.every(x => x(r))), data = m;
        if (op === "update") m.forEach(r => Object.assign(r, pay));
        else if (op === "insert" || op === "upsert") { data = [].concat(pay).map(p => { const k = p.key ?? p.product_id ?? p.state, ex = op === "upsert" && k != null ? rows.find(r => (r.key ?? r.product_id ?? r.state) === k) : null; if (ex) return Object.assign(ex, p); const n = {id: "d" + Math.random().toString(36).slice(2, 8), ...p}; rows.push(n); return n; }); }
        else if (op === "delete") D[t] = rows.filter(r => !m.includes(r));
        else { if (ord) data = [...m].sort((a, b) => (a[ord[0]] > b[ord[0]] ? 1 : -1) * (ord[1] ? 1 : -1)); data = data.slice(0, lim); }
        return Promise.resolve({data: one ? (data[0] ?? null) : data, error: null, count: data.length}).then(res, rej);
      }};
    return api;
  };
  return {from, auth: {getUser: async () => ({data: {user: {id: "demo", email: "demo@example.com"}}}), signOut: async () => {}, signInWithPassword: async () => ({error: null})},
    rpc: async (n, a) => { if (n === "review_wholesale") { const w = D.wholesale_applications.find(x => x.id === a.p_id); if (w) { w.status = a.p_approve ? "approved" : "rejected"; const p = D.profiles.find(x => x.id === w.user_id); if (p) p.wholesale_status = w.status; } } return {data: null, error: null}; },
    storage: {from: () => ({upload: async () => ({error: null}), getPublicUrl: () => ({data: {publicUrl: BASE + "assets/images/akubee-logo.png"}})})}};
}

// ---------- UI helpers ----------
const msg = (m, bad) => { const e = $("#adm-msg"); if (e) { e.textContent = m; e.className = "meta " + (bad ? "text-danger" : "text-success"); } };
const modal = html => { const o = document.createElement("div"); o.className = "modal-ov"; o.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">${html}</div>`; o.addEventListener("click", e => { if (e.target === o || e.target.closest("[data-close]")) o.remove(); }); document.body.appendChild(o); return o; };
const fld = (n, l, v = "", t = "text", x = "") => `<div class="mb-3"><label class="meta" for="m_${n}">${l}</label><input class="form-control" id="m_${n}" name="${n}" type="${t}" value="${esc(v)}" ${x}></div>`;
const txt = (n, l, v = "") => `<div class="mb-3"><label class="meta" for="m_${n}">${l}</label><textarea class="form-control" id="m_${n}" name="${n}" rows="3">${esc(v)}</textarea></div>`;
const sel = (n, l, opts, cur) => `<div class="mb-3"><label class="meta" for="m_${n}">${l}</label><select class="form-select" id="m_${n}" name="${n}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
const tbl = (heads, rows) => `<div class="tbl-wrap"><table class="table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}" class="text-muted">Nothing here yet.</td></tr>`}</tbody></table></div>`;
const bdg = s => `<span class="bdg bdg-${esc(String(s).replace(/_/g, "-"))}">${esc(label(s))}</span>`;
const fd = form => Object.fromEntries(new FormData(form));
const num = v => v === "" || v == null ? null : Number(v);
const audit = (action, entity, id, details) => sb.from("audit_logs").insert({actor_id: USER?.id, action, entity, entity_id: id, details});
const tabs = (items, cur) => `<div class="d-flex gap-2 mb-3 flex-wrap">${items.map(([k, t]) => `<button class="chip ${k === cur ? "on" : ""}" data-tab="${k}">${t}</button>`).join("")}</div>`;

// ---------- Shell & guard ----------
async function guard() {
  const {data: {user}} = await sb.auth.getUser(); if (!user) return false; USER = user;
  const {data} = await sb.from("user_roles").select("role").eq("user_id", user.id);
  OWNER = (data || []).some(r => r.role === "admin");
  return (data || []).some(r => ["admin", "staff"].includes(r.role));
}
function shell(page) {
  const nav = [["dashboard", "Dashboard"], ["orders", "Orders"], ["products", "Products"], ["customers", "Customers"], ["quotations", "Quotes & distributors"], ...(OWNER ? [["settings", "Settings"]] : [])];
  $("#app").innerHTML = `${DEMO ? `<div class="demo-bar">Demo mode: sample data only. Nothing is saved. Connect Supabase in config/config.js for real use.</div>` : ""}
<div class="container py-3"><div class="d-flex justify-content-between align-items-center mb-2"><a href="${lnk("dashboard")}"><img src="${BASE}assets/images/akubee-logo.png" alt="AkuBee admin" height="34" style="width:auto"></a>
<div class="d-flex gap-2 align-items-center"><span class="meta">${esc(USER?.email)} (${OWNER ? "owner" : "staff"})</span><button class="btn btn-outline-dark btn-sm" id="logout">Log out</button></div></div>
<nav class="adm-nav" aria-label="Admin">${nav.map(([k, t]) => `<a href="${lnk(k)}" class="${k === page ? "on" : ""}">${t}</a>`).join("")}</nav><p id="adm-msg" class="meta" role="status"></p><div id="adm-main"></div></div>`;
  $("#logout").onclick = async () => { await sb.auth.signOut(); go(lnk("login")); };
}

const AP = {};
// ---------- Login ----------
AP.login = async () => {
  document.title = "Admin login | AkuBee Auto Care";
  $("#app").innerHTML = `<div class="container py-5" style="max-width:420px"><img src="${BASE}assets/images/akubee-logo.png" alt="AkuBee" height="48" style="width:auto"><h1 class="h2 mt-3">Admin login</h1>
${DEMO ? `<p class="meta">Demo mode: Supabase is not connected, so no password is needed.</p>` : ""}<form id="lf">${DEMO ? "" : fld("email", "Email", "", "email", "required autocomplete=email") + fld("password", "Password", "", "password", "required autocomplete=current-password")}<p class="meta" id="adm-msg" role="alert"></p><button class="btn btn-accent w-100">${DEMO ? "Open demo dashboard" : "Log in"}</button></form></div>`;
  $("#lf").addEventListener("submit", async e => {
    e.preventDefault(); const v = fd(e.target);
    if (!DEMO) { const {error} = await sb.auth.signInWithPassword({email: v.email, password: v.password}); if (error) return msg("Login failed. Check your details.", true); }
    if (await guard()) go(lnk("dashboard")); else { await sb.auth.signOut(); msg("This account does not have admin access.", true); }
  });
};

// ---------- Dashboard ----------
AP.dashboard = async () => {
  const [o, w, q, inv, lg] = await Promise.all([
    sb.from("orders").select("id,reference,customer_name,status,payment_status,total,created_at").order("created_at", {ascending: false}).limit(500),
    sb.from("wholesale_applications").select("id").eq("status", "pending"), sb.from("quotation_requests").select("id").eq("status", "new"),
    sb.from("inventory").select("quantity,low_stock_threshold,track_stock,products(name,sku)"), sb.from("audit_logs").select("action,entity,created_at").order("created_at", {ascending: false}).limit(8)]);
  const O = o.data || [], paid = O.filter(x => x.payment_status === "paid"), low = (inv.data || []).filter(i => i.track_stock && i.quantity <= i.low_stock_threshold);
  const stat = (n, v, href) => `<a class="stat" ${href ? `href="${href}"` : ""}><span class="meta">${n}</span><strong>${v}</strong></a>`;
  $("#adm-main").innerHTML = `<div class="stats">${stat("Total orders", O.length, lnk("orders"))}${stat("Revenue (paid)", naira(paid.reduce((s, x) => s + Number(x.total || 0), 0)))}
${stat("Pending payments", O.filter(x => x.payment_status !== "paid" && !["cancelled", "refunded"].includes(x.status)).length, lnk("orders"))}${stat("Completed orders", O.filter(x => x.status === "delivered").length)}
${stat("Wholesale applications", (w.data || []).length, lnk("customers"))}${stat("New quotations", (q.data || []).length, lnk("quotations"))}${stat("Low-stock products", low.length, lnk("products"))}</div>
<div class="row g-3 mt-1"><div class="col-md-7"><h2 class="h5">Recent orders</h2>${tbl(["Reference", "Customer", "Status", "Total"], O.slice(0, 8).map(x => `<tr><td>${esc(x.reference)}</td><td>${esc(x.customer_name)}</td><td>${bdg(x.status)}</td><td>${naira(x.total)}</td></tr>`).join(""))}</div>
<div class="col-md-5"><h2 class="h5">Low stock</h2>${low.length ? low.map(i => `<p class="small m-0">${esc(i.products?.name)} (${esc(i.products?.sku)}): <strong>${i.quantity}</strong> left</p>`).join("") : "<p class='meta'>No low-stock products. Stock is only counted for products with stock tracking turned on.</p>"}
<h2 class="h5 mt-3">Recent activity</h2>${(lg.data || []).length ? lg.data.map(a => `<p class="small m-0">${esc(label(a.action))} · ${dt(a.created_at)}</p>`).join("") : "<p class='meta'>No activity logged yet.</p>"}</div></div>`;
};

// ---------- Orders ----------
AP.orders = async () => {
  const uid = param("user"); let rows = [];
  $("#adm-main").innerHTML = `<h1 class="h2">Orders${uid ? " (one customer)" : ""}</h1><div class="d-flex flex-wrap gap-2 mb-3"><input class="form-control" id="oq" placeholder="Search reference, name, phone" style="max-width:260px" aria-label="Search">
<select class="form-select" id="os" style="max-width:200px" aria-label="Status"><option value="">All statuses</option>${STATUSES.map(s => `<option value="${s}">${label(s)}</option>`).join("")}</select><input class="form-control" type="date" id="od" style="max-width:170px" aria-label="From date"></div><div id="olist"></div>`;
  const draw = () => {
    const t = $("#oq").value.toLowerCase(), s = $("#os").value;
    const list = rows.filter(o => (!s || o.status === s) && (!t || [o.reference, o.customer_name, o.phone].join(" ").toLowerCase().includes(t)));
    $("#olist").innerHTML = tbl(["Reference", "Date", "Customer", "Status", "Payment", "Total"], list.map(o => `<tr class="clk" data-id="${esc(o.id)}"><td>${esc(o.reference)}${o.is_wholesale ? " (W)" : ""}</td><td>${dt(o.created_at)}</td><td>${esc(o.customer_name)}</td><td>${bdg(o.status)}</td><td>${bdg(o.payment_status)}</td><td>${naira(o.total)}</td></tr>`).join(""));
  };
  const load = async () => { let q = sb.from("orders").select("*,order_items(product_name,quantity,unit_price)").order("created_at", {ascending: false}).limit(300); if (uid) q = q.eq("user_id", uid); if ($("#od").value) q = q.gte("created_at", $("#od").value); rows = (await q).data || []; draw(); };
  ["oq", "os"].forEach(i => $("#" + i).addEventListener("input", draw)); $("#od").addEventListener("change", load);
  $("#olist").addEventListener("click", e => { const r = e.target.closest("tr[data-id]"); if (r) openOrder(rows.find(x => x.id === r.dataset.id), load); });
  await load();
};
function openOrder(o, reload) {
  const m = modal(`<div class="d-flex justify-content-between"><h2 class="h5">${esc(o.reference)}</h2><button class="btn-close" data-close aria-label="Close"></button></div>
<p class="meta">${dt(o.created_at)} · Payment: ${bdg(o.payment_status)} · ${o.is_wholesale ? "Wholesale order" : "Retail order"}</p>
${tbl(["Item", "Qty", "Unit price"], o.order_items.map(i => `<tr><td>${esc(i.product_name)}</td><td>${i.quantity}</td><td>${naira(i.unit_price)}</td></tr>`).join(""))}
<p class="fw-semibold">Total: ${naira(o.total)} <span class="meta">(subtotal ${naira(o.subtotal)}, delivery ${naira(o.delivery_fee)})</span></p>
<form id="of">${sel("status", "Order status", STATUSES.map(s => [s, label(s)]), o.status)}${fld("customer_name", "Customer", o.customer_name)}${fld("phone", "Phone", o.phone)}${fld("address", "Delivery address", o.address)}
<div class="row g-2"><div class="col-6">${fld("city", "City", o.city)}</div><div class="col-6">${fld("state", "State", o.state)}</div></div>${fld("tracking_info", "Dispatch / tracking details", o.tracking_info || "")}${txt("fulfilment_notes", "Fulfilment notes", o.fulfilment_notes || "")}
<div class="d-flex gap-2 flex-wrap"><button class="btn btn-accent">Save changes</button><a class="btn btn-outline-dark" target="_blank" rel="noopener" href="${waLink(o.phone, `Hello ${o.customer_name}, this is AkuBee Auto Care about your order ${o.reference}.`)}">WhatsApp customer</a></div></form>`);
  $("#of", m).addEventListener("submit", async e => {
    e.preventDefault(); const v = fd(e.target);
    const {error} = await sb.from("orders").update({status: v.status, customer_name: v.customer_name, phone: v.phone, address: v.address, city: v.city, state: v.state, tracking_info: v.tracking_info || null, fulfilment_notes: v.fulfilment_notes || null}).eq("id", o.id);
    if (error) return msg("Could not save the order.", true);
    if (v.status !== o.status) await audit("order_status_changed", "order", o.id, {from: o.status, to: v.status});
    m.remove(); msg("Order saved."); reload();
  });
}

// ---------- Products ----------
AP.products = async () => {
  let P = [], C = [], B = [];
  const load = async () => {
    const [p, c, b] = await Promise.all([
      sb.from("products").select("id,sku,slug,name,description,retail_price,min_wholesale_qty,is_featured,is_active,category_id,brand_id,categories(name),brands(name),inventory(track_stock,quantity,low_stock_threshold),pricing_tiers(min_qty,unit_price),product_images(id,url,sort_order)").order("created_at", {ascending: false}).limit(500),
      sb.from("categories").select("id,name,slug").order("sort_order"), sb.from("brands").select("id,name")]);
    P = p.data || []; C = c.data || []; B = b.data || []; draw();
  };
  $("#adm-main").innerHTML = `<div class="d-flex justify-content-between flex-wrap gap-2 mb-3"><h1 class="h2 m-0">Products</h1><div class="d-flex gap-2 flex-wrap"><button class="btn btn-outline-dark btn-sm" id="addcat">+ Category</button><button class="btn btn-outline-dark btn-sm" id="addbrand">+ Brand</button><button class="btn btn-accent btn-sm" id="addp">+ Add product</button></div></div>
<input class="form-control mb-3" id="pq" placeholder="Search products" style="max-width:300px" aria-label="Search products"><div id="plist"></div>`;
  const draw = () => {
    const t = $("#pq").value.toLowerCase();
    $("#plist").innerHTML = tbl(["Product", "Category", "Retail price", "Stock", "Status", ""], P.filter(p => !t || (p.name + p.sku).toLowerCase().includes(t)).map(p => {
      const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
      return `<tr><td>${esc(p.name)}<br><span class="meta">${esc(p.sku)}${p.is_featured ? " · featured" : ""}</span></td><td>${esc(p.categories?.name || "")}</td><td>${naira(p.retail_price)}</td><td>${inv?.track_stock ? inv.quantity : "not tracked"}</td><td>${bdg(p.is_active ? "active" : "archived")}</td>
<td class="nowrap"><button class="btn btn-outline-dark btn-sm" data-edit="${esc(p.id)}">Edit</button> <button class="btn btn-outline-dark btn-sm" data-arch="${esc(p.id)}">${p.is_active ? "Archive" : "Restore"}</button> ${OWNER ? `<button class="btn btn-outline-dark btn-sm" data-del="${esc(p.id)}">Delete</button>` : ""}</td></tr>`; }).join(""));
  };
  $("#pq").addEventListener("input", draw);
  $("#addp").onclick = () => edit(null);
  $("#addcat").onclick = async () => { const n = prompt("Category name"); if (n && slug(n)) { const {error} = await sb.from("categories").insert({name: n.trim(), slug: slug(n)}); msg(error ? "Could not add category." : "Category added.", !!error); load(); } };
  $("#addbrand").onclick = async () => { const n = prompt("Brand name"); if (n && slug(n)) { const {error} = await sb.from("brands").insert({name: n.trim(), slug: slug(n)}); msg(error ? "Could not add brand." : "Brand added.", !!error); load(); } };
  $("#plist").addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return; const id = b.dataset.edit || b.dataset.arch || b.dataset.del, p = P.find(x => x.id === id);
    if (b.dataset.edit) edit(p);
    if (b.dataset.arch) { await sb.from("products").update({is_active: !p.is_active}).eq("id", id); await audit(p.is_active ? "product_archived" : "product_restored", "product", id, {name: p.name}); load(); }
    if (b.dataset.del && confirm(`Delete "${p.name}" permanently? Past orders keep their item names. Archive instead if unsure.`)) { await sb.from("products").delete().eq("id", id); await audit("product_deleted", "product", id, {name: p.name}); load(); }
  });
  function edit(p) {
    const inv = (Array.isArray(p?.inventory) ? p.inventory[0] : p?.inventory) || {}, tiers = (p?.pricing_tiers || []).map(t => `${t.min_qty}=${t.unit_price}`).join("\n");
    const m = modal(`<div class="d-flex justify-content-between"><h2 class="h5">${p ? "Edit product" : "Add product"}</h2><button class="btn-close" data-close aria-label="Close"></button></div><form id="pf">
${fld("name", "Name", p?.name, "text", "required")}${fld("sku", "SKU", p?.sku, "text", "required")}${sel("category_id", "Category", [["", "None"], ...C.map(c => [c.id, c.name])], p?.category_id)}${sel("brand_id", "Brand", [["", "None"], ...B.map(b => [b.id, b.name])], p?.brand_id)}
<div class="row g-2"><div class="col-6">${fld("retail_price", "Retail price (₦)", p?.retail_price ?? "", "number", "min=0 step=0.01")}</div><div class="col-6">${fld("min_wholesale_qty", "Wholesale minimum qty", p?.min_wholesale_qty ?? "", "number", "min=1")}</div></div>
${OWNER ? txt("tiers", "Wholesale price tiers (one per line: minimum qty=unit price)", tiers) : ""}${txt("description", "Description", p?.description)}
<div class="row g-2"><div class="col-6">${fld("quantity", "Stock quantity", inv.quantity ?? 0, "number", "min=0")}</div><div class="col-6">${fld("low_stock_threshold", "Low-stock alert at", inv.low_stock_threshold ?? 5, "number", "min=0")}</div></div>
<label class="d-block mb-2"><input type="checkbox" name="track_stock" ${inv.track_stock ? "checked" : ""}> Track stock for this product</label><label class="d-block mb-2"><input type="checkbox" name="is_featured" ${p?.is_featured ? "checked" : ""}> Featured on homepage</label><label class="d-block mb-3"><input type="checkbox" name="is_active" ${p?.is_active ?? true ? "checked" : ""}> Active (visible in shop)</label>
<div class="mb-3"><span class="meta">Images (JPEG, PNG or WebP, max 2 MB each)</span><div id="imgs" class="d-flex gap-2 flex-wrap my-2">${(p?.product_images || []).map(i => `<span class="thumb"><img src="${esc(/^(https?:|data:|\/)/.test(i.url) ? i.url : BASE + i.url)}" alt="" height="56"><button type="button" data-rmimg="${esc(i.id)}" aria-label="Remove image">×</button></span>`).join("")}</div><input type="file" id="files" accept="image/jpeg,image/png,image/webp" multiple></div>
<button class="btn btn-accent w-100">Save product</button></form>`);
    m.addEventListener("click", async e => { const r = e.target.closest("[data-rmimg]"); if (r) { await sb.from("product_images").delete().eq("id", r.dataset.rmimg); r.closest(".thumb").remove(); } });
    $("#pf", m).addEventListener("submit", async e => {
      e.preventDefault(); const v = fd(e.target), f = e.target.elements;
      const row = {name: v.name.trim(), sku: v.sku.trim(), category_id: v.category_id || null, brand_id: v.brand_id || null, retail_price: num(v.retail_price), min_wholesale_qty: num(v.min_wholesale_qty), description: v.description, is_featured: f.is_featured.checked, is_active: f.is_active.checked};
      const files = [...$("#files", m).files], bad = files.find(x => !["image/jpeg", "image/png", "image/webp"].includes(x.type) || x.size > 2097152);
      if (bad) return alert(`"${bad.name}" is not allowed. Use JPEG, PNG or WebP under 2 MB.`);
      let id = p?.id, r;
      if (p) r = await sb.from("products").update(row).eq("id", id);
      else { r = await sb.from("products").insert({...row, slug: slug(row.name)}).select("id").single(); id = r.data?.id; }
      if (r.error || !id) return alert("Could not save the product. Check that the SKU and name are unique.");
      await sb.from("inventory").upsert({product_id: id, track_stock: f.track_stock.checked, quantity: num(v.quantity) || 0, low_stock_threshold: num(v.low_stock_threshold) ?? 5});
      if (OWNER) await sb.from("pricing_tiers").delete().eq("product_id", id);
      const tiers = OWNER ? v.tiers.split("\n").map(l => l.split("=").map(x => Number(x.trim()))).filter(([a, b]) => a > 0 && b >= 0).map(([a, b]) => ({product_id: id, min_qty: a, unit_price: b})) : [];
      if (tiers.length) await sb.from("pricing_tiers").insert(tiers);
      for (const [i, file] of files.entries()) {
        const path = `${id}/${Date.now()}-${i}-${slug(file.name.replace(/\.[^.]+$/, ""))}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
        const up = await sb.storage.from("product-images").upload(path, file, {contentType: file.type}); if (up.error) { alert("An image failed to upload."); continue; }
        await sb.from("product_images").insert({product_id: id, url: sb.storage.from("product-images").getPublicUrl(path).data.publicUrl, alt: row.name, sort_order: (p?.product_images?.length || 0) + i});
      }
      await audit(p ? "product_updated" : "product_created", "product", id, {name: row.name}); m.remove(); msg("Product saved."); load();
    });
  }
  await load();
};

// ---------- Customers & wholesale ----------
AP.customers = async () => {
  let tab = "apps";
  const draw = async () => {
    const main = $("#adm-main");
    if (tab === "apps") {
      const {data} = await sb.from("wholesale_applications").select("*").order("created_at", {ascending: false}).limit(200), A = data || [];
      main.innerHTML = `<h1 class="h2">Customers</h1>${tabs([["apps", "Wholesale applications"], ["people", "Customers"]], tab)}` + (A.length ? A.map(a => `<div class="tip mb-2"><div class="d-flex justify-content-between"><strong>${esc(a.business_name)}</strong>${bdg(a.status)}</div>
<p class="small m-0">${esc(a.contact_name)} · ${esc(a.phone)} · ${esc(a.email)}</p><p class="small m-0">${esc(a.business_type)} · ${esc(a.business_address)}, ${esc(a.state)}</p><p class="small m-0">Interested in: ${esc(a.products_interest || "n/a")} · Volume: ${esc(a.estimated_volume || "n/a")} · Reg: ${esc(a.registration_details || "n/a")}</p>
${a.status === "pending" && OWNER ? `<div class="d-flex gap-2 mt-2"><button class="btn btn-accent btn-sm" data-rev="${esc(a.id)}" data-ok="1">Approve</button><button class="btn btn-outline-dark btn-sm" data-rev="${esc(a.id)}" data-ok="0">Reject</button></div>` : `<p class="meta m-0">${esc(a.admin_notes || "")}</p>`}</div>`).join("") : "<p class='text-muted'>No applications yet.</p>");
    } else {
      const {data} = await sb.from("profiles").select("id,full_name,phone,wholesale_status,created_at").order("created_at", {ascending: false}).limit(300);
      main.innerHTML = `<h1 class="h2">Customers</h1>${tabs([["apps", "Wholesale applications"], ["people", "Customers"]], tab)}` + tbl(["Name", "Phone", "Account", "Joined", ""], (data || []).map(c => `<tr><td>${esc(c.full_name || "(no name)")}</td><td>${esc(c.phone || "")}</td><td>${bdg(c.wholesale_status === "none" ? "retail" : c.wholesale_status)}</td><td>${dt(c.created_at)}</td>
<td class="nowrap"><a class="btn btn-outline-dark btn-sm" href="${lnk("orders")}?user=${esc(c.id)}">Orders</a> ${!OWNER ? "" : c.wholesale_status === "approved" ? "" : `<button class="btn btn-outline-dark btn-sm" data-set="approved" data-id="${esc(c.id)}">Grant wholesale</button>`} ${!OWNER ? "" : c.wholesale_status === "suspended" ? `<button class="btn btn-outline-dark btn-sm" data-set="none" data-id="${esc(c.id)}">Reactivate</button>` : `<button class="btn btn-outline-dark btn-sm" data-set="suspended" data-id="${esc(c.id)}">Suspend</button>`}</td></tr>`).join(""));
    }
  };
  $("#adm-main").addEventListener("click", async e => {
    const t = e.target.closest("[data-tab]"); if (t) { tab = t.dataset.tab; return draw(); }
    const r = e.target.closest("[data-rev]");
    if (r) { const notes = prompt("Notes (optional)") ?? ""; const {error} = await sb.rpc("review_wholesale", {p_id: r.dataset.rev, p_approve: r.dataset.ok === "1", p_notes: notes}); msg(error ? "Could not review that application." : "Application updated.", !!error); return draw(); }
    const s = e.target.closest("[data-set]");
    if (s && confirm("Change this customer's account status?")) { const {error} = await sb.from("profiles").update({wholesale_status: s.dataset.set}).eq("id", s.dataset.id); if (!error) await audit("customer_status_changed", "profile", s.dataset.id, {to: s.dataset.set}); msg(error ? "Could not update." : "Customer updated.", !!error); draw(); }
  });
  await draw();
};

// ---------- Quotations & distributors ----------
AP.quotations = async () => {
  let tab = "q";
  const draw = async () => {
    const main = $("#adm-main"), head = `<h1 class="h2">Quotes &amp; distributors</h1>${tabs([["q", "Quotation requests"], ["d", "Distributor applications"]], tab)}`;
    if (tab === "q") {
      const {data} = await sb.from("quotation_requests").select("*,quotation_items(product_name,quantity)").order("created_at", {ascending: false}).limit(200);
      main.innerHTML = head + ((data || []).map(q => `<div class="tip mb-2"><div class="d-flex justify-content-between"><strong>${esc(q.reference)}</strong>${bdg(q.status)}</div><p class="small m-0">${esc(q.contact_name)}${q.business_name ? " · " + esc(q.business_name) : ""} · ${esc(q.phone)} · ${dt(q.created_at)}</p>
<p class="small m-0">${(q.quotation_items || []).map(i => esc(i.product_name) + " × " + i.quantity).join(", ")}</p>${q.requirements ? `<p class="small m-0">Requirements: ${esc(q.requirements)}</p>` : ""}
<div class="d-flex gap-2 flex-wrap mt-2 align-items-start"><select class="form-select" style="width:150px" data-st="${esc(q.id)}" data-kind="quotation_requests" aria-label="Status">${["new", "in_review", "quoted", "closed"].map(s => `<option ${s === q.status ? "selected" : ""}>${s}</option>`).join("")}</select>
<textarea class="form-control" rows="1" style="flex:1;min-width:180px" data-nt="${esc(q.id)}" placeholder="Internal notes">${esc(q.internal_notes || "")}</textarea><button class="btn btn-accent btn-sm" data-save="${esc(q.id)}" data-kind="quotation_requests">Save</button>
<a class="btn btn-outline-dark btn-sm" target="_blank" rel="noopener" href="${waLink(q.phone, `Hello ${q.contact_name}, this is AkuBee Auto Care about your quotation ${q.reference}.`)}">Reply on WhatsApp</a></div></div>`).join("") || "<p class='text-muted'>No quotation requests yet.</p>");
    } else {
      const {data} = await sb.from("distributor_applications").select("*").order("created_at", {ascending: false}).limit(200);
      main.innerHTML = head + ((data || []).map(d => `<div class="tip mb-2"><div class="d-flex justify-content-between"><strong>${esc(d.business_name)}</strong>${bdg(d.status)}</div><p class="small m-0">${esc(d.applicant_name)} · ${esc(d.phone)} · ${esc(d.location)} · ${esc(d.business_type || "")}</p>
<p class="small m-0">Interest: ${esc(d.areas_of_interest || "n/a")} ${d.comments ? "· " + esc(d.comments) : ""}</p><div class="d-flex gap-2 flex-wrap mt-2 align-items-start"><select class="form-select" style="width:150px" data-st="${esc(d.id)}" data-kind="distributor_applications" aria-label="Status">${["new", "in_review", "accepted", "declined"].map(s => `<option ${s === d.status ? "selected" : ""}>${s}</option>`).join("")}</select>
<textarea class="form-control" rows="1" style="flex:1;min-width:180px" data-nt="${esc(d.id)}" placeholder="Internal notes">${esc(d.internal_notes || "")}</textarea><button class="btn btn-accent btn-sm" data-save="${esc(d.id)}" data-kind="distributor_applications">Save</button>
<a class="btn btn-outline-dark btn-sm" target="_blank" rel="noopener" href="${waLink(d.phone, `Hello ${d.applicant_name}, this is AkuBee Auto Care about your distributor application.`)}">Reply on WhatsApp</a></div></div>`).join("") || "<p class='text-muted'>No distributor applications yet.</p>");
    }
  };
  $("#adm-main").addEventListener("click", async e => {
    const t = e.target.closest("[data-tab]"); if (t) { tab = t.dataset.tab; return draw(); }
    const s = e.target.closest("[data-save]");
    if (s) { const id = s.dataset.save, st = $(`[data-st="${id}"]`).value, nt = $(`[data-nt="${id}"]`).value; const {error} = await sb.from(s.dataset.kind).update({status: st, internal_notes: nt}).eq("id", id); if (!error) await audit("status_updated", s.dataset.kind, id, {status: st}); msg(error ? "Could not save." : "Saved.", !!error); }
  });
  await draw();
};

// ---------- Settings ----------
AP.settings = async () => {
  const [s, z, pm, pl] = await Promise.all([sb.from("site_settings").select("key,value"), sb.from("delivery_zones").select("id,state,fee,is_active").order("state"), sb.from("promotions").select("id,name,product_id,discount_percent,ends_at,show_countdown,is_active").order("created_at", {ascending: false}), sb.from("products").select("id,name").order("name")]);
  const PN = Object.fromEntries((pl.data || []).map(p => [p.id, p.name]));
  const S = Object.fromEntries((s.data || []).map(r => [r.key, r.value])), pp = S.payment_providers || {}, c = S.store_contact || {}, w = S.site_content || {};
  const save = async (key, value, isPublic = true) => { const {error} = await sb.from("site_settings").upsert({key, value, is_public: isPublic}); if (!error) await audit("setting_changed", "site_settings", null, {key}); msg(error ? "Could not save." : "Saved.", !!error); };
  $("#adm-main").innerHTML = `<h1 class="h2">Settings</h1><div class="row g-3"><div class="col-md-6"><div class="tip"><h2 class="h5">Payment providers</h2><form id="pp"><label class="d-block mb-2"><input type="checkbox" name="paystack" ${pp.paystack ? "checked" : ""}> Paystack</label><label class="d-block mb-3"><input type="checkbox" name="flutterwave" ${pp.flutterwave ? "checked" : ""}> Flutterwave</label><button class="btn btn-accent btn-sm">Save</button></form><p class="meta mt-2">API secret keys are set in Supabase, never here.</p></div></div>
<div class="col-md-6"><div class="tip"><h2 class="h5">Store details</h2><form id="sc">${fld("phone", "Phone", c.phone ?? "08089036605")}${fld("whatsapp", "WhatsApp number", c.whatsapp ?? "08089036605")}${fld("email", "Email", c.email ?? "", "email")}${fld("address1", "Store 1 address", c.address1 ?? "Shop D4008, Apo Urban Market, Abuja")}${fld("address2", "Store 2 address", c.address2 ?? "Gudu Plaza, Abuja")}${fld("instagram", "Instagram link", c.instagram ?? "https://www.instagram.com/akubee_autocare_abuja/")}${fld("facebook", "Facebook link", c.facebook ?? "")}${fld("tiktok", "TikTok link", c.tiktok ?? "")}<button class="btn btn-accent btn-sm">Save</button></form></div></div>
<div class="col-md-6"><div class="tip"><h2 class="h5">Website content</h2><form id="sw">${fld("announcement", "Announcement bar text", w.announcement ?? "")}${fld("hero_headline", "Homepage headline", w.hero_headline ?? "")}${txt("hero_text", "Homepage supporting text", w.hero_text ?? "")}<button class="btn btn-accent btn-sm">Save</button></form></div></div>
<div class="col-md-6"><div class="tip"><h2 class="h5">Delivery charges by state</h2><div id="zl">${(z.data || []).map(r => `<div class="d-flex justify-content-between small mb-1"><span>${esc(r.state)}: ${naira(r.fee)}</span><button class="btn btn-outline-dark btn-sm" data-zdel="${esc(r.id)}">Remove</button></div>`).join("") || "<p class='meta'>No delivery fees set. Orders show a delivery fee of zero until you add one.</p>"}</div>
<form id="zf" class="d-flex gap-2 mt-2"><select class="form-select" name="state" aria-label="State">${STATES.map(x => `<option>${x}</option>`).join("")}</select><input class="form-control" name="fee" type="number" min="0" placeholder="Fee ₦" required style="width:110px"><button class="btn btn-accent btn-sm">Set</button></form></div></div>
<div class="col-12"><div class="tip"><h2 class="h5">Discounts and deals</h2><p class="meta">A discount lowers the retail price shown in the shop and charged at checkout. The countdown shows on the homepage only when you tick it and set an end time.</p>
<div id="pml">${(pm.data || []).map(r => `<div class="d-flex justify-content-between align-items-center small mb-1 gap-2"><span>${esc(r.name)}: ${esc(PN[r.product_id] || "product")} (-${r.discount_percent}%)${r.ends_at ? " until " + dt(r.ends_at) : ""}${r.is_active ? "" : " (off)"}</span><button class="btn btn-outline-dark btn-sm" data-pdel="${esc(r.id)}">Remove</button></div>`).join("") || "<p class='meta'>No discounts set.</p>"}</div>
<form id="pmf" class="row g-2 mt-1"><div class="col-md-4"><select class="form-select" name="product_id" required aria-label="Product"><option value="">Choose product</option>${(pl.data || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></div>
<div class="col-6 col-md-2"><input class="form-control" name="discount_percent" type="number" min="1" max="90" placeholder="% off" required aria-label="Percent off"></div><div class="col-6 col-md-3"><input class="form-control" name="ends_at" type="datetime-local" aria-label="Ends"></div>
<div class="col-md-3"><label class="meta"><input type="checkbox" name="show_countdown"> Show countdown</label></div><div class="col-12"><button class="btn btn-accent btn-sm">Add discount</button></div></form></div></div></div>
<p class="meta mt-3">The storefront shows store details, website text, payment switches and active discounts from these settings.</p>`;
  $("#pp").addEventListener("submit", e => { e.preventDefault(); const f = e.target.elements; save("payment_providers", {paystack: f.paystack.checked, flutterwave: f.flutterwave.checked}); });
  $("#sc").addEventListener("submit", e => { e.preventDefault(); save("store_contact", fd(e.target)); });
  $("#sw").addEventListener("submit", e => { e.preventDefault(); save("site_content", fd(e.target)); });
  $("#zf").addEventListener("submit", async e => { e.preventDefault(); const v = fd(e.target); await sb.from("delivery_zones").upsert({state: v.state, fee: Number(v.fee), is_active: true}, {onConflict: "state"}); await audit("delivery_fee_set", "delivery_zones", null, v); AP.settings(); });
  $("#pmf").addEventListener("submit", async e => { e.preventDefault(); const v = fd(e.target), f = e.target.elements;
    const {error} = await sb.from("promotions").insert({name: PN[v.product_id] + " deal", product_id: v.product_id, discount_percent: Number(v.discount_percent), ends_at: v.ends_at ? new Date(v.ends_at).toISOString() : null, show_countdown: f.show_countdown.checked, is_active: true});
    if (!error) await audit("promotion_added", "promotions", null, {product: PN[v.product_id], pct: v.discount_percent}); msg(error ? "Could not add the discount." : "Discount added.", !!error); AP.settings(); });
  $("#pml").addEventListener("click", async e => { const b = e.target.closest("[data-pdel]"); if (b) { await sb.from("promotions").delete().eq("id", b.dataset.pdel); AP.settings(); } });
  $("#zl").addEventListener("click", async e => { const b = e.target.closest("[data-zdel]"); if (b) { await sb.from("delivery_zones").delete().eq("id", b.dataset.zdel); AP.settings(); } });
};

async function boot(page) {
  sb = DEMO ? await demo() : window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  if (page === "login") return AP.login();
  if (!(await guard())) return go(lnk("login"));
  document.title = "Admin | AkuBee Auto Care"; if (page === "settings" && !OWNER) return go(lnk("dashboard")); shell(page); await AP[page]();
}
window.AdminPages = {boot};
if (!PREVIEW) document.addEventListener("DOMContentLoaded", () => boot(document.body.dataset.page));
})();
