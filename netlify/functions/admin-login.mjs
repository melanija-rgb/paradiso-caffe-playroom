import {
  UNCONFIGURED_MESSAGE,
  isAdminPasswordConfigured,
  passwordsMatch,
  signAdminToken,
  TOKEN_TTL_MS,
} from "../lib/admin-auth.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function unconfigured() {
  return json(503, { error: UNCONFIGURED_MESSAGE, code: "unconfigured" });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metoda nije dozvoljena." });
  }

  if (!isAdminPasswordConfigured()) return unconfigured();

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Neispravan JSON." });
  }

  const password = typeof payload.password === "string" ? payload.password : "";
  if (!passwordsMatch(password, process.env.ADMIN_PASSWORD)) {
    return json(401, { error: "Pogrešna šifra." });
  }

  const token = signAdminToken();
  if (!token) return unconfigured();

  return json(200, { token, expiresIn: TOKEN_TTL_MS });
}
