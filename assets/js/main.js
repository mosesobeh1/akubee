"use strict";
// ---- Editable config (replace with Supabase data in Phase 2) ----
const WHATSAPP = "2348089036605"; // 08089036605 in international format
// Prices are intentionally null: the owner has not supplied any. Admin must set them.
const PRODUCTS = [
  {id:"spray-paint-450",name:"Spray Paint 450ml",cat:"Spray paints",img:"assets/images/spray-paint.jpg",moq:24,tags:"paint exterior colour"},
  {id:"under-coating-650",name:"Auto Under Coating 650ml",cat:"Exterior care",img:"assets/images/undercoating.jpg",moq:null,tags:"rust antirust underbody exterior"},
  {id:"tyre-polish",name:"Tyre Polish",cat:"Wax & polish",img:"assets/images/tyre-polish.jpg",moq:null,tags:"tyre shine exterior detailing"},
  {id:"car-scent",name:"Car Air Freshener (Jasmine)",cat:"Air fresheners",img:"assets/images/car-scent.jpg",moq:null,tags:"scent interior freshener"},
  {id:"towel-branded",name:"AkuBee Twin Microfibre Towel",cat:"Towels",img:"assets/images/towel-branded.jpg",moq:50,tags:"towel microfibre drying detailing wash"}
];
const CATEGORIES = [
  ["Car wash products","bi-droplet"],["Cleaning products","bi-stars"],["Spray paints","bi-palette"],
  ["Microfibre towels","bi-grid-3x3"],["Wax & polish","bi-brightness-high"],["Coolants & additives","bi-thermometer-half"],
  ["Car care kits","bi-box-seam"],["Detailing accessories","bi-brush"]
];
const TRENDING = ["car wash shampoo","spray paint","microfibre towel","foam cleaner","dashboard polish","radiator coolant","wash mitt"];

// ---- Helpers ----
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const wa = text => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

// ---- Cart (guest cart in localStorage) ----
let cart = [];
try { cart = JSON.parse(localStorage.getItem("cart") || "[]"); } catch { cart = []; }
const saveCart = () => { try { localStorage.setItem("cart", JSON.stringify(cart)); } catch {} renderCart(); };
function add(id){
  const row = cart.find(i => i.id === id);
  row ? row.qty++ : cart.push({id, qty:1});
  saveCart();
}
function change(id, d){
  const row = cart.find(i => i.id === id); if(!row) return;
  row.qty += d; if(row.qty < 1) cart = cart.filter(i => i.id !== id);
  saveCart();
}
function renderCart(){
  $("#cartCount").textContent = cart.reduce((n,i) => n + i.qty, 0);
  const box = $("#cartItems");
  if(!cart.length){ box.innerHTML = "<p class='text-muted'>Your cart is empty. Add a product to get started.</p>"; $("#waOrder").classList.add("disabled"); return; }
  $("#waOrder").classList.remove("disabled");
  box.innerHTML = cart.map(i => {
    const p = PRODUCTS.find(x => x.id === i.id); if(!p) return "";
    return `<div class="d-flex align-items-center gap-2 mb-3"><img src="${esc(p.img)}" alt="" width="48" height="48" style="object-fit:contain">
      <div class="flex-grow-1 small fw-semibold">${esc(p.name)}</div>
      <div class="btn-group btn-group-sm"><button class="btn btn-outline-dark" data-d="-1" data-id="${esc(p.id)}" aria-label="Decrease">−</button>
      <span class="btn btn-light disabled">${i.qty}</span><button class="btn btn-outline-dark" data-d="1" data-id="${esc(p.id)}" aria-label="Increase">+</button></div></div>`;
  }).join("");
  const lines = cart.map(i => { const p = PRODUCTS.find(x => x.id === i.id); return p ? `- ${p.name} x ${i.qty}` : ""; }).join("\n");
  $("#waOrder").href = wa(`Hello AkuBee Auto Care, I would like to order:\n${lines}\nPlease confirm availability and price.`);
}
$("#cartItems").addEventListener("click", e => {
  const b = e.target.closest("button[data-id]"); if(b) change(b.dataset.id, +b.dataset.d);
});

// ---- Products & search ----
function card(p){
  const moq = p.moq ? `Wholesale MOQ: ${p.moq} pcs` : "Wholesale: ask for MOQ";
  return `<div class="col-6 col-md-4 col-lg-3"><article class="card-p"><img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy">
    <div class="body"><span class="meta">${esc(p.cat)}</span><h3>${esc(p.name)}</h3>
    <span class="price text-muted">Price on request</span><span class="meta">${esc(moq)}</span>
    <div class="mt-auto d-grid gap-1 pt-2"><button class="btn btn-accent btn-sm" data-add="${esc(p.id)}">Add to cart</button>
    <a class="btn btn-outline-dark btn-sm" target="_blank" rel="noopener" href="${wa("Hello, I am interested in: " + p.name)}">WhatsApp enquiry</a></div></div></article></div>`;
}
function showProducts(q = ""){
  const t = q.trim().toLowerCase();
  const list = PRODUCTS.filter(p => !t || (p.name + " " + p.cat + " " + p.tags).toLowerCase().includes(t));
  $("#productGrid").innerHTML = list.map(card).join("");
  $("#empty").classList.toggle("d-none", list.length > 0);
}
$("#productGrid").addEventListener("click", e => { const b = e.target.closest("[data-add]"); if(b) add(b.dataset.add); });
$("#searchForm").addEventListener("submit", e => { e.preventDefault(); showProducts($("#q").value); $("#featured").scrollIntoView({behavior:"smooth"}); });
$("#q").addEventListener("input", e => { showProducts(e.target.value); });
$("#suggest").innerHTML = TRENDING.map(t => `<option value="${esc(t)}">`).join("");
$("#finder").addEventListener("click", e => { const b = e.target.closest("button[data-q]"); if(b){ $("#q").value = b.dataset.q; showProducts(b.dataset.q); $("#featured").scrollIntoView({behavior:"smooth"}); } });

// ---- Categories, trending ----
$("#catGrid").innerHTML = CATEGORIES.map(([n,i]) => `<div class="col-6 col-md-3"><a class="cat" href="#featured" data-cat="${esc(n)}"><i class="bi ${i}"></i><h3>${esc(n)}</h3></a></div>`).join("");
$("#catGrid").addEventListener("click", e => { const a = e.target.closest("[data-cat]"); if(a){ const w = a.dataset.cat.split(" ")[0]; $("#q").value = w; showProducts(w); } });
$("#trending").innerHTML = TRENDING.map(t => `<button class="chip" data-t="${esc(t)}">${esc(t)}</button>`).join("");
$("#trending").addEventListener("click", e => { const b = e.target.closest("[data-t]"); if(b){ $("#q").value = b.dataset.t; showProducts(b.dataset.t); $("#featured").scrollIntoView({behavior:"smooth"}); } });

// ---- WhatsApp CTAs ----
$("#waWholesale").href = wa("Hello AkuBee Auto Care, I would like wholesale pricing. Business name: ___ Products of interest: ___");
$("#waDistributor").href = wa("Hello AkuBee Auto Care, I would like to become a distributor. Name: ___ Location: ___");
$("#yr").textContent = new Date().getFullYear();
showProducts(); renderCart();
