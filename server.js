/**
 * HONGZ AI SERVER — FINAL A (Stable)
 * - Twilio WhatsApp webhook (dual route): /whatsapp/incoming & /twilio/webhook
 * - Menu: JADWAL / TOWING
 * - Location share handler (Latitude/Longitude OR maps link)
 * - Admin notify for towing + location
 * - OpenAI optional (withTimeout, no "timeout:" param that can break)
 *
 * REQUIRED ENV (Render):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM     e.g. "whatsapp:+6285752965167"
 *   ADMIN_WHATSAPP_TO        e.g. "whatsapp:+6281375430728"
 *
 * OPTIONAL ENV:
 *   OPENAI_API_KEY
 *   OPENAI_MODEL            e.g. "gpt-4o-mini"
 *   OPENAI_TIMEOUT_MS       e.g. "9000"
 *   DEBUG                   "true"/"false"
 *
 * BUSINESS INFO (optional override):
 *   BIZ_NAME
 *   BIZ_ADDRESS
 *   BIZ_HOURS
 *   MAPS_LINK
 *   WHATSAPP_ADMIN          wa.me link
 *   WHATSAPP_CS             wa.me link
 */

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");

let OpenAI = null;
try { OpenAI = require("openai"); } catch (_) { OpenAI = null; }

// -------------------- ENV --------------------
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

  DEBUG = "false",
} = process.env;

const IS_DEBUG = String(DEBUG).toLowerCase() === "true";

function dlog(...args) { if (IS_DEBUG) console.log("[HONGZ]", ...args); }

// Hard stop if missing required Twilio env (so Papa langsung tahu)
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ADMIN_WHATSAPP_TO) {
  console.error("[HONGZ] Missing required ENV. Set: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ADMIN_WHATSAPP_TO");
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// -------------------- APP --------------------
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// -------------------- UTIL --------------------
function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normText(s) {
  return String(s || "")
    .replace(/\u200b/g, "")
    .replace(/\r/g, "")
    .trim();
}

function upper(s) { return normText(s).toUpperCase(); }

function isCommand(body, cmd) {
  const t = upper(body);
  const c = String(cmd).toUpperCase();
  return t === c || t.startsWith(c + " ") || t.includes("\n" + c) || t.includes(" " + c + " ");
}

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
    return { type: "link", mapsUrl: mapsLinkMatch[0], raw: body };
  }

  return null;
}

function mentionsCantDrive(text) {
  return /tidak bisa jalan|ga bisa jalan|gak bisa jalan|mogok|stuck|macet total|selip parah|rpm naik tapi tidak jalan|masuk d tapi tidak jalan|masuk r tapi tidak jalan|berisiko|darurat/i.test(text);
}

// “Triase pintar” tanpa OpenAI (biar nggak terasa bodoh)
function smartFallbackReply(body) {
  const b = normText(body);

  // Kalau user sudah menulis detail (contoh Innova 2008 telat masuk gigi)
  // kita balas dengan arah diagnosa yang lebih “mekanik”
  const looksLikeCarCase = /\b(innova|avanza|xenia|rush|terios|fortuner|pajero|brio|jazz|ertiga|mobilio|xpander|hrv|crv|alphard|vellfire|cvt|matic|atf|transmisi)\b/i.test(b)
    || /\b(200\d|201\d|202\d)\b/.test(b)
    || /\b(rpm|jedug|selip|telat|pindah gigi|hentak|getar|ga mau jalan|overheat)\b/i.test(b);

  if (looksLikeCarCase) {
    return [
      `Baik, dari gejala yang Anda tulis, kemungkinan ada beberapa arah pemeriksaan:`,
      `1) Oli transmisi (level/kondisi/terbakar) & kebocoran`,
      `2) Sistem kontrol (solenoid/sensor/TCM) — perlu scan`,
      `3) Tekanan oli transmisi & kondisi internal (perlu cek tekanan/tes jalan)`,
      ``,
      `Agar tidak salah langkah, boleh jawab singkat (pilih yang paling sesuai):`,
      `1) Gejala muncul saat *dingin* atau saat *panas/macet*?`,
      `2) Saat masuk D/R ada jedug / delay / rpm naik tapi mobil tidak jalan?`,
      ``,
      `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.`,
      `Ketik *TOWING* lalu kirim *share lokasi* bila perlu.`,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");
  }

  // default umum tapi tetap rapi
  return [
    `Baik, boleh info singkat ya agar diagnosanya tepat:`,
    `1) Mobil & tahun`,
    `2) Keluhan utama (contoh: rpm tinggi / jedug / selip / telat masuk gigi)`,
    `3) Muncul saat dingin atau saat panas/macet?`,
    ``,
    `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.`,
    `Ketik *TOWING* lalu kirim *share lokasi* bila perlu.`,
    confidenceLine(),
    ``,
    businessSignature(),
  ].join("\n");
}

// -------------------- ADMIN NOTIFY --------------------
async function notifyAdmin({ title, from, body, location }) {
  const msg = [
    `🚨 *${title}*`,
    `Dari: ${from || "-"}`,
    location?.mapsUrl ? `Lokasi: ${location.mapsUrl}` : `Lokasi: (belum ada)`,
    body ? `Pesan: ${body}` : ``,
    ``,
    `Aksi: follow up customer ini.`,
  ].filter(Boolean).join("\n");

  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: ADMIN_WHATSAPP_TO,
      body: msg,
    });
    dlog("Admin notified");
  } catch (e) {
    console.error("[HONGZ] Admin notify failed:", e.message);
  }
}

