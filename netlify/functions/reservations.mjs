import { connectLambda, getStore } from "@netlify/blobs";

const STORE_NAME = "reservations";
const LIST_KEY = "all";
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

function getReservationsStore(event) {
  connectLambda(event);
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function readList(event) {
  const store = getReservationsStore(event);
  const data = await store.get(LIST_KEY, { type: "json" });
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

async function writeList(event, items) {
  const store = getReservationsStore(event);
  await store.setJSON(LIST_KEY, { items });
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
    if (event.httpMethod === "GET") {
      if (!isAdmin(event)) {
        return json(401, { error: "Nedozvoljen pristup." });
      }
      const items = await readList(event);
      items.sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
      );
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

      const items = await readList(event);
      items.unshift(item);
      await writeList(event, items);
      return json(201, { item });
    }

    if (event.httpMethod === "DELETE") {
      if (!isAdmin(event)) {
        return json(401, { error: "Nedozvoljen pristup." });
      }

      const params = event.queryStringParameters || {};
      const id = cleanText(params.id, 80);
      if (!id) return json(400, { error: "Nedostaje ID rezervacije." });

      const items = await readList(event);
      const next = items.filter((entry) => entry.id !== id);
      if (next.length === items.length) {
        return json(404, { error: "Rezervacija nije pronađena." });
      }
      await writeList(event, next);
      return json(200, { ok: true });
    }

    return json(405, { error: "Metoda nije dozvoljena." });
  } catch (error) {
    console.error("reservations function error", error);
    return json(500, {
      error: "Serverska greška. Pokušajte ponovo.",
      detail: String(error && error.message ? error.message : error),
    });
  }
}
