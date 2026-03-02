/*
==================================================
HONGZ AI SERVER — HYBRID C+ ELITE
FINAL v2.1 — ELITE STABLE (ONE FILE)
deps: express, body-parser, twilio, openai (^4)
==================================================
*/

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ================= ENV =================
const {
  // Twilio
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM, // e.g. "whatsapp:+14155238886" or "whatsapp:+1xxx"
  ADMIN_WHATSAPP_TO,    // e.g. "whatsapp:+62813xxxx"
  MONITOR_WHATSAPP_TO,  // e.g. "whatsapp:+62812xxxx" (radar)

  // Branding
  BIZ_NAME = "Hongz Bengkel – Spesialis Transmisi Matic",
  BIZ_HOURS = "Senin–Sabtu 09.00–17.00",
  MAPS_LINK = "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  WHATSAPP_ADMIN = "https://wa.me/6281375430728",
  WHATSAPP_CS = "https://wa.me/6285752965167",

  // Storage
  DATA_DIR = "./data",

  // OpenAI
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  OPENAI_MAX_OUTPUT_TOKENS = "220",
  OPENAI_TEMPERATURE = "0.3",
  OPENAI_TIMEOUT_MS = "9000",

  // Controls
  RADAR_ENABLED = "true",
  ADMIN_NOTIFY_ENABLED = "true",
  ADMIN_NOTIFY_MIN_SCORE = "5",
  ADMIN_NOTIFY_COOLDOWN_SEC = "60",
  RADAR_COOLDOWN_SEC = "15",

  PORT = "3000",
  DEBUG = "false",
} = process.env;

const IS_DEBUG = String(DEBUG).toLowerCase() === "true";
const RADAR_ON = String(RADAR_ENABLED).toLowerCase() === "true";
const ADMIN_NOTIFY_ON = String(ADMIN_NOTIFY_ENABLED).toLowerCase() === "true";

const ADMIN_MIN_SCORE = Number(ADMIN_NOTIFY_MIN_SCORE || 5);
const ADMIN_CD_MS = Number(ADMIN_NOTIFY_COOLDOWN_SEC || 60) * 1000;
const RADAR_CD_MS = Number(RADAR_COOLDOWN_SEC || 15) * 1000;

const OAI_MAXTOK = Number(OPENAI_MAX_OUTPUT_TOKENS || 220);
const OAI_TEMP = Number(OPENAI_TEMPERATURE || 0.3);
const OAI_TIMEOUT = Number(OPENAI_TIMEOUT_MS || 9000);

// ================= APP =================
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ================= TWILIO CLIENT =================
const twilioClient = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

// ================= STORAGE =================
function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}
ensureDir(DATA_DIR);

const DB_FILE = path.join(DATA_DIR, "hongz_db.json");

function loadDBFile() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? parsed
      : { customers: {}, tickets: {}, events: [], meta: {} };
  } catch (_) {
    return { customers: {}, tickets: {}, events: [], meta: {} };
  }
}

function saveDBFile(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("DB save failed:", e?.message || e);
  }
}

function nowISO() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }

function sha16(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
}

function dlog(...args) {
  if (IS_DEBUG) console.log("[DLOG]", ...args);
}

// ================= BASIC HELPERS =================
function normText(s) { return String(s || "").replace(/\u200b/g, "").trim(); }
function upper(s) { return normText(s).toUpperCase(); }

function cleanMsisdn(from) {
  return String(from || "").replace(/^whatsapp:\+?/i, "").replace(/[^\d]/g, "");
}
function toWaMe(from) {
  const n = cleanMsisdn(from);
  return n ? `https://wa.me/${n}` : "-";
}

function replyTwiML(res, message) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message || "Halo Bang 🙏");
  res.type("text/xml");
  return res.status(200).send(twiml.toString());
}

function isCommand(body, cmd) {
  const t = upper(body);
  const c = String(cmd || "").toUpperCase();
  return t === c || t.startsWith(c + " ") || t.includes("\n" + c) || t.includes(" " + c + " ");
}

function confidenceLine(style = "neutral") {
  if (style === "casual") return "✅ Tenang ya Bang, kita bantu sampai jelas langkahnya 🙂";
  return "✅ Tenang ya Bang, kami bantu sampai jelas langkahnya.";
}

function acBookingCloseText(style) {
  const openHour = "09.00–17.00";

  const head = "Siap Bang ✅ Bisa.";

  // Scarcity halus + positioning elite
  const softLine =
    "Supaya tidak menunggu lama, biasanya kami atur kedatangan per jam.\n" +
    "Khusus pagi biasanya lebih cepat penuh karena banyak unit prioritas.";

  // Authority positioning
  const authorityLine =
    "Nanti kami siapkan teknisi khusus AC supaya pengecekan lebih fokus & cepat.";

  // Micro-commitment closing
  const lockLine =
    "Kalau sudah cocok dengan jadwalnya, cukup balas: *SIAP BESOK* supaya kami bisa langsung kunci kedatangan & siapkan teknisinya.";

  return (
    head + "\n\n" +
    softLine + "\n\n" +
    authorityLine + "\n\n" +
    "Mohon kirim data berikut:\n" +
    "1) Nama\n" +
    "2) Mobil & tahun\n" +
    `3) Mau datang jam berapa? (kami buka ${openHour})\n\n` +
    "Sekalian biar diagnosa lebih cepat:\n" +
    "4) Dinginnya hilang total atau cuma kurang dingin?\n" +
    "5) Terakhir servis AC kapan?\n\n" +
    lockLine + "\n\n" +
    "Kalau butuh cepat, langsung voice call Admin: +6281375430728"
  );
}

function signatureShort() {
  return [
    `— ${BIZ_NAME}`,
    `🧭 Maps: ${MAPS_LINK}`,
    `⏱ ${BIZ_HOURS}`,
    `📲 Admin: ${WHATSAPP_ADMIN}`,
    `💬 CS: ${WHATSAPP_CS}`,
    `Ketik *JADWAL* (booking) / *TOWING* (darurat)`,
  ].join("\n");
}

function signatureTowing() {
  return [
    `— ${BIZ_NAME}`,
    `📲 Admin prioritas: ${WHATSAPP_ADMIN}`,
    `⚡ Darurat? Klik Admin untuk *voice call* (lebih cepat).`,
  ].join("\n");
}
function getPreferredGreeting(customer) {
  const p = String(customer?.preferredGreeting || "").toLowerCase();
  if (p === "formal") return "Pak";
  if (p === "casual") return "Bang";
  return null; // belum ada preferensi
}

function greetWord(customer, style, userText = "") {
  const t = String(userText || "").toLowerCase();

  // kalau user pakai "pak"
  if (/\bpak\b/.test(t)) return "Baik Pak.";

  // kalau user pakai "bang"
  if (/\bbang\b/.test(t)) return "Baik Bang.";

  // kalau ada preferensi tersimpan, pakai itu
  const pref = getPreferredGreeting(customer);
  if (pref === "Pak") return "Baik Pak.";
  if (pref === "Bang") return "Baik Bang.";

  // urgent default lebih sopan
  if (style === "urgent") return "Baik Pak.";

  // fallback
  if (style === "formal") return "Baik Pak.";
  return "Baik Bang.";
}

