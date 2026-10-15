import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { describe, test } from "node:test";
import { handler as loginHandler } from "../netlify/functions/admin-login.mjs";
import { handler as reservationsHandler } from "../netlify/functions/reservations.mjs";
import { createMemoryStore } from "./memory-store.mjs";

const ROOT = join(import.meta.dirname, "..");
const SLOT_A = "12:00–15:00";
const SLOT_B = "17:00–20:00";
const PASSWORD = "test-admin-pass";
const OLD_HASH =
  "3404217d72d0c7e6a1a21f95c3083eb2487ee55643f6482a5026e0bfe97d0e96";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function futureDate(daysAhead = 40) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startSite(store) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname === "/api/reservations" || url.pathname === "/api/admin-login") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const event = {
          httpMethod: req.method || "GET",
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
          queryStringParameters: Object.fromEntries(url.searchParams.entries()),
        };
        const result =
          url.pathname === "/api/admin-login"
            ? await loginHandler(event)
            : await reservationsHandler(event, { blobsStore: store });
        res.writeHead(result.statusCode || 500, result.headers || {});
        res.end(result.body || "");
        return;
      }

      const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const filePath = normalize(join(ROOT, requested));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, {
        "content-type": TYPES[extname(filePath)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(data);
    } catch (error) {
      res.writeHead(error && error.code === "ENOENT" ? 404 : 500);
      res.end(error && error.code === "ENOENT" ? "not found" : "error");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (error) => reject(error));
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) listener(message.params || {});
    }
  });

  return {
    ready,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method) {
      return new Promise((resolve) => {
        const list = listeners.get(method) || [];
        const listener = (params) => {
          listeners.set(
            method,
            (listeners.get(method) || []).filter((item) => item !== listener)
          );
          resolve(params);
        };
        list.push(listener);
        listeners.set(method, list);
      });
    },
    close() {
      ws.close();
    },
  };
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function launchChrome() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const userDataDir = `/tmp/chrome-paradiso-${port}`;
  const logs = [];
  const chrome = spawn(
    "/usr/local/bin/google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--disable-extensions",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  chrome.stdout.on("data", (chunk) => logs.push(String(chunk)));
  chrome.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const browser = openCdp(version.webSocketDebuggerUrl);
  await browser.ready;
  const target = await browser.send("Target.createTarget", { url: "about:blank" });
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const page = pages.find((entry) => entry.id === target.targetId) || pages.find((entry) => entry.type === "page");
  const cdp = openCdp(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  async function navigate(url) {
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url });
    await Promise.race([
      loaded,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`load timeout ${url}`)), 8000)),
    ]);
  }

  async function evaluate(expression) {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails.exception || result.exceptionDetails));
    }
    return result.result?.value;
  }

  return {
    chrome,
    logs,
    navigate,
    evaluate,
    async close() {
      cdp.close();
      browser.close();
      chrome.kill();
    },
  };
}

