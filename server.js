/**
 * HONGZ AI SERVER — FINAL A-B-C (One-File) v1.0
 * A) Dual webhook routes: /twilio/webhook AND /whatsapp/incoming
 * B) Admin gets: customer number + wa.me link + location link (if any) + booking notify
 * C) Anti-hallucination address: AI forbidden to invent address; only MAPS_LINK allowed
 *
 * Required ENV:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM      e.g. "whatsapp:+6285729651657"
 *   ADMIN_WHATSAPP_TO         e.g. "whatsapp:+6281375430728"
 *
 * Optional ENV:
 *   OPENAI_API_KEY
 *   OPENAI_MODEL             default "gpt-4o-mini"
 *   OPENAI_TIMEOUT_MS        default "9000"
 *
 * Branding ENV (optional):
 *   BIZ_NAME, BIZ_ADDRESS, BIZ_HOURS, MAPS_LINK
 *   WHATSAPP_ADMIN, WHATSAPP_CS  (public wa.me links)
 *
 * Storage (optional, Render persistent disk):
 *   DATA_DIR                 default "/var/data"
 *
 * Debug:
 *   DEBUG="true"
 */

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// OpenAI optional
let OpenAI;
try { OpenAI = require("openai"); } catch (_) { OpenAI = null; }

// -------------------- ENV --------------------
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM, // "whatsapp:+62..."
  ADMIN_WHATSAPP_TO,    // "whatsapp:+62..."

  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  OPENAI_TIMEOUT_MS = "9000",

  BIZ_NAME = "Hongz Bengkel – Spesialis Transmisi Matic",
  BIZ_ADDRESS = "Jl. M. Yakub No.10b, Medan Perjuangan",
  BIZ_HOURS = "Senin–Sabtu 09.00–17.00",
  MAPS_LINK = "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  WHATSAPP_ADMIN = "https://wa.me/6281375430728",
  WHATSAPP_CS = "https://wa.me/6285752965167",

  DATA_DIR = "/var/data",
  DEBUG = "false",
} = process.env;

const IS_DEBUG = String(DEBUG).toLowerCase() === "true";
function dlog(...args) { if (IS_DEBUG) console.log("[HONGZ]", ...args); }

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ADMIN_WHATSAPP_TO) {
  console.error("Missing required ENV: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ADMIN_WHATSAPP_TO");
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// -------------------- APP --------------------
const app = express();
app.use(bodyParser.urlencoded({ extended: false })); // Twilio sends x-www-form-urlencoded
app.use(bodyParser.json());

// -------------------- STORAGE --------------------
function ensureDir(dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {} }
ensureDir(DATA_DIR);

const DB_FILE = path.join(DATA_DIR, "hongz_db.json");

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (_) { return { customers: {}, events: [] }; }
}

function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8"); }
  catch (e) { console.error("DB save failed:", e.message); }
}

function nowISO() { return new Date().toISOString(); }
function hashPhone(phone) {
  return crypto.createHash("sha256").update(String(phone)).digest("hex").slice(0, 16);
}

// -------------------- HELPERS --------------------
function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normText(s) {
  return String(s || "").replace(/\u200b/g, "").trim();
}

function isCommand(body, cmd) {
  const t = normText(body).toUpperCase();
  const c = String(cmd).toUpperCase();
  return t === c || t.startsWith(c + " ") || t.includes("\n" + c) || t.includes(" " + c + " ");
}

function cleanMsisdn(from) {
  // from like "whatsapp:+628123..."
  return String(from || "").replace("whatsapp:+", "").replace(/[^\d]/g, "");
}

function toWaMe(from) {
  const n = cleanMsisdn(from);
  return n ? `https://wa.me/${n}` : "-";
}

// -------------------- LOCATION PARSER --------------------
// Twilio WhatsApp may send Latitude/Longitude/Label/Address
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

  // fallback: detect maps link inside message body
  const body = String(reqBody.Body || "").trim();
  const mapsLinkMatch = body.match(/https?:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)[^\s]+/i);
  if (mapsLinkMatch) {
    return { type: "link", mapsUrl: mapsLinkMatch[0], raw: body };
  }
  return null;
}

// -------------------- BUSINESS SIGNATURE (MATURE) --------------------
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

function confidenceLine() {
  return `✅ Tenang ya, kami bantu sampai jelas langkahnya.`;
}