// ================= MEMORY SNIPPET (SAFE) =================
function buildMemorySnippet(customer, ticket) {
  const c = customer || {};
  const t = ticket || {};

  const parts = [];

  // prefer greeting
  if (c.preferredGreeting) {
    parts.push(`Preferred greeting: ${c.preferredGreeting}`);
  }

  // basic profile (kalau sudah ada)
  if (c.name) parts.push(`Name: ${c.name}`);
  if (c.vehicle) parts.push(`Vehicle: ${c.vehicle}`);
  if (c.year) parts.push(`Year: ${c.year}`);

  // last known issue (kalau ada)
  if (c.lastIssue) parts.push(`Last issue: ${c.lastIssue}`);

  // ticket context (ringan)
  if (t.type) parts.push(`Lane: ${t.type}`);
  if (t.stage != null) parts.push(`Stage: ${t.stage}`);
  if (t.locationUrl) parts.push(`Last location: ${t.locationUrl}`);

  return parts.length ? parts.join("\n") : "";
}
// --- TOWING intent (biar TOWING gak nabrak chat biasa) ---
function detectTowingIntent(body) {
  const t = String(body || "").toLowerCase();

  // intent towing / mogok / stuck / evakuasi
  if (/towing|evakuasi|derek|di jalan|jalan tol|banjir|mogok|stuck|nyangkut|bahaya/i.test(t)) return true;

  // "tidak bisa jalan / tidak bergerak / masuk D/R tapi tidak jalan"
  if (detectCantDrive(body)) return true;

  // gejala slip berat (kadang user sebut "selip" tapi masih bisa jalan pelan)
  if (/selip parah|selip berat|rpm naik tapi|ga narik sama sekali|tidak narik/i.test(t)) return true;

  return false;
}

// ping / basa-basi singkat yang sering bikin towing template keulang
function isGenericPing(body) {
  const t = String(body || "").toLowerCase().trim();
  return /^(bang|pak|pagi|siang|malam|halo|hai|permisi|tes|test|cek|ok|oke|ya|iya|sip|siap|mau tanya|nanya)$/i.test(t);
}

// signature towing cukup 1x per ticket (biar gak spam panjang)
function towingSignatureOnce(ticket) {
  if (ticket && ticket._towingSigSent) return ""; // sudah pernah kirim
  if (ticket) ticket._towingSigSent = true;
  return "\n\n" + signatureTowing();
}

// ================= DETECTORS (ELITE FINAL CLEAN) =================

// ================= BASIC GREETING / ASK =================

function isGreetingOnly(body) {
  const t = String(body || "").toLowerCase().trim();

  // dukung variasi salam + tambahan wr wb + "bang"
  return /^(halo|hai|pagi|siang|sore|malam|ass?alamualaikum)(\s+(wr\.?\s*wb\.?)?)?(\s+bang)?\s*$/i.test(t);
}

function isAskingIntent(body) {
  const t = String(body || "").toLowerCase().trim();

  // pastikan hanya intent tanya, bukan kalimat panjang yang beda konteks
  return /^(bang\s+)?(mau\s+tanya|izin\s+tanya|mau\s+nanya|mau\s+konsultasi|tanya)(\b|$)/i.test(t);
}

function isGeneralQuestion(body) {
  return isGreetingOnly(body) || isAskingIntent(body);
}

// ================= SLIP DETECTION =================

function detectSlip(body) {
  const t = String(body || "").toLowerCase();

  if (/\b(selp|slip|ngelos|gelos)\b|(\brpm\b.*\bnaik\b.*\b(tidak jalan|ga jalan|gak jalan)\b)|\b(loss)\b/i.test(t)) {
    return true;
  }

  return false;
}

function detectOli(body) {
  const t = String(body || "").toLowerCase();
  return /\b(ganti oli|oli matic|service oli|flush oli)\b/i.test(t);
}

function detectOverhaul(body) {
  const t = String(body || "").toLowerCase();
  return /\b(overhaul|turun mesin matic|bongkar total)\b/i.test(t);
}

// 🔒 RATE LIMITER (ELITE)
const rate = new Map();

function hitRateLimit(phone, ms = 2000) {
  const now = Date.now();
  const last = rate.get(phone) || 0;
  if (now - last < ms) return true;
  rate.set(phone, now);
  return false;
}

function isSlipElite(body) {
  const t = String(body || "").toLowerCase();

  // gear D/R masuk tapi tidak jalan

  if (/\b(d|r)\b.*(masuk|nyantol).*(tapi|tp).*(tidak jalan|ga jalan|gak jalan)/i.test(t)) {
    return true;
  }

  return false;
}

function slipPromptElite(style) {

  const head = style === "urgent"
    ? "Baik Bang. Kalau selip jangan dipaksakan dulu ya."
    : "Baik Bang. Saya pastikan dulu ya.";

  return (
    head + "\n\n" +
    "Selip biasanya ada 2 kondisi:\n" +
    "1) RPM naik tapi mobil masih jalan pelan\n" +
    "2) Sudah tidak narik sama sekali\n\n" +
    "Yang Bang alami yang mana?\n\n" +
    "Info juga mobil & tahun berapa supaya saya arahkan solusi paling tepat."
  );
}

function oliPrompt(style) {
  return (
    "Baik Bang 👍\n\n" +
    "Untuk ganti oli matic ada 2 pilihan:\n" +
    "1️⃣ Drain biasa\n" +
    "2️⃣ Full flush machine\n\n" +
    "Info mobil & tahun berapa Bang?\n" +
    "Terakhir ganti oli km berapa?"
  );
}

function overhaulPrompt(style) {
  return (
    "Baik Bang 🙏\n\n" +
    "Overhaul itu bongkar total transmisi.\n\n" +
    "Biasanya karena:\n" +
    "• Sudah tidak jalan\n" +
    "• Slip parah\n" +
    "• Bunyi kasar\n\n" +
    "Info mobil & gejala detailnya apa Bang?\n" +
    "Supaya saya arahkan estimasi biayanya."
  );
}

// ================= TOWING =================

function detectTowingIntent(body) {
  const t = String(body || "").toLowerCase();

  // kalau slip -> jangan dianggap towing (kecuali user minta derek jelas)
  if (detectSlip(body) && !/(towing|derek|evakuasi|ditarik|jemput|angkut)/i.test(t)) {
    return false;
  }

  // towing eksplisit
  if (/(towing|evakuasi|derek|ditarik|jemput|angkut)/i.test(t)) {
    return true;
  }

  // benar2 tidak bisa bergerak sama sekali
  if (/tidak bisa jalan sama sekali|tidak bisa bergerak sama sekali|stuck total|macet total|mogok total/i.test(t)) {
    return true;
  }

  return false;
}

// ================= CANT DRIVE =================

function detectCantDrive(body) {
  const t = String(body || "").toLowerCase();

  // slip tidak otomatis cantDrive kecuali total stuck
  if (detectSlip(body)) {
    return /tidak jalan sama sekali|gak jalan sama sekali|ga jalan sama sekali|tidak bisa jalan sama sekali|tidak bisa bergerak sama sekali|stuck total|macet total/i.test(t);
  }

  return /tidak bisa jalan|ga bisa jalan|gak bisa jalan|tidak bisa bergerak|stuck|mogok|macet total|d masuk tapi tidak jalan|r masuk tapi tidak jalan/i.test(t);
}

// ================= STYLE =================

function detectStyle(body) {
  const raw = String(body || "");
  const t = raw.toLowerCase();

  if (/darurat|tolong|cepat|mogok|bahaya|stuck|macet total/i.test(t)) {
    return "urgent";
  }

  const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(raw);

  if (t.length < 20 || hasEmoji) {
    return "casual";
  }

  return "neutral";
}

// ================= GENERAL PROMPT =================

function generalPrompt(style) {
  if (style === "urgent") {
    return "Siap Bang. Mohon tulis keluhannya singkat ya + share lokasi kalau darurat 🙏";
  }
  return "Siap Bang 🙂 Boleh info tipe mobil + tahun + keluhan utamanya apa ya?";
}

