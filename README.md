# Ropa Furnitures website

## Files
- index.html — the whole website (photos and logo are inside it)
- netlify/functions/pesapal.js — Pesapal card / M-Pesa payments
- netlify/functions/order-number.mjs — sequential order numbers (1001, 1002 …)
- netlify/functions/delivery.js — delivery towns and delivery price from Fargo Courier (hidden until set up)
- netlify/functions/lib/catalog.js — product prices used by the server  (KEEP IN SYNC with PRODUCTS in index.html)
- netlify/functions/lib/fargo.js — Fargo connection + the size/weight of each product
- package.json, netlify.toml — Netlify setup

Upload the folder structure exactly as it is in the zip.

## 1. Pesapal (online payments)
Netlify -> Project configuration -> Environment variables:

| Name | Value |
|---|---|
| PESAPAL_CONSUMER_KEY | your Pesapal consumer key |
| PESAPAL_CONSUMER_SECRET | your Pesapal consumer secret |
| PESAPAL_ENV | `live` for real payments; leave out to use Pesapal's test mode |
| SITE_URL | https://ropa-furniture.netlify.app (no slash at the end) |

Then Deploys -> Trigger deploy -> Deploy project.
The error "invalid_consumer_key_or_secret_provided" in Netlify -> Logs -> Functions -> pesapal means Pesapal
did not accept the key + secret pair. Copy a fresh pair from the SAME Pesapal account/environment you set in
PESAPAL_ENV (test keys only work in test mode, live keys only in live mode) and paste without spaces.

## 2. Fargo delivery (optional — the website hides it until all of this is done)
Customers pick their delivery town, see the delivery price from Fargo added to their total, and it is included in the
WhatsApp message and the Pesapal payment (the price is always re-checked on the server).

1. Create your own account at api.bookacourier.co.ke, then Websites -> Add Domain to get YOUR "Website Token".
   (Never use a token from someone else's plugin.)
2. In Netlify add FARGO_TOKEN = your token, then redeploy.
3. Open https://ropa-furniture.netlify.app/.netlify/functions/delivery?list=1 — it lists Fargo's towns with ID numbers.
   Find Nakuru's ID and add FARGO_PICKUP_TOWN_ID = that number in Netlify.
4. Measure each product (length, width, height) and weigh it. Ask Fargo which units they expect (normally cm and kg).
   Fill every number in SIZES in netlify/functions/lib/fargo.js. Delivery stays hidden until ALL 13 products have all 4 numbers.
5. Optional: FARGO_FROM_EMAIL = your email; FARGO_API_URL if Fargo gives you a https address.
6. Redeploy and test with an order to a town you know the price for.

This only calculates delivery prices. Booking the courier is still done by you in your Fargo account.

## Notes
- Prices: change them in PRODUCTS (index.html) AND lib/catalog.js.
- Order numbers are stored in Netlify (Blobs, store "ropa-orders"); START (in order-number.mjs) sets the first number.
