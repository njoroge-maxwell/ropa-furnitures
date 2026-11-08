// Ropa Furniture — Paystack backend (card + M-Pesa) for Netlify.
// Your secret key stays here on the server, and the amount is worked out here so prices can't be tampered with.
//
// Netlify environment variables (Project configuration -> Environment variables):
//   PAYSTACK_SECRET_KEY   your secret key from Paystack (Settings -> API Keys & Webhooks): sk_test_... or sk_live_...
//   SITE_URL              e.g. https://ropa-furniture.netlify.app  (no slash at the end)
// Test keys (sk_test_...) = practice mode, live keys (sk_live_...) = real money. The key itself decides which.

const crypto = require("crypto");
const { CATALOG } = require("./lib/catalog");
const fargo = require("./lib/fargo");

const DEPOSIT_RATE = 0.5;
const MIN_PAYMENT = 100;   // smallest custom amount (KSh). KEEP IN SYNC with MIN_PAYMENT in index.html
const API = "https://api.paystack.co";
const secret = () => (process.env.PAYSTACK_SECRET_KEY || "").trim();

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

async function paystack(path, { method = "GET", body } = {}) {
  if (!secret()) throw new Error("PAYSTACK_SECRET_KEY is not set in Netlify");
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new Error(`Paystack error ${res.status}: ${data.message || "unknown"}`);
  return data;
}

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const siteUrl = (process.env.SITE_URL || `https://${event.headers.host}`).replace(/\/$/, "");

    // 1) The website asks whether the customer has paid (after Paystack sends them back)
    if (event.httpMethod === "GET" && q.reference) {
      if (!/^[A-Za-z0-9._=-]{5,100}$/.test(q.reference)) return json(400, { error: "Bad reference" });
      const { data } = await paystack(`/transaction/verify/${encodeURIComponent(q.reference)}`);
      const s = String(data.status || "").toLowerCase();
      const label = s === "success" ? "Completed" : ["ongoing", "pending", "processing", "queued"].includes(s) ? "Pending" : "Failed";
      return json(200, {
        payment_status_description: label,
        amount: Number(data.amount) / 100,
        merchant_reference: data.reference,
        payment_method: data.channel,
      });
    }

    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    // 2) Paystack's own notification (webhook) — only logged, so the payment shows up in Netlify -> Logs -> Functions
    const sig = event.headers["x-paystack-signature"];
    if (sig) {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body || "";
      const ok = crypto.createHmac("sha512", secret()).update(raw).digest("hex") === sig;
      if (ok) {
        const e = JSON.parse(raw);
        console.log("Paystack event", e.event, e.data && e.data.reference, e.data && e.data.status, e.data && e.data.amount, e.data && e.data.channel);
      } else console.warn("Paystack webhook with a bad signature ignored");
      return json(200, { received: true });
    }

    // 3) A new payment from the website
    const { items, mode, customer, orderNumber, townId, customAmount } = JSON.parse(event.body || "{}");
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
    const email = String(customer?.email || "").trim().slice(0, 100);
    if (!name || !phone) return json(400, { error: "Name and phone are required." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "Please enter a valid email address for online payment." });

    // Delivery (only if a Fargo town was chosen): price comes from Fargo here, never from the browser
    let delivery = 0;
    if (townId !== undefined && townId !== null) {
      const noDelivery = { error: "We couldn't confirm the delivery cost online. Please order on WhatsApp and we'll agree it there." };
      if (!Number.isInteger(townId) || !fargo.ready()) return json(400, noDelivery);
      try {
        delivery = await fargo.quote(items.map((it) => ({ id: it.id, qty: Number(it.qty) })), townId, { ...customer, name, phone });
      } catch (e) {
        console.error(e);
        return json(400, noDelivery);
      }
      total += delivery;
    }

    const deposit = mode === "deposit";
    let amount;
    if (mode === "custom") {
      const c = Number(customAmount);
      if (!Number.isInteger(c) || c < MIN_PAYMENT) return json(400, { error: `The smallest amount you can pay online is KSh ${MIN_PAYMENT.toLocaleString("en-KE")}.` });
      if (c > total) return json(400, { error: `That's more than your order total (KSh ${total.toLocaleString("en-KE")}). Please enter a smaller amount.` });
      amount = c;
    } else {
      amount = deposit ? Math.ceil(total * DEPOSIT_RATE) : total;
    }
    const balance = total - amount;
    const paymentText = mode === "custom" ? "Part payment" : deposit ? "50% deposit" : "Full payment";
    const num = String(orderNumber || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
    const ref = ("ROPA-" + (num ? num + "-" : "") + Date.now().toString(36).toUpperCase()).slice(0, 60);
    const itemsText = items.map((it) => `${CATALOG[it.id].name} x${it.qty}${it.wood ? " (" + String(it.wood).slice(0, 20) + ")" : ""}`).join(", ").slice(0, 300);

    const { data } = await paystack("/transaction/initialize", {
      method: "POST",
      body: {
        email,
        amount: Math.round(amount * 100),          // Paystack wants the smallest unit: KES 1 = 100
        currency: "KES",
        reference: ref,
        channels: ["mobile_money", "card"],        // M-Pesa first, then card
        callback_url: siteUrl + "/",
        metadata: {
          order_number: num || null,
          deposit,
          payment_type: mode === "custom" ? "custom" : deposit ? "deposit" : "full",
          order_total: total,
          balance,
          custom_fields: [
            { display_name: "Order", variable_name: "order", value: num ? "#" + num : ref },
            { display_name: "Customer", variable_name: "customer", value: name },
            { display_name: "Phone", variable_name: "phone", value: phone },
            { display_name: "Delivery", variable_name: "delivery", value: String(customer?.area || "").slice(0, 100) || "-" },
            { display_name: "Items", variable_name: "items", value: itemsText },
            { display_name: "Payment", variable_name: "payment", value: paymentText },
            { display_name: "Order total", variable_name: "order_total", value: "KSh " + total.toLocaleString("en-KE") },
            { display_name: "Balance after this payment", variable_name: "balance", value: "KSh " + balance.toLocaleString("en-KE") },
          ],
        },
      },
    });
    if (!data.authorization_url) throw new Error("Paystack did not return a payment link");
    return json(200, { redirect_url: data.authorization_url, merchant_reference: data.reference || ref, amount, total, balance });
  } catch (err) {
    console.error(err);
    return json(502, { error: "Could not start payment. Please try again or order on WhatsApp." });
  }
};