function acPromptElite(style) {
  if (style === "urgent") {
    return (
      "Siap Bang ✅\n" +
      "AC tidak dingin bisa karena freon bocor/kurang, kompresor lemah, extra fan mati, atau evaporator kotor.\n\n" +
      "Jawab singkat ya:\n" +
      "1) Dingin hilang total atau kurang dingin?\n" +
      "2) Kalau gas, RPM naik terasa berat?\n" +
      "3) Terakhir servis AC kapan?\n\n" +
      "Kalau darurat di jalan, share lokasi sekarang 🙏"
    );
  }

  return (
    "Siap Bang ✅\n" +
    "AC tidak dingin biasanya karena:\n" +
    "• Freon kurang / bocor\n" +
    "• Kompresor lemah\n" +
    "• Extra fan / kipas mati\n" +
    "• Evaporator / filter kabin kotor\n\n" +
    "Boleh info:\n" +
    "– Dingin hilang total atau cuma kurang dingin?\n" +
    "– Terakhir servis AC kapan?\n\n" +
    "Kalau mau langsung beres, kirim hari & jam datang ya."
  );
}


// ================= OTHER DETECTORS =================

function detectAC(body) {
  const t = String(body || "").toLowerCase();
  return /\bac\b|freon|kompresor|blower|evaporator|kondensor|tidak dingin|dingin sebentar|panas lagi|extra fan|kipas/i.test(t);
}

function detectNoStart(body) {
  const t = String(body || "").toLowerCase();
  return /tidak bisa hidup|gak bisa hidup|ga bisa hidup|tidak bisa starter|gak bisa starter|ga bisa starter|starter|aki|accu|lampu redup/i.test(t);
}

function detectPriceOnly(body) {
  const t = String(body || "").toLowerCase();
  return /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget|ongkos/i.test(t);
}

function detectBuyingSignal(body) {
  const t = String(body || "").toLowerCase();
  return /jadwal|booking|bisa masuk|hari ini|besok|lusa|jam berapa|mau datang|fix datang|oke saya ke sana|alamat|lokasi|maps|share lokasi/i.test(t);
}

function hasVehicleInfo(body) {
  const t = String(body || "").toLowerCase();
  const hasYear = /\b(19\d{2}|20\d{2})\b/.test(t);
  const hasBrand = /toyota|honda|nissan|mitsubishi|suzuki|daihatsu|mazda|hyundai|kia|wuling|bmw|mercedes|audi|lexus/i.test(t);
  return hasYear || hasBrand;
}


// ================= GENERAL PROMPT =================

function generalPrompt(style) {
  if (style === "urgent") {
    return "Siap Bang. Mohon tulis keluhannya singkat ya + share lokasi kalau darurat 🙏";
  }

  return "Siap Bang 🙂 Boleh info tipe mobil + tahun + keluhan utamanya apa ya?";
}


// ================= OTHER DETECTORS =================

function detectAC(body) {
  const t = String(body || "").toLowerCase();
  return /\bac\b|freon|kompresor|blower|evaporator|kondensor|tidak dingin|dingin sebentar|panas lagi|extra fan|kipas/i.test(t);
}

function detectNoStart(body) {
  const t = String(body || "").toLowerCase();
  return /tidak bisa hidup|gak bisa hidup|ga bisa hidup|tidak bisa starter|gak bisa starter|ga bisa starter|starter|aki|accu|lampu redup/i.test(t);
}

function detectPriceOnly(body) {
  const t = String(body || "").toLowerCase();
  return /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget|ongkos/i.test(t);
}

function detectBuyingSignal(body) {
  const t = String(body || "").toLowerCase();
  return /jadwal|booking|bisa masuk|hari ini|besok|lusa|jam berapa|mau datang|fix datang|oke saya ke sana|alamat|lokasi|maps|share lokasi/i.test(t);
}

function hasVehicleInfo(body) {
  const t = String(body || "").toLowerCase();
  const hasYear = /\b(19\d{2}|20\d{2})\b/.test(t);
  const hasBrand = /toyota|honda|nissan|mitsubishi|suzuki|daihatsu|mazda|hyundai|kia|wuling|bmw|mercedes|audi|lexus/i.test(t);

  return hasYear || hasBrand;
}


// ================= LOCATION PARSER =================
function extractMapsLink(reqBody) {
  const body = String(reqBody?.Body ?? "").trim();
  if (!body) return null;
  const m = body.match(/(https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)[^\s]+)/i);
  if (!m) return null;
  return { type: "link", mapsUrl: m[1], raw: body };
}
function extractLocation(reqBody) {
  const lat = reqBody?.Latitude || reqBody?.latitude;
  const lng = reqBody?.Longitude || reqBody?.longitude;
  if (lat && lng) {
    return {
      type: "coords",
      lat: String(lat),
      lng: String(lng),
      mapsUrl: `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`
    };
  }
  const link = extractMapsLink(reqBody);
  if (link) return link;
  return null;
}

// ================= TICKET SYSTEM =================
function getOrCreateTicket(db, customerId, from) {
  if (!db.tickets) db.tickets = {};
  let ticket = Object.values(db.tickets).find(t => t.customerId === customerId && t.status !== "CLOSED");
  if (ticket) return ticket;

  const id = "T-" + Math.floor(10000 + Math.random() * 90000);
  ticket = {
    id,
    customerId,
    from,
    status: "OPEN",
    type: "GENERAL",     // GENERAL | AC | NO_START | TOWING | JADWAL
    stage: 0,            // stage flow (khusus AC)
    score: 0,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    lastInboundAtMs: 0,
    lastBody: "",
    locationUrl: "",
  };
  db.tickets[id] = ticket;
  return ticket;
}

function updateTicket(ticket, patch) {
  Object.assign(ticket, patch || {});
  ticket.updatedAt = nowISO();
}

// ================= LEAD SCORE =================
function leadScore({ body, hasLoc, cantDrive, isJadwal, isTowing }) {
  let score = 0;
  if (cantDrive || isTowing || hasLoc) score += 5;
  if (isJadwal || detectBuyingSignal(body)) score += 4;
  if (detectPriceOnly(body) && String(body || "").length < 35) score -= 2;
  return Math.max(0, Math.min(10, score));
}

// ================= RADAR & ADMIN NOTIFY =================
function canSendCooldown(db, key, cooldownMs) {
  if (!db.meta) db.meta = {};
  if (!db.meta.cooldowns) db.meta.cooldowns = {};
  const last = Number(db.meta.cooldowns[key] || 0);
  const now = nowMs();
  if (now - last < cooldownMs) return false;
  db.meta.cooldowns[key] = now;
  return true;
}

async function safeSendWhatsApp(to, text) {
  if (!twilioClient) return false;
  if (!TWILIO_WHATSAPP_FROM) return false;
  if (!to) return false;

  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to,
      body: String(text || "").slice(0, 1500),
    });
    return true;
  } catch (e) {
    console.error("Twilio send failed:", e?.message || e);
    return false;
  }
}

// ============================
// ✅ FOLLOW-UP ELIGIBILITY HELPER (ELITE)
// ============================
function isEligibleForFollowUp(t, nowMsValue, minutesIdle) {
  if (!t) return false;

  // wajib punya nomor tujuan
  if (!t.from) return false;

  // jangan follow up kalau sudah CLOSED
  if (t.type === "CLOSED") return false;

  // jangan follow up kalau sudah confirmed/jadwal (anggap closing)
  if (t.type === "AC_CONFIRMED") return false;

  // jangan follow up kalau baru saja masuk (anti spam)
  if (minutesIdle < 60) return false;

  // optional: kalau ada flag do-not-follow
  if (t.noFollowUp) return false;

  return true;
}

// ============================
// ✅ PICK FOLLOW-UP STAGE (60m / 6h / 24h)
// return 0 jika belum waktunya
// ============================
function pickFollowUpStage(t, minutesIdle) {
  // stage 1: 60 menit
  if (minutesIdle >= 60 && !t.fu1Sent) return 1;

  // stage 2: 6 jam
  if (minutesIdle >= 360 && !t.fu2Sent) return 2;

  // stage 3: 24 jam
  if (minutesIdle >= 1440 && !t.fu3Sent) return 3;

  return 0;
}

