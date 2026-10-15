import { connectLambda, getStore } from "@netlify/blobs";
import { verifyAdminToken } from "../lib/admin-auth.mjs";

const STORE_NAME = "reservations";
const TAKEN_MESSAGE = "Ovaj termin je upravo zauzet. Odaberite drugi.";
const STALE_LOCK_MS = 15_000;

const ALLOWED_SLOTS = new Map([
  ["12:00–15:00", "1200-1500"],
  ["17:00–20:00", "1700-2000"],
]);

const ALLOWED_PACKAGES = new Set(["Paket 1", "Paket 2"]);

const CANCELLED_STATUSES = new Set([
  "cancelled",
  "canceled",
  "otkazano",
  "otkazana",
  "otkazan",
]);

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

function resolveStore(event, context) {
  if (context && context.blobsStore) return context.blobsStore;
  return openStore(event);
}

function blobKey(id) {
  return `item/${id}`;
}

function slotLockKey(datum, vrijeme) {
  const slot = ALLOWED_SLOTS.get(vrijeme) || encodeURIComponent(vrijeme);
  return `slot/${datum}/${slot}`;
}

function headerValue(event, name) {
  const headers = event?.headers || {};
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted && value) return String(value);
  }
  return "";
}

function isAdmin(event) {
  return verifyAdminToken(headerValue(event, "x-admin-token"));
}

function isCancelled(item) {
  if (!item || typeof item !== "object") return false;
  if (item.cancelled === true || item.otkazano === true) return true;
  const status = String(item.status || item.stanje || "")
    .trim()
    .toLowerCase();
  return CANCELLED_STATUSES.has(status);
}

function isActiveReservation(item) {
  return Boolean(item && item.id && item.datum && item.vrijeme) && !isCancelled(item);
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

function takenPairs(items) {
  const seen = new Set();
  const taken = [];
  for (const item of items) {
    if (!isActiveReservation(item)) continue;
    const key = `${item.datum}\n${item.vrijeme}`;
    if (seen.has(key)) continue;
    seen.add(key);
    taken.push({ datum: item.datum, vrijeme: item.vrijeme });
  }
  taken.sort((a, b) =>
    `${a.datum}${a.vrijeme}`.localeCompare(`${b.datum}${b.vrijeme}`)
  );
  return taken;
}

async function findActiveConflict(store, datum, vrijeme) {
  const items = await listReservations(store);
  return (
    items.find(
      (item) =>
        isActiveReservation(item) &&
        item.datum === datum &&
        item.vrijeme === vrijeme
    ) || null
  );
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

function todayInSarajevo(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Sarajevo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isRealDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateReservation(input) {
  const datum = cleanText(input.datum, 32);
  const vrijeme = cleanText(input.vrijeme, 40);
  const paket = cleanText(input.paket, 40);
  const ime = cleanText(input.ime, 80);
  const telefon = cleanText(input.telefon, 40);
  const source = input.source === "admin" ? "admin" : "web";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !isRealDate(datum)) {
    return { error: "Neispravan datum." };
  }
  if (datum < todayInSarajevo()) {
    return { error: "Ne možete rezervisati prošli datum." };
  }
  if (!ALLOWED_SLOTS.has(vrijeme)) {
    return { error: "Neispravan termin." };
  }
  if (!ALLOWED_PACKAGES.has(paket)) {
    return { error: "Neispravan paket." };
  }
  if (!ime || !telefon) {
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

async function releaseSlotIfOwned(store, item) {
  const key = slotLockKey(item.datum, item.vrijeme);
  const stored = await store.get(key, { type: "json" });
  if (stored && stored.id === item.id) {
    await store.delete(key);
  }
}

async function claimSlot(store, item) {
  const key = slotLockKey(item.datum, item.vrijeme);
  const payload = {
    id: item.id,
    datum: item.datum,
    vrijeme: item.vrijeme,
    claimedAt: new Date().toISOString(),
  };

  const attempt = async () => {
    const result = await store.setJSON(key, payload, { onlyIfNew: true });
    if (result && result.modified === false) return false;
    const stored = await store.get(key, { type: "json" });
    return Boolean(stored && stored.id === item.id);
  };

  if (await attempt()) return true;

  const lock = await store.get(key, { type: "json" });
  if (lock?.id) {
    const owner = await store.get(blobKey(lock.id), { type: "json" });
    const ownerActive =
      isActiveReservation(owner) &&
      owner.datum === item.datum &&
      owner.vrijeme === item.vrijeme;
    if (ownerActive) return false;

    const claimedAt = Date.parse(lock.claimedAt || "");
    const fresh =
      Number.isFinite(claimedAt) && Date.now() - claimedAt < STALE_LOCK_MS;
    if (!owner && fresh) return false;
  }

  await store.delete(key);
  return attempt();
}

export async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    const store = resolveStore(event, context);

    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters || {};
      if (params.availability === "1" || params.availability === "true") {
        const items = await listReservations(store);
        return json(200, { taken: takenPairs(items) });
      }

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

      const existing = await findActiveConflict(store, item.datum, item.vrijeme);
      if (existing) return json(409, { error: TAKEN_MESSAGE });

      const claimed = await claimSlot(store, item);
      if (!claimed) return json(409, { error: TAKEN_MESSAGE });

      const raced = await findActiveConflict(store, item.datum, item.vrijeme);
      if (raced) {
        await releaseSlotIfOwned(store, item);
        return json(409, { error: TAKEN_MESSAGE });
      }

      try {
        await store.setJSON(blobKey(item.id), item);
      } catch (writeError) {
        await releaseSlotIfOwned(store, item);
        throw writeError;
      }
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
      if (existing.datum && existing.vrijeme) {
        const key = slotLockKey(existing.datum, existing.vrijeme);
        const lock = await store.get(key, { type: "json" });
        if (!lock || lock.id === id) await store.delete(key);
      }
      return json(200, { ok: true });
    }

    return json(405, { error: "Metoda nije dozvoljena." });
  } catch (error) {
    console.error("reservations function error", error);
    return json(500, { error: "Serverska greška. Pokušajte ponovo." });
  }
}
