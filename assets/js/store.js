"use strict";
const CFG = window.APP_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const wa = t => `https://wa.me/${CFG.WHATSAPP}?text=${encodeURIComponent(t)}`;
const naira = n => "₦" + Number(n).toLocaleString("en-NG");
const go = u => window.PREVIEW ? (location.hash = "/" + u) : (location.href = u);
const priceText = p => p.price != null ? naira(p.price) : "Price on request";

// ---------- Data layer: Supabase when configured, local JSON otherwise ----------
const Store = {
  all: [], cats: [],
  param(k) {
    const q = new URLSearchParams(location.search).get(k);
    return q ?? new URLSearchParams(location.hash.split("?")[1] || "").get(k);
  },
  async load() {
    if (this.all.length) return;
    try {
      if (CFG.SUPABASE_URL && window.supabase) {
        const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
        const [p, c] = await Promise.all([
          sb.from("products").select("id,slug,sku,name,description,retail_price,min_wholesale_qty,specs,is_featured,created_at,categories(name,slug),brands(name),product_images(url,sort_order),inventory(track_stock,quantity)").eq("is_active", true),
          sb.from("categories").select("name,slug").eq("is_active", true).order("sort_order")]);
        if (p.error || c.error) throw (p.error || c.error);
        this.cats = c.data;
        this.all = p.data.map((r, i) => {
          const imgs = (r.product_images || []).sort((a, b) => a.sort_order - b.sort_order).map(x => x.url);
          const inv = r.inventory;
          return {id: r.id, slug: r.slug, sku: r.sku, name: r.name, desc: r.description, price: r.retail_price, moq: r.min_wholesale_qty,
            size: r.specs?.size, brand: r.brands?.name, cat: r.categories?.name, catSlug: r.categories?.slug, img: imgs[0] || "", images: imgs,
            featured: r.is_featured, created: new Date(r.created_at).getTime() || i, stock: inv && inv.track_stock ? inv.quantity : null};
        });
      }
    } catch (e) { console.warn("Supabase unavailable, using local catalogue.", e); this.all = []; }
    if (!this.all.length) {
      const j = window.__CATALOGUE__ || await (await fetch("data/products.json")).json();
      this.all = j.products; this.cats = j.categories;
    }
  },
  get: slug => Store.all.find(p => p.slug === slug),
  search(list, q) {
    const t = (q || "").toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter(p => { const h = [p.name, p.cat, p.brand, p.desc, p.sku].join(" ").toLowerCase(); return t.every(w => h.includes(w)); });
  },
  availability(p) {
    if (p.stock == null) return ["Confirm availability on WhatsApp", "text-muted"];
    if (p.stock === 0) return ["Out of stock", "text-danger"];
    return p.stock <= 5 ? ["Low stock", "text-warning"] : ["In stock", "text-success"];
  }
};

// ---------- Cart (guest cart in localStorage) ----------
const Cart = {
  items: (() => { try { return JSON.parse(localStorage.getItem("cart") || "[]"); } catch { return []; } })(),
  save() { try { localStorage.setItem("cart", JSON.stringify(this.items)); } catch {} this.render(); },
  add(id, n = 1) { const r = this.items.find(i => i.id === id); r ? r.qty += n : this.items.push({id, qty: n}); this.save(); },
  change(id, d) { const r = this.items.find(i => i.id === id); if (!r) return; r.qty += d; if (r.qty < 1) this.items = this.items.filter(i => i !== r); this.save(); },
  render() {
    const cnt = $("#cartCount"), box = $("#cartItems"), btn = $("#waOrder"); if (!box) return;
    cnt.textContent = this.items.reduce((n, i) => n + i.qty, 0);
    const rows = this.items.map(i => ({p: Store.get(i.id), qty: i.qty})).filter(r => r.p);
    btn.classList.toggle("disabled", !rows.length);
    if (!rows.length) { box.innerHTML = "<p class='text-muted'>Your cart is empty. Add a product to get started.</p>"; return; }
    box.innerHTML = rows.map(({p, qty}) => `<div class="d-flex align-items-center gap-2 mb-3"><img src="${esc(p.img)}" alt="" width="48" height="48" style="object-fit:contain">
      <div class="flex-grow-1 small fw-semibold">${esc(p.name)}<div class="meta">${esc(priceText(p))}</div></div>
      <div class="btn-group btn-group-sm"><button class="btn btn-outline-dark" data-d="-1" data-id="${esc(p.id)}" aria-label="Decrease">−</button><span class="btn btn-light disabled">${qty}</span><button class="btn btn-outline-dark" data-d="1" data-id="${esc(p.id)}" aria-label="Increase">+</button></div></div>`).join("");
    const priced = rows.every(r => r.p.price != null);
    $("#cartTotal").textContent = priced ? "Subtotal: " + naira(rows.reduce((s, r) => s + r.p.price * r.qty, 0)) : "Prices are confirmed when you send your order.";
    btn.href = wa("Hello AkuBee Auto Care, I would like to order:\n" + rows.map(r => `- ${r.p.name} x ${r.qty}`).join("\n") + "\nPlease confirm availability and price.");
  }
};