// ============================
// ✅ SIMPLE SERVICE LABEL (biar semua jenis kerja masuk)
// ============================
function serviceLabel(ticketType) {
  const t = String(ticketType || "").toUpperCase();

  if (t.includes("AC")) return "AC Mobil";
  if (t.includes("TOWING")) return "Towing / Darurat";
  if (t.includes("SLIP")) return "Transmisi (Slip)";
  if (t.includes("NO_START")) return "Mesin Tidak Mau Hidup";
  if (t.includes("JADWAL")) return "Booking / Jadwal";

  // default: anggap transmisi/general bengkel
  return "Bengkel (Transmisi/Engine/Suspensi/Electrical)";
}

// ============================
// ✅ FOLLOW-UP MESSAGE GENERATOR (per stage + per type + score)
// ============================
function buildFollowUpMessage(t, stage) {
  const label = serviceLabel(t.type);
  const car = t.car ? `\nMobil: ${t.car}` : "";
  const score = Number(t.score || 0);

  // Nada makin tegas kalau score tinggi
  const urgency =
    score >= 80 ? "Biar cepat kita amankan slot hari ini ya 🙏" :
    score >= 60 ? "Kalau mau lanjut, kita bantu atur jadwalnya ya 🙏" :
                  "Kalau masih butuh info, tanya aja ya 🙏";

  if (stage === 1) {
    return (
      "Halo Bang 👋\n\n" +
      `Kemarin sempat konsultasi soal *${label}*.` + car + "\n" +
      "Sekarang masih mau kita bantu lanjut?\n\n" +
      urgency + "\n" +
      "Balas: *LANJUT* atau kirim *Mobil + Tahun + Keluhan* ya."
    );
  }

  if (stage === 2) {
    return (
      "Halo Bang 🙏\n\n" +
      `Follow up singkat untuk *${label}* ya.` + car + "\n" +
      "Supaya tidak bolak-balik, jawab 2 hal ini:\n" +
      "1) Keluhannya sekarang bagaimana?\n" +
      "2) Mobil & tahun berapa?\n\n" +
      "Nanti kami arahkan langkah paling aman dulu."
    );
  }

  // stage 3
  return (
    "Halo Bang 👑\n\n" +
    `Terakhir follow up untuk *${label}*.` + car + "\n" +
    "Kalau masih ingin beres, kami bisa bantu booking waktu yang kosong.\n\n" +
    "Balas: *JADWAL* + hari (misal: besok/senin) + jam kira-kira.\n" +
    "Kalau tidak jadi, cukup balas: *STOP* 🙏"
  );
}

async function radarPing(db, payload) {
  if (!RADAR_ON) return;
  if (!MONITOR_WHATSAPP_TO) return;

  const key = `radar:${payload.ticketId}`;
  if (!canSendCooldown(db, key, RADAR_CD_MS)) return;

  const msg = [
    "📡 RADAR HONGZ",
    `Ticket: ${payload.ticketId}`,
    `From: ${payload.from}`,
    `wa.me: ${payload.waMe}`,
    `Type: ${payload.type} | Stage:${payload.stage} | Score:${payload.score}`,
    payload.locationUrl ? `📍 Lokasi: ${payload.locationUrl}` : "📍 Lokasi: -",
    `Msg: ${payload.snippet}`,
  ].join("\n");

  await safeSendWhatsApp(MONITOR_WHATSAPP_TO, msg);
}

async function adminNotify(db, payload) {
  if (!ADMIN_NOTIFY_ON) return;
  if (!ADMIN_WHATSAPP_TO) return;
  if (payload.score < ADMIN_MIN_SCORE) return;

  const key = `admin:${payload.ticketId}`;
  if (!canSendCooldown(db, key, ADMIN_CD_MS)) return;

  const msg = [
    "🧑‍💼 ADMIN ALERT — HONGZ",
    `Ticket: ${payload.ticketId}`,
    `Tag: ${payload.score >= 8 ? "🔴 PRIORITY" : payload.score >= 5 ? "🟡 POTENTIAL" : "🔵 NORMAL"}`,
    `From: ${payload.from}`,
    `wa.me: ${payload.waMe}`,
    `Type: ${payload.type} | Stage:${payload.stage} | Score:${payload.score}`,
    payload.locationUrl ? `📍 Lokasi: ${payload.locationUrl}` : "📍 Lokasi: -",
    `Msg: ${payload.snippet}`,
  ].join("\n");

  await safeSendWhatsApp(ADMIN_WHATSAPP_TO, msg);
}

// ================= OPENAI (SAFE) =================
function withTimeout(promise, ms, label = "TIMEOUT") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

function mustMapsOnly(aiText, userText) {
  const low = String(aiText || "").toLowerCase();
  const u = String(userText || "").toLowerCase();
  const userAskingLocation = /(alamat|lokasi|maps|map|di mana|dimana)/i.test(u);
  const looksLikeAddress = /(jl\.|jalan\s+\w|no\.|nomor\s+\d|kecamatan|kelurahan|kode pos)/i.test(low);

  if (userAskingLocation && looksLikeAddress) return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
  const aiClearlyInventing = /(jl\.|jalan\s+\w).*(no\.|nomor\s+\d)/i.test(low);
  if (aiClearlyInventing) return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
  return aiText;
}

// ✅ Natural opener randomizer (micro)
function naturalOpener(style = "neutral") {
  const elite = [
    "Baik Bang, saya pahami kondisinya.",
    "Oke Bang, saya mengerti gejalanya.",
    "Saya paham arah masalahnya Bang.",
    "Baik Bang, dari cerita abang saya sudah dapat gambaran awalnya."
  ];

  const casual = [
    "Oke Bang, saya lihat dulu ya arahnya.",
    "Siap Bang, saya sudah dapat bayangannya.",
    "Baik Bang, pelan-pelan kita cek arahnya."
  ];

  const formal = [
    "Baik Pak, saya pahami kondisinya.",
    "Saya mengerti gejala yang Bapak maksud."
  ];

  let pool = elite;
  if (style === "casual") pool = casual.concat(elite);
  if (style === "formal") pool = formal.concat(elite);

  return pool[Math.floor(Math.random() * pool.length)];
}

// helper kecil biar gak dobel opener kalau AI sudah buka dengan kalimat serupa
function startsLikeOpener(text) {
  const t = String(text || "").trim().toLowerCase();
  return /^(baik|oke|ok|siap)\s+(bang|pak)\b/.test(t) || /^saya\s+paham\b/.test(t);
}

// ================= AUTHORITY SCALING (ELITE) =================
function buildAuthorityTone({ style, score, ticketType }) {

style = String(style || "").toLowerCase();
  let level = 1;

  if (score >= 6) level++;
  if (ticketType === "TOWING") level += 2;
  if (ticketType === "AC_CONFIRMED") level += 1;
  if (style === "urgent") level += 2;

  // clamp 1–5
  level = Math.max(1, Math.min(level, 5));

  if (level <= 2) {
    return "Nada: hangat, membimbing, tidak terlalu teknis.";
  }

  if (level === 3) {
    return "Nada: profesional, jelas, langsung ke inti.";
  }

  if (level === 4) {
    return "Nada: tegas, berbasis pola kerusakan, arahkan tindakan.";
  }

  return "Nada: sangat tegas, prioritaskan keselamatan & tindakan cepat.";
}