// -------------------- PRIORITY TAG (for admin) --------------------
function isPremiumText(text = "") {
  const t = String(text).toLowerCase();
  return /land cruiser|alphard|vellfire|lexus|bmw|mercedes|benz|audi|porsche|range rover|land rover|prado|lc200|lc300/.test(t);
}

function isUrgentText(text = "") {
  const t = String(text).toLowerCase();
  return /tidak bisa jalan|gak bisa jalan|ga bisa jalan|mogok|stuck|overheat|panas.*tidak bisa|masuk d.*tidak jalan|masuk r.*tidak jalan|rpm naik tapi tidak jalan|selip parah|berbahaya|darurat/i.test(t);
}

function buildPriorityTag(body = "") {
  const premium = isPremiumText(body);
  const urgent = isUrgentText(body);
  if (urgent && premium) return "🚨 PRIORITY+ (URGENT + PREMIUM)";
  if (urgent) return "🚨 PRIORITY (URGENT)";
  if (premium) return "⭐ PRIORITY (PREMIUM)";
  return "NORMAL";
}

// -------------------- EXTRACT BOOKING DETAILS (light) --------------------
function extractBookingDetails(text = "") {
  const t = String(text || "").replace(/\r/g, "").trim();
  // Very light heuristic parsing (safe)
  // User usually sends: Nama / Mobil Tahun / Gejala / Hari Jam
  const lines = t.split("\n").map(s => s.trim()).filter(Boolean);

  let name = "";
  let car = "";
  let year = "";
  let symptom = "";
  let when = "";

  const joined = lines.join(" | ");

  // Find year
  const yearMatch = joined.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) year = yearMatch[0];

  // Guess name: first segment if contains no car keywords
  if (lines.length >= 1) {
    // if first line short, treat as name
    if (lines[0].length <= 30 && !/mobil|matic|cvt|rpm|gigi|transmisi/i.test(lines[0])) name = lines[0];
  }

  // Guess car from keywords “mobil …”
  const carMatch = joined.match(/(innova|avanza|xenia|ertiga|brio|jazz|hrv|crv|civic|fortuner|pajero|alphard|vellfire|land cruiser|x-trail|terios|rush|ayla|sigra|calya|agya|camry|corolla|yaris|mobil\s+[a-z0-9\- ]{2,30})/i);
  if (carMatch) car = carMatch[0].replace(/^mobil\s+/i, "").trim();

  // Symptom: pick segment with rpm/jedug/selip/telat/no move
  const symMatch = joined.match(/(rpm tinggi[^|]{0,60}|jedug[^|]{0,60}|selip[^|]{0,60}|telat masuk[^|]{0,60}|tidak bisa jalan[^|]{0,60}|mogok[^|]{0,60})/i);
  if (symMatch) symptom = symMatch[0].trim();

  // When: detect day/time words
  const whenMatch = joined.match(/(hari ini|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu)[^|]{0,50}/i);
  if (whenMatch) when = whenMatch[0].trim();

  return { name, car, year, symptom, when, raw: t };
}

function adminReplyTemplate(details, priorityTag) {
  const carLine = `${details.car || "Mobil"} ${details.year || ""}`.trim();
  const whenLine = details.when ? `Rencana datang: ${details.when}` : `Rencana datang: (mohon info hari & jam)`;

  const urgentLine =
    String(priorityTag).includes("URGENT")
      ? "Karena ada indikasi risiko, mohon jangan dipaksakan jalan. Jika perlu, kami bisa bantu arahkan towing."
      : "Kami arahkan langkah pemeriksaan paling efisien supaya cepat ketemu akar masalah.";

  return [
    "Halo, saya Admin Hongz 👋",
    "Terima kasih, kami sudah terima info Anda.",
    "",
    `Unit: ${carLine}`,
    `Keluhan: ${details.symptom || "-"}`,
    whenLine,
    "",
    urgentLine,
    "",
    "Boleh jawab singkat 2 hal ini ya:",
    "1) Gejala muncul saat dingin atau saat panas/macet?",
    "2) Ada jedug/selip atau indikator lampu menyala?",
    "",
    "Jika unit tidak bisa jalan, ketik TOWING dan share lokasi.",
  ].join("\n");
}

