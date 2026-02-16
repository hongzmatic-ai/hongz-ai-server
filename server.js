/**
 * HONGZ AI SERVER — FINAL STABIL C (Enterprise)
 * - Twilio WhatsApp webhook
 * - Menu: JADWAL / TOWING
 * - Auto-priority towing system (enterprise)
 * - Proper handling WhatsApp location share (Latitude/Longitude OR maps link)
 * - Admin notification for towing + location
 *
 * Required ENV:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM          e.g. "whatsapp:+6285729651657" (Twilio WA sender)
 *   ADMIN_WHATSAPP_TO             e.g. "whatsapp:+6281375430728" (Hongz/admin)
 *
 * Optional ENV:
 *   OPENAI_API_KEY
 *   OPENAI_MODEL                  e.g. "gpt-4o-mini"
 *   OPENAI_TIMEOUT_MS             e.g. "9000"
 *
 *   BIZ_NAME
 *   BIZ_ADDRESS
 *   BIZ_HOURS
 *   MAPS_LINK
 *   WHATSAPP_ADMIN                public wa.me link (admin)
 *   WHATSAPP_CS                   public wa.me link (cs)
 *
 *   FOLLOWUP_ENABLED              "true"/"false"
 *   FOLLOWUP_HOURS                "18"
 *   FOLLOWUP_MAX_PER_CUSTOMER     "3"
 *   FOLLOWUP_COOLDOWN_HOURS       "36"
 *
 * Disk (Render persistent):
 *   DATA_DIR                       e.g. "/var/data"
 */

const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const twilio = require("twilio");

// OpenAI (optional)
let OpenAI;
try { OpenAI = require("openai"); } catch (_) { OpenAI = null; }

// -------------------- ENV & DEFAULTS --------------------
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  ADMIN_WHATSAPP_TO,

  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  OPENAI_TIMEOUT_MS = "9000",

  BIZ_NAME = "Hongz Bengkel – Spesialis Transmisi Matic",
  BIZ_ADDRESS = "Jl. M. Yakub No.10b, Medan Perjuangan",
  BIZ_HOURS = "Senin–Sabtu 09.00–17.00",
  MAPS_LINK = "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  WHATSAPP_ADMIN = "https://wa.me/6281375430728",
  WHATSAPP_CS = "https://wa.me/6285752965167",

  FOLLOWUP_ENABLED = "true",
  FOLLOWUP_HOURS = "18",
  FOLLOWUP_MAX_PER_CUSTOMER = "3",
  FOLLOWUP_COOLDOWN_HOURS = "36",

  DATA_DIR = "/var/data",
  DEBUG = "false",
  CRON_KEY = "",
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ADMIN_WHATSAPP_TO) {
  console.error("Missing required ENV. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ADMIN_WHATSAPP_TO");
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// -------------------- APP SETUP --------------------
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// -------------------- SIMPLE PERSISTENT STORE --------------------
function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}
ensureDir(DATA_DIR);

const DB_FILE = path.join(DATA_DIR, "hongz_db.json");

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return { customers: {}, events: [] };
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("DB save failed:", e.message);
  }
}

function nowISO() {
  return new Date().toISOString();
}

function hashPhone(phone) {
  return crypto.createHash("sha256").update(String(phone)).digest("hex").slice(0, 16);
}

// -------------------- UTIL: PARSE LOCATION --------------------
// Twilio WhatsApp may send Latitude/Longitude/Address/Label
function extractLocation(reqBody) {
  const lat = reqBody.Latitude || reqBody.latitude;
  const lng = reqBody.Longitude || reqBody.longitude;
  const label = reqBody.Label || reqBody.label;
  const address = reqBody.Address || reqBody.address;

  if (lat && lng) {
    return {
      type: "coords",
      lat: String(lat),
      lng: String(lng),
      label: label ? String(label) : "",
      address: address ? String(address) : "",
      mapsUrl: `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`
    };
  }

  // Fallback: look for a maps link inside Body
  const body = String(reqBody.Body || "").trim();
  const mapsLinkMatch = body.match(/https?:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)[^\s]+/i);
  if (mapsLinkMatch) {
    return {
      type: "link",
      mapsUrl: mapsLinkMatch[0],
      raw: body
    };
  }

  return null;
}

