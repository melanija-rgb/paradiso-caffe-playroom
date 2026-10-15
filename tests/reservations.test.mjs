import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { handler as loginHandler } from "../netlify/functions/admin-login.mjs";
import { handler as reservationsHandler } from "../netlify/functions/reservations.mjs";
import {
  passwordsMatch,
  signAdminToken,
  verifyAdminToken,
} from "../netlify/lib/admin-auth.mjs";
import { createMemoryStore } from "./memory-store.mjs";

const OLD_HASH =
  "3404217d72d0c7e6a1a21f95c3083eb2487ee55643f6482a5026e0bfe97d0e96";
const PASSWORD = "test-admin-pass";
const SLOT_A = "12:00–15:00";
const SLOT_B = "17:00–20:00";
const SECRET_NAME = "TajnoImeXYZ";
const SECRET_PHONE = "0619998877";

function futureDate(daysAhead = 30) {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Sarajevo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function pastDate() {
  return "2020-01-15";
}

function reservation(overrides = {}) {
  return {
    datum: futureDate(40),
    vrijeme: SLOT_A,
    paket: "Paket 1",
    ime: SECRET_NAME,
    telefon: SECRET_PHONE,
    source: "web",
    ...overrides,
  };
}

function event({ method = "GET", body, token, query }) {
  const headers = {};
  if (token) headers["x-admin-token"] = token;
  return {
    httpMethod: method,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
    queryStringParameters: query || null,
  };
}

async function callReservations(store, options) {
  const result = await reservationsHandler(event(options), { blobsStore: store });
  return { status: result.statusCode, body: JSON.parse(result.body || "{}") };
}

async function login(password) {
  const result = await loginHandler({
    httpMethod: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return { status: result.statusCode, body: JSON.parse(result.body || "{}") };
}

describe("reservations and admin auth", { concurrency: false }, () => {
  test("client and reservation function no longer contain the password hash", () => {
    const files = [
      "store.js",
      "admin.js",
      "script.js",
      "admin.html",
      "netlify/functions/reservations.mjs",
      "netlify/functions/admin-login.mjs",
    ];
    for (const file of files) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      assert.equal(text.includes(OLD_HASH), false, file);
      assert.equal(text.includes("ADMIN_PASS_HASH"), false, file);
    }
  });

  test("installed blobs client supports atomic onlyIfNew writes", () => {
    const source = readFileSync(
      new URL("../node_modules/@netlify/blobs/dist/main.js", import.meta.url),
      "utf8"
    );
    assert.match(source, /onlyIfNew/);
  });

  test("rejects a duplicate slot, including near-simultaneous requests", async () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    delete process.env.ADMIN_SECRET;
    const store = createMemoryStore();
    const datum = futureDate(40);
    const payload = reservation({ datum });

    const first = await callReservations(store, { method: "POST", body: payload });
    assert.equal(first.status, 201);

    const duplicate = await callReservations(store, {
      method: "POST",
      body: reservation({
        datum,
        paket: "Paket 2",
        ime: "Drugo Ime",
        telefon: "062000000",
      }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, "Ovaj termin je upravo zauzet. Odaberite drugi.");

    const otherSlot = await callReservations(store, {
      method: "POST",
      body: reservation({ datum, vrijeme: SLOT_B }),
    });
    assert.equal(otherSlot.status, 201);

    const raced = createMemoryStore();
    const originalList = raced.list.bind(raced);
    let listed = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    raced.list = async (options) => {
      listed += 1;
      if (listed <= 2) {
        if (listed === 2) release();
        await gate;
      }
      return originalList(options);
    };

    const raceDate = futureDate(50);
    const [left, right] = await Promise.all([
      callReservations(raced, { method: "POST", body: reservation({ datum: raceDate }) }),
      callReservations(raced, {
        method: "POST",
        body: reservation({ datum: raceDate, ime: "Drugi" }),
      }),
    ]);
    const statuses = [left.status, right.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    assert.equal(
      raced.keys().filter((key) => key.startsWith("item/")).length,
      1
    );
    assert.ok(
      raced.calls.some((call) => call.key.startsWith("slot/") && call.options.onlyIfNew === true)
    );
  });

  test("availability returns only date and slot, never personal data", async () => {
    const store = createMemoryStore();
    const datum = futureDate(40);
    const created = await callReservations(store, {
      method: "POST",
      body: reservation({ datum }),
    });
    assert.equal(created.status, 201);

    const cancelled = {
      id: "rez-cancelled",
      datum: futureDate(60),
      vrijeme: SLOT_A,
      paket: "Paket 1",
      ime: "SkrivenoIme",
      telefon: "064333444",
      status: "cancelled",
      createdAt: new Date().toISOString(),
    };
    await store.setJSON(`item/${cancelled.id}`, cancelled);

    const result = await callReservations(store, {
      method: "GET",
      query: { availability: "1" },
    });
    assert.equal(result.status, 200);
    const raw = JSON.stringify(result.body);
    assert.equal(raw.includes(SECRET_NAME), false);
    assert.equal(raw.includes(SECRET_PHONE), false);
    assert.equal(raw.includes("SkrivenoIme"), false);
    assert.equal(raw.includes("064333444"), false);
    assert.equal(result.body.items, undefined);
    for (const pair of result.body.taken) {
      assert.deepEqual(Object.keys(pair).sort(), ["datum", "vrijeme"]);
    }
    assert.equal(
      result.body.taken.some((pair) => pair.datum === datum && pair.vrijeme === SLOT_A),
      true
    );
    assert.equal(
      result.body.taken.some((pair) => pair.vrijeme === SLOT_B),
      false
    );
    assert.equal(
      result.body.taken.some((pair) => pair.datum === cancelled.datum),
      false
    );
  });

  test("a cancelled reservation does not block the slot", async () => {
    const store = createMemoryStore();
    const datum = futureDate(70);
    await store.setJSON("item/rez-old", {
      id: "rez-old",
      datum,
      vrijeme: SLOT_A,
      paket: "Paket 1",
      ime: "Staro",
      telefon: "065000000",
      status: "otkazano",
      createdAt: new Date().toISOString(),
    });
    await store.setJSON(`slot/${datum}/1200-1500`, {
      id: "rez-old",
      datum,
      vrijeme: SLOT_A,
      claimedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const result = await callReservations(store, {
      method: "POST",
      body: reservation({ datum }),
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
  });

  test("rejects past dates and invalid slot or package values", async () => {
    const store = createMemoryStore();
    const past = await callReservations(store, {
      method: "POST",
      body: reservation({ datum: pastDate() }),
    });
    assert.equal(past.status, 400);
    assert.match(past.body.error, /prošli datum/);

    const badDate = await callReservations(store, {
      method: "POST",
      body: reservation({ datum: "2026-02-31" }),
    });
    assert.equal(badDate.status, 400);

    const badSlot = await callReservations(store, {
      method: "POST",
      body: reservation({ vrijeme: "12:00-15:00" }),
    });
    assert.equal(badSlot.status, 400);
    assert.equal(badSlot.body.error, "Neispravan termin.");

    const badPackage = await callReservations(store, {
      method: "POST",
      body: reservation({ paket: "Paket 3" }),
    });
    assert.equal(badPackage.status, 400);
    assert.equal(badPackage.body.error, "Neispravan paket.");
    assert.equal(store.keys().filter((key) => key.startsWith("item/")).length, 0);
  });

  test("admin login accepts the right password, rejects the wrong one, and ignores the old hash", async () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    delete process.env.ADMIN_SECRET;

    const wrong = await login("pogresno");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.token, undefined);

    const right = await login(PASSWORD);
    assert.equal(right.status, 200);
    assert.equal(typeof right.body.token, "string");
    assert.equal(right.body.token.includes("."), true);
    const legacyHash = createHash("sha256").update(`paradiso::${PASSWORD}`).digest("hex");
    assert.notEqual(right.body.token, legacyHash);
    assert.notEqual(right.body.token, OLD_HASH);
    assert.equal(verifyAdminToken(right.body.token), true);

    const store = createMemoryStore();
    await callReservations(store, { method: "POST", body: reservation() });

    const anonymous = await callReservations(store, { method: "GET" });
    assert.equal(anonymous.status, 401);

    const withHash = await callReservations(store, { method: "GET", token: OLD_HASH });
    assert.equal(withHash.status, 401);

    const withLegacy = await callReservations(store, { method: "GET", token: legacyHash });
    assert.equal(withLegacy.status, 401);

    const expired = signAdminToken({ ttlMs: -1000 });
    const withExpired = await callReservations(store, { method: "GET", token: expired });
    assert.equal(withExpired.status, 401);

    const [body, sig] = right.body.token.split(".");
    const tampered = `${body}.${sig.slice(0, -1)}${sig.endsWith("a") ? "b" : "a"}`;
    const withTampered = await callReservations(store, { method: "GET", token: tampered });
    assert.equal(withTampered.status, 401);

    const allowed = await callReservations(store, {
      method: "GET",
      token: right.body.token,
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.items[0].ime, SECRET_NAME);
    assert.equal(allowed.body.items[0].telefon, SECRET_PHONE);

    const adminPost = await callReservations(store, {
      method: "POST",
      body: reservation({ vrijeme: SLOT_B, source: "admin" }),
    });
    assert.equal(adminPost.status, 401);

    const adminPostOk = await callReservations(store, {
      method: "POST",
      token: right.body.token,
      body: reservation({ vrijeme: SLOT_B, source: "admin", datum: futureDate(80) }),
    });
    assert.equal(adminPostOk.status, 201);

    const removed = await callReservations(store, {
      method: "DELETE",
      token: right.body.token,
      query: { id: allowed.body.items[0].id },
    });
    assert.equal(removed.status, 200);

    const rebook = await callReservations(store, {
      method: "POST",
      body: reservation(),
    });
    assert.equal(rebook.status, 201);

    delete process.env.ADMIN_PASSWORD;
    const unconfigured = await login(PASSWORD);
    assert.equal(unconfigured.status, 503);
    assert.equal(unconfigured.body.error, "Prijava trenutno nije podešena.");
    const afterUnset = await callReservations(store, {
      method: "GET",
      token: right.body.token,
    });
    assert.equal(afterUnset.status, 401);
  });

  test("password comparison matches exact values only", () => {
    assert.equal(passwordsMatch("tajna", "tajna"), true);
    assert.equal(passwordsMatch("tajna", "tajna "), false);
    assert.equal(passwordsMatch("", "tajna"), false);
    assert.equal(passwordsMatch("tajna", "TajnA"), false);
  });
});
