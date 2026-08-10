import { connectLambda, getStore } from "@netlify/blobs";

const STORE_NAME = "reservations";
const ADMIN_PASS_HASH =
  "3404217d72d0c7e6a1a21f95c3083eb2487ee55643f6482a5026e0bfe97d0e96";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
    body: JSON.stringify(body),
  };
}

function openStore(event) {
  connectLambda(event);
  return getStore(STORE_NAME);
}

function blobKey(id) {
  return `item/${id}`;
}

async function migrateLegacyList(store) {
  const legacy = await store.get("all", { type: "json" });
  if (!legacy) return;

  const legacyItems = Array.isArray(legacy)
    ? legacy
    : legacy && Array.isArray(legacy.items)
      ? legacy.items
      : [];

  for (const item of legacyItems) {
    if (!item?.id) continue;
    const key = blobKey(item.id);
    const existing = await store.get(key, { type: "json" });
    if (!existing) {
      await store.setJSON(key, item);
    }
  }

  // Prevent deleted items from being restored on the next read.
  await store.delete("all");
}

async function listReservations(store) {
  await migrateLegacyList(store);

  const result = await store.list({ prefix: "item/" });
  const blobs = result.blobs || [];
  const items = [];

  for (const entry of blobs) {
    const data = await store.get(entry.key, { type: "json" });
    if (data && data.id) items.push(data);
  }

  items.sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  return items;
}

function isAdmin(event) {
  const token =
    event.headers["x-admin-token"] ||
    event.headers["X-Admin-Token"] ||
    "";
  return Boolean(token) && token === ADMIN_PASS_HASH;
}

function uid() {
  return `rez-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value, max = 120) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function validateReservation(input) {
  const datum = cleanText(input.datum, 32);
  const vrijeme = cleanText(input.vrijeme, 40);
  const paket = cleanText(input.paket, 40);
  const ime = cleanText(input.ime, 80);
  const telefon = cleanText(input.telefon, 40);
  const source = input.source === "admin" ? "admin" : "web";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    return { error: "Neispravan datum." };
  }
  if (!vrijeme || !paket || !ime || !telefon) {
    return { error: "Popunite sva obavezna polja." };
  }

  return {
    item: {
      id: uid(),
      datum,
      vrijeme,
      paket,
      ime,
      telefon,
      createdAt: new Date().toISOString(),
      source,
    },
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    const store = openStore(event);

    if (event.httpMethod === "GET") {
      if (!isAdmin(event)) {
        return json(401, { error: "Nedozvoljen pristup." });
      }
      const items = await listReservations(store);
      return json(200, { items });
    }

    if (event.httpMethod === "POST") {
      let payload;
      try {
        payload = JSON.parse(event.body || "{}");
      } catch {
        return json(400, { error: "Neispravan JSON." });
      }

      const { item, error } = validateReservation(payload);
      if (error) return json(400, { error });

      if (item.source === "admin" && !isAdmin(event)) {
        return json(401, { error: "Nedozvoljen pristup." });
      }

      await store.setJSON(blobKey(item.id), item);
      return json(201, { item });
    }

    if (event.httpMethod === "DELETE") {
      if (!isAdmin(event)) {
        return json(401, { error: "Nedozvoljen pristup." });
      }

      const params = event.queryStringParameters || {};
      const id = cleanText(params.id, 80);
      if (!id) return json(400, { error: "Nedostaje ID rezervacije." });

      const existing = await store.get(blobKey(id), { type: "json" });
      if (!existing) {
        return json(404, { error: "Rezervacija nije pronađena." });
      }
      await store.delete(blobKey(id));
      return json(200, { ok: true });
    }

    return json(405, { error: "Metoda nije dozvoljena." });
  } catch (error) {
    console.error("reservations function error", error);
    return json(500, { error: "Serverska greška. Pokušajte ponovo." });
  }
}