// -------------------- UTIL: NORMALIZE TEXT --------------------
function normText(s) {
  return String(s || "")
    .replace(/\u200b/g, "")
    .trim();
}

function isCommand(body, cmd) {
  const t = normText(body).toUpperCase();
  return t === cmd || t.startsWith(cmd + " ") || t.includes("\n" + cmd) || t.includes(" " + cmd + " ");
}

// -------------------- BUSINESS SIGNATURE (FINAL FORMAT) --------------------
function businessSignature() {
  return [
    `📍 ${BIZ_NAME}`,
    `${BIZ_ADDRESS}`,
    `🧭 ${MAPS_LINK}`,
    `⏱ ${BIZ_HOURS}`,
    ``,
    `📲 WhatsApp Admin:`,
    `${WHATSAPP_ADMIN}`,
    ``,
    `💬 WhatsApp CS:`,
    `${WHATSAPP_CS}`,
    ``,
    `Ketik:`,
    `*JADWAL* untuk booking pemeriksaan`,
    `*TOWING* bila unit tidak bisa berjalan`,
  ].join("\n");
}

// Auto-confidence line (requested)
function confidenceLine() {
  return `✅ Tenang ya, kami bantu sampai jelas langkahnya.`;
}

// -------------------- ENTERPRISE: PRIORITY TOWING FLOW --------------------
function towingInstruction(location) {
  const parts = [];
  parts.push(`Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan untuk mencegah kerusakan melebar.`);
  parts.push(`Ketik *TOWING* lalu kirim *share lokasi* Anda — kami bantu arahkan evakuasi ke workshop.`);
  if (location?.mapsUrl) parts.push(`📍 Lokasi terdeteksi: ${location.mapsUrl}`);
  parts.push(confidenceLine());
  parts.push("");
  parts.push(businessSignature());
  return parts.join("\n");
}

async function notifyAdminTowing({ from, body, location, reason }) {
  // “Enterprise” notify to admin with structured info
  const msg = [
    `🚨 *PRIORITY TOWING (AUTO)*`,
    `Dari: ${from}`,
    `Alasan: ${reason || "-"}`,
    location?.mapsUrl ? `Lokasi: ${location.mapsUrl}` : `Lokasi: (belum ada)`,
    body ? `Pesan: ${body}` : ``,
    ``,
    `Aksi cepat: balas customer ini atau hubungi untuk towing.`,
  ].filter(Boolean).join("\n");

  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: ADMIN_WHATSAPP_TO,
      body: msg,
    });
  } catch (e) {
    console.error("Admin notify failed:", e.message);
  }
}

// -------------------- AI REPLY (OPTIONAL) --------------------
async function aiReply(userText) {
  if (!OPENAI_API_KEY || !OpenAI) return null;

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  const system = `
Anda adalah Customer Service bengkel transmisi matic "Hongz Bengkel".
Bahasa: Indonesia sopan, ringkas, membantu.
Aturan penting:
- Jika pelanggan menyebut mobil tidak bisa jalan, mogok, stuck, atau berbahaya → arahkan TOWING (jangan paksa jalan).
- Jika pelanggan mengirim lokasi (maps link atau koordinat) → akui lokasi diterima dan beritahu admin akan diarahkan towing.
- Jangan sebut internal sistem / token.
- Tutup pesan dengan signature bisnis yang sudah disediakan jika perlu.
`;

  try {
    const resp = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: system.trim() },
        { role: "user", content: userText },
      ],
      temperature: 0.4,
      timeout: Number(OPENAI_TIMEOUT_MS) || 9000,
    });

    const text = resp?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    console.error("OpenAI failed:", e.message);
    return null;
  }
}

