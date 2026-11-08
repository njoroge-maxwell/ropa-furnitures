# Ropa Furniture website

## Files
- index.html — the whole website (photos and logo are inside it)
- netlify/functions/paystack.js — card + M-Pesa payments through Paystack
- netlify/functions/order-number.mjs — sequential order numbers (1001, 1002 …)
- netlify/functions/delivery.js + lib/fargo.js — Fargo delivery prices (stays hidden until Fargo gives a working API)
- netlify/functions/lib/catalog.js — product prices used by the server  (KEEP IN SYNC with PRODUCTS in index.html)
- package.json, netlify.toml — Netlify setup

Upload the folder structure exactly as it is in the zip.

## Paystack setup
1. Sign up at paystack.com (Kenya) as an individual business and finish verification (ID, proof of address, bank account in your name).
2. Paystack dashboard -> Settings -> API Keys & Webhooks: copy your SECRET key (sk_test_… for practice, sk_live_… for real money).
3. Netlify -> Project configuration -> Environment variables:

| Name | Value |
|---|---|
| PAYSTACK_SECRET_KEY | your secret key (tick "Contains secret values") |
| SITE_URL | https://ropa-furniture.netlify.app (no slash at the end) |

4. Deploys -> Trigger deploy -> Deploy project.
5. (Optional) In Paystack, set the Webhook URL to https://ropa-furniture.netlify.app/.netlify/functions/paystack
   so every payment is also written to Netlify -> Logs -> Functions -> paystack.

The key decides the mode: sk_test_ = practice (no real money), sk_live_ = real payments. Start with the test key.
Paystack needs the customer's email, so the website asks for it when paying online. Each payment shows the order number,
customer, phone, delivery area and items in your Paystack dashboard.

## Notes
- Prices: change them in PRODUCTS (index.html) AND lib/catalog.js.
- Order numbers are stored in Netlify (Blobs, store "ropa-orders"); START (in order-number.mjs) sets the first number.
- Fargo delivery: see lib/fargo.js. It stays off until Fargo supplies a working API.
