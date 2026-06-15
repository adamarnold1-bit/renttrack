import { createSign, randomUUID } from "node:crypto";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// --- Auth ---

async function getAccessToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY env var not set");
  const creds = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body   = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${header}.${body}`;
  const sign = createSign("RSA-SHA256");
  sign.write(unsigned);
  sign.end();
  const sig = sign.sign(creds.private_key, "base64url");
  const jwt = `${unsigned}.${sig}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const json = await r.json();
  if (json.error) throw new Error(`Auth error: ${json.error} — ${json.error_description}`);
  return json.access_token;
}

// --- Sheets helpers ---

async function sheetsGet(range, token) {
  const r = await fetch(`${BASE}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.json();
}

async function sheetsClear(range, token) {
  await fetch(`${BASE}/values/${encodeURIComponent(range)}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

async function sheetsUpdate(range, values, token) {
  await fetch(`${BASE}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
}

async function ensureSheet(entity, token) {
  const meta = await fetch(BASE, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  const exists = (meta.sheets || []).some(s => s.properties.title === entity);
  if (!exists) {
    await fetch(`${BASE}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: entity } } }] }),
    });
  }
}

// --- Data layer ---

async function load(entity, token) {
  try {
    const res = await sheetsGet(`${entity}!A:B`, token);
    const rows = res.values || [];
    if (rows.length <= 1) return [];
    return rows.slice(1)
      .map(r => { try { return JSON.parse(r[1] || "{}"); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function save(entity, items, token) {
  await ensureSheet(entity, token);
  await sheetsClear(`${entity}!A:B`, token);
  const values = [["id", "data"], ...items.map(i => [i.id, JSON.stringify(i)])];
  await sheetsUpdate(`${entity}!A1`, values, token);
}

function readBody(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

// --- Handler ---

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const url    = new URL(req.url, `http://${req.headers.host}`);
  const entity = url.searchParams.get("entity");
  const id     = url.searchParams.get("id");

  try {
    const token = await getAccessToken();

    if (req.method === "GET") {
      if (entity === "all") {
        const [properties, renters, payments, allocations, bills] = await Promise.all(
          ["properties", "renters", "payments", "allocations", "bills"].map(e => load(e, token))
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ properties, renters, payments, allocations, bills }));
      } else if (entity) {
        const items = await load(entity, token);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(items));
      } else {
        res.writeHead(400); res.end("Missing entity");
      }
      return;
    }

    const data = await readBody(req);

    if (req.method === "POST") {
      const items = await load(entity, token);
      const item  = { id: randomUUID(), ...data, createdAt: new Date().toISOString() };
      items.push(item);
      await save(entity, items, token);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(item));
    } else if (req.method === "PUT") {
      const items = await load(entity, token);
      const idx   = items.findIndex(i => i.id === id);
      if (idx === -1) { res.writeHead(404); res.end("Not found"); return; }
      items[idx] = { ...items[idx], ...data, updatedAt: new Date().toISOString() };
      await save(entity, items, token);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(items[idx]));
    } else if (req.method === "DELETE") {
      const items = (await load(entity, token)).filter(i => i.id !== id);
      await save(entity, items, token);
      res.writeHead(204); res.end();
    } else {
      res.writeHead(405); res.end("Method not allowed");
    }
  } catch (err) {
    console.error("[RentTrack API Error]", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}