// -------------------- MAIN WEBHOOK --------------------
app.post("/twilio/webhook", async (req, res) => {
  const db = loadDB();

  const from = req.body.From || "";
  const to = req.body.To || "";
  const body = normText(req.body.Body || "");
  const location = extractLocation(req.body);

  const customerId = hashPhone(from);
  if (!db.customers[customerId]) {
    db.customers[customerId] = {
      from,
      firstSeen: nowISO(),
      lastSeen: nowISO(),
      towingCount: 0,
      followupCount: 0,
      lastFollowupAt: null,
      lastTowingAt: null,
    };
  } else {
    db.customers[customerId].lastSeen = nowISO();
  }

  // Log event
  db.events.push({
    t: nowISO(),
    from,
    to,
    body,
    hasLocation: !!location,
    location,
  });

  // -------------------- ENTERPRISE RULES --------------------
  const upper = body.toUpperCase();

  const mentionsCantDrive =
    /tidak bisa jalan|ga bisa jalan|gak bisa jalan|mogok|stuck|macet total|seret|ngunci|berisiko|darurat/i.test(body);

  const cmdTowing = isCommand(body, "TOWING");
  const cmdJadwal = isCommand(body, "JADWAL");

  // 1) If user sent location at any time -> treat as towing-priority followup (admin notify)
  if (location) {
    db.customers[customerId].towingCount += 1;
    db.customers[customerId].lastTowingAt = nowISO();
    saveDB(db);

    await notifyAdminTowing({
      from,
      body,
      location,
      reason: "Customer shared location",
    });

    // Reply to customer (NOT NGAWUR): acknowledge + next step
    const reply = [
      `Baik, lokasi sudah kami terima ✅`,
      `Kami akan bantu arahkan evakuasi / towing bila unit tidak aman untuk dijalankan.`,
      ``,
      `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.`,
      `Ketik *TOWING* (jika belum) — tim kami akan follow up.`,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");

    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // 2) Explicit TOWING command -> priority + ask for location + admin notify (without location yet)
  if (cmdTowing || mentionsCantDrive) {
    db.customers[customerId].towingCount += 1;
    db.customers[customerId].lastTowingAt = nowISO();
    saveDB(db);

    await notifyAdminTowing({
      from,
      body,
      location: null,
      reason: cmdTowing ? "Customer typed TOWING" : "Customer mentions can't drive / risk",
    });

    const reply = towingInstruction(null);
    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // 3) JADWAL command -> booking flow (keep simple)
  if (cmdJadwal) {
    saveDB(db);
    const reply = [
      `Siap, untuk *booking pemeriksaan*, mohon kirim data singkat:`,
      `1) Nama`,
      `2) Mobil & tahun`,
      `3) Keluhan utama (contoh: "rpm tinggi", "jedug pindah gigi", "selip")`,
      `4) Rencana datang (hari & jam)`,
      ``,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");

    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // 4) Otherwise: AI (optional). If no OpenAI, use a safe default template.
  let reply = null;

  const ai = await aiReply(body);
  if (ai) {
    reply = [
      ai,
      ``,
      `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.`,
      `Ketik *TOWING* lalu kirim *share lokasi* bila perlu.`,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");
  } else {
    reply = [
      `Baik, untuk memastikan sumber masalahnya akurat, boleh info:`,
      `- Keluhan muncul saat dingin atau saat panas/macet?`,
      `- Ada kebocoran oli / suara aneh?`,
      `- Kapan terakhir ganti oli transmisi?`,
      ``,
      `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.`,
      `Ketik *TOWING* lalu kirim *share lokasi* bila perlu.`,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");
  }

  saveDB(db);
  res.type("text/xml");
  return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
});

// -------------------- HEALTH CHECK --------------------
app.get("/", (_req, res) => {
  res.status(200).send("HONGZ AI SERVER — OK");
});

// -------------------- CRON (optional) --------------------
app.post("/cron/followup", (req, res) => {
  // simple auth
  if (CRON_KEY && req.query.key !== CRON_KEY) {
    return res.status(403).send("Forbidden");
  }
  if (FOLLOWUP_ENABLED !== "true") {
    return res.status(200).send("Followup disabled");
  }
  // (Keeping followup minimal & safe; can be expanded later)
  return res.status(200).send("Followup cron acknowledged");
});

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// -------------------- START --------------------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("HONGZ AI SERVER — FINAL STABIL C — START");
  console.log("Listening on port:", port);
});