async function aiReply(userText, context) {
  if (!OPENAI_API_KEY) return null;

  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    // style dari context kalau ada (urgent/formal/casual/neutral)
    const style = String(context?.style || "neutral");

    // 🧠 Natural Elite prompt (GPT yang atur, tapi kita kasih “bahasa” biar gak kelihatan sistem)
    const sys = [
      `Anda adalah Kepala Bengkel ${BIZ_NAME} di Medan.`,
context?.memorySnippet || "",
      "Karakter: mekanik senior (diagnosa center), manusiawi, berwibawa, tenang, elegan, tegas tapi sopan. Jangan terdengar seperti bot/CS.",
"Kepribadian: percaya diri, tidak mengemis, tidak defensif, fokus solusi.",
"Gaya jawaban: ringkas, presisi, berbasis pola gejala. Hindari kata ragu seperti 'mungkin/kira-kira'.",
buildAuthorityTone({
  style,
  score: context?.score || 0,
  ticketType: context?.ticketType || "GENERAL"
}),
"",
      "ATURAN WAJIB:",
      "1) Jangan beri angka harga pasti.",
      `2) Jika user tanya lokasi/alamat → jawab hanya link maps: ${MAPS_LINK}`,
      "3) Maksimal 2 pertanyaan dalam 1 balasan.",
      `4) Jika darurat/tidak bisa jalan → sarankan jangan dipaksakan + minta share lokasi + arahkan voice call admin (${WHATSAPP_ADMIN}).`,
      "5) Hindari kata yang terasa sistem/robotik seperti: 'saya tangkap', 'input diterima', 'ticket', 'stage'.",
      "6) Jika lawan bicara ragu/sekadar tanya-tanya (3T/3M), jawab halus tapi tetap memandu ke info minimum (mobil+tahun+gejala).",
      context?.laneRule ? `7) ${context.laneRule}` : "",
    ].filter(Boolean).join("\n");

    const resp = await withTimeout(
      client.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: OAI_TEMP,
        max_tokens: OAI_MAXTOK,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: String(userText || "") },
        ],
      }),
      OAI_TIMEOUT,
      "OPENAI_TIMEOUT"
    );

    let text = resp?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    text = mustMapsOnly(text, userText);

    // ✅ Tambah opener micro (tanpa kelihatan sistem), tapi jangan dobel
    if (!startsLikeOpener(text)) {
      const opener = naturalOpener(style);
      text = `${opener}\n\n${text}`;
    }

    if (text.length > 900) text = text.slice(0, 900).trim() + "…";
    return text;
  } catch (e) {
    console.error("OpenAI failed:", e?.message || e);
    return null;
  }
}

// ================= NATURAL ELITE — STEP 2 HELPERS =================
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function detectSoftLowIntent(body) {
  // 3T/3M versi halus (tanpa frontal)
  const t = String(body || "").toLowerCase();

  const manyAsksFewFacts =
    (t.match(/\?/g) || []).length >= 2 && !hasVehicleInfo(body);

  const priceProbe =
    /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget|ongkos/i.test(t) &&
    String(body || "").trim().length < 45;

  const timeWasterVibes =
    /cuma tanya|sekedar tanya|iseng|penasaran|nanya doang|lihat-lihat|compare|banding/i.test(t);

  const wantCheapFastPerfect =
    /murah|termurah|diskon besar|paling murah|langsung beres|cepat banget|garansi paling lama|tanpa bongkar/i.test(t);

  return !!(manyAsksFewFacts || priceProbe || timeWasterVibes || wantCheapFastPerfect);
}

function authorityLevel({ score, isUrgent, hasLoc, hasVehicle, buyingSignal }) {
  // makin serius → makin tegas (tanpa terlihat sistem)
  let lvl = 1;
  if (hasVehicle) lvl++;
  if (buyingSignal) lvl++;
  if (score >= 5) lvl++;
  if (isUrgent || hasLoc) lvl += 2;
  return clamp(lvl, 1, 5);
}

function softClose({ lvl, lane, style }) {
  // closing psikologi halus (tanpa kata "closing")
  // lvl 1-5
  const isCasual = style === "casual";
  const isFormal = style === "formal";

  if (lvl >= 4) {
    return isFormal
      ? "Kalau Bapak berkenan, kirim hari & jam rencana datang. Biar kami siapkan slot cek cepat."
      : "Kalau mau cepat beres, kirim hari & jam datang ya Bang. Biar admin siapin slot cek singkat.";
  }

  if (lvl === 3) {
    if (lane === "AC") return isCasual
      ? "Biar gak muter-muter, kalau sempat masuk bentar kita cek 15–30 menit ya Bang."
      : "Biar tidak muter-muter, saran saya cek singkat 15–30 menit ya Bang.";
    return isFormal
      ? "Supaya arahnya tepat, lebih aman kita cek singkat di bengkel terlebih dulu."
      : "Supaya arahnya tepat, paling aman kita cek singkat dulu ya Bang.";
  }

  // lvl 1-2: minta info minimum dulu, tetap hangat
  return isFormal
    ? "Boleh info mobil & tahunnya dulu, lalu keluhan yang paling terasa?"
    : "Boleh info mobil & tahun dulu ya Bang, sama keluhan yang paling terasa?";
}

// ================= PREFERRED GREETING MODE (SAFE PATCH) =================

// ENV toggle (aman kalau tidak diset di Render)
const PREFERRED_GREETING_ON =
  String(process.env.PREFERRED_GREETING_MODE || "true").toLowerCase() === "true";

const PREFERRED_GREETING_THRESHOLD =
  Number(process.env.PREFERRED_GREETING_THRESHOLD || 2);

const PREFERRED_GREETING_CD_MS =
  Number(process.env.PREFERRED_GREETING_COOLDOWN_SEC || 30) * 1000;


// --- detector ---
function detectUserCallsUsPak(text) {
  const raw = String(text || "").trim();
  const t = raw.toLowerCase();
  return /\bpak\b/.test(t) &&
    /^(pak|permisi pak|halo pak|pagi pak|siang pak|malam pak)/i.test(raw);
}

function detectUserCallsUsBang(text) {
  const raw = String(text || "").trim();
  const t = raw.toLowerCase();
  return /\bbang\b/.test(t) &&
    /^(bang|halo bang|pagi bang|siang bang|malam bang)/i.test(raw);
}


// --- updater ---
function updatePreferredGreeting(db, profile, body, customerId) {
  try {
    if (!PREFERRED_GREETING_ON) return;
    if (!profile) return;

    if (!db.meta) db.meta = {};
    if (!db.meta.prefGreetCd) db.meta.prefGreetCd = {};

    const key = `prefgreet:${customerId}`;
    const last = Number(db.meta.prefGreetCd[key] || 0);
    const now = Date.now();

    if (now - last < PREFERRED_GREETING_CD_MS) return;

    if (!profile.greet) {
      profile.greet = { pakCount: 0, bangCount: 0, preferred: "" };
    }

    const saidPak = detectUserCallsUsPak(body);
    const saidBang = detectUserCallsUsBang(body);

    if (saidPak) profile.greet.pakCount += 1;
    if (saidBang) profile.greet.bangCount += 1;

    // threshold jadi formal permanen
    if (profile.greet.pakCount >= PREFERRED_GREETING_THRESHOLD) {
      profile.greet.preferred = "formal";
    }

    // kalau Bang jauh lebih dominan, reset
    if (profile.greet.bangCount >= (profile.greet.pakCount + 3)) {
      profile.greet.preferred = "";
    }

    db.meta.prefGreetCd[key] = now;

  } catch (e) {
    console.error("PreferredGreeting update failed:", e?.message || e);
  }
}


// --- greeting builder (dipakai AI wrapper nanti) ---
function buildGreeting(profile, style = "neutral") {
  const p = profile || {};
  const pref = String(p?.greet?.preferred || "");

  const finalStyle = (pref === "formal") ? "formal" : style;

  const name = String(p.name || "").trim();

  if (name) {
    if (/^pak\s+/i.test(name)) return name;
    if (finalStyle === "formal") return `Pak ${name}`;
    return name;
  }

  return (finalStyle === "formal") ? "Pak" : "Bang";
}

