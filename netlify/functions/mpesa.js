// Ropa Furnitures — M-Pesa (Safaricom Daraja "M-Pesa Express" / STK push) backend for Netlify.
// Sends a payment prompt to the customer's phone and reports back whether they paid.
// Prices are calculated here on the server so customers cannot change what they pay.
//
// Environment variables (Netlify → Project configuration → Environment variables):
//   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET   from your app on developer.safaricom.co.ke
//   MPESA_SHORTCODE   your Paybill number — or, for a Till, the Store/Head Office number Safaricom gave you
//   MPESA_TILL        (Till users only) your Till number. Leave empty if you use a Paybill.
//   MPESA_PASSKEY     the Lipa Na M-Pesa Online passkey for that shortcode
//   MPESA_ENV         "live" for real money; anything else uses Safaricom's sandbox
//   SITE_URL          e.g. https://ropa-furniture.netlify.app  (no slash at the end)

// KEEP IN SYNC with PRODUCTS in index.html
const CATALOG = {
  1:{price:30000}, 2:{price:40000}, 3:{price:30000}, 4:{price:15000}, 5:{price:35000},
  6:{price:25000}, 7:{price:60000}, 8:{price:15000}, 9:{price:45000}, 10:{price:35000},
  11:{price:25000}, 12:{price:30000}, 13:{price:17000},
};
const DEPOSIT_RATE = 0.5;

const env = (k) => (process.env[k] || "").trim();
const BASE = () => (env("MPESA_ENV") === "live" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke");
const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const FAIL_GENERIC = "M-Pesa payment isn't available right now. Please use WhatsApp to order — we'll sort payment there.";

let tokenCache = { token: null, exp: 0 };

async function getToken() {
  if (!env("MPESA_CONSUMER_KEY") || !env("MPESA_CONSUMER_SECRET") || !env("MPESA_SHORTCODE") || !env("MPESA_PASSKEY")) {
    throw new Error("M-Pesa settings are missing in Netlify (need CONSUMER_KEY, CONSUMER_SECRET, SHORTCODE, PASSKEY)");
  }
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const auth = Buffer.from(`${env("MPESA_CONSUMER_KEY")}:${env("MPESA_CONSUMER_SECRET")}`).toString("base64");
  const res = await fetch(BASE() + "/oauth/v1/generate?grant_type=client_credentials", {
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Daraja authentication failed (${res.status}) ${JSON.stringify(data)}`);
  tokenCache = { token: data.access_token, exp: Date.now() + ((Number(data.expires_in) || 3599) - 60) * 1000 };
  return tokenCache.token;
}

// Daraja wants YYYYMMDDHHmmss in Nairobi time (UTC+3)
function timestamp() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
const password = (ts) => Buffer.from(env("MPESA_SHORTCODE") + env("MPESA_PASSKEY") + ts).toString("base64");

// 0712345678 / 712345678 / +254712345678 / 254 712 345 678  ->  254712345678
function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) d = "254" + d.slice(1);
  else if (d.length === 9 && /^[17]/.test(d)) d = "254" + d;
  return /^254[17]\d{8}$/.test(d) ? d : null;
}

async function queryStatus(checkoutId) {
  const token = await getToken();
  const ts = timestamp();
  const res = await fetch(BASE() + "/mpesa/stkpushquery/v1/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: env("MPESA_SHORTCODE"),
      Password: password(ts),
      Timestamp: ts,
      CheckoutRequestID: checkoutId,
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (d.ResultCode !== undefined && d.ResultCode !== null && d.ResultCode !== "") {
    const code = String(d.ResultCode);
    return { status: code === "0" ? "success" : "failed", code, desc: d.ResultDesc || "" };
  }
  if (d.errorCode && !String(d.errorCode).includes("500.001.1001")) console.warn("STK query:", res.status, JSON.stringify(d));
  return { status: "pending" }; // "being processed" and other temporary answers
}

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};

    // Website asks whether the customer has paid yet
    if (event.httpMethod === "GET" && q.checkoutId) {
      if (!/^[\w-]{5,80}$/.test(q.checkoutId)) return json(400, { error: "Bad request" });
      return json(200, await queryStatus(q.checkoutId));
    }
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");

    // Safaricom's result notification (shows up in Netlify → Logs → Functions with the M-Pesa receipt number)
    if (body.Body && body.Body.stkCallback) {
      const cb = body.Body.stkCallback;
      console.log("STK callback", cb.CheckoutRequestID, cb.ResultCode, cb.ResultDesc, JSON.stringify(cb.CallbackMetadata || {}));
      return json(200, { ResultCode: 0, ResultDesc: "Accepted" });
    }

    // New payment request from the website
    const { items, mode, customer } = body;
    if (!Array.isArray(items) || !items.length || items.length > 30) return json(400, { error: "Your order is empty." });
    let total = 0;
    for (const it of items) {
      const p = CATALOG[it.id];
      const qty = Number(it.qty);
      if (!p || !Number.isInteger(qty) || qty < 1 || qty > 20) return json(400, { error: "Invalid item in order." });
      total += p.price * qty;
    }
    const name = String(customer?.name || "").trim();
    const phone = normalizePhone(customer?.phone);
    if (!name) return json(400, { error: "Please enter your name." });
    if (!phone) return json(400, { error: "Please enter a valid Safaricom number, e.g. 0712 345 678." });

    const amount = mode === "deposit" ? Math.ceil(total * DEPOSIT_RATE) : total;
    const ref = "ROPA" + String(Date.now()).slice(-8); // max 12 characters
    const siteUrl = (env("SITE_URL") || `https://${event.headers.host}`).replace(/\/$/, "");
    const till = env("MPESA_TILL");
    const ts = timestamp();
    const token = await getToken();

    const res = await fetch(BASE() + "/mpesa/stkpush/v1/processrequest", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: env("MPESA_SHORTCODE"),
        Password: password(ts),
        Timestamp: ts,
        TransactionType: till ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: till || env("MPESA_SHORTCODE"),
        PhoneNumber: phone,
        CallBackURL: siteUrl + "/.netlify/functions/mpesa",
        AccountReference: ref,
        TransactionDesc: "Ropa order",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (String(data.ResponseCode) !== "0" || !data.CheckoutRequestID) {
      console.error("STK push rejected", res.status, JSON.stringify(data));
      return json(502, { error: "We couldn't send the M-Pesa prompt. Please check your number, or order on WhatsApp." });
    }
    return json(200, {
      checkout_request_id: data.CheckoutRequestID,
      reference: ref,
      amount,
      phone_hint: `0${phone.slice(3, 6)} ••• ${phone.slice(-3)}`,
    });
  } catch (err) {
    console.error(err);
    return json(502, { error: FAIL_GENERIC });
  }
};