// -------------------- ADMIN NOTIFY (TOWING + JADWAL) --------------------
async function notifyAdminTowing({ from, body, location, reason }) {
  const customerLink = toWaMe(from);
  const msg = [
    `🚨 *PRIORITY TOWING (AUTO)*`,
    `Customer: ${from}`,
    `Chat customer: ${customerLink}`,
    `Status: ${buildPriorityTag(body)}`,
    `Alasan: ${reason || "-"}`,
    location?.mapsUrl ? `Lokasi: ${location.mapsUrl}` : `Lokasi: (belum ada)`,
    body ? `Pesan: ${body}` : ``,
    ``,
    `Aksi: klik wa.me untuk follow up customer.`,
  ].filter(Boolean).join("\n");

  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: ADMIN_WHATSAPP_TO,
      body: msg,
    });
  } catch (e) {
    console.error("Admin notify towing failed:", e.message);
  }
}

async function notifyAdminJadwal({ from, body, lastLocation }) {
  const customerLink = toWaMe(from);
  const details = extractBookingDetails(body);
  const priority = buildPriorityTag(body);
  const template = adminReplyTemplate(details, priority);

  const msg = [
    `📅 *BOOKING JADWAL (AUTO)*`,
    `Status: ${priority}`,
    `Customer: ${from}`,
    `Chat customer: ${customerLink}`,
    lastLocation?.mapsUrl ? `Lokasi terakhir: ${lastLocation.mapsUrl}` : `Lokasi terakhir: (belum ada)`,
    ``,
    `Ringkas:`,
    `- Nama: ${details.name || "-"}`,
    `- Mobil: ${(`${details.car || "-"}` + (details.year ? ` ${details.year}` : "")).trim()}`,
    `- Gejala: ${details.symptom || "-"}`,
    `- Rencana datang: ${details.when || "-"}`,
    ``,
    `Template balasan Admin (copy-paste):`,
    `--------------------`,
    template,
    `--------------------`,
    ``,
    `Pesan asli:`,
    `${details.raw}`,
  ].join("\n");

  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: ADMIN_WHATSAPP_TO,
      body: msg,
    });
  } catch (e) {
    console.error("Admin notify jadwal failed:", e.message);
  }
}

// -------------------- AI REPLY (OPTIONAL) --------------------
function looksLikeAddress(text = "") {
  const low = String(text).toLowerCase();
  return (
    low.includes("alamat") ||
    low.includes("jl") ||
    low.includes("jalan") ||
    low.includes("no.") ||
    low.includes("nomor")
  );
}

async function aiReply(userText) {
  if (!OPENAI_API_KEY || !OpenAI) return null;

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const timeoutMs = Number(OPENAI_TIMEOUT_MS) || 9000;

  // C) Anti hallucination: NEVER invent address; ONLY MAPS_LINK allowed
  const system = `
Anda adalah CS bengkel transmisi matic: ${BIZ_NAME} (Medan).
Bahasa: Indonesia sopan, ringkas, membantu.

ATURAN KERAS:
- DILARANG membuat/mengarang alamat apa pun (jangan menulis "Jl", "Jalan", "No", "Nomor", atau alamat).
- Jika pelanggan tanya alamat/lokasi: jawab hanya dengan link ini: ${MAPS_LINK}
- Jika pelanggan menyebut tidak bisa jalan/mogok/berisiko: arahkan TOWING (jangan dipaksakan).
- Maksimal 2 pertanyaan.
- Jangan menyebut token/internal/sistem.

FORMAT:
- 1 paragraf analisa singkat (tidak menakutkan).
- Lalu langkah aman berikutnya.
`.trim();

  try {
    const resp = await Promise.race([
      client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText },
        ],
        temperature: 0.35,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("OPENAI_TIMEOUT")), timeoutMs)),
    ]);

    const text = resp?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    // Hard sanitize: if AI outputs address-like words -> replace with MAPS_LINK only
    if (looksLikeAddress(text)) {
      return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
    }

    // Safety cap
    if (text.length > 900) return text.slice(0, 900).trim();
    return text;
  } catch (e) {
    console.error("OpenAI failed:", e.message);
    return null;
  }
}