// ================= MAIN WEBHOOK =================
async function webhookHandler(req, res) {
  const db = loadDBFile();
  if (!db.customers) db.customers = {};
  if (!db.tickets) db.tickets = {};
  if (!Array.isArray(db.events)) db.events = [];
  if (!db.meta) db.meta = { cooldowns: {} };

  const from = normText(req.body?.From || "");
  const to = normText(req.body?.To || "");
  const body = normText(req.body?.Body || "");

  if (body.length > 900) {
    saveDBFile(db);
    return replyTwiML(res, "Pesan terlalu panjang Bang 🙏 Mohon kirim ringkas ya.");
  }
  if (!body) {
    saveDBFile(db);
    return replyTwiML(res, "Silakan tulis keluhan mobilnya ya Bang 🙏");
  }

  const style = detectStyle(body);
  const location = extractLocation(req.body || {});
  const hasLoc = !!location;
  const customerId = sha16(from || "unknown");

  // ensure customer
  if (!db.customers[customerId]) {
    db.customers[customerId] = {
      from,
      firstSeen: nowISO(),
      lastSeen: nowISO(),
      phone: cleanMsisdn(from),
    };
  } else {
    db.customers[customerId].lastSeen = nowISO();
  }
try {
  updatePreferredGreeting(db, db.customers[customerId], body, customerId);
} catch (_) {}

const greet = greetWord(
  db.customers[customerId],
  style,
  body
);

  // ticket
  const ticket = getOrCreateTicket(db, customerId, from);
  if (location?.mapsUrl) ticket.locationUrl = location.mapsUrl;

// ==============================
// 🛑 STOP / UNSUBSCRIBE SYSTEM
// ==============================
const STOP_KEYWORDS = [
  "stop",
  "unsubscribe",
  "tidak mau",
  "ga mau",
  "gak mau",
  "jangan kirim",
  "jangan chat",
  "no follow up",
  "cukup",
  "sudah cukup",
  "gak jadi",
  "tidak jadi"
];

if (STOP_KEYWORDS.some(k => body.includes(k))) {

  
  const tickets = db.tickets || {};

  for (const id in tickets) {
    const t = tickets[id];
    if (t && t.from === from) {
      t.followUpSent = true;
      t.type = "CLOSED";
      t.optOut = true;
    }
  }

  if (!db.meta) db.meta = {};
  if (!db.meta.optOut) db.meta.optOut = {};
  db.meta.optOut[from] = Date.now();

  saveDBFile(db);

  await safeSendWhatsApp(
    from,
    "Baik 👍\n\nKami tidak akan mengirim follow up lagi.\nJika suatu saat butuh bantuan transmisi matic, tinggal chat ya 🙏\n\n— Hongz Bengkel"
  );

  console.log("User opted out:", from);

  return res.sendStatus(200);
}

  // detections
  const cmdTowing = isCommand(body, "TOWING");
  const cmdJadwal = isCommand(body, "JADWAL");
  const acMode = detectAC(body);
  const noStart = detectNoStart(body);
  const cantDrive = detectCantDrive(body);       
  const slipMode = detectSlip(body);
const oliMode = detectOli(body);
const overhaulMode = detectOverhaul(body);
  const priceOnly = detectPriceOnly(body);
  const buying = detectBuyingSignal(body);

// ================= TYPE ROUTING (ELITE NUMBERED) =================

// 1) General question -> jawab singkat & stop
if (isGeneralQuestion(body)) {
  saveDBFile(db);
  return replyTwiML(res, generalPrompt(style));
}

 else if (slipMode) {

  ticket.type = "SLIP";
  saveDBFile(db);

  return replyTwiML(res, slipPromptElite(style));
}

// 1️⃣ General
if (isGeneralQuestion(body)) {
  saveDBFile(db);
  return replyTwiML(res, generalPrompt(style));
}

// 2️⃣ SLIP
else if (slipMode) {
  ticket.type = "SLIP";
  saveDBFile(db);
  return replyTwiML(res, slipPromptElite(style));
}

// 3️⃣ OLI MATIC
else if (oliMode) {
  ticket.type = "OLI";
  saveDBFile(db);
  return replyTwiML(res, oliPrompt(style));
}

// 4️⃣ OVERHAUL
else if (overhaulMode) {
  ticket.type = "OVERHAUL";
  saveDBFile(db);
  return replyTwiML(res, overhaulPrompt(style));
}

// 5️⃣ TOWING / TIDAK JALAN
else if (cmdTowing || cantDrive || hasLoc) {
  ticket.type = "TOWING";
}

// 🔥 0) HARD CONFIRM AC
else if (String(body || "").toLowerCase().includes("siap besok")) {
  ticket.type = "AC_CONFIRMED";
  ticket.confirmedAt = Date.now();
  saveDBFile(db);

  // ⏳ AUTO FOLLOW UP 10 MENIT
  setTimeout(() => {
    const db2 = loadDBFile();
    const t = db2.tickets[ticketId];

    if (t && t.type === "AC_CONFIRMED") {
      sendWhatsAppMessage(
        from,
        "Halo Bang 👋\n\n" +
          "Besok jadi datang sesuai jam yang dikirim ya?\n" +
          "Kalau ada perubahan waktu kabari supaya teknisi bisa kami atur ulang 🙏"
      );
    }
  }, 10 * 60 * 1000); // 10 menit

  return replyTwiML(
    res,
    "Siap Bang ✅ Kedatangan BESOK kami konfirmasi.\n\n" +
      "Unit langsung masuk pengecekan saat tiba.\n" +
      "Mohon datang sesuai jam yang dikirim ya supaya tidak menunggu.\n\n" +
      "Sampai ketemu di Hongz 👑"
  );
}

// 4) AC (ELITE)
else if (acMode) {

  // 🔥 Kalau user AC + tanya booking → langsung closing
  if (buying || cmdJadwal) {
    ticket.type = "AC";
    saveDBFile(db);
    return replyTwiML(res, acBookingCloseText(style));
  }

  // 🔁 Kalau sudah pernah masuk AC, jangan ulang edukasi panjang
  if (ticket.type === "AC") {
    saveDBFile(db);
    return replyTwiML(
      res,
      "Siap Bang ✅ Biar cepat, jawab ini ya:\n" +
      "1) Dinginnya hilang total atau cuma kurang dingin?\n" +
      "2) Terakhir servis AC kapan?\n" +
      "3) Mobil apa & tahun berapa?"
    );
  }

  // 🟢 Pertama kali masuk AC
  ticket.type = "AC";
  saveDBFile(db);
  return replyTwiML(res, acPromptElite(style));
}

// 5) Jadwal / closing signal (khusus NON-AC)
else if ((cmdJadwal || buying) && !acMode) {
  ticket.type = "JADWAL";
}

// 6) No start
else if (noStart) {
  ticket.type = "NO_START";
}

// 7) Default fallback
else {
  ticket.type = "GENERAL";
}

 // 🔥 PRIORITY BOOST + ESCALATION (AC ONLY)
if (ticket.type === "AC" || ticket.type === "AC_CONFIRMED") {

  ticket.priority = "HIGH";
  saveDBFile(db);

  const cooldownKey = `high_${ticket.id}`;

  if (canSendCooldown(db, cooldownKey, 5 * 60 * 1000)) {

    const msg =
      "🔥 LEAD HIGH AC\n" +
      "Ticket: " + ticket.id + "\n" +
      "Type: " + ticket.type + "\n" +
      "Isi: " + String(body || "").slice(0, 120);

    safeSendWhatsApp(process.env.WHATSAPP_ADMIN, msg);
    safeSendWhatsApp(process.env.WHATSAPP_RADAR, msg);

    radarPing(db, {
      type: "HIGH_LEAD",
      from,
      ticketType: ticket.type
    });

    saveDBFile(db);
  }

  // ⏱ ESCALATION 15 MENIT (HANYA AC)
  setTimeout(() => {
    try {
      const db3 = loadDBFile();
      const t3 = db3.tickets && db3.tickets[ticket.id];
      if (!t3) return;

      if (t3.priority !== "HIGH") return;

      const escKey = `esc_${t3.id}`;
      if (!canSendCooldown(db3, escKey, 30 * 60 * 1000)) return;

      const escMsg =
        "🚨 ESCALATION 15 MENIT\n" +
        "Ticket: " + t3.id + "\n" +
        "Type: " + t3.type + "\n" +
        "Isi: " + String(t3.lastBody || "").slice(0, 160);

      safeSendWhatsApp(process.env.WHATSAPP_ADMIN, escMsg);
      safeSendWhatsApp(process.env.WHATSAPP_RADAR, escMsg);

      radarPing(db3, {
        type: "ESCALATE_15M",
        ticketId: t3.id
      });

      saveDBFile(db3);

    } catch (e) {
      console.error("esc15m error:", e);
    }
  }, 15 * 60 * 1000);
}

const score = leadScore({
  body,
  hasLoc,
  cantDrive,
  isJadwal: (ticket.type === "JADWAL"),
  isTowing: (ticket.type === "TOWING"),
  isSlip: (ticket.type === "SLIP"),
});

  updateTicket(ticket, {
    score,
    lastBody: body,
    lastInboundAtMs: nowMs(),
  });

  const waMe = toWaMe(from);
  const snippet = body.replace(/\s+/g, " ").slice(0, 80);

  // events
  db.events.push({
    t: nowISO(),
    from,
    to,
    body,
    ticketId: ticket.id,
    type: ticket.type,
    stage: ticket.stage,
    score,
    locationUrl: ticket.locationUrl || "",
  });
  if (db.events.length > 4000) db.events = db.events.slice(-2000);

  // radar + admin notify (non-blocking but awaited safely)
  await radarPing(db, {
    ticketId: ticket.id,
    from,
    waMe,
    type: ticket.type,
    stage: ticket.stage,
    score,
    locationUrl: ticket.locationUrl || "",
    snippet,
  });
  await adminNotify(db, {
    ticketId: ticket.id,
    from,
    waMe,
    type: ticket.type,
    stage: ticket.stage,
    score,
    locationUrl: ticket.locationUrl || "",
    snippet,
  });

  // ================= RULES PRIORITY (ONE BIG BLOCK) =================

  // 1) Lokasi diminta -> jawaban maps saja
  if (/alamat|lokasi|maps|map|di mana|dimana/i.test(body)) {
    saveDBFile(db);
    return replyTwiML(res, `Untuk lokasi, silakan buka: ${MAPS_LINK}`);
  }

  // 2) Lokasi diterima (coords/maps link)
  if (hasLoc) {
    ticket.type = "TOWING";
    saveDBFile(db);
    return replyTwiML(
      res,
      [
        "Baik Bang, lokasi sudah kami terima ✅",
        "Admin akan follow up untuk langkah berikutnya (termasuk evakuasi/towing bila diperlukan).",
        "",
        confidenceLine(style),
        "",
        signatureTowing(),
      ].join("\n")
    );
  }

  // 3) Towing / tidak bisa jalan (urgent) — SMART STICKY (NO LOOP)
if (ticket.type === "TOWING") {
  const towingIntent = detectTowingIntent(body) || hasLoc || (style === "urgent");
  const pingOnly = isGenericPing(body);

  // Kalau user cuma ping ("bang/pak/mau tanya/tes") -> jangan spam towing template.
  // Biarkan jatuh ke DEFAULT AI agar jawab nyambung & manusiawi.
  if (!towingIntent && pingOnly) {
    // do nothing (lanjut ke bawah)
  } else if (towingIntent) {
    const msg = [
      "Baik Bang.",
      "Kalau unit sudah *tidak bisa jalan/bergerak*, jangan dipaksakan dulu — bisa memperparah kerusakan.",
      "",
      "Silakan kirim *share lokasi sekarang*.",
      `⚡ Untuk respons tercepat, langsung *voice call Admin*: ${WHATSAPP_ADMIN}`,
      "",
      confidenceLine(style),
      towingSignatureOnce(ticket), // signature 1x per ticket
    ].filter(Boolean).join("\n");

    saveDBFile(db); // simpan setelah flag _towingSigSent di-set
    return replyTwiML(res, msg);
  }
}

// 3B) SLIP FLOW (lebih manusia & nyambung)
if (ticket.type === "SLIP") {
  saveDBFile(db);
  return replyTwiML(
    res,
    [
      greet, // sudah ikut greetWord()
      "Kalau *selip* di matic, saya perlu pastikan dulu ini selip ringan atau sudah mulai berat.",
      "",
      "1) Selipnya terjadi saat *D* jalan, atau saat pindah gigi (1-2/2-3)?",
      "2) RPM naik tapi mobil *masih maju pelan* atau *sama sekali tidak narik*?",
      "",
      "Biar cepat: kirim *tipe mobil + tahun* + sejak kapan gejala muncul.",
      "",
      confidenceLine(style),
      "",
      signatureShort(),
    ].join("\n")
  );
}
  // 4) JADWAL / booking
  if (ticket.type === "JADWAL") {
    saveDBFile(db);
    return replyTwiML(
      res,
      [
        "Siap Bang ✅ Untuk booking, kirim data singkat ya:",
        "1) Nama",
        "2) Mobil & tahun",
        "3) Keluhan utama (singkat)",
        "4) Mau datang hari & jam berapa",
        "",
        `⚡ Butuh cepat? Voice call Admin: ${WHATSAPP_ADMIN}`,
        "",
        confidenceLine(style),
        "",
        signatureShort(),
      ].join("\n")
    );
  }

  // 5) AC FLOW (STEP 1–2–3) — stabil & tidak muter
  if (ticket.type === "AC") {
    const t = String(body || "").toLowerCase();

    // STEP 1
    if (Number(ticket.stage || 0) < 1) {
      ticket.stage = 1;
      saveDBFile(db);
      return replyTwiML(
        res,
        [
          "Siap Bang, saya fokus *AC* dulu ya (bukan matic).",
          "",
          "1) AC-nya *tidak dingin sama sekali* atau *dingin sebentar lalu panas*?",
          "2) Blower angin *kencang* atau *lemah*?",
          "",
          "Biar cepat: kirim *tipe mobil + tahun*.",
          "",
          confidenceLine(style),
          "",
          signatureShort(),
        ].join("\n")
      );
    }

    // STEP 2
    const hasBasicACInfo =
      hasVehicleInfo(body) ||
      /\b(19\d{2}|20\d{2})\b/.test(t) ||
      /tidak dingin|dingin sebentar|panas|blower|kompresor|freon|extra fan|kipas|servis|service|kasar/i.test(t);

    if (Number(ticket.stage || 0) === 1 && hasBasicACInfo) {
      ticket.stage = 2;
      saveDBFile(db);
      return replyTwiML(
        res,
        [
          "Baik Bang, saya tangkap ya.",
          "Gejala *dingin sebentar lalu panas + kompresor kasar* paling sering terkait:",
          "• tekanan freon drop / ada kebocoran ringan",
          "• extra fan lemah (kondensor panas)",
          "• kompresor mulai berat / magnetic clutch bermasalah",
          "",
          "Biar tidak merembet, paling aman kita cek langsung (singkat) di bengkel.",
          "",
          "Ketik *JADWAL* untuk booking ya Bang.",
          "",
          confidenceLine(style),
          "",
          signatureShort(),
        ].join("\n")
      );
    }

    // STEP 3
    if (Number(ticket.stage || 0) >= 2) {
      saveDBFile(db);
      return replyTwiML(
        res,
        [
          "Siap Bang ✅",
          "Kalau mau langsung beres tanpa coba-coba, kirim *hari & jam datang* ya.",
          "Admin siapkan slot.",
          "",
          confidenceLine(style),
          "",
          signatureShort(),
        ].join("\n")
      );
    }
  }

  // 6) NO START
  if (ticket.type === "NO_START") {
    saveDBFile(db);
    return replyTwiML(
      res,
      [
        "Tenang Bang, kita cek cepat ya.",
        "Saat distarter: *cekrek/lemot* atau *muter normal tapi tidak nyala*?",
        "Lampu dashboard: *terang* atau *redup/mati*?",
        "",
        "Biar cepat: kirim video saat distarter + tipe mobil & tahun.",
        "",
        confidenceLine(style),
        "",
        signatureShort(),
      ].join("\n")
    );
  }


  // 7) DEFAULT: AI / fallback — NATURAL ELITE v2

  const hasVehicle = hasVehicleInfo(body);
  const lowIntent = detectSoftLowIntent(body);
  const isUrgent = (ticket.type === "TOWING") || cantDrive || hasLoc;
  const lane = String(ticket.type || "GENERAL");

  const lvl = authorityLevel({
    score: Number(ticket.score || score || 0),
    isUrgent,
    hasLoc: !!hasLoc,
    hasVehicle,
    buyingSignal: !!buying,
  });
const memorySnippet =
buildMemorySnippet(db.customers[customerId], ticket);

  // ===== Micro smalltalk (tidak muncul kalau urgent) =====
  function microSmalltalk(style) {
    if (isUrgent) return "";

    const warm = [
      "Semoga mobilnya masih aman ya Bang.",
      "Tenang dulu ya Bang, kita pelan-pelan arahkan.",
      "Yang penting kita pastikan dulu langkah paling aman."
    ];

    const pro = [
      "Baik, kita pastikan arahnya tepat dulu.",
      "Supaya tidak salah langkah, kita cek arahnya dulu.",
    ];

    const senior = [
      "Kasus seperti ini sering terjadi, tapi masih bisa kita arahkan.",
      "Biasanya ada pola tertentu, nanti kita cocokkan dulu."
    ];

    let pool = pro;
    if (style === "warm") pool = warm.concat(pro);
    if (style === "senior") pool = senior.concat(pro);

    return pool[Math.floor(Math.random() * pool.length)];
  }

  const smalltalk = microSmalltalk(style);

  const laneRule =
    priceOnly
      ? "Jika user hanya tanya harga tanpa info → minta mobil+tahun+gejala singkat, lalu arahkan ke diagnosa singkat."
      : lowIntent
        ? "Jika user masih lihat-lihat atau banyak tanya tanpa info → jawab hangat tapi arahkan minta mobil+tahun+gejala."
        : "";

  const aiCore = await aiReply(body, {
    laneRule,
    style
  });

  const closeLine = softClose({ lvl, lane, style });

  // ===== Jika AI berhasil =====
  if (aiCore) {

    const out = [
      smalltalk ? smalltalk : "",
      aiCore,
      "",
      closeLine,
      "",
      confidenceLine(style),
      "",
      signatureShort(),
    ].filter(Boolean).join("\n");

    saveDBFile(db);
    return replyTwiML(res, out);
  }

  // ===== Fallback (kalau AI gagal) =====
  const fallback = [
    smalltalk ? smalltalk : "",
    "Saya bantu arahkan dulu ya.",
    hasVehicle
      ? (style === "pro"
          ? "Keluhan yang paling terasa apa ya Pak?"
          : "Keluhan yang paling terasa apa ya Bang?")
      : (style === "pro"
          ? "Boleh info mobil & tahunnya dulu ya Pak?"
          : "Boleh info mobil & tahun dulu ya Bang?"),
    "",
    closeLine,
    "",
    confidenceLine(style),
    "",
    signatureShort(),
  ].filter(Boolean).join("\n");

  saveDBFile(db);
  return replyTwiML(res, fallback);}


