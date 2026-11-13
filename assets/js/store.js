"use strict";
const CFG = window.APP_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const wa = t => `https://wa.me/${CFG.WHATSAPP}?text=${encodeURIComponent(t)}`;
const naira = n => "₦" + Number(n).toLocaleString("en-NG");
const go = u => window.PREVIEW ? (location.hash = "/" + u) : (location.href = u);
const ICONS = {"car-wash":"bi-droplet",cleaning:"bi-stars","spray-paints":"bi-palette",towels:"bi-grid-3x3","wax-polish":"bi-brightness-high",coolants:"bi-thermometer-half","air-fresheners":"bi-wind","car-care-kits":"bi-box-seam",accessories:"bi-brush"};
const priceText = p => p.price != null ? naira(p.price) : "Price on request";

// ---------- Data layer: Supabase when configured, local JSON otherwise ----------
const Store = {
  all: [], cats: [], sb: null, wish: new Set(),
  param(k) {
    const q = new URLSearchParams(location.search).get(k);
    return q ?? new URLSearchParams(location.hash.split("?")[1] || "").get(k);
  },
  async load() {
    if (this.all.length) return;
    try {
      if (CFG.SUPABASE_URL && window.supabase) {
        const sb = this.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
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
  add(id, n = 1) { const r = this.items.find(i => i.id === id); const p = Store.get(id), min = Store.wholesale && p?.moq ? p.moq : 1; r ? r.qty += n : this.items.push({id, qty: Math.max(n, min)}); this.save(); },
  change(id, d) { const r = this.items.find(i => i.id === id); if (!r) return; const p = Store.get(id), min = Store.wholesale && p?.moq ? p.moq : 1; if (r.qty + d < min) { if (d < 0) this.items = this.items.filter(i => i !== r); } else r.qty += d; this.save(); },
  render() {
    const cnt = $("#cartCount"), box = $("#cartItems"), btn = $("#waOrder"); if (!box) return;
    cnt.textContent = this.items.reduce((n, i) => n + i.qty, 0);
    const rows = this.items.map(i => ({p: Store.get(i.id), qty: i.qty})).filter(r => r.p);
    btn.classList.toggle("disabled", !rows.length);
    if (!rows.length) { box.innerHTML = "<p class='text-muted'>Your cart is empty. Add a product to get started.</p>"; return; }
    box.innerHTML = rows.map(({p, qty}) => `<div class="d-flex align-items-center gap-2 mb-3"><img src="${esc(p.img)}" alt="" width="48" height="48" style="object-fit:contain">
      <div class="flex-grow-1 small fw-semibold">${esc(p.name)}<div class="meta">${esc(Store.unit(p, qty) != null ? naira(Store.unit(p, qty)) : "Price on request")}</div></div>
      <div class="btn-group btn-group-sm"><button class="btn btn-outline-dark" data-d="-1" data-id="${esc(p.id)}" aria-label="Decrease">−</button><span class="btn btn-light disabled">${qty}</span><button class="btn btn-outline-dark" data-d="1" data-id="${esc(p.id)}" aria-label="Increase">+</button></div></div>`).join("");
    const priced = rows.every(r => Store.unit(r.p, r.qty) != null);
    $("#cartTotal").textContent = priced ? "Subtotal: " + naira(rows.reduce((s, r) => s + Store.unit(r.p, r.qty) * r.qty, 0)) : "Prices are confirmed when you send your order.";
    btn.href = wa("Hello AkuBee Auto Care, I would like to order:\n" + rows.map(r => `- ${r.p.name} x ${r.qty}`).join("\n") + "\nPlease confirm availability and price.");
  }
};

// ---------- Shared layout ----------
const Layout = {
  mount() {
    $("#site-header").innerHTML = `
<div class="announce"><div class="container d-flex justify-content-between gap-3"><span><i class="bi bi-truck"></i> ${esc(C().announcement || "Nationwide delivery")}</span><a href="tel:${tel()}"><i class="bi bi-telephone"></i> ${esc(S().phone || "08089036605")}</a></div></div>
<header class="site-header sticky-top"><div class="container hdr py-2">
<a href="index.html" class="brand"><img src="assets/images/akubee-logo.png" alt="AkuBee Auto Care Limited" width="100" height="58"></a>
<div class="hdr-actions"><a class="hide-mobile" href="login.html" aria-label="Account"><i class="bi bi-person fs-5"></i></a><a class="hide-mobile" href="wishlist.html" aria-label="Wishlist"><i class="bi bi-heart fs-5"></i></a>
<button class="btn p-0 position-relative" data-bs-toggle="offcanvas" data-bs-target="#cart" aria-label="Cart"><i class="bi bi-bag fs-5"></i><span class="badge-count" id="cartCount">0</span></button>
<button class="btn p-0 d-md-none" data-bs-toggle="offcanvas" data-bs-target="#menu" aria-label="Menu"><i class="bi bi-list fs-2"></i></button></div>
<form class="search" id="searchForm" role="search" autocomplete="off"><input type="search" id="q" class="form-control" placeholder="Search car wash, spray paint, towels…" aria-label="Search products" list="suggest"><datalist id="suggest"></datalist><button class="btn btn-accent" aria-label="Search"><i class="bi bi-search"></i></button></form></div>
<div class="catbar d-none d-md-block"><div class="container d-flex gap-4" id="catBar"></div></div></header>
<div class="offcanvas offcanvas-start" id="menu"><div class="offcanvas-header"><img src="assets/images/akubee-logo.png" alt="AkuBee" width="90"><button class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button></div>
<div class="offcanvas-body d-grid gap-3"><a href="shop.html">Shop all products</a><a href="index.html#categories">Categories</a><a href="wholesale.html">Wholesale &amp; distributors</a><a href="wishlist.html">Wishlist</a><a href="track-order.html">Track order</a><a href="about.html">About us</a><a href="contact.html">Contact &amp; stores</a><a href="faqs.html">FAQs</a><a href="login.html">Login / Register</a></div></div>
<div class="offcanvas offcanvas-end" id="cart"><div class="offcanvas-header"><h2 class="h5 m-0">Your cart</h2><button class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button></div>
<div class="offcanvas-body d-flex flex-column"><div id="cartItems" class="flex-grow-1"></div><p class="small text-muted" id="cartTotal"></p><a class="btn btn-dark w-100 mb-2" href="checkout.html">Checkout</a><a class="btn btn-accent w-100" id="waOrder" target="_blank" rel="noopener">Send order on WhatsApp</a></div></div>`;
    $("#site-footer").innerHTML = `<footer class="site-footer mt-5" id="contact"><div class="container py-5"><div class="row g-4">
<div class="col-md-4"><img src="assets/images/akubee-logo-light.png" alt="AkuBee Auto Care Limited" width="140"><p class="mt-3">Car care wholesaler, distributor and retailer.</p>
<div class="d-flex gap-2">${socials()}<a class="soc" href="${wa("Hello AkuBee Auto Care")}" target="_blank" rel="noopener" aria-label="WhatsApp"><i class="bi bi-whatsapp"></i></a><a class="soc" href="tel:${tel()}" aria-label="Call us"><i class="bi bi-telephone"></i></a></div></div>
<div class="col-md-4"><h3>Our stores (Abuja)</h3>${storeBlock()}</div>
<div class="col-md-4"><h3>Information</h3><ul class="list-unstyled cols2"><li><a href="shop.html">Shop</a></li><li><a href="wholesale.html">Wholesale</a></li><li><a href="track-order.html">Track order</a></li><li><a href="about.html">About us</a></li><li><a href="contact.html">Contact</a></li><li><a href="faqs.html">FAQs</a></li><li><a href="delivery.html">Delivery</a></li><li><a href="returns.html">Returns &amp; refunds</a></li><li><a href="privacy.html">Privacy policy</a></li><li><a href="terms.html">Terms</a></li><li><a href="login.html">My account</a></li><li><a href="admin/login.html">Staff login</a></li></ul></div></div></div>
<div class="copy">© ${new Date().getFullYear()} AkuBee Auto Care Limited</div></footer><a class="float-wa" href="${wa("Hello AkuBee Auto Care")}" target="_blank" rel="noopener" aria-label="Chat on WhatsApp"><i class="bi bi-whatsapp"></i></a>`;
    $("#searchForm").addEventListener("submit", e => { e.preventDefault(); go("shop.html?q=" + encodeURIComponent($("#q").value.trim())); });
    $("#cartItems").addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) Cart.change(b.dataset.id, +b.dataset.d); });
  },
  fill() {
    $("#catBar").innerHTML = Store.cats.slice(0, 6).map(c => `<a href="shop.html?cat=${esc(c.slug)}">${esc(c.name)}</a>`).join("") + `<a href="wholesale.html" class="ms-auto">Wholesale</a>`;
    $("#suggest").innerHTML = Store.all.map(p => `<option value="${esc(p.name)}">`).join("");
  }
};

