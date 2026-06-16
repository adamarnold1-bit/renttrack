// api/upload-bill.js — Upload a bill PDF to Google Drive, return shareable link
import { createSign } from "node:crypto";

const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";
const DRIVE_FILES  = "https://www.googleapis.com/drive/v3/files";
const DRIVE_SCOPE  = "https://www.googleapis.com/auth/drive.file";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function makeJwt(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: DRIVE_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const sig = signer.sign(sa.private_key, "base64url");
  return `${unsigned}.${sig}`;
}

async function getDriveToken() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not set");
  const sa = JSON.parse(keyJson);
  const jwt = makeJwt(sa);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || "Failed to get Drive token");
  return data.access_token;
}

async function getOrCreateFolder(token) {
  const folderName = "RentTrack Bills";
  const q = encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const search = await fetch(`${DRIVE_FILES}?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());

  if (search.files && search.files.length > 0) return search.files[0].id;

  const created = await fetch(DRIVE_FILES, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }),
  }).then(r => r.json());
  return created.id;
}

function readBody(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") { res.writeHead(405); res.end("Method not allowed"); return; }

  try {
    const { filename, mimeType = "application/pdf", data: base64Data } = await readBody(req);
    if (!filename || !base64Data) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "filename and data required" }));
      return;
    }

    const token    = await getDriveToken();
    const folderId = await getOrCreateFolder(token);
    const fileBuffer = Buffer.from(base64Data, "base64");

    const boundary = "rt_bill_boundary";
    const meta = JSON.stringify({ name: filename, parents: [folderId] });
    const part1 = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`, "utf-8");
    const part2 = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, "utf-8");
    const part3 = Buffer.from(`\r\n--${boundary}--`, "utf-8");
    const body  = Buffer.concat([part1, part2, fileBuffer, part3]);

    const uploadRes = await fetch(DRIVE_UPLOAD, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    });

    const uploaded = await uploadRes.json();
    if (!uploaded.id) throw new Error(uploaded.error?.message || "Drive upload failed — ensure Drive API is enabled in GCP");

    // Make readable by anyone with the link
    await fetch(`${DRIVE_FILES}/${uploaded.id}/permissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: uploaded.webViewLink, fileId: uploaded.id }));
  } catch (err) {
    console.error("[Upload Bill Error]", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}