// ================= ROUTES =================
app.post("/twilio/webhook", async (req, res) => {
  try {
    console.log("[TWILIO HIT] /twilio/webhook", {
      from: req.body?.From,
      body: req.body?.Body,
      ct: req.headers["content-type"],
    });
    return await webhookHandler(req, res);
  } catch (e) {
    console.error("webhook error:", e?.message || e);
    return replyTwiML(res, "Maaf Bang, sistem lagi padat 🙏 Silakan ulangi sebentar lagi.");
  }
});

app.get("/health", (req, res) => res.status(200).send("OK"));

app.get("/", (_req, res) => {
  const ok = [
    "HONGZ AI SERVER v2.1 — OK",
    `TwilioClient: ${twilioClient ? "READY" : "MISSING_SID_OR_TOKEN"}`,
    `TWILIO_WHATSAPP_FROM: ${TWILIO_WHATSAPP_FROM ? "SET" : "NOT_SET"}`,
    `ADMIN_WHATSAPP_TO: ${ADMIN_WHATSAPP_TO ? "SET" : "NOT_SET"}`,
    `MONITOR_WHATSAPP_TO: ${MONITOR_WHATSAPP_TO ? "SET" : "NOT_SET"}`,
    `OpenAI: ${OPENAI_API_KEY ? "SET" : "NOT_SET"}`,
    `DB: ${DB_FILE}`,
  ].join("\n");
  return res.status(200).send(ok);
});