// ---------- Product card ----------
const card = p => {
  const [av, cls] = Store.availability(p);
  return `<div class="col-6 col-md-4 col-lg-3"><article class="card-p"><button class="wish ${Store.wish.has(p.id) ? "on" : ""}" data-wish="${esc(p.id)}" aria-label="Save to wishlist" aria-pressed="${Store.wish.has(p.id)}"><i class="bi bi-heart"></i></button><a href="product.html?slug=${esc(p.slug)}"><img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy"></a>
<div class="body"><span class="meta">${esc(p.cat)}${p.brand ? " · " + esc(p.brand) : ""}</span><h3><a href="product.html?slug=${esc(p.slug)}">${esc(p.name)}</a></h3>
<span class="price ${p.price == null ? "text-muted" : ""}">${priceHtml(p)}</span>
<span class="meta">${p.moq ? "Wholesale MOQ: " + p.moq + " pcs" : "Wholesale: ask for MOQ"}</span><span class="meta ${cls}"><i class="bi bi-box-seam"></i> ${esc(av)}</span>
<div class="mt-auto d-grid gap-1 pt-2"><button class="btn btn-accent btn-sm" data-add="${esc(p.id)}">Add to cart</button><a class="btn btn-outline-dark btn-sm" href="product.html?slug=${esc(p.slug)}">Quick view</a></div></div></article></div>`;
};
const bindAdd = root => root.addEventListener("click", async e => {
  const w = e.target.closest("[data-wish]");
  if (w) { const on = await Store.toggleWish(w.dataset.wish); if (on !== null) { w.classList.toggle("on", on); w.setAttribute("aria-pressed", on); } return; }
  const b = e.target.closest("[data-add]"); if (b) { Cart.add(b.dataset.add); b.textContent = "Added ✓"; setTimeout(() => b.textContent = "Add to cart", 1200); }
});

