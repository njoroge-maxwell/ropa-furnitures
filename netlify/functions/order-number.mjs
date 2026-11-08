// Ropa Furniture — hands out sequential order numbers (1001, 1002, 1003 …).
// Each number is "claimed" with an atomic write-if-new in Netlify Blobs, so two customers
// can never receive the same number, even if they order at the same moment.
import { getStore } from "@netlify/blobs";

const START = 1001; // the first order number — change this if you want to start somewhere else

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function claim(store, from, tries) {
  let n = from;
  for (let i = 0; i < tries; i++, n++) {
    const { modified } = await store.set(`order-${n}`, new Date().toISOString(), { onlyIfNew: true });
    if (modified) return n;
  }
  return null;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    const store = getStore({ name: "ropa-orders", consistency: "strong" });

    // "next" is only a hint to start looking from; the atomic claim above is what guarantees uniqueness.
    const hint = parseInt(await store.get("next"), 10);
    let n = await claim(store, Number.isInteger(hint) && hint >= START ? hint : START, 60);

    if (n === null) {
      // The hint was missing or far behind: find the highest number handed out so far and continue after it.
      const { blobs } = await store.list({ prefix: "order-" });
      const highest = blobs.reduce((m, b) => Math.max(m, parseInt(b.key.slice(6), 10) || 0), START - 1);
      n = await claim(store, highest + 1, 60);
    }
    if (n === null) return json({ error: "Busy, please try again" }, 503);

    await store.set("next", String(n + 1));
    return json({ number: n });
  } catch (err) {
    console.error(err);
    return json({ error: "Could not get an order number" }, 500);
  }
};