// ---------- Shared layout ----------
const Layout = {
  mount() {
    $("#site-header").innerHTML = `
<div class="announce"><div class="container d-flex justify-content-between gap-3"><span><i class="bi bi-truck"></i> Nationwide delivery across Nigeria</span><a href="index.html#wholesale">Wholesale enquiries</a></div></div>
<header class="site-header sticky-top"><div class="container hdr py-2">
<a href="index.html" class="brand"><img src="assets/images/akubee-logo.png" alt="AkuBee Auto Care Limited" width="100" height="58"></a>
<div class="hdr-actions"><a class="hide-mobile" href="#" aria-label="Account"><i class="bi bi-person fs-5"></i></a><a class="hide-mobile" href="#" aria-label="Wishlist"><i class="bi bi-heart fs-5"></i></a>
<button class="btn p-0 position-relative" data-bs-toggle="offcanvas" data-bs-target="#cart" aria-label="Cart"><i class="bi bi-bag fs-5"></i><span class="badge-count" id="cartCount">0</span></button>
<button class="btn p-0 d-md-none" data-bs-toggle="offcanvas" data-bs-target="#menu" aria-label="Menu"><i class="bi bi-list fs-2"></i></button></div>
<form class="search" id="searchForm" role="search" autocomplete="off"><input type="search" id="q" class="form-control" placeholder="Search car wash, spray paint, towels…" aria-label="Search products" list="suggest"><datalist id="suggest"></datalist><button class="btn btn-accent" aria-label="Search"><i class="bi bi-search"></i></button></form></div>
<div class="catbar d-none d-md-block"><div class="container d-flex gap-4" id="catBar"></div></div></header>
<div class="offcanvas offcanvas-start" id="menu"><div class="offcanvas-header"><img src="assets/images/akubee-logo.png" alt="AkuBee" width="90"><button class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button></div>
<div class="offcanvas-body d-grid gap-3"><a href="shop.html">Shop all products</a><a href="index.html#categories">Categories</a><a href="index.html#wholesale">Wholesale &amp; distributors</a><a href="index.html#contact">Contact &amp; stores</a></div></div>
<div class="offcanvas offcanvas-end" id="cart"><div class="offcanvas-header"><h2 class="h5 m-0">Your cart</h2><button class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button></div>
<div class="offcanvas-body d-flex flex-column"><div id="cartItems" class="flex-grow-1"></div><p class="small text-muted" id="cartTotal"></p><a class="btn btn-accent w-100" id="waOrder" target="_blank" rel="noopener">Send order on WhatsApp</a></div></div>`;
    $("#site-footer").innerHTML = `<footer class="site-footer mt-5" id="contact"><div class="container py-5"><div class="row g-4">
<div class="col-md-4"><img src="assets/images/akubee-logo-light.png" alt="AkuBee Auto Care Limited" width="140"><p class="mt-3">Car care wholesaler, distributor and retailer.</p></div>
<div class="col-md-4"><h3>Our stores (Abuja)</h3><p>Shop D4008, Apo Urban Market<br>Gudu Plaza</p><p><a href="tel:08089036605">08089036605</a> (call / WhatsApp)</p></div>
<div class="col-md-4"><h3>Information</h3><ul class="list-unstyled"><li><a href="#">Privacy policy</a></li><li><a href="#">Terms and conditions</a></li><li><a href="#">Returns and refunds</a></li></ul></div></div></div>
<div class="copy">© ${new Date().getFullYear()} AkuBee Auto Care Limited</div></footer>`;
    $("#searchForm").addEventListener("submit", e => { e.preventDefault(); go("shop.html?q=" + encodeURIComponent($("#q").value.trim())); });
    $("#cartItems").addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) Cart.change(b.dataset.id, +b.dataset.d); });
  },
  fill() {
    $("#catBar").innerHTML = Store.cats.slice(0, 6).map(c => `<a href="shop.html?cat=${esc(c.slug)}">${esc(c.name)}</a>`).join("") + `<a href="index.html#wholesale" class="ms-auto">Wholesale</a>`;
    $("#suggest").innerHTML = Store.all.map(p => `<option value="${esc(p.name)}">`).join("");
  }
};