// ---------- Pages ----------
const Pages = {
  index() {
    document.title = "AkuBee Auto Care Limited | Car Care Products, Wholesale & Retail, Abuja";
    $("#app").innerHTML = `
<section class="container hero my-3"><div class="row g-3"><div class="col-lg-8"><div class="banner dark main"><div class="banner-text"><span class="tag">Wholesale &amp; retail</span>
<h1>${esc(C().hero_headline || "Car care that keeps every vehicle showroom-ready")}</h1><p>${esc(C().hero_text || "Car wash liquids, spray paints, microfibre towels, polish and more, supplied from Abuja to Nigeria.")}</p><a href="shop.html" class="btn btn-accent">Shop now</a></div>
<img src="assets/images/towel-branded.jpg" alt="AkuBee branded yellow microfibre towel"></div></div>
<div class="col-lg-4 d-grid gap-3"><div class="banner yellow"><div class="banner-text"><h2>Spray paint</h2><p>450ml, MOQ 24 pcs</p><a href="shop.html?cat=spray-paints" class="btn btn-dark btn-sm">Shop</a></div><img src="assets/images/spray-paint.jpg" alt="Spray paint can"></div>
<div class="banner dark"><div class="banner-text"><h2>Tyre polish</h2><p>Deep, lasting shine</p><a href="product.html?slug=tyre-polish" class="btn btn-accent btn-sm">Shop</a></div><img src="assets/images/tyre-polish.jpg" alt="Tyre polish spray"></div></div></div></section>
<section class="container"><div class="finder"><h2>What does your vehicle need today?</h2><div class="row g-2">
${[["Exterior care","cat=wax-polish"],["Interior care","q=interior"],["Washing","cat=car-wash"],["Detailing","cat=accessories"]].map(([n, q]) => `<div class="col-6 col-md-3"><a class="fbtn" href="shop.html?${q}">${n}</a></div>`).join("")}</div></div></section>
<section class="container py-5" id="categories"><h2 class="sec-title">Shop by category</h2><div class="row g-3">${Store.cats.map(c => `<div class="col-6 col-md-3"><a class="cat" href="shop.html?cat=${esc(c.slug)}"><i class="bi ${ICONS[c.slug] || "bi-tag"}"></i><h3>${esc(c.name)}</h3><span class="meta">${Store.all.filter(p => p.catSlug === c.slug).length} products</span></a></div>`).join("")}</div></section>
<section class="container"><div class="row g-3"><div class="col-md-6"><div class="banner dark promo"><div class="banner-text"><h2>Retail deals</h2><p>Offers appear here once configured in the admin.</p></div></div></div>
<div class="col-md-6" id="wholesale"><div class="banner yellow promo"><div class="banner-text"><h2>Buy in bulk</h2><p>Spray paint, car wash and wax MOQ 24 pcs. Towels and sponges MOQ 50 pcs.</p><a class="btn btn-dark btn-sm" href="wholesale.html">Wholesale &amp; MOQ details</a></div></div></div></div></section>
<section class="container py-5"><div class="d-flex justify-content-between align-items-center"><h2 class="sec-title">Featured products</h2><a href="shop.html">View all</a></div><div class="row g-3" id="grid">${Store.all.filter(p => p.featured).slice(0, 8).map(card).join("")}</div></section>
<section class="container pb-4"><h2 class="sec-title">Trending searches</h2><div class="d-flex flex-wrap gap-2">${["car wash","spray paint","microfibre towel","foam cleaner","dashboard polish","coolant","wash mitt"].map(t => `<a class="chip" href="shop.html?q=${encodeURIComponent(t)}">${t}</a>`).join("")}</div></section>
${Deals.html()}
<section class="container py-4"><h2 class="sec-title">Our brands</h2><p class="text-muted">Brand logos supplied by the business will be listed here.</p></section>
<section class="container py-4"><div class="wholesale-cta"><div><h2>Run a car wash, detailing shop or store?</h2><p>Request wholesale pricing or apply to become a distributor.</p></div>
<div class="d-flex gap-2 flex-wrap"><a class="btn btn-accent" href="quote.html">Request wholesale pricing</a><a class="btn btn-outline-light" href="distributor.html">Become a distributor</a></div></div></section>
<section class="container py-5"><h2 class="sec-title">Car care tips</h2><div class="row g-3">
<div class="col-md-4"><article class="tip"><h3>Use coolant, not plain water</h3><p>Coolant helps prevent overheating and protects the engine.</p></article></div>
<div class="col-md-4"><article class="tip"><h3>Dry with microfibre</h3><p>A soft towel lifts water without scratching paint.</p></article></div>
<div class="col-md-4"><article class="tip"><h3>Protect dashboard and tyres</h3><p>Polish keeps vinyl, rubber and tyres looking fresh.</p></article></div></div></section>
<section class="container"><div class="row g-3 benefits text-center"><div class="col-6 col-md-3"><i class="bi bi-truck"></i><h3>Nationwide delivery</h3></div><div class="col-6 col-md-3"><i class="bi bi-shield-lock"></i><h3>Secure online payments</h3></div><div class="col-6 col-md-3"><i class="bi bi-boxes"></i><h3>Wholesale available</h3></div><div class="col-6 col-md-3"><i class="bi bi-whatsapp"></i><h3>WhatsApp support</h3></div></div></section>`;
    bindAdd($("#grid")); Deals.start();
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
<div class="col-md-6"><h1 class="h2 fw-bold">${esc(p.name)}</h1><p class="price fs-4 ${p.price == null ? "text-muted" : ""}">${priceHtml(p)}</p><p class="${cls} fw-semibold">${esc(av)}</p>${wsLine(p)}
<p>${esc(p.desc)}</p><p class="meta">Wholesale pricing is available to approved business accounts.${p.moq ? ` Minimum bulk order: ${p.moq} pcs.` : ""}</p>
<div class="d-flex gap-2 align-items-center mb-3"><label for="qty" class="meta">Quantity</label><input id="qty" type="number" min="${Store.wholesale && p.moq ? p.moq : 1}" value="${Store.wholesale && p.moq ? p.moq : 1}" class="form-control" style="width:90px"></div>
<div class="d-grid gap-2 d-sm-flex"><button class="btn btn-accent" id="addBtn">Add to cart</button><button class="btn btn-dark" id="buyBtn">Buy now</button><a class="btn btn-outline-dark" target="_blank" rel="noopener" href="${wa("Hello AkuBee Auto Care, I am interested in: " + p.name + " (" + p.sku + ")")}"><i class="bi bi-whatsapp"></i> WhatsApp enquiry</a><button class="btn btn-outline-dark" id="wishBtn"><i class="bi bi-heart"></i> Save</button></div>
<table class="table mt-4"><tbody>${specs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div></div>
${related.length ? `<h2 class="sec-title mt-5">Related products</h2><div class="row g-3" id="grid">${related.map(card).join("")}</div>` : ""}</div>`;
    const qty = () => Math.max(1, parseInt($("#qty").value) || 1);
    $("#addBtn").onclick = () => { Cart.add(p.id, qty()); $("#addBtn").textContent = "Added ✓"; setTimeout(() => $("#addBtn").textContent = "Add to cart", 1200); };
    $("#wishBtn").onclick = async () => { const on = await Store.toggleWish(p.id); if (on !== null) $("#wishBtn").lastChild.textContent = on ? " Saved" : " Save"; };
    $("#buyBtn").onclick = () => { Cart.add(p.id, qty()); bootstrap.Offcanvas.getOrCreateInstance($("#cart")).show(); };
    if ($("#grid")) bindAdd($("#grid"));
    let ld = $("#ld"); if (!ld) { ld = document.createElement("script"); ld.id = "ld"; ld.type = "application/ld+json"; document.head.appendChild(ld); }
    ld.textContent = JSON.stringify({"@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.sku, description: p.desc, image: p.img, brand: p.brand ? {"@type": "Brand", name: p.brand} : undefined,
      ...(p.price != null ? {offers: {"@type": "Offer", priceCurrency: "NGN", price: p.price, availability: p.stock === 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock"}} : {})});
  }
};

const STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT Abuja","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];
const field = (n, l, t = "text", x = "") => `<div class="mb-3"><label class="meta" for="f_${n}">${l}</label><input class="form-control" id="f_${n}" name="${n}" type="${t}" ${x}></div>`;
const notice = m => `<div class="tip mb-3" role="status"><i class="bi bi-info-circle"></i> ${m}</div>`;

Pages.checkout = function () {
  document.title = "Checkout | AkuBee Auto Care Limited";
  const done = Store.param("done");
  if (done) {
    $("#app").innerHTML = `<div class="container py-5 text-center"><i class="bi bi-check-circle fs-1 text-success"></i><h1 class="sec-title">Order received</h1><p class="fs-4 fw-bold">${esc(done)}</p>
<p>Keep this reference. The store will contact you to confirm prices, delivery and payment.</p><div class="d-flex gap-2 justify-content-center flex-wrap"><a class="btn btn-accent" target="_blank" rel="noopener" href="${wa("Hello AkuBee Auto Care, my order reference is " + done)}"><i class="bi bi-whatsapp"></i> Message us on WhatsApp</a><a class="btn btn-outline-dark" href="shop.html">Continue shopping</a></div><div id="paybox" class="mt-4"></div></div>`;
    Pay.mount(done);
    return;
  }
  const rows = Cart.items.map(i => ({p: Store.get(i.id), qty: i.qty})).filter(r => r.p);
  if (!rows.length) { $("#app").innerHTML = `<div class="container py-5"><h1 class="sec-title">Your cart is empty</h1><a class="btn btn-accent" href="shop.html">Browse products</a></div>`; return; }
  const priced = rows.every(r => Store.unit(r.p, r.qty) != null);
  $("#app").innerHTML = `<div class="container py-4"><h1 class="sec-title">Checkout</h1><div class="row g-4"><div class="col-md-7">
${Store.sb ? "" : notice("Online ordering is not connected yet, so this order cannot be saved. Use the WhatsApp button to send it.")}
<form id="co" novalidate><div class="d-none"><input name="website" tabindex="-1" autocomplete="off"></div>
${field("name", "Full name", "text", "required autocomplete=name")}${field("phone", "Phone number", "tel", "required autocomplete=tel")}${field("email", "Email (optional)", "email", "autocomplete=email")}
${field("address", "Delivery address", "text", "required autocomplete=street-address")}
<div class="row g-2"><div class="col-6"><label class="meta" for="f_state">State</label><select class="form-select" id="f_state" name="state" required><option value="">Select state</option>${STATES.map(s => `<option>${s}</option>`).join("")}</select></div>
<div class="col-6">${field("city", "City", "text", "required")}</div></div>
${field("notes", "Delivery instructions (optional)")}
<div id="ts" class="mb-2"></div><p class="meta" id="msg" role="alert"></p>
<button class="btn btn-accent w-100" id="place">${Store.sb ? "Place order" : "Place order (not connected)"}</button></form></div>
<div class="col-md-5"><div class="tip"><h2 class="h5">Order summary</h2>${rows.map(r => `<div class="d-flex justify-content-between small mb-2"><span>${esc(r.p.name)} × ${r.qty}</span><span>${Store.unit(r.p, r.qty) != null ? naira(Store.unit(r.p, r.qty) * r.qty) : "TBC"}</span></div>`).join("")}
<hr><p class="fw-semibold m-0">${priced ? "Subtotal: " + naira(rows.reduce((s, r) => s + Store.unit(r.p, r.qty) * r.qty, 0)) : "Prices confirmed by the store"}</p><p class="meta m-0">Delivery fee is confirmed by the store. Payment: you can pay online after placing your order, once the total is confirmed.</p>
<a class="btn btn-outline-dark w-100 mt-3" target="_blank" rel="noopener" href="${wa("Hello AkuBee Auto Care, I would like to order:\n" + rows.map(r => `- ${r.p.name} x ${r.qty}`).join("\n"))}"><i class="bi bi-whatsapp"></i> Send on WhatsApp instead</a></div></div></div></div>`;
  Forms.mount(); $("#co").addEventListener("submit", async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), msg = $("#msg");
    if (f.website) return;
    if (!Store.sb) { msg.textContent = "Online ordering is not connected yet. Please use WhatsApp."; return; }
    if (!f.name.trim() || f.phone.trim().length < 7 || f.address.trim().length < 5 || !f.state || !f.city.trim()) { msg.textContent = "Please complete your name, phone number, address, state and city."; return; }
    $("#place").disabled = true; msg.textContent = "Placing your order…";
    const {data, error} = await Forms.call("place_order", {p_customer: {name: f.name, phone: f.phone, email: f.email, address: f.address, state: f.state, city: f.city, notes: f.notes}, p_items: rows.map(r => ({slug: r.p.slug, qty: r.qty}))});
    if (error) { msg.textContent = (error.message || "We could not place your order.") + " You can also order on WhatsApp."; $("#place").disabled = false; return; }
    try { sessionStorage.setItem("lastOrder", JSON.stringify({ref: data.reference, phone: f.phone, email: f.email, priced: data.priced})); } catch {}
    Cart.items = []; Cart.save(); go("checkout.html?done=" + encodeURIComponent(data.reference));
  });
};

Pages.login = async function () {
  document.title = "Login or register | AkuBee Auto Care Limited";
  $("#app").innerHTML = `<div class="container py-5" style="max-width:460px"><h1 class="sec-title">Your account</h1>${Store.sb ? "" : notice("Accounts are available once the store connects its database.")}
<div class="d-flex gap-2 mb-3"><button class="chip" data-tab="in">Login</button><button class="chip" data-tab="up">Create account</button><button class="chip" data-tab="rs">Forgot password</button></div><p class="meta" id="msg" role="alert"></p>
<form data-f="in">${field("email", "Email", "email", "required autocomplete=email")}${field("password", "Password", "password", "required autocomplete=current-password")}<button class="btn btn-accent w-100">Login</button></form>
<form data-f="up" hidden>${field("full_name", "Full name", "text", "required")}${field("email", "Email", "email", "required")}${field("password", "Password (8+ characters)", "password", "required minlength=8 autocomplete=new-password")}<button class="btn btn-accent w-100">Create account</button></form>
<form data-f="rs" hidden>${field("email", "Email", "email", "required")}<button class="btn btn-accent w-100">Send reset link</button></form>
<form data-f="np" hidden>${field("password", "New password (8+ characters)", "password", "required minlength=8")}<button class="btn btn-accent w-100">Save new password</button></form>
<p class="meta mt-4">Wholesale buyer? Create an account, then message us on WhatsApp to request wholesale approval.</p></div>`;
  const tab = t => document.querySelectorAll("[data-f]").forEach(f => f.hidden = f.dataset.f !== t);
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => tab(b.dataset.tab));
  if (!Store.sb) return;
  const sb = Store.sb, msg = $("#msg");
  sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY") tab("np"); });
  const {data: s} = await sb.auth.getSession(); if (s.session && !location.hash.includes("type=recovery")) return go("account.html");
  document.querySelectorAll("[data-f]").forEach(form => form.addEventListener("submit", async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(form)); msg.textContent = "Please wait…"; let r;
    if (form.dataset.f === "in") r = await sb.auth.signInWithPassword({email: v.email, password: v.password});
    if (form.dataset.f === "up") r = await sb.auth.signUp({email: v.email, password: v.password, options: {data: {full_name: v.full_name}}});
    if (form.dataset.f === "rs") r = await sb.auth.resetPasswordForEmail(v.email, {redirectTo: location.origin + "/login.html"});
    if (form.dataset.f === "np") r = await sb.auth.updateUser({password: v.password});
    if (r.error) { msg.textContent = "That did not work: " + r.error.message; return; }
    if (form.dataset.f === "rs") msg.textContent = "If that email has an account, a reset link is on its way.";
    else if (form.dataset.f === "up" && !r.data.session) msg.textContent = "Account created. Check your email to confirm it, then log in.";
    else go("account.html");
  }));
};

Pages.account = async function () {
  document.title = "My account | AkuBee Auto Care Limited";
  if (!Store.sb) { $("#app").innerHTML = `<div class="container py-5">${notice("Accounts are available once the store connects its database.")}</div>`; return; }
  const sb = Store.sb, {data: {user}} = await sb.auth.getUser(); if (!user) return go("login.html");
  const [pr, od] = await Promise.all([sb.from("profiles").select("full_name,phone,wholesale_status").eq("id", user.id).single(),
    sb.from("orders").select("reference,status,payment_status,total,created_at,order_items(product_name,quantity)").order("created_at", {ascending: false})]);
  const p = pr.data || {}, st = {none: "Retail customer", pending: "Wholesale pending approval", approved: "Wholesale approved", rejected: "Wholesale not approved", suspended: "Suspended"}[p.wholesale_status] || "Retail customer";
  $("#app").innerHTML = `<div class="container py-4"><div class="d-flex justify-content-between align-items-center"><h1 class="sec-title">My account</h1><button class="btn btn-outline-dark btn-sm" id="out">Log out</button></div>
<div class="row g-4"><div class="col-md-4"><div class="tip"><p class="meta m-0">${esc(user.email)}</p><p class="fw-semibold">${esc(st)}</p>
<form id="pf">${field("full_name", "Full name", "text", `value="${esc(p.full_name)}"`)}${field("phone", "Phone", "tel", `value="${esc(p.phone)}"`)}<button class="btn btn-accent btn-sm">Save profile</button> <span class="meta" id="pm"></span></form></div></div>
<div class="col-md-8"><h2 class="h5">Order history</h2>${(od.data || []).length ? od.data.map(o => `<div class="tip mb-2"><div class="d-flex justify-content-between"><strong>${esc(o.reference)}</strong><span class="meta">${new Date(o.created_at).toLocaleDateString("en-NG")}</span></div>
<p class="small m-0">${o.order_items.map(i => esc(i.product_name) + " × " + i.quantity).join(", ")}</p><p class="meta m-0">Status: ${esc(o.status)} · Payment: ${esc(o.payment_status)} · ${o.total != null ? naira(o.total) : "Price to be confirmed"}</p></div>`).join("") : "<p class='text-muted'>No orders yet.</p>"}</div></div></div>`;
  $("#out").onclick = async () => { await sb.auth.signOut(); go("index.html"); };
  $("#pf").addEventListener("submit", async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    const r = await sb.from("profiles").update({full_name: v.full_name, phone: v.phone}).eq("id", user.id); $("#pm").textContent = r.error ? "Could not save." : "Saved."; });
};

// ---------- Wholesale ----------
Store.wholesale = false; Store.status = "none"; Store.user = null;
Store.unit = (p, qty) => {
  let u = p.price; if (u != null && p.promo) u = Math.round(u * (100 - p.promo.pct)) / 100;
  if (Store.wholesale && p.tiers) { const t = p.tiers.filter(t => t.min_qty <= qty).sort((a, b) => b.min_qty - a.min_qty)[0]; if (t) u = t.unit_price; }
  return u;
};
Store.loadWholesale = async function () {
  if (!this.sb) return;
  const {data: {session}} = await this.sb.auth.getSession(); if (!session) return;
  this.user = session.user;
  const {data: w} = await this.sb.from("wishlist_items").select("product_id"); this.wish = new Set((w || []).map(x => x.product_id));
  const {data: pr} = await this.sb.from("profiles").select("wholesale_status").eq("id", session.user.id).single();
  this.status = pr?.wholesale_status || "none"; if (this.status !== "approved") return;
  const {data} = await this.sb.from("pricing_tiers").select("product_id,min_qty,unit_price"); this.wholesale = true;
  (data || []).forEach(t => { const p = this.all.find(x => x.id === t.product_id); if (p) (p.tiers = p.tiers || []).push(t); });
};
const wsLine = p => Store.wholesale && p.tiers?.length ? `<p class="fw-semibold">Your wholesale price: ${[...p.tiers].sort((a, b) => a.min_qty - b.min_qty).map(t => naira(t.unit_price) + " from " + t.min_qty + " pcs").join(", ")}</p>` : "";
const sel = (n, l, opts, x = "") => `<div class="mb-3"><label class="meta" for="f_${n}">${l}</label><select class="form-select" id="f_${n}" name="${n}" ${x}><option value="">Select</option>${opts.map(o => `<option>${esc(o)}</option>`).join("")}</select></div>`;
const area = (n, l, x = "") => `<div class="mb-3"><label class="meta" for="f_${n}">${l}</label><textarea class="form-control" id="f_${n}" name="${n}" rows="3" ${x}></textarea></div>`;
const BTYPES = ["Car wash business", "Auto-detailing business", "Automotive shop", "Retailer / reseller", "Distributor", "Other"];
const honey = `<div class="d-none"><input name="website" tabindex="-1" autocomplete="off"></div>`;
// Submit a form to a database function and show the result in #msg.
async function send(form, rpc, args, onOk) {
  const msg = $("#msg");
  if (!Store.sb) { msg.textContent = "This form is not connected to the store's database yet. Please use WhatsApp."; return; }
  msg.textContent = "Sending…"; form.querySelector("button[type=submit],button:not([type])").disabled = true;
  const {data, error} = await Forms.call(rpc, args);
  form.querySelector("button[type=submit],button:not([type])").disabled = false;
  if (error) { msg.textContent = (error.message || "We could not send that.") + " You can also use WhatsApp."; return; }
  msg.textContent = ""; onOk(data);
}

Pages.wholesale = function () {
  document.title = "Wholesale & distributors | AkuBee Auto Care Limited";
  const withMoq = Store.all.filter(p => p.moq);
  const stat = {pending: "Your wholesale application is pending approval.", approved: "Your wholesale account is approved. Wholesale prices and bulk ordering are enabled.", rejected: "Your last wholesale application was not approved. Message us for details.", suspended: "Your account is suspended. Please contact us."}[Store.status];
  $("#app").innerHTML = `<section class="container my-3"><div class="banner dark main" style="min-height:240px"><div class="banner-text" style="max-width:100%"><span class="tag">Wholesale &amp; distributors</span><h1>Stock up on car care products for your business</h1><p>For car washes, detailing shops, automotive stores, resellers and distributors across Nigeria.</p>
<div class="d-flex gap-2 flex-wrap"><a class="btn btn-accent" href="wholesale-register.html">Register for wholesale</a><a class="btn btn-outline-light" href="quote.html">Request a quotation</a><a class="btn btn-outline-light" href="distributor.html">Become a distributor</a></div></div></div></section>
<div class="container py-4">${stat ? notice(esc(stat)) : ""}<div class="row g-3 benefits text-center mb-4"><div class="col-6 col-md-3"><i class="bi bi-tags"></i><h3>Bulk pricing</h3></div><div class="col-6 col-md-3"><i class="bi bi-boxes"></i><h3>Stock for resale</h3></div><div class="col-6 col-md-3"><i class="bi bi-truck"></i><h3>Nationwide delivery</h3></div><div class="col-6 col-md-3"><i class="bi bi-whatsapp"></i><h3>WhatsApp support</h3></div></div>
<h2 class="sec-title">Minimum order quantities</h2><p class="meta">Wholesale prices are shown only to approved business accounts. Quantities below are the minimums for wholesale orders.</p>
<table class="table"><thead><tr><th>Product</th><th>MOQ</th></tr></thead><tbody>${withMoq.map(p => `<tr><td><a href="product.html?slug=${esc(p.slug)}">${esc(p.name)}</a></td><td>${p.moq} pcs</td></tr>`).join("")}</tbody></table>
<p class="meta">Other products: ask us for the minimum quantity.</p>
<div class="d-flex gap-2 flex-wrap"><a class="btn btn-accent" href="quote.html">Request a quotation</a><a class="btn btn-dark" href="login.html">Wholesale login</a><a class="btn btn-outline-dark" target="_blank" rel="noopener" href="${wa("Hello AkuBee Auto Care, I have a wholesale enquiry.")}"><i class="bi bi-whatsapp"></i> WhatsApp</a></div></div>`;
};

Pages.wholesaleRegister = function () {
  document.title = "Wholesale registration | AkuBee Auto Care Limited";
  const head = `<div class="container py-4" style="max-width:640px"><h1 class="sec-title">Wholesale registration</h1>`;
  if (!Store.sb) { $("#app").innerHTML = head + notice("Registration opens once the store connects its database. Meanwhile, message us on WhatsApp.") + "</div>"; return; }
  if (!Store.user) { $("#app").innerHTML = head + `<p>Please <a href="login.html"><u>create an account or log in</u></a> first, then come back to this page to apply.</p></div>`; return; }
  if (Store.status === "pending" || Store.status === "approved") { $("#app").innerHTML = head + notice(Store.status === "pending" ? "Your application is pending approval. We will contact you." : "Your wholesale account is approved.") + `<a class="btn btn-accent" href="shop.html">Shop now</a></div>`; return; }
  $("#app").innerHTML = head + `<p class="meta">New wholesale accounts start as pending until the store approves them.</p><form id="wf">${honey}
${field("business_name", "Business name", "text", "required")}${field("contact_name", "Contact person", "text", "required")}${field("phone", "Phone number", "tel", "required")}${field("email", "Email", "email", `required value="${esc(Store.user.email)}"`)}
${field("business_address", "Business address", "text", "required")}${sel("business_type", "Business type", BTYPES, "required")}${sel("state", "State", STATES, "required")}
${field("registration_details", "Business registration details (if applicable)")}${area("products_interest", "Products of interest")}${field("estimated_volume", "Estimated purchasing volume (e.g. 200 pcs per month)")}
<div id="ts" class="mb-2"></div><p class="meta" id="msg" role="alert"></p><button class="btn btn-accent w-100">Submit application</button></form></div>`;
  Forms.mount(); $("#wf").addEventListener("submit", e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); if (v.website) return;
    send(e.target, "apply_wholesale", {p: v}, () => { Store.status = "pending"; Pages.wholesaleRegister(); }); });
};

Pages.quote = function () {
  document.title = "Request a quotation | AkuBee Auto Care Limited";
  const pre = Store.param("slug"), opts = Store.all.map(p => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join("");
  const row = s => `<div class="d-flex gap-2 mb-2 qrow"><select class="form-select" aria-label="Product"><option value="">Select product</option>${opts.replace(`value="${esc(s)}"`, `value="${esc(s)}" selected`)}</select><input class="form-control" type="number" min="1" value="1" style="width:90px" aria-label="Quantity"></div>`;
  $("#app").innerHTML = `<div class="container py-4" style="max-width:680px"><h1 class="sec-title">Request a quotation</h1><form id="qf">${honey}
<h2 class="h5">Products</h2><div id="rows">${row(pre || "")}</div><button type="button" class="btn btn-outline-dark btn-sm mb-3" id="more">+ Add another product</button>
${area("requirements", "Special requirements")}${field("name", "Your name", "text", "required")}${field("business", "Business name")}${field("phone", "Phone number", "tel", "required")}${field("email", "Email", "email")}
<div id="ts" class="mb-2"></div><p class="meta" id="msg" role="alert"></p><button class="btn btn-accent w-100">Send quotation request</button></form></div>`;
  $("#more").onclick = () => $("#rows").insertAdjacentHTML("beforeend", row(""));
  Forms.mount(); $("#qf").addEventListener("submit", e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); if (v.website) return;
    const items = [...document.querySelectorAll(".qrow")].map(r => ({slug: r.querySelector("select").value, qty: parseInt(r.querySelector("input").value) || 0})).filter(i => i.slug && i.qty > 0);
    if (!items.length) { $("#msg").textContent = "Please choose at least one product and quantity."; return; }
    send(e.target, "submit_quotation", {p_contact: v, p_items: items}, d => {
      $("#app").innerHTML = `<div class="container py-5 text-center"><i class="bi bi-check-circle fs-1 text-success"></i><h1 class="sec-title">Quotation request sent</h1><p class="fs-4 fw-bold">${esc(d.reference)}</p><p>We will review it and get back to you.</p>
<a class="btn btn-accent" target="_blank" rel="noopener" href="${wa("Hello AkuBee Auto Care, I am following up on quotation " + d.reference)}"><i class="bi bi-whatsapp"></i> Follow up on WhatsApp</a></div>`; });
  });
};

Pages.distributor = function () {
  document.title = "Become a distributor | AkuBee Auto Care Limited";
  $("#app").innerHTML = `<div class="container py-4" style="max-width:640px"><h1 class="sec-title">Become a distributor</h1><p class="meta">Tell us about your business. We review every application.</p><form id="df">${honey}
${field("applicant_name", "Your name", "text", "required")}${field("business_name", "Business name", "text", "required")}${field("phone", "Phone number", "tel", "required")}${field("email", "Email", "email")}${field("location", "Location (city and state)", "text", "required")}
${sel("business_type", "Business type", BTYPES)}${area("areas_of_interest", "Areas of interest")}${area("comments", "Additional comments")}
<div id="ts" class="mb-2"></div><p class="meta" id="msg" role="alert"></p><button class="btn btn-accent w-100">Submit application</button></form></div>`;
  Forms.mount(); $("#df").addEventListener("submit", e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); if (v.website) return;
    send(e.target, "submit_distributor", {p: v}, () => { $("#app").innerHTML = `<div class="container py-5 text-center"><i class="bi bi-check-circle fs-1 text-success"></i><h1 class="sec-title">Application received</h1><p>Thank you. We will be in touch.</p><a class="btn btn-accent" href="index.html">Back to home</a></div>`; }); });
};

// ---------- Online payment (server-side: Supabase Edge Functions) ----------
const Pay = {
  async providers() {
    if (!Store.sb) return {};
    const {data} = await Store.sb.from("site_settings").select("value").eq("key", "payment_providers").maybeSingle();
    return data?.value || {};
  },
  async mount(ref) {
    const box = $("#paybox"); let o = {};
    try { o = JSON.parse(sessionStorage.getItem("lastOrder") || "{}"); } catch {}
    if (o.ref !== ref) { box.innerHTML = ""; return; }
    if (!o.priced) { box.innerHTML = notice("The store will confirm your total first. You can pay online once it is confirmed."); return; }
    this._p = await this.providers();
    const list = ["paystack", "flutterwave"].filter(k => this._p[k]);
    if (!list.length) { box.innerHTML = notice("Online payment is not available yet. The store will contact you about payment."); return; }
    box.innerHTML = `<div class="tip text-start mx-auto" style="max-width:420px"><h2 class="h5">Pay online</h2>${field("pemail", "Email for your payment receipt", "email", `value="${esc(o.email || "")}"`)}
<div class="d-grid gap-2">${list.map(k => `<button class="btn btn-accent" data-p="${k}">Pay with ${k === "paystack" ? "Paystack" : "Flutterwave"}</button>`).join("")}</div><p class="meta mt-2" id="pmsg" role="alert"></p></div>`;
    box.onclick = async e => {
      const b = e.target.closest("[data-p]"); if (!b) return; b.disabled = true; $("#pmsg").textContent = "Starting payment…";
      const {data, error} = await Store.sb.functions.invoke("payment-init", {body: {order_reference: ref, phone: o.phone, provider: b.dataset.p, email: $("#f_pemail").value.trim()}});
      b.disabled = false;
      if (error || !data?.authorization_url) { $("#pmsg").textContent = "We could not start the payment. Please check your email address and try again, or contact us on WhatsApp."; return; }
      location.href = data.authorization_url;
    };
  }
};

Pages.paymentStatus = async function () {
  document.title = "Payment status | AkuBee Auto Care Limited";
  const pref = Store.param("pref"), view = h => $("#app").innerHTML = `<div class="container py-5 text-center" style="max-width:560px">${h}</div>`;
  view("<p>Checking your payment…</p>");
  if (!pref || !Store.sb) { view(`<h1 class="sec-title">Payment status</h1>${notice("We could not check this payment. Please contact us on WhatsApp with your order reference.")}`); return; }
  const {data, error} = await Store.sb.functions.invoke("payment-verify", {body: {reference: pref}});
  const s = error ? "error" : data.status, ref = data?.order_reference || "";
  if (s === "paid") view(`<i class="bi bi-check-circle fs-1 text-success"></i><h1 class="sec-title">Payment confirmed</h1><p>Thank you. Your order <strong>${esc(ref)}</strong> is paid and the store will start processing it.</p><a class="btn btn-accent" href="shop.html">Continue shopping</a>`);
  else if (s === "pending") view(`<h1 class="sec-title">Payment pending</h1><p>We have not received confirmation yet. This can take a few minutes.</p><button class="btn btn-accent" id="again">Check again</button>`), $("#again").onclick = () => Pages.paymentStatus();
  else if (s === "amount_mismatch" || s === "already_paid") view(`<h1 class="sec-title">We need to check this payment</h1><p>Please message us on WhatsApp with your order reference ${esc(ref)}.</p><a class="btn btn-accent" target="_blank" rel="noopener" href="${wa("Hello AkuBee Auto Care, please check my payment for order " + ref)}">WhatsApp us</a>`);
  else view(`<h1 class="sec-title">Payment not completed</h1><p>Your payment did not go through, and you have not been charged for this attempt.</p>${ref ? `<a class="btn btn-accent" href="checkout.html?done=${encodeURIComponent(ref)}">Try again</a>` : `<a class="btn btn-accent" href="shop.html">Back to shop</a>`}`);
};

// ---------- Spam check (Cloudflare Turnstile) + gated form submission ----------
const Forms = {
  token: "", wid: null,
  mount() {
    const box = $("#ts"); this.token = ""; if (!box || !CFG.TURNSTILE_SITEKEY) return;
    const render = () => { this.wid = window.turnstile.render(box, {sitekey: CFG.TURNSTILE_SITEKEY, callback: t => { this.token = t; }, "expired-callback": () => { this.token = ""; }}); };
    if (window.turnstile) render();
    else { const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = render; document.head.appendChild(s); }
  },
  async call(fn, args) {
    if (!Store.sb) return {error: {message: "Not connected."}};
    if (CFG.TURNSTILE_SITEKEY && !this.token) return {error: {message: "Please complete the spam check."}};
    const {data, error} = await Store.sb.functions.invoke("submit-form", {body: {fn, args, token: this.token}});
    if (window.turnstile && this.wid != null) { try { window.turnstile.reset(this.wid); } catch {} }
    this.token = "";
    if (error) { let m = "Something went wrong."; try { m = (await error.context.json()).error || m; } catch {} return {error: {message: m}}; }
    return {data};
  }
};

// ---------- Wishlist ----------
Store.toggleWish = async id => {
  if (!Store.sb || !Store.user) { go("login.html"); return null; }
  const on = Store.wish.has(id), q = Store.sb.from("wishlist_items");
  const r = on ? await q.delete().eq("product_id", id).eq("user_id", Store.user.id) : await q.insert({user_id: Store.user.id, product_id: id});
  if (r.error) return null; on ? Store.wish.delete(id) : Store.wish.add(id); return !on;
};
Pages.wishlist = function () {
  document.title = "Wishlist | AkuBee Auto Care Limited";
  if (!Store.sb || !Store.user) { $("#app").innerHTML = `<div class="container py-5"><h1 class="sec-title">Wishlist</h1><p>${Store.sb ? "Please log in to see the products you saved." : "Wishlists are available once the store connects its database."}</p><a class="btn btn-accent" href="login.html">Log in</a></div>`; return; }
  const list = Store.all.filter(p => Store.wish.has(p.id));
  $("#app").innerHTML = `<div class="container py-4"><h1 class="sec-title">Wishlist</h1>${list.length ? `<div class="row g-3" id="grid">${list.map(card).join("")}</div>` : `<p class="text-muted">Nothing saved yet. Tap the heart on a product to save it.</p><a class="btn btn-accent" href="shop.html">Browse products</a>`}</div>`;
  if ($("#grid")) bindAdd($("#grid"));
};

// ---------- Order tracking ----------
Pages.trackOrder = function () {
  document.title = "Track your order | AkuBee Auto Care Limited";
  $("#app").innerHTML = `<div class="container py-4" style="max-width:520px"><h1 class="sec-title">Track your order</h1><form id="tf">${field("ref", "Order reference", "text", "required placeholder=AKB-000000-0000")}${field("phone", "Phone number used for the order", "tel", "required")}
<p class="meta" id="msg" role="alert"></p><button class="btn btn-accent w-100">Track order</button></form><div id="tres" class="mt-3"></div></div>`;
  if (Store.param("ref")) $("#f_ref").value = Store.param("ref");
  $("#tf").addEventListener("submit", async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)), msg = $("#msg");
    if (!Store.sb) { msg.textContent = "Order tracking is available once the store connects its database. Please message us on WhatsApp."; return; }
    msg.textContent = "Looking up your order…";
    const {data, error} = await Store.sb.rpc("track_order", {p_ref: v.ref, p_phone: v.phone});
    if (error) { msg.textContent = /Too many/.test(error.message) ? "Too many tries. Please wait a while and try again." : "We could not find that order. Check the reference and phone number."; $("#tres").innerHTML = ""; return; }
    msg.textContent = "";
    $("#tres").innerHTML = `<div class="tip"><p class="m-0 meta">${esc(data.reference)} · ${new Date(data.created_at).toLocaleDateString("en-NG")}</p><h2 class="h5 text-capitalize">${esc(String(data.status).replace(/_/g, " "))}</h2><p class="meta">Payment: ${esc(data.payment_status)}</p>
<p class="small">${data.items.map(i => esc(i.name) + " × " + i.qty).join(", ")}</p>${data.tracking_info ? `<p class="small"><strong>Dispatch details:</strong> ${esc(data.tracking_info)}</p>` : ""}</div>`;
  });
};

// ---------- Information pages (edit the text here) ----------
const WA_LINK = `<a href="${wa("Hello AkuBee Auto Care")}" target="_blank" rel="noopener">WhatsApp 08089036605</a>`;
const INFO = {
  about: ["About AkuBee Auto Care", `<p>AkuBee Auto Care Limited supplies car care products as a wholesaler, distributor and retailer in Abuja, Nigeria. We serve vehicle owners, car washes, auto-detailing businesses, automotive shops and resellers.</p>
<p>Our range includes spray paints, microfibre towels, car wash and wax liquids, foam cleaners, polishes, radiator coolants, air fresheners and detailing accessories.</p><h2 class="h5">Visit us in Abuja</h2><ul><li>Shop D4008, Apo Urban Market</li><li>Gudu Plaza</li></ul>
<p>We deliver across Nigeria. Businesses can buy in bulk: see our <a href="wholesale.html">wholesale page</a>.</p>`],
  faqs: ["Frequently asked questions", `<details><summary>How do I order?</summary><p>Add products to your cart and check out as a guest or with an account. You can also order by ${WA_LINK}.</p></details>
<details><summary>Do you deliver outside Abuja?</summary><p>Yes, we deliver across Nigeria. Delivery fees depend on your state and are confirmed by the store.</p></details>
<details><summary>Why do some products show “Price on request”?</summary><p>The store confirms the price and availability of those items when you order or enquire. Message us on WhatsApp for a quick answer.</p></details>
<details><summary>Can I buy wholesale?</summary><p>Yes. Many products have a minimum order quantity (for example 24 or 50 pieces). Register for a wholesale account or <a href="quote.html">request a quotation</a>. Wholesale prices are shown to approved business accounts.</p></details>
<details><summary>How do I pay?</summary><p>Once online payment is switched on, you can pay by card or other methods supported by Paystack or Flutterwave. Your order is marked paid only after the payment is confirmed by the payment provider.</p></details>
<details><summary>How can I track my order?</summary><p>Use the <a href="track-order.html">order tracking page</a> with your order reference and phone number.</p></details>`],
  delivery: ["Delivery information", `<p>We deliver across Nigeria. Delivery fees depend on your state and the size of your order, and the store confirms the fee with you. Delivery times are confirmed by the store when your order is accepted.</p>
<p>Please give a full delivery address and a phone number we can reach. You can follow your order on the <a href="track-order.html">tracking page</a>. For questions, ${WA_LINK}.</p>`],
  returns: ["Returns and refunds", `<p>Please check your order when it arrives. If an item is wrong, damaged or incomplete, contact us as soon as possible on ${WA_LINK} with your order reference and photos where possible.</p>
<p>The store reviews each request and tells you the outcome. Where a refund is approved for an online payment, it is made through the same payment provider.</p><p class="meta">The store owner should confirm the exact return period and conditions before launch.</p>`],
  privacy: ["Privacy policy", `<p>We collect the details you give us, such as your name, phone number, email, delivery address, account details and order history, to process orders, arrange delivery, provide support and manage wholesale accounts.</p>
<p>Online payments are handled by Paystack or Flutterwave. We do not see or store your card details. Our website data is stored with our service provider Supabase. We do not sell your personal information.</p>
<p>To ask about, correct or delete your information, contact us on ${WA_LINK}.</p><p class="meta">This is a plain-language starting draft. The store owner should have it reviewed before launch.</p>`],
  terms: ["Terms and conditions", `<p>By using this website you agree to these terms. Prices and availability can change. An order is confirmed when the store accepts it, and the store may contact you to confirm price, stock and delivery.</p>
<p>Wholesale prices and bulk ordering are available to approved business accounts and are subject to minimum order quantities. Delivery is subject to the details you provide. Online payments are processed by third-party providers, and an order is treated as paid only after the provider confirms the payment.</p>
<p>For any question, ${WA_LINK}.</p><p class="meta">This is a starting draft. The store owner should have it reviewed before launch.</p>`]
};
const infoPage = key => () => { document.title = INFO[key][0] + " | AkuBee Auto Care Limited"; $("#app").innerHTML = `<div class="container py-4 info" style="max-width:760px"><h1 class="sec-title">${INFO[key][0]}</h1>${INFO[key][1]}</div>`; };
["about", "faqs", "delivery", "returns", "privacy", "terms"].forEach(k => { Pages[k] = infoPage(k); });
Pages.contact = function () {
  document.title = "Contact us | AkuBee Auto Care Limited";
  $("#app").innerHTML = `<div class="container py-4" style="max-width:760px"><h1 class="sec-title">Contact us</h1><div class="row g-3"><div class="col-md-6"><div class="tip">${storeBlock(true)}</div></div>
<div class="col-md-6"><form id="cf">${field("name", "Your name", "text", "required")}<div class="mb-3"><label class="meta" for="f_message">Message</label><textarea class="form-control" id="f_message" name="message" rows="4" required></textarea></div><button class="btn btn-accent w-100"><i class="bi bi-whatsapp"></i> Send on WhatsApp</button></form></div></div></div>`;
  $("#cf").addEventListener("submit", e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); window.open(wa(`Hello AkuBee Auto Care, I am ${v.name}. ${v.message}`), "_blank", "noopener"); });
};

// ---------- Store settings from the admin, and promotions ----------
Store.settings = {};
const S = () => Store.settings.store_contact || {}, C = () => Store.settings.site_content || {};
const tel = () => esc((S().phone || "08089036605").replace(/[^\d+]/g, ""));
const mapLink = a => `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}" target="_blank" rel="noopener">${esc(a)}</a>`;
Store.loadSettings = async function () {
  if (!this.sb) return;
  const [s, pr] = await Promise.all([this.sb.from("site_settings").select("key,value"), this.sb.from("promotions").select("product_id,name,discount_percent,ends_at,show_countdown")]);
  if (!s.error) this.settings = Object.fromEntries((s.data || []).map(r => [r.key, r.value]));
  let wa = String(S().whatsapp || "").replace(/\D/g, ""); if (wa.startsWith("0")) wa = "234" + wa.slice(1); if (wa.length >= 11) CFG.WHATSAPP = wa;
  (pr.data || []).forEach(x => { const p = this.all.find(y => y.id === x.product_id); if (p && (!p.promo || x.discount_percent > p.promo.pct)) p.promo = {pct: x.discount_percent, ends: x.ends_at, countdown: x.show_countdown, name: x.name}; });
};
const storeBlock = full => `<p><i class="bi bi-geo-alt"></i> ${mapLink(S().address1 || "Shop D4008, Apo Urban Market, Abuja")}</p><p><i class="bi bi-geo-alt"></i> ${mapLink(S().address2 || "Gudu Plaza, Abuja")}</p>
<p><i class="bi bi-telephone"></i> <a href="tel:${tel()}">${esc(S().phone || "08089036605")}</a> (call / WhatsApp)</p>${S().email ? `<p><i class="bi bi-envelope"></i> <a href="mailto:${esc(S().email)}">${esc(S().email)}</a></p>` : ""}
${full ? `<p class="m-0"><i class="bi bi-instagram"></i> <a href="${esc(S().instagram || "https://www.instagram.com/akubee_autocare_abuja/")}" target="_blank" rel="noopener">Instagram</a></p>` : ""}`;
const socials = () => [[S().instagram || "https://www.instagram.com/akubee_autocare_abuja/", "bi-instagram", "Instagram"], [S().facebook, "bi-facebook", "Facebook"], [S().tiktok, "bi-tiktok", "TikTok"]]
  .filter(x => x[0] && /^https?:\/\//.test(x[0])).map(([u, i, n]) => `<a class="soc" href="${esc(u)}" target="_blank" rel="noopener" aria-label="${n}"><i class="bi ${i}"></i></a>`).join("");
const priceHtml = p => {
  if (p.price == null) return "Price on request";
  if (!p.promo) return esc(naira(p.price));
  return `<s class="meta">${esc(naira(p.price))}</s> ${esc(naira(Math.round(p.price * (100 - p.promo.pct)) / 100))} <span class="deal">-${p.promo.pct}%</span>`;
};
const Deals = {
  timer: null,
  html() {
    const list = Store.all.filter(p => p.promo && p.price != null);
    if (!list.length) return `<section class="deals my-5"><div class="container"><h2 class="sec-title text-white">Deals of the week</h2><p class="text-secondary m-0">No active promotion right now. Check back soon.</p></div></section>`;
    return `<section class="deals my-5"><div class="container"><div class="d-flex justify-content-between align-items-center flex-wrap gap-2"><h2 class="sec-title text-white m-0">Deals of the week</h2><div class="cd" id="cd" hidden></div></div>
<div class="row g-3 mt-1" id="dealGrid">${list.slice(0, 8).map(card).join("")}</div></div></section>`;
  },
  start() {
    clearInterval(this.timer); const el = $("#cd"); if (!el) return;
    const ends = Store.all.filter(p => p.promo?.countdown && p.promo.ends).map(p => new Date(p.promo.ends).getTime()).filter(t => t > Date.now()).sort((a, b) => a - b)[0];
    if ($("#dealGrid")) bindAdd($("#dealGrid"));
    if (!ends) return;
    const tick = () => { const s = Math.max(0, Math.floor((ends - Date.now()) / 1000)); if (!s) { el.textContent = "Offer ended"; clearInterval(this.timer); return; }
      el.textContent = `Ends in ${Math.floor(s / 86400)}d ${String(Math.floor(s % 86400 / 3600)).padStart(2, "0")}h ${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`; };
    el.hidden = false; tick(); this.timer = setInterval(tick, 1000);
  }
};

const App = {
  async boot(page) { Layout.mount(); await Store.load(); try { await Store.loadSettings(); } catch {} try { await Store.loadWholesale(); } catch {} if (Object.keys(Store.settings).length) Layout.mount(); Layout.fill(); Cart.render(); (Pages[page || document.body.dataset.page] || (() => {}))(); }
};
if (!window.PREVIEW) document.addEventListener("DOMContentLoaded", () => App.boot());
