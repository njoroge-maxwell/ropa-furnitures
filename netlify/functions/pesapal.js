// Ropa Furnitures — Pesapal API 3.0 backend (Netlify Function)
// Keeps your Pesapal keys secret and works out the amount on the server so prices can't be tampered with.
//
// Environment variables (Netlify → Site settings → Environment variables):
//   PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET  (from your Pesapal account)
//   PESAPAL_ENV     "live" for real payments; anything else uses the sandbox
//   SITE_URL        e.g. https://ropafurniture.netlify.app  (no trailing slash)
//   PESAPAL_IPN_ID  (optional) — if empty, the function registers the IPN URL itself

// KEEP IN SYNC with PRODUCTS in index.html
const CATALOG = {
  1:{name:"Easy Chair",price:30000}, 2:{name:"Easy Chair with Footrest",price:40000},
  3:{name:"Armchair (with Footrest)",price:30000}, 4:{name:"Wishbone Chair",price:15000},
  5:{name:"Mixed Colour Easy Chair",price:35000}, 6:{name:"Weaved Bar Stools",price:25000},
  7:{name:"Weaved Daybed",price:60000}, 8:{name:"Dining Chair",price:15000},
  9:{name:"Entry Bench",price:45000}, 10:{name:"Curve Armchair",price:35000},
  11:{name:"Wish Barstool",price:25000}, 12:{name:"Bench",price:30000}, 13:{name:"Dressing Stool",price:17000}
};
const DEPOSIT_RATE = 0.5;

const BASE = () => process.env.PESAPAL_ENV === "live"
  ? "https://pay.pesapal.com/v3" : "https://cybqa.pesapal.com/pesapalv3";

let tokenCache = { token: null, exp: 0 };
let ipnCache = null;

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE() + path, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = (data.error && (data.error.message || data.error.code)) || `Pesapal error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const data = await api("/api/Auth/RequestToken", {
    method: "POST",
    body: { consumer_key: process.env.PESAPAL_CONSUMER_KEY, consumer_secret: process.env.PESAPAL_CONSUMER_SECRET },
  });
  if (!data.token) throw new Error("Pesapal authentication failed");
  tokenCache = { token: data.token, exp: Date.now() + 4 * 60 * 1000 }; // tokens last ~5 min
  return data.token;
}

async function getIpnId(token, siteUrl) {
  if (process.env.PESAPAL_IPN_ID) return process.env.PESAPAL_IPN_ID;
  if (ipnCache) return ipnCache;
  const data = await api("/api/URLSetup/RegisterIPN", {
    method: "POST", token,
    body: { url: `${siteUrl}/.netlify/functions/pesapal`, ipn_notification_type: "GET" },
  });
  ipnCache = data.ipn_id;
  return ipnCache;
}

async function status(trackingId) {
  const token = await getToken();
  return api(`/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(trackingId)}`, { token });
}

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const siteUrl = (process.env.SITE_URL || `https://${event.headers.host}`).replace(/\/$/, "");

    // 1) IPN call from Pesapal (it sends OrderTrackingId + OrderNotificationType)
    if (event.httpMethod === "GET" && q.OrderTrackingId && q.OrderNotificationType) {
      const s = await status(q.OrderTrackingId);
      console.log("IPN", q.OrderMerchantReference, s.payment_status_description, s.amount);
      return json(200, {
        orderNotificationType: q.OrderNotificationType,
        orderTrackingId: q.OrderTrackingId,
        orderMerchantReference: q.OrderMerchantReference,
        status: 200,
      });
    }

    // 2) Website asks for the payment status after the customer returns
    if (event.httpMethod === "GET" && q.trackingId) {
      const s = await status(q.trackingId);
      return json(200, {
        payment_status_description: s.payment_status_description,
        amount: s.amount,
        merchant_reference: s.merchant_reference,
        payment_method: s.payment_method,
      });
    }

    // 3) Create a payment
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
    const { items, mode, customer } = JSON.parse(event.body || "{}");

    if (!Array.isArray(items) || !items.length || items.length > 30) return json(400, { error: "Your order is empty." });
    let total = 0;
    for (const it of items) {
      const p = CATALOG[it.id];
      const qty = Number(it.qty);
      if (!p || !Number.isInteger(qty) || qty < 1 || qty > 20) return json(400, { error: "Invalid item in order." });
      total += p.price * qty;
    }
    const name = String(customer?.name || "").trim().slice(0, 80);
    const phone = String(customer?.phone || "").trim().slice(0, 20);
    if (!name || !phone) return json(400, { error: "Name and phone are required." });

    const deposit = mode === "deposit";
    const amount = deposit ? Math.ceil(total * DEPOSIT_RATE) : total;
    const ref = "ROPA-" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
    const [first, ...rest] = name.split(/\s+/);

    const token = await getToken();
    const notification_id = await getIpnId(token, siteUrl);
    const resp = await api("/api/Transactions/SubmitOrderRequest", {
      method: "POST", token,
      body: {
        id: ref,
        currency: "KES",
        amount,
        description: `Ropa Furnitures ${deposit ? "50% deposit" : "order"} ${ref}`.slice(0, 100),
        callback_url: siteUrl + "/",
        cancellation_url: siteUrl + "/",
        notification_id,
        billing_address: {
          email_address: String(customer?.email || "").trim().slice(0, 80),
          phone_number: phone,
          country_code: "KE",
          first_name: first,
          last_name: rest.join(" "),
          line_1: String(customer?.area || "").slice(0, 100),
        },
      },
    });
    if (!resp.redirect_url) throw new Error("Pesapal did not return a payment link");
    return json(200, { redirect_url: resp.redirect_url, order_tracking_id: resp.order_tracking_id, merchant_reference: ref, amount });
  } catch (err) {
    console.error(err);
    return json(502, { error: "Could not start payment. Please try again or order on WhatsApp." });
  }
};