function requireCronKey(req) {
  const key = String(req.query.key || "");
  if (!process.env.CRON_KEY || key !== process.env.CRON_KEY) {
    return false;
  }
  return true;
}

// ==============================
// 🔁 CRON FOLLOW UP ENGINE (ELITE)
// ==============================
app.get("/cron/followup", async (req, res) => {
  try {
    // ✅ keamanan: pakai key query
  if (!requireCronKey(req)) {
  return res.status(403).send("Forbidden");
}

    const db = loadDBFile();
    const now = Date.now();

    let triggered = 0;

    const tickets = db.tickets || {};
    for (const id in tickets) {
      const t = tickets[id];
      if (!t) continue;

      const last = t.lastInboundAtMs;
      if (!last) continue;

      const minutesIdle = (now - last) / 60000;

      // ✅ STOP keyword (kalau customer minta stop)
      

// ✅ STOP / OPT-OUT (jangan follow up lagi)
if (t.optOut) continue;
if (t.type === "CLOSED") continue;

      // ✅ cek eligible
      if (!isEligibleForFollowUp(t, now, minutesIdle)) continue;

      // ✅ pilih stage follow up
      const stage = pickFollowUpStage(t, minutesIdle);
      if (!stage) continue;

      // ✅ cooldown global follow-up per ticket (anti spam)
      const fuKey = `fu_${t.id}_stage_${stage}`;
      if (!canSendCooldown(db, fuKey, 60 * 60 * 1000)) { // 1 jam cooldown per stage
        continue;
      }

      const msg = buildFollowUpMessage(t, stage);

      // ✅ KIRIM ke customer
      await safeSendWhatsApp(t.from, msg);

      // ✅ TANDAI stage terkirim
      if (stage === 1) t.fu1Sent = true;
      if (stage === 2) t.fu2Sent = true;
      if (stage === 3) t.fu3Sent = true;

      // ✅ log
      triggered++;

      // ✅ optional: notify admin/radar kalau follow-up ditembak
      safeSendWhatsApp(
        process.env.WHATSAPP_ADMIN,
        `✅ FOLLOWUP SENT\nTicket: ${t.id}\nStage: ${stage}\nType: ${t.type}\nTo: ${t.from}`
      );
    }

    saveDBFile(db);
    res.status(200).send("OK - Followup checked: " + triggered);

  } catch (err) {
    console.error("Cron followup error:", err);
    res.status(500).send("Error");
  }
});

// ================= START =================
app.listen(Number(PORT || 3000), () => {
  console.log("HONGZ AI SERVER v2.1 — START");
  console.log("PORT:", PORT);
  console.log("POST /twilio/webhook");
});