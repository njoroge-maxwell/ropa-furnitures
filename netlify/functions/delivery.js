// Ropa Furniture — delivery towns and delivery price (via Fargo Courier).
// If Fargo isn't set up (see lib/fargo.js), this simply says "disabled" and the website hides the delivery option.
const { CATALOG } = require("./lib/catalog");
const fargo = require("./lib/fargo");

const json = (body) => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET") {
      // Setup helper: open  /.netlify/functions/delivery?list=1  to see Fargo's town ID numbers (needs FARGO_TOKEN only)
      if ((event.queryStringParameters || {}).list && fargo.hasToken()) return json({ towns: await fargo.getTowns() });
      if (!fargo.ready()) return json({ enabled: false });
      return json({ enabled: true, towns: await fargo.getTowns() });
    }
    if (event.httpMethod !== "POST") return json({ unavailable: true });

    const { items, townId, customer } = JSON.parse(event.body || "{}");
    if (!fargo.ready() || !Number.isInteger(townId) || !Array.isArray(items) || !items.length || items.length > 30) {
      return json({ unavailable: true });
    }
    const lines = [];
    for (const it of items) {
      const qty = Number(it.qty);
      if (!CATALOG[it.id] || !Number.isInteger(qty) || qty < 1 || qty > 20) return json({ unavailable: true });
      lines.push({ id: it.id, qty });
    }
    return json({ fee: await fargo.quote(lines, townId, customer || {}) });
  } catch (err) {
    console.error(err);
    return json(event.httpMethod === "GET" ? { enabled: false } : { unavailable: true });
  }
};
