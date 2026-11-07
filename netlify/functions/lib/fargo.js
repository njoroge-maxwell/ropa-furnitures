// Fargo Courier (api.bookacourier.co.ke) — delivery town list and delivery price.
// Written from the request format used by Fargo's own Magento plugin. Switched OFF until everything below is filled in.
//
// Needed to switch delivery on:
//   1. Netlify environment variables:
//        FARGO_TOKEN            your own "Website Token" (Fargo account -> Websites -> Add Domain)
//        FARGO_PICKUP_TOWN_ID   Fargo's ID number for the town you ship FROM (Nakuru) — it appears in the towns list
//        FARGO_API_URL          (optional) defaults to http://api.bookacourier.co.ke/index.php
//        FARGO_FROM_EMAIL       (optional) your email, sent as the sender
//   2. The real size and weight of every product below (ask Fargo which units they expect — normally cm and kg).
//      Until EVERY product has all four numbers, the delivery option stays hidden on the website.

const SIZES = {
  1:{length:0,width:0,height:0,weight:0},  // Easy Chair
  2:{length:0,width:0,height:0,weight:0},  // Easy Chair with Footrest
  3:{length:0,width:0,height:0,weight:0},  // Armchair (with Footrest)
  4:{length:0,width:0,height:0,weight:0},  // Wishbone Chair
  5:{length:0,width:0,height:0,weight:0},  // Mixed Colour Easy Chair
  6:{length:0,width:0,height:0,weight:0},  // Weaved Bar Stools
  7:{length:0,width:0,height:0,weight:0},  // Weaved Daybed
  8:{length:0,width:0,height:0,weight:0},  // Dining Chair
  9:{length:0,width:0,height:0,weight:0},  // Entry Bench
  10:{length:0,width:0,height:0,weight:0}, // Curve Armchair
  11:{length:0,width:0,height:0,weight:0}, // Wish Barstool
  12:{length:0,width:0,height:0,weight:0}, // Bench
  13:{length:0,width:0,height:0,weight:0}, // Dressing Stool
};

const env = (k) => (process.env[k] || "").trim();
const API = () => env("FARGO_API_URL") || "http://api.bookacourier.co.ke/index.php";
const pickupTown = () => parseInt(env("FARGO_PICKUP_TOWN_ID"), 10);
const sizesComplete = () => Object.values(SIZES).every((s) => s.length > 0 && s.width > 0 && s.height > 0 && s.weight > 0);
const ready = () => !!env("FARGO_TOKEN") && Number.isInteger(pickupTown()) && sizesComplete();

async function call(task, params = {}) {
  const qs = new URLSearchParams({ option: "com_fargo_shipping", task, token: env("FARGO_TOKEN"), ...params });
  const res = await fetch(`${API()}?${qs}`, { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Fargo sent an unreadable reply (${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`Fargo error ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

let townCache = { list: null, exp: 0 };
async function getTowns() {
  if (townCache.list && Date.now() < townCache.exp) return townCache.list;
  const data = await call("shippingregions.getRegions");
  const regions = Array.isArray(data.regions) ? data.regions : [];
  const list = regions
    .map((r) => ({ id: Number(r.id), name: String(r.title || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) }))
    .filter((r) => Number.isInteger(r.id) && r.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) throw new Error("Fargo returned no towns: " + JSON.stringify(data).slice(0, 200));
  townCache = { list, exp: Date.now() + 6 * 3600 * 1000 };
  return list;
}

// lines: [{id, qty}]   townId: Fargo town id   who: {name, phone, email, area}
async function quote(lines, townId, who = {}) {
  if (!ready()) throw new Error("Fargo delivery is not switched on yet");
  const [first, ...rest] = String(who.name || "Ropa customer").trim().split(/\s+/);
  const items = lines.map((l) => {
    const s = SIZES[l.id];
    if (!s) throw new Error("No size for product " + l.id);
    return {
      quantity: l.qty, radius: s.width, height: s.height, width: s.width, length: s.length, weight: s.weight,
      dropoff: townId, pickup: pickupTown(), product_sku: "ROPA-" + l.id,
      to_building: "", to_street: who.area || "", to_suburb: who.area || "", to_additionalinfo: "",
      firstname: first, lastname: rest.join(" "), telephone: who.phone || "", email: who.email || "",
      from_firstname: "Ropa Furnitures", from_lastname: "", from_email: env("FARGO_FROM_EMAIL"),
      from_building: "", from_street: "", from_suburb: "Nakuru", from_additionalinfo: "Nakuru", from_telephone: "0719378579",
    };
  });
  const data = await call("shippingregions.getItemsShippingValue", {
    shippingrequest: Buffer.from(JSON.stringify(items)).toString("base64"),
  });
  const cost = Number(data.shipping_cost);
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Fargo gave no delivery price: " + JSON.stringify(data).slice(0, 200));
  return Math.round(cost);
}

const hasToken = () => !!env("FARGO_TOKEN");
module.exports = { ready, hasToken, getTowns, quote, SIZES };