// ---------- Product card ----------
const card = p => {
  const [av, cls] = Store.availability(p);
  return `<div class="col-6 col-md-4 col-lg-3"><article class="card-p"><a href="product.html?slug=${esc(p.slug)}"><img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy"></a>
<div class="body"><span class="meta">${esc(p.cat)}${p.brand ? " · " + esc(p.brand) : ""}</span><h3><a href="product.html?slug=${esc(p.slug)}">${esc(p.name)}</a></h3>
<span class="price ${p.price == null ? "text-muted" : ""}">${esc(priceText(p))}</span>
<span class="meta">${p.moq ? "Wholesale MOQ: " + p.moq + " pcs" : "Wholesale: ask for MOQ"}</span><span class="meta ${cls}">${esc(av)}</span>
<div class="mt-auto d-grid gap-1 pt-2"><button class="btn btn-accent btn-sm" data-add="${esc(p.id)}">Add to cart</button><a class="btn btn-outline-dark btn-sm" href="product.html?slug=${esc(p.slug)}">Quick view</a></div></div></article></div>`;
};
const bindAdd = root => root.addEventListener("click", e => { const b = e.target.closest("[data-add]"); if (b) { Cart.add(b.dataset.add); b.textContent = "Added ✓"; setTimeout(() => b.textContent = "Add to cart", 1200); } });