// -------------------- MAIN WEBHOOK HANDLER --------------------
async function webhookHandler(req, res) {
  const db = loadDB();

  const from = req.body.From || "";
  const to = req.body.To || "";
  const body = normText(req.body.Body || "");
  const location = extractLocation(req.body);

  dlog("Incoming", { from, to, body, hasLocation: !!location });

  const customerId = hashPhone(from);
  if (!db.customers[customerId]) {
    db.customers[customerId] = {
      from,
      firstSeen: nowISO(),
      lastSeen: nowISO(),
      lastLocation: null,
      towingCount: 0,
      lastTowingAt: null,
      lastJadwalAt: null,
    };
  } else {
    db.customers[customerId].lastSeen = nowISO();
  }

  // persist last location (if any)
  if (location?.mapsUrl) db.customers[customerId].lastLocation = location;

  // Log event
  db.events.push({ t: nowISO(), from, to, body, hasLocation: !!location, location });
  if (db.events.length > 5000) db.events = db.events.slice(-2000);
  saveDB(db);

  const mentionsCantDrive =
    /tidak bisa jalan|ga bisa jalan|gak bisa jalan|mogok|stuck|macet total|selip parah|rpm naik tapi tidak jalan|masuk d tapi tidak jalan|masuk r tapi tidak jalan|berisiko|darurat/i.test(body);

  const cmdTowing = isCommand(body, "TOWING");
  const cmdJadwal = isCommand(body, "JADWAL");

  // 1) If user shared location anytime -> notify admin with location + wa.me + reply acknowledge
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

    const reply = [
      `Baik, lokasi sudah kami terima ✅`,
      `Kami bantu arahkan langkah berikutnya.`,
      ``,
      `Jika unit tidak aman untuk dijalankan / tidak bisa berjalan, sebaiknya jangan dipaksakan.`,
      `Admin akan follow up untuk arahan towing / kedatangan.`,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");

    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // 2) TOWING command OR can't drive -> notify admin even without location + ask location
  if (cmdTowing || mentionsCantDrive) {
    db.customers[customerId].towingCount += 1;
    db.customers[customerId].lastTowingAt = nowISO();
    saveDB(db);

    await notifyAdminTowing({
      from,
      body,
      location: db.customers[customerId].lastLocation || null,
      reason: cmdTowing ? "Customer typed TOWING" : "Customer mentions can't drive / risk",
    });

    const reply = [
      `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan untuk mencegah kerusakan melebar.`,
      `Silakan *share lokasi* Anda (pin lokasi WhatsApp) — setelah itu admin akan arahkan towing.`,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");

    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // 3) JADWAL command -> reply + notify admin (B)
  if (cmdJadwal) {
    db.customers[customerId].lastJadwalAt = nowISO();
    saveDB(db);

    await notifyAdminJadwal({
      from,
      body,
      lastLocation: db.customers[customerId].lastLocation || null,
    });

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

  // 4) Default: handle address question quickly (no AI needed)
  let replyText = null;
  if (/alamat|lokasi|maps|map|di mana|dimana/i.test(body)) {
    replyText = `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
  } else {
    const ai = await aiReply(body);
    if (ai) replyText = ai;
  }

  if (!replyText) {
    replyText = [
      `Halo! Boleh info singkat ya:`,
      `1) Mobil & tahun`,
      `2) Keluhan utama (rpm tinggi / jedug / selip / telat masuk gigi)`,
      `3) Muncul saat dingin atau saat panas/macet?`,
    ].join("\n");
  }

  const reply = [
    replyText,
    ``,
    `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.`,
    `Ketik *TOWING* lalu *share lokasi* bila perlu.`,
    confidenceLine(),
    ``,
    businessSignature(),
  ].join("\n");

  res.type("text/xml");
  return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
}

// -------------------- A) DUAL ROUTES --------------------
app.post(["/twilio/webhook", "/whatsapp/incoming"], (req, res) => {
  webhookHandler(req, res).catch((e) => {
    console.error("Webhook fatal:", e.message);
    res.type("text/xml");
    return res.send(
      `<Response><Message>${escapeXml(
        "Maaf, sistem sedang padat. Ketik *TOWING* untuk kondisi darurat atau *JADWAL* untuk booking."
      )}</Message></Response>`
    );
  });
});

// -------------------- HEALTH --------------------
app.get("/", (_req, res) => res.status(200).send("HONGZ AI SERVER — OK"));

// -------------------- START --------------------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("HONGZ AI SERVER — FINAL A-B-C — START");
  console.log("Listening on port:", port);
  console.log("Webhook routes: /twilio/webhook and /whatsapp/incoming");
});