describe("booking and admin pages", { concurrency: false, timeout: 60000 }, () => {
  test("marks taken slots unavailable and shows the conflict message", async () => {
    delete process.env.ADMIN_SECRET;
    delete process.env.ADMIN_PASSWORD;
    const store = createMemoryStore();
    const site = await startSite(store);
    const datum = futureDate(45);
    const seeded = await fetch(`${site.origin}/api/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        datum,
        vrijeme: SLOT_A,
        paket: "Paket 1",
        ime: "TajnoImeXYZ",
        telefon: "0619998877",
      }),
    });
    assert.equal(seeded.status, 201);

    const browser = await launchChrome();
    try {
      await browser.navigate(`${site.origin}/rezervisi-proslavu.html`);
      const fetched = await browser.evaluate(`(async () => {
        const started = Date.now();
        while (Date.now() - started < 4000) {
          const names = performance.getEntriesByType("resource").map((entry) => entry.name);
          if (names.some((name) => name.includes("availability=1"))) return true;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        return false;
      })()`);
      assert.equal(fetched, true);

      const selected = await browser.evaluate(`(async () => {
        const iso = ${JSON.stringify(datum)};
        const [year, month, day] = iso.split("-").map(Number);
        const monthNames = ["Januar","Februar","Mart","April","Maj","Juni","Juli","August","Septembar","Oktobar","Novembar","Decembar"];
        const label = document.getElementById("cal-month");
        for (let step = 0; step < 36; step += 1) {
          const [name, yearText] = label.textContent.trim().split(/\\s+/);
          const viewMonth = monthNames.indexOf(name);
          const viewYear = Number(yearText);
          if (viewYear === year && viewMonth === month - 1) break;
          const forward = viewYear < year || (viewYear === year && viewMonth < month - 1);
          document.getElementById(forward ? "cal-next" : "cal-prev").click();
        }
        const button = [...document.querySelectorAll(".calendar__day")].find((element) =>
          element.textContent === String(day) && !element.classList.contains("is-empty") && !element.disabled
        );
        if (!button) return { ok: false, label: label.textContent };
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 400));
        return {
          ok: true,
          date: document.getElementById("booking-date").value,
          slots: [...document.querySelectorAll('input[name="vrijeme"]')].map((input) => {
            const label = input.closest("label");
            return {
              value: input.value,
              disabled: input.disabled,
              cursor: getComputedStyle(label).cursor,
              color: getComputedStyle(label.querySelector("span")).color,
              border: getComputedStyle(label).borderTopColor,
            };
          }),
        };
      })()`);
      assert.equal(selected.ok, true, JSON.stringify(selected));
      assert.equal(selected.date, datum);
      const taken = selected.slots.find((slot) => slot.value === SLOT_A);
      const open = selected.slots.find((slot) => slot.value === SLOT_B);
      assert.equal(taken.disabled, true);
      assert.equal(open.disabled, false);
      assert.equal(taken.cursor, "not-allowed");
      assert.equal(taken.color, "rgb(197, 192, 182)");
      assert.equal(open.color, "rgb(26, 26, 26)");
      assert.equal(taken.border, "rgb(197, 192, 182)");

      await browser.evaluate(`(() => {
        const input = [...document.querySelectorAll('input[name="vrijeme"]')].find((item) => item.value === ${JSON.stringify(SLOT_B)});
        input.checked = true;
        document.getElementById("booking-name").value = "Ana Anic";
        document.getElementById("booking-phone").value = "061222333";
        document.querySelector('input[name="paket"]').checked = true;
      })()`);

      const conflict = await fetch(`${site.origin}/api/reservations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          datum,
          vrijeme: SLOT_B,
          paket: "Paket 2",
          ime: "DrugaOsobe",
          telefon: "062444555",
        }),
      });
      assert.equal(conflict.status, 201);

      const submitted = await browser.evaluate(`(async () => {
        document.getElementById("booking-form").requestSubmit();
        const started = Date.now();
        while (Date.now() - started < 4000) {
          const error = document.getElementById("booking-error");
          if (error && !error.hidden && error.textContent) {
            const afternoon = [...document.querySelectorAll('input[name="vrijeme"]')].find((item) => item.value === ${JSON.stringify(SLOT_B)});
            return {
              message: error.textContent,
              formHidden: document.getElementById("booking-form").hidden,
              afternoonDisabled: afternoon.disabled,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        return { message: document.getElementById("booking-error").textContent, timedOut: true };
      })()`);
      assert.equal(submitted.message, "Ovaj termin je upravo zauzet. Odaberite drugi.");
      assert.equal(submitted.formHidden, false);
      assert.equal(submitted.afternoonDisabled, true);

      await browser.navigate(`${site.origin}/admin.html`);
      const unconfigured = await browser.evaluate(`(async () => {
        document.getElementById("admin-password").value = "bilo-sta";
        document.getElementById("login-form").requestSubmit();
        const started = Date.now();
        while (Date.now() - started < 4000) {
          const error = document.getElementById("login-error");
          if (error && !error.hidden) {
            return {
              message: error.textContent,
              panelHidden: document.getElementById("admin-panel").hidden,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        return { timedOut: true };
      })()`);
      assert.equal(unconfigured.message, "Prijava trenutno nije podešena.");
      assert.equal(unconfigured.panelHidden, true);

      process.env.ADMIN_PASSWORD = PASSWORD;
      const wrong = await browser.evaluate(`(async () => {
        document.getElementById("admin-password").value = "netacno";
        document.getElementById("login-form").requestSubmit();
        const started = Date.now();
        while (Date.now() - started < 4000) {
          const error = document.getElementById("login-error");
          if (error && !error.hidden && error.textContent === "Pogrešna šifra.") {
            return { message: error.textContent, panelHidden: document.getElementById("admin-panel").hidden };
          }
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        return { message: document.getElementById("login-error").textContent, timedOut: true };
      })()`);
      assert.equal(wrong.message, "Pogrešna šifra.");
      assert.equal(wrong.panelHidden, true);

      const right = await browser.evaluate(`(async () => {
        document.getElementById("admin-password").value = ${JSON.stringify(PASSWORD)};
        document.getElementById("login-form").requestSubmit();
        const started = Date.now();
        while (Date.now() - started < 4000) {
          const panel = document.getElementById("admin-panel");
          if (panel && !panel.hidden) {
            const token = sessionStorage.getItem("paradiso_admin_token_v3") || "";
            const denied = await fetch("/api/reservations", { headers: { "X-Admin-Token": ${JSON.stringify(OLD_HASH)} } });
            const allowed = await fetch("/api/reservations", { headers: { "X-Admin-Token": token } });
            return {
              panelHidden: panel.hidden,
              tokenHasDot: token.includes("."),
              tokenIsHash: token === ${JSON.stringify(OLD_HASH)},
              oldStatus: denied.status,
              newStatus: allowed.status,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        return { timedOut: true, error: document.getElementById("login-error").textContent };
      })()`);
      assert.equal(right.panelHidden, false);
      assert.equal(right.tokenHasDot, true);
      assert.equal(right.tokenIsHash, false);
      assert.equal(right.oldStatus, 401);
      assert.equal(right.newStatus, 200);
    } finally {
      await browser.close();
      await new Promise((resolve) => site.server.close(resolve));
      delete process.env.ADMIN_PASSWORD;
    }
  });
});
