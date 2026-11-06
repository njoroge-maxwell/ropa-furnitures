# Ropa Furnitures website

Files
- index.html — the whole website (photos and logo are inside it)
- netlify/functions/pesapal.js — secure backend for Pesapal card / M-Pesa payments
- netlify.toml — tells Netlify where the function is

## 1. Before anything else (2 edits in index.html)
Search for `OWNER_WHATSAPP` and put in your WhatsApp number, e.g. `2547XXXXXXXX` (no + or spaces).
Prices live in the `PRODUCTS` list. If you change a price, change it in `pesapal.js` (`CATALOG`) too —
the server calculates the amount itself, so customers can't alter prices.

## 2. Get Pesapal keys
1. Sign up at pesapal.com as a merchant (and at the Pesapal developer sandbox to test first).
2. Copy your Consumer Key and Consumer Secret.
3. Ask Pesapal which payment channels are enabled on your account (cards, M-Pesa, and your till if you want it).
   What customers see on the Pesapal payment page depends on what your account has switched on.

## 3. Put the site online (Netlify, free tier works)
1. Upload this folder to a GitHub repository.
2. On netlify.com: Add new site → Import from Git → choose the repo (no build command needed).
3. Site settings → Environment variables, add:
   - PESAPAL_CONSUMER_KEY
   - PESAPAL_CONSUMER_SECRET
   - SITE_URL = your site address, e.g. https://ropafurniture.netlify.app
   - PESAPAL_ENV = sandbox while testing, then `live` when you're ready for real money
4. Redeploy. Test with Pesapal's sandbox test cards/numbers, then switch PESAPAL_ENV to `live`
   and use your live keys.

## How payment works
Customer taps "Pay online" → site calls the function → function asks Pesapal for a payment link →
customer pays on Pesapal's secure page → returns to your site, which shows a payment banner and a
"Send confirmation on WhatsApp" button. Pesapal also pings the function (IPN) and your dashboard shows every payment.