// -------------------- OPENAI (OPTIONAL) --------------------
function withTimeout(promise, ms, label = "OPENAI_TIMEOUT") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

async function aiReply(userText) {
  if (!OPENAI_API_KEY || !OpenAI) return null;

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  const system = `
Anda adalah CS WhatsApp bengkel transmisi matic "Hongz Bengkel" di Medan.
Bahasa: Indonesia, profesional, ringkas, membantu.
ATURAN:
- Jangan beri angka biaya fix tanpa pemeriksaan.
- Jika pelanggan menyebut tidak bisa jalan/mogok/berisiko: sarankan jangan dipaksakan + arahkan TOWING.
- Maksimal 2 pertanyaan.
- Jawaban harus praktis: langkah cek apa dulu.
`.trim();

  try {
    const resp = await withTimeout(
      client.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.35,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText },
        ],
      }),
      Number(OPENAI_TIMEOUT_MS) || 9000
    );

    const text = resp?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    console.error("[HONGZ] OpenAI failed:", e.message);
    return null;
  }
}

// -------------------- CORE HANDLER --------------------
async function handleIncoming(req, res) {
  const from = req.body.From || "";
  const body = normText(req.body.Body || "");
  const location = extractLocation(req.body);

  dlog("INCOMING", { from, body, hasLocation: !!location });

  const cmdJadwal = isCommand(body, "JADWAL");
  const cmdTowing = isCommand(body, "TOWING");
  const cantDrive = mentionsCantDrive(body);

  // A) Location shared anytime => acknowledge + notify admin
  if (location) {
    await notifyAdmin({
      title: "LOCATION RECEIVED",
      from,
      body,
      location,
    });

    const reply = [
      `Baik, lokasi sudah kami terima ✅`,
      `Kami akan bantu arahkan langkah berikutnya.`,
      location?.mapsUrl ? `📍 Link lokasi: ${location.mapsUrl}` : ``,
      ``,
      `Jika unit tidak aman untuk dijalankan / tidak bisa berjalan, sebaiknya jangan dipaksakan.`,
      `Ketik *TOWING* (jika belum) — tim kami akan follow up.`,
      confidenceLine(),
      ``,
      businessSignature(),
    ].filter(Boolean).join("\n");

    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // B) TOWING or cant-drive => priority towing + notify admin
  if (cmdTowing || cantDrive) {
    await notifyAdmin({
      title: "PRIORITY TOWING",
      from,
      body,
      location: null,
    });

    const reply = [
      `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan untuk mencegah kerusakan melebar.`,
      `Silakan *share lokasi* Anda (kirim lokasi WhatsApp / link Google Maps).`,
      `Setelah lokasi masuk, tim kami bantu arahkan evakuasi/towing.`,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");

    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // C) JADWAL
  if (cmdJadwal) {
    const reply = [
      `Siap, untuk *booking pemeriksaan*, mohon kirim format:`,
      `NAMA / MOBIL / TAHUN / GEJALA / RENCANA DATANG (hari & jam)`,
      ``,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");

    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // D) Normal chat => AI optional, fallback smart
  let replyText = null;

  const ai = await aiReply(body);
  if (ai) {
    replyText = [
      ai,
      ``,
      `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.`,
      `Ketik *TOWING* lalu kirim *share lokasi* bila perlu.`,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");
  } else {
    replyText = smartFallbackReply(body);
  }

  res.type("text/xml");
  return res.send(`<Response><Message>${escapeXml(replyText)}</Message></Response>`);
}

// -------------------- ROUTES --------------------
// Dual route (biar Twilio salah set path pun tetap masuk)
app.post("/whatsapp/incoming", handleIncoming);
app.post("/twilio/webhook", handleIncoming);

// Health check
app.get("/", (_req, res) => res.status(200).send("HONGZ AI SERVER — OK"));

// -------------------- START --------------------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("HONGZ AI SERVER — FINAL A — START");
  console.log("Listening on port:", port);
});
