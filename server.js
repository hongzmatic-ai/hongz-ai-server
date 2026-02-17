/**
 * HONGZ AI SERVER — FINAL A (Super Stabil / No OpenAI)
 * - Twilio WhatsApp Webhook
 * - Menu: JADWAL / TOWING
 * - Auto-priority towing: jika user ketik TOWING / mogok / tidak bisa jalan / rpm naik tapi tidak jalan
 * - Handle WhatsApp location share: Latitude/Longitude OR maps link
 * - Admin notification selalu dikirim untuk towing / lokasi
 *
 * Required ENV:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM   e.g. "whatsapp:+62857xxxx" (Twilio WA sender)
 *   ADMIN_WHATSAPP_TO      e.g. "whatsapp:+62813xxxx" (Papa/admin)
 */

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  ADMIN_WHATSAPP_TO,

  // Optional branding
  BIZ_NAME = "Hongz Bengkel – Spesialis Transmisi Matic",
  BIZ_ADDRESS = "Jl. M. Yakub No.10b, Medan Perjuangan",
  BIZ_HOURS = "Senin–Sabtu 09.00–17.00",
  MAPS_LINK = "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  WHATSAPP_ADMIN = "https://wa.me/6281375430728",
  WHATSAPP_CS = "https://wa.me/6285752965167",

  DEBUG = "false",
} = process.env;

const IS_DEBUG = (DEBUG || "false").toLowerCase() === "true";
function dlog(...args) {
  if (IS_DEBUG) console.log("[HONGZ]", ...args);
}

// --- Required ENV check ---
function missingEnv() {
  const miss = [];
  if (!TWILIO_ACCOUNT_SID) miss.push("TWILIO_ACCOUNT_SID");
  if (!TWILIO_AUTH_TOKEN) miss.push("TWILIO_AUTH_TOKEN");
  if (!TWILIO_WHATSAPP_FROM) miss.push("TWILIO_WHATSAPP_FROM");
  if (!ADMIN_WHATSAPP_TO) miss.push("ADMIN_WHATSAPP_TO");
  return miss;
}

const miss = missingEnv();
if (miss.length) {
  console.error("Missing required ENV:", miss.join(", "));
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

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
  return String(s || "").replace(/\u200b/g, "").trim();
}

function isCommand(body, cmd) {
  const t = normText(body).toUpperCase();
  const c = String(cmd).toUpperCase();
  return t === c || t.startsWith(c + " ") || t.includes("\n" + c) || t.includes(" " + c + " ");
}

// Location: Twilio WhatsApp can send Latitude/Longitude/Label/Address
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
      mapsUrl: `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`,
    };
  }

  // Fallback: detect maps link inside message body
  const body = String(reqBody.Body || "").trim();
  const mapsLinkMatch = body.match(/https?:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)[^\s]+/i);
  if (mapsLinkMatch) {
    return { type: "link", mapsUrl: mapsLinkMatch[0], raw: body };
  }
  return null;
}

// -------------------- BUSINESS SIGNATURE --------------------
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

function towingInstruction(location) {
  const parts = [];
  parts.push(`Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan agar kerusakan tidak melebar.`);
  parts.push(`Ketik *TOWING* lalu kirim *share lokasi* Anda — kami bantu arahkan evakuasi ke workshop.`);
  if (location?.mapsUrl) parts.push(`📍 Lokasi terdeteksi: ${location.mapsUrl}`);
  parts.push(confidenceLine());
  parts.push("");
  parts.push(businessSignature());
  return parts.join("\n");
}

// -------------------- ADMIN NOTIFY --------------------
async function notifyAdminTowing({ from, body, location, reason }) {
  const msg = [
    `🚨 *PRIORITY TOWING (AUTO)*`,
    `Dari: ${from || "-"}`,
    `Alasan: ${reason || "-"}`,
    location?.mapsUrl ? `Lokasi: ${location.mapsUrl}` : `Lokasi: (belum ada)`,
    body ? `Pesan: ${body}` : ``,
    ``,
    `Aksi cepat: hubungi customer ini untuk koordinasi towing.`,
  ].filter(Boolean).join("\n");

  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: ADMIN_WHATSAPP_TO,
      body: msg,
    });
    dlog("Admin notified");
  } catch (e) {
    console.error("Admin notify failed:", e.message);
  }
}

// -------------------- CORE RESPONSE --------------------
function twimlMessage(res, text) {
  res.type("text/xml");
  return res.send(`<Response><Message>${escapeXml(text)}</Message></Response>`);
}

function triageTemplate() {
  return [
    `Halo! Boleh info singkat ya:`,
    `1) Mobil & tahun`,
    `2) Keluhan utama (contoh: rpm tinggi / jedug / selip / telat masuk gigi)`,
    `3) Muncul saat dingin atau panas/macet?`,
    ``,
    `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.`,
    `Ketik *TOWING* lalu kirim *share lokasi* bila perlu.`,
    confidenceLine(),
    ``,
    businessSignature(),
  ].join("\n");
}

// -------------------- MAIN WEBHOOK --------------------
// sesuai Twilio screenshot papa: /whatsapp/incoming
app.post("/whatsapp/incoming", async (req, res) => {
  const from = req.body.From || "";
  const body = normText(req.body.Body || "");
  const location = extractLocation(req.body);

  dlog("Incoming:", { from, body, hasLocation: !!location });

  const cmdTowing = isCommand(body, "TOWING");
  const cmdJadwal = isCommand(body, "JADWAL");

  const mentionsCantDrive =
    /tidak bisa jalan|ga bisa jalan|gak bisa jalan|mogok|stuck|macet total|selip parah|rpm naik tapi tidak jalan|masuk d tapi tidak jalan|masuk r tapi tidak jalan|berisiko|darurat/i.test(body);

  // 1) Kalau user share lokasi → auto towing priority + notify admin + ack ke user
  if (location) {
    await notifyAdminTowing({
      from,
      body,
      location,
      reason: "Customer shared location",
    });

    const reply = [
      `Baik, lokasi sudah kami terima ✅`,
      `Kami akan bantu arahkan evakuasi / towing bila unit tidak aman untuk dijalankan.`,
      ``,
      `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.`,
      `Silakan ketik *TOWING* (jika belum) — tim kami akan follow up.`,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");

    return twimlMessage(res, reply);
  }

  // 2) Kalau TOWING atau terdeteksi mogok → notify admin + minta lokasi
  if (cmdTowing || mentionsCantDrive) {
    await notifyAdminTowing({
      from,
      body,
      location: null,
      reason: cmdTowing ? "Customer typed TOWING" : "Customer mentions can't drive / risk",
    });

    return twimlMessage(res, towingInstruction(null));
  }

  // 3) JADWAL → minta data booking
  if (cmdJadwal) {
    const reply = [
      `Siap, untuk *booking pemeriksaan*, mohon kirim data singkat:`,
      `1) Nama`,
      `2) Mobil & tahun`,
      `3) Keluhan utama`,
      `4) Rencana datang (hari & jam)`,
      ``,
      confidenceLine(),
      ``,
      businessSignature(),
    ].join("\n");
    return twimlMessage(res, reply);
  }

  // 4) Default (selalu balas, tidak boleh diam)
  return twimlMessage(res, triageTemplate());
});

// Alias route (kalau Papa pernah pakai ini sebelumnya)
app.post("/twilio/webhook", async (req, res) => {
  return app._router.handle(req, res, require("finalhandler")(req, res));
});

// Health check
app.get("/", (_req, res) => res.status(200).send("HONGZ AI SERVER — OK"));

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("HONGZ AI SERVER — FINAL A — START");
  console.log("Listening on port:", port);
});