// ---------- Pages ----------
const Pages = {
  index() {
    document.title = "AkuBee Auto Care Limited | Car Care Products, Wholesale & Retail, Abuja";
    $("#app").innerHTML = `
<section class="container hero my-3"><div class="row g-3"><div class="col-lg-8"><div class="banner dark main"><div class="banner-text"><span class="tag">Wholesale &amp; retail</span>
<h1>Car care that keeps every vehicle showroom-ready</h1><p>Car wash liquids, spray paints, microfibre towels, polish and more, supplied from Abuja to Nigeria.</p><a href="shop.html" class="btn btn-accent">Shop now</a></div>
<img src="assets/images/towel-branded.jpg" alt="AkuBee branded yellow microfibre towel"></div></div>
<div class="col-lg-4 d-grid gap-3"><div class="banner yellow"><div class="banner-text"><h2>Spray paint</h2><p>450ml, MOQ 24 pcs</p><a href="shop.html?cat=spray-paints" class="btn btn-dark btn-sm">Shop</a></div><img src="assets/images/spray-paint.jpg" alt="Spray paint can"></div>
<div class="banner dark"><div class="banner-text"><h2>Tyre polish</h2><p>Deep, lasting shine</p><a href="product.html?slug=tyre-polish" class="btn btn-accent btn-sm">Shop</a></div><img src="assets/images/tyre-polish.jpg" alt="Tyre polish spray"></div></div></div></section>
<section class="container"><div class="finder"><h2>What does your vehicle need today?</h2><div class="row g-2">
${[["Exterior care","cat=wax-polish"],["Interior care","q=interior"],["Washing","cat=car-wash"],["Detailing","cat=accessories"]].map(([n, q]) => `<div class="col-6 col-md-3"><a class="fbtn" href="shop.html?${q}">${n}</a></div>`).join("")}</div></div></section>
<section class="container py-5" id="categories"><h2 class="sec-title">Shop by category</h2><div class="row g-3">${Store.cats.map(c => `<div class="col-6 col-md-3"><a class="cat" href="shop.html?cat=${esc(c.slug)}"><i class="bi bi-tag"></i><h3>${esc(c.name)}</h3><span class="meta">${Store.all.filter(p => p.catSlug === c.slug).length} products</span></a></div>`).join("")}</div></section>
<section class="container"><div class="row g-3"><div class="col-md-6"><div class="banner dark promo"><div class="banner-text"><h2>Retail deals</h2><p>Offers appear here once configured in the admin.</p></div></div></div>
<div class="col-md-6" id="wholesale"><div class="banner yellow promo"><div class="banner-text"><h2>Buy in bulk</h2><p>Spray paint, car wash and wax MOQ 24 pcs. Towels and sponges MOQ 50 pcs.</p><a class="btn btn-dark btn-sm" target="_blank" rel="noopener" href="${wa("Hello AkuBee Auto Care, I would like wholesale pricing. Business name: ___ Products of interest: ___")}">Request wholesale pricing</a></div></div></div></div></section>
<section class="container py-5"><div class="d-flex justify-content-between align-items-center"><h2 class="sec-title">Featured products</h2><a href="shop.html">View all</a></div><div class="row g-3" id="grid">${Store.all.filter(p => p.featured).slice(0, 8).map(card).join("")}</div></section>
<section class="container pb-4"><h2 class="sec-title">Trending searches</h2><div class="d-flex flex-wrap gap-2">${["car wash","spray paint","microfibre towel","foam cleaner","dashboard polish","coolant","wash mitt"].map(t => `<a class="chip" href="shop.html?q=${encodeURIComponent(t)}">${t}</a>`).join("")}</div></section>
<section class="deals my-5"><div class="container"><h2 class="sec-title text-white">Deals of the week</h2><p class="text-secondary m-0">No active promotion. A countdown appears here only for a real offer set up by the admin.</p></div></section>
<section class="container py-4"><h2 class="sec-title">Our brands</h2><p class="text-muted">Brand logos supplied by the business will be listed here.</p></section>
<section class="container py-4"><div class="wholesale-cta"><div><h2>Run a car wash, detailing shop or store?</h2><p>Request wholesale pricing or apply to become a distributor.</p></div>
<div class="d-flex gap-2 flex-wrap"><a class="btn btn-accent" target="_blank" rel="noopener" href="${wa("Hello AkuBee Auto Care, I would like wholesale pricing.")}">Request wholesale pricing</a><a class="btn btn-outline-light" target="_blank" rel="noopener" href="${wa("Hello AkuBee Auto Care, I would like to become a distributor. Name: ___ Location: ___")}">Become a distributor</a></div></div></section>
<section class="container py-5"><h2 class="sec-title">Car care tips</h2><div class="row g-3">
<div class="col-md-4"><article class="tip"><h3>Use coolant, not plain water</h3><p>Coolant helps prevent overheating and protects the engine.</p></article></div>
<div class="col-md-4"><article class="tip"><h3>Dry with microfibre</h3><p>A soft towel lifts water without scratching paint.</p></article></div>
<div class="col-md-4"><article class="tip"><h3>Protect dashboard and tyres</h3><p>Polish keeps vinyl, rubber and tyres looking fresh.</p></article></div></div></section>
<section class="container"><div class="row g-3 benefits text-center"><div class="col-6 col-md-3"><i class="bi bi-truck"></i><h3>Nationwide delivery</h3></div><div class="col-6 col-md-3"><i class="bi bi-shield-lock"></i><h3>Secure online payments</h3></div><div class="col-6 col-md-3"><i class="bi bi-boxes"></i><h3>Wholesale available</h3></div><div class="col-6 col-md-3"><i class="bi bi-whatsapp"></i><h3>WhatsApp support</h3></div></div></section>`;
    bindAdd($("#grid"));
  },
  shop() {
    const q = Store.param("q") || "", cat = Store.param("cat") || "", sort = Store.param("sort") || "new", brand = Store.param("brand") || "";
    document.title = "Shop car care products | AkuBee Auto Care Limited";
    $("#q").value = q;
    const brands = [...new Set(Store.all.map(p => p.brand).filter(Boolean))].sort();
    let list = Store.search(Store.all, q);
    if (cat) list = list.filter(p => p.catSlug === cat);
    if (brand) list = list.filter(p => p.brand === brand);
    const by = {new: (a, b) => b.created - a.created, "price-asc": (a, b) => (a.price ?? 1e12) - (b.price ?? 1e12), "price-desc": (a, b) => (b.price ?? -1) - (a.price ?? -1), name: (a, b) => a.name.localeCompare(b.name)};
    list.sort(by[sort] || by.new);
    const opt = (v, t, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(t)}</option>`;
    $("#app").innerHTML = `<div class="container py-4"><h1 class="sec-title">${q ? `Results for “${esc(q)}”` : "Shop all products"}</h1>
<form class="row g-2 mb-3" id="filters"><div class="col-6 col-md-3"><select class="form-select" name="cat" aria-label="Category">${opt("", "All categories", cat)}${Store.cats.map(c => opt(c.slug, c.name, cat)).join("")}</select></div>
<div class="col-6 col-md-3"><select class="form-select" name="brand" aria-label="Brand">${opt("", "All brands", brand)}${brands.map(b => opt(b, b, brand)).join("")}</select></div>
<div class="col-6 col-md-3"><select class="form-select" name="sort" aria-label="Sort">${opt("new", "Newest", sort)}${opt("name", "Name A–Z", sort)}${opt("price-asc", "Price: low to high", sort)}${opt("price-desc", "Price: high to low", sort)}</select></div></form>
<p class="meta">${list.length} product${list.length === 1 ? "" : "s"}</p>
<div class="row g-3" id="grid">${list.map(card).join("")}</div>
${list.length ? "" : `<div class="tip"><h3>No products found</h3><p>Try a shorter word such as “wax” or “towel”, or <a href="shop.html">view all products</a>.</p></div>`}</div>`;
    $("#filters").addEventListener("change", e => {
      const f = new FormData($("#filters")); const u = new URLSearchParams(); if (q) u.set("q", q);
      for (const [k, v] of f) if (v) u.set(k, v);
      go("shop.html?" + u);
    });
    bindAdd($("#grid"));
  },
  product() {
    const p = Store.get(Store.param("slug"));
    if (!p) { $("#app").innerHTML = `<div class="container py-5"><h1 class="sec-title">Product not found</h1><p>This product may have been removed. <a href="shop.html">Browse all products</a>.</p></div>`; return; }
    document.title = `${p.name} | AkuBee Auto Care Limited`;
    const [av, cls] = Store.availability(p), related = Store.all.filter(x => x.catSlug === p.catSlug && x.id !== p.id).slice(0, 4);
    const specs = [["SKU", p.sku], ["Brand", p.brand], ["Size", p.size], ["Category", p.cat], ["Wholesale MOQ", p.moq ? p.moq + " pcs" : null]].filter(r => r[1]);
    $("#app").innerHTML = `<div class="container py-4"><nav class="meta mb-3"><a href="index.html">Home</a> / <a href="shop.html?cat=${esc(p.catSlug)}">${esc(p.cat)}</a> / ${esc(p.name)}</nav>
<div class="row g-4"><div class="col-md-6"><img class="pdp-img" src="${esc(p.img)}" alt="${esc(p.name)}"></div>
<div class="col-md-6"><h1 class="h2 fw-bold">${esc(p.name)}</h1><p class="price fs-4 ${p.price == null ? "text-muted" : ""}">${esc(priceText(p))}</p><p class="${cls} fw-semibold">${esc(av)}</p>
<p>${esc(p.desc)}</p><p class="meta">Wholesale pricing is available to approved business accounts.${p.moq ? ` Minimum bulk order: ${p.moq} pcs.` : ""}</p>
<div class="d-flex gap-2 align-items-center mb-3"><label for="qty" class="meta">Quantity</label><input id="qty" type="number" min="1" value="1" class="form-control" style="width:90px"></div>
<div class="d-grid gap-2 d-sm-flex"><button class="btn btn-accent" id="addBtn">Add to cart</button><button class="btn btn-dark" id="buyBtn">Buy now</button><a class="btn btn-outline-dark" target="_blank" rel="noopener" href="${wa("Hello AkuBee Auto Care, I am interested in: " + p.name + " (" + p.sku + ")")}"><i class="bi bi-whatsapp"></i> WhatsApp enquiry</a></div>
<table class="table mt-4"><tbody>${specs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div></div>
${related.length ? `<h2 class="sec-title mt-5">Related products</h2><div class="row g-3" id="grid">${related.map(card).join("")}</div>` : ""}</div>`;
    const qty = () => Math.max(1, parseInt($("#qty").value) || 1);
    $("#addBtn").onclick = () => { Cart.add(p.id, qty()); $("#addBtn").textContent = "Added ✓"; setTimeout(() => $("#addBtn").textContent = "Add to cart", 1200); };
    $("#buyBtn").onclick = () => { Cart.add(p.id, qty()); bootstrap.Offcanvas.getOrCreateInstance($("#cart")).show(); };
    if ($("#grid")) bindAdd($("#grid"));
    let ld = $("#ld"); if (!ld) { ld = document.createElement("script"); ld.id = "ld"; ld.type = "application/ld+json"; document.head.appendChild(ld); }
    ld.textContent = JSON.stringify({"@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.sku, description: p.desc, image: p.img, brand: p.brand ? {"@type": "Brand", name: p.brand} : undefined,
      ...(p.price != null ? {offers: {"@type": "Offer", priceCurrency: "NGN", price: p.price, availability: p.stock === 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock"}} : {})});
  }
};

const App = {
  async boot(page) { Layout.mount(); await Store.load(); Layout.fill(); Cart.render(); (Pages[page || document.body.dataset.page] || (() => {}))(); }
};
if (!window.PREVIEW) document.addEventListener("DOMContentLoaded", () => App.boot());
