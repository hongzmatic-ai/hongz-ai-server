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

const OAI_MAXTOK = Number(OPENAI_MAX_OUTPUT_TOKENS || 450);
const OAI_TEMP = Number(OPENAI_TEMPERATURE || 0.55);
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

function signatureTowing() {di 
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

// ================= CONVERSATION PHASE DETECTOR =================
function detectConversationPhase({ score = 0, ticketType = "GENERAL", body = "" }) {
  const t = String(body || "").toLowerCase();

  if (ticketType === "TOWING") return "A"; // dominan darurat

  if (/(jadwal|booking|siap|datang|besok|hari ini)/.test(t))
    return "C"; // closing

  if (score >= 7) return "A"; // serius tinggi

  return "B"; // default seimbang
}

// ================= HONGZ ATF DATABASE =================
const ATF_DATABASE = {
  policy: "Hongz Bengkel menggunakan oli transmisi Idemitsu sebagai standar layanan.",

  toyota_at: {
    brand: "Idemitsu",
    type: "ATF WS",
    suitable: [
      "Avanza AT",
      "Xenia AT",
      "Rush AT",
      "Terios AT",
      "Innova AT",
      "Camry AT",
      "Calya AT",
      "Sigra AT",
      "Fortuner AT bensin"
    ],
    interval: "sekitar 20.000 km untuk menjaga umur transmisi",
    notes: "AT konvensional Toyota / Daihatsu"
  },

  toyota_cvt: {
    brand: "Idemitsu",
    type: "CVTF Type TL / TC",
    suitable: [
      "Yaris CVT",
      "Corolla Cross CVT",
      "Raize CVT",
      "Agya CVT",
      "Yaris Cross CVT",
      "Veloz CVT",
      "Velloz CVT",
      "Rocky CVT",
      "Ayla CVT"
    ],
    interval: "sekitar 20.000 km untuk menjaga umur transmisi",
    notes: "CVT Toyota / Daihatsu modern"
  },

  honda_cvt: {
    brand: "Idemitsu",
    type: "CVTF HCF-2",
    suitable: [
      "Honda Jazz CVT",
      "BR-V CVT",
      "HR-V CVT",
      "Brio CVT",
      "Mobilio CVT",
      "WR-V CVT",
      "City Hatchback CVT",
      "CR-V CVT"
    ],
    interval: "sekitar 20.000 km untuk menjaga umur transmisi",
    notes: "CVT Honda"
  },

  mitsubishi_at: {
    brand: "Idemitsu",
    type: "ATF SP III",
    suitable: [
      "Pajero Sport AT",
      "Montero AT",
      "Xpander AT",
      "Xpander Cross AT",
      "Outlander AT",
      "Hyundai AT tertentu",
      "Kia AT tertentu"
    ],
    interval: "sekitar 20.000 km untuk menjaga umur transmisi",
    notes: "AT Mitsubishi / Hyundai / Kia tertentu"
  },

  mitsubishi_cvt: {
    brand: "Idemitsu",
    type: "CVTF",
    suitable: [
      "Xpander CVT",
      "Xforce CVT",
      "Mirage CVT",
      "Attrage CVT"
    ],
    interval: "sekitar 20.000 km untuk menjaga umur transmisi",
    notes: "CVT Mitsubishi"
  },

  nissan_cvt: {
    brand: "Idemitsu",
    type: "NS-2 / NS-3",
    suitable: [
      "Nissan X-Trail CVT",
      "Serena CVT",
      "Grand Livina CVT",
      "Livina CVT",
      "Juke CVT",
      "March CVT"
    ],
    interval: "sekitar 20.000 km untuk menjaga umur transmisi",
    notes: "CVT Nissan"
  },

  dct_dsg: {
    brand: "Idemitsu",
    type: "DCTF / DSG Fluid",
    suitable: [
      "VW DSG",
      "Audi DSG",
      "Ford Powershift",
      "DCT tertentu"
    ],
    interval: "sekitar 20.000 km untuk menjaga umur transmisi",
    notes: "DCT / DSG"
  },

  universal: {
    brand: "Idemitsu",
    type: "ATF sesuai spesifikasi gearbox",
    suitable: ["Perlu cek model mobil + tahun + tipe transmisi"],
    interval: "sekitar 20.000 km untuk menjaga umur transmisi",
    notes: "Fallback default Hongz"
  }
};

// ================= TEXT NORMALIZER =================
function normalizeText(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ================= DETECT USER ASKING ABOUT ATF =================
function isAskingATF(text = "") {
  const t = normalizeText(text);
  return /(oli matic|oli transmisi|atf|cvtf|merk oli|pakai oli apa|pakai merk apa|oli apa|oli gearbox|oli cvt)/i.test(t);
}

// ================= ATF PICKER =================
function getATFInfoByText(text = "") {
  const t = normalizeText(text);

  // Toyota / Daihatsu AT konvensional
  if (/(avanza|xenia|rush|terios|innova|camry|calya|sigra|fortuner)/i.test(t)) {
    return ATF_DATABASE.toyota_at;
  }

  // Toyota / Daihatsu CVT
  if (/(yaris|corolla cross|raize|agya|rocky|ayla|yaris cross|veloz cvt|velloz cvt)/i.test(t)) {
    return ATF_DATABASE.toyota_cvt;
  }

  // Honda CVT
  if (/(jazz|brv|br-v|hrv|hr-v|brio|mobilio|wrv|wr-v|city hatchback|crv cvt|cr-v cvt)/i.test(t)) {
    return ATF_DATABASE.honda_cvt;
  }

  // Mitsubishi AT
  if (/(pajero|montero|xpander at|xpander cross at|outlander at|hyundai at|kia at)/i.test(t)) {
    return ATF_DATABASE.mitsubishi_at;
  }

  // Mitsubishi CVT
  if (/(xpander cvt|xforce|mirage cvt|attrage cvt)/i.test(t)) {
    return ATF_DATABASE.mitsubishi_cvt;
  }

  // Nissan CVT
  if (/(xtrail|x-trail|serena|grand livina|livina cvt|juke|march cvt)/i.test(t)) {
    return ATF_DATABASE.nissan_cvt;
  }

  // DCT / DSG
  if (/(dct|dsg|double clutch|powershift|golf|jetta|passat|tiguan|vw|volkswagen|audi)/i.test(t)) {
    return ATF_DATABASE.dct_dsg;
  }

  // Fallback kalau user tanya oli tapi mobil belum jelas
  if (isAskingATF(t) || /(matic|otomatis|transmisi matic|cvt)/i.test(t)) {
    return ATF_DATABASE.universal;
  }

  return null;
}

// ================= AUTO DETECT TRANSMISSION TYPE =================
function detectTransmissionType(text = "") {
  const t = normalizeText(text);

  if (/\b(cvt|cvtf|pulley|belt cvt|steel belt)\b/i.test(t)) {
    return {
      type: "CVT",
      confidence: "high",
      reason: "User menyebut kata kunci CVT secara langsung."
    };
  }

  if (/\b(dct|dsg|double clutch|kopling ganda|powershift)\b/i.test(t)) {
    return {
      type: "DCT",
      confidence: "high",
      reason: "User menyebut kata kunci DCT/DSG secara langsung."
    };
  }

  if (/\b(at|matic biasa|matic konvensional|torque converter|atf ws|sp iii)\b/i.test(t)) {
    return {
      type: "AT",
      confidence: "high",
      reason: "User menyebut kata kunci AT konvensional secara langsung."
    };
  }

  if (/(avanza|xenia|rush|terios|innova|camry|fortuner|calya|sigra)/i.test(t)) {
    return {
      type: "AT",
      confidence: "medium",
      reason: "Model kendaraan umum AT konvensional."
    };
  }

  if (/(hrv|hr-v|jazz|brio|mobilio|wr-v|wrv|city hatchback|crv cvt|cr-v cvt|yaris cross|corolla cross|raize|rocky|ayla|agya|xtrail|x-trail|serena|livina cvt|juke|march|xpander cvt|xforce)/i.test(t)) {
    return {
      type: "CVT",
      confidence: "medium",
      reason: "Model kendaraan umum CVT."
    };
  }

  if (/(golf|jetta|passat|tiguan|audi|vw|volkswagen)/i.test(t)) {
    return {
      type: "DCT",
      confidence: "medium",
      reason: "Model kendaraan umum DSG/DCT."
    };
  }

  if (/(belt selip|pulley|dengung cvt|gredek cvt)/i.test(t)) {
    return {
      type: "CVT",
      confidence: "medium",
      reason: "Gejala lebih dekat ke karakter CVT."
    };
  }

  if (/(selip kopling ganda|mechatronic|overheat dsg|gigi ganjil genap)/i.test(t)) {
    return {
      type: "DCT",
      confidence: "medium",
      reason: "Gejala lebih dekat ke karakter DCT/DSG."
    };
  }

  if (/(nyentak masuk d|mundur delay|kickdown keras|torque converter|masuk d keras)/i.test(t)) {
    return {
      type: "AT",
      confidence: "low",
      reason: "Gejala cenderung AT konvensional, perlu verifikasi."
    };
  }

  return {
    type: "UNKNOWN",
    confidence: "low",
    reason: "Belum cukup data untuk memastikan jenis transmisi."
  };
}

// ================= AUTO DETECT SEVERITY LEVEL =================
function detectSeverityLevel(text = "") {
  const t = normalizeText(text);

  const ringanKeywords = [
    "telat pindah",
    "agak telat",
    "sedikit getar",
    "kadang nyentak",
    "oli hitam",
    "belum pernah ganti oli",
    "service berkala",
    "perawatan",
    "bunyi halus",
    "dengung ringan",
    "baru terasa",
    "kadang saja"
  ];

  const sedangKeywords = [
    "nyentak",
    "jedug",
    "selip",
    "rpm naik tapi tidak lari",
    "rpm tinggi tapi tidak lari",
    "masuk d lambat",
    "mundur lambat",
    "gredek",
    "overheat",
    "getar saat jalan",
    "kickdown keras",
    "tenaga kosong",
    "transmisi panas",
    "masuk d delay",
    "mundur delay"
  ];

  const beratKeywords = [
    "tidak bisa jalan",
    "tidak mau jalan",
    "mobil tidak bergerak",
    "hilang gigi",
    "gagal jalan",
    "mundur tidak mau",
    "masuk d tidak mau",
    "mati total",
    "suara kasar keras",
    "bunyi keras",
    "ngunci",
    "slip parah",
    "harus towing",
    "asap",
    "bau gosong berat",
    "d dan r tidak jalan",
    "masuk d dan r tidak gerak"
  ];

  let ringan = 0;
  let sedang = 0;
  let berat = 0;

  for (const k of ringanKeywords) {
    if (t.includes(k)) ringan += 1;
  }

  for (const k of sedangKeywords) {
    if (t.includes(k)) sedang += 2;
  }

  for (const k of beratKeywords) {
    if (t.includes(k)) berat += 3;
  }

  if (/(tidak bisa jalan|tidak mau jalan|mobil tidak bergerak|harus towing|masuk d dan r tidak gerak)/i.test(t)) {
    berat += 4;
  }

  if (/(nyentak|jedug|selip|gredek|mundur lambat|masuk d lambat|rpm tinggi tapi tidak lari)/i.test(t)) {
    sedang += 2;
  }

  if (/(ganti oli|servis berkala|baru terasa ringan|kadang saja)/i.test(t)) {
    ringan += 1;
  }

  if (berat >= 4) {
    return {
      level: "BERAT",
      advice: "Jangan dipaksakan jalan. Prioritaskan pengecekan langsung / towing bila perlu.",
      score: berat
    };
  }

  if (sedang >= 2) {
    return {
      level: "SEDANG",
      advice: "Masih bisa mengarah ke kerusakan berkembang. Sarankan cek sebelum dipakai jauh.",
      score: sedang
    };
  }

  if (ringan >= 1) {
    return {
      level: "RINGAN",
      advice: "Masih tahap awal / indikasi ringan. Cocok diarahkan ke perawatan dan pengecekan dini.",
      score: ringan
    };
  }

  return {
    level: "BELUM JELAS",
    advice: "Gejala belum cukup detail. Minta 1-2 info tambahan: mobil, tahun, gejala paling terasa.",
    score: 0
  };
}

// ================= HONGZ TRANSMISSION SYMPTOM DATABASE =================
const TRANSMISSION_SYMPTOMS = [
  {
    id: "SYM_01",
    keywords: ["rpm naik", "mobil tidak jalan", "mesin naik tapi mobil tidak jalan"],
    possible: ["kampas kopling selip", "torque converter bermasalah", "tekanan oli transmisi lemah"],
    severity: "high"
  },
  {
    id: "SYM_02",
    keywords: ["masuk d tidak jalan", "masuk gigi d tidak jalan", "d tidak respon"],
    possible: ["torque converter rusak", "tekanan oli transmisi hilang", "kampas maju aus"],
    severity: "high"
  },
  {
    id: "SYM_03",
    keywords: ["masuk r tidak jalan", "gigi mundur tidak jalan", "r tidak respon"],
    possible: ["kampas reverse aus", "seal bocor", "tekanan oli reverse lemah"],
    severity: "high"
  },
  {
    id: "SYM_04",
    keywords: ["hentak", "jedug", "kasar pindah gigi", "pindah gigi keras"],
    possible: ["solenoid lemah", "valve body kotor", "tekanan oli tidak stabil"],
    severity: "medium"
  },
  {
    id: "SYM_05",
    keywords: ["delay masuk d", "masuk d telat", "d masuk lama"],
    possible: ["tekanan oli lemah", "seal piston bocor", "kampas mulai aus"],
    severity: "high"
  },
  {
    id: "SYM_06",
    keywords: ["delay masuk r", "mundur telat", "r masuk lama"],
    possible: ["kampas reverse aus", "valve body bermasalah", "tekanan oli reverse rendah"],
    severity: "high"
  },
  {
    id: "SYM_07",
    keywords: ["selip", "slip", "ngelos"],
    possible: ["kampas kopling aus", "oli transmisi lemah", "tekanan oli drop"],
    severity: "high"
  },
  {
    id: "SYM_08",
    keywords: ["getar", "vibrasi", "bergetar saat jalan"],
    possible: ["torque converter tidak stabil", "mounting perlu dicek", "kampas mulai aus"],
    severity: "medium"
  },
  {
    id: "SYM_09",
    keywords: ["dengung", "bunyi dengung", "ngorok"],
    possible: ["bearing transmisi aus", "pompa oli bermasalah", "gear set perlu dicek"],
    severity: "medium"
  },
  {
    id: "SYM_10",
    keywords: ["bunyi kasar", "suara kasar", "berisik"],
    possible: ["bearing aus", "gear train bermasalah", "komponen internal aus"],
    severity: "high"
  },
  {
    id: "SYM_11",
    keywords: ["overheat", "panas", "transmisi panas"],
    possible: ["cooler tersumbat", "oli transmisi menurun", "beban internal tinggi"],
    severity: "high"
  },
  {
    id: "SYM_12",
    keywords: ["lampu at menyala", "lampu matic menyala", "indikator transmisi menyala"],
    possible: ["fault sensor", "solenoid error", "TCM membaca gangguan transmisi"],
    severity: "medium"
  },
  {
    id: "SYM_13",
    keywords: ["limp mode", "gigi 3 terus", "jalan di satu gigi"],
    possible: ["solenoid error", "sensor transmisi bermasalah", "TCM proteksi"],
    severity: "high"
  },
  {
    id: "SYM_14",
    keywords: ["cvt ngeden", "berat", "lemot tarikan"],
    possible: ["belt cvt aus", "pulley lemah", "tekanan oli cvt rendah"],
    severity: "high"
  },
  {
    id: "SYM_15",
    keywords: ["rpm tinggi", "rpm tinggi tapi lambat", "teriak"],
    possible: ["kampas selip", "rasio cvt tidak naik normal", "tekanan oli tidak cukup"],
    severity: "high"
  },
  {
    id: "SYM_16",
    keywords: ["sentak awal", "jeduk awal jalan", "hentak awal"],
    possible: ["engine mounting perlu dicek", "tekanan oli awal tinggi", "valve body kurang halus"],
    severity: "medium"
  },
  {
    id: "SYM_17",
    keywords: ["kickdown tidak respon", "tenaga kosong saat injak", "gas dalam tidak narik"],
    possible: ["solenoid respon lambat", "tekanan oli tidak cukup", "kampas mulai lemah"],
    severity: "medium"
  },
  {
    id: "SYM_18",
    keywords: ["tidak mau upshift", "gigi tidak naik", "tertahan di gigi bawah"],
    possible: ["solenoid shift bermasalah", "sensor speed error", "valve body macet"],
    severity: "high"
  },
  {
    id: "SYM_19",
    keywords: ["tidak mau downshift", "gigi tidak turun"],
    possible: ["solenoid shift error", "valve body kotor", "TCM perlu dicek"],
    severity: "medium"
  },
  {
    id: "SYM_20",
    keywords: ["hunting gear", "naik turun gigi sendiri", "bingung pindah gigi"],
    possible: ["sensor input/output bermasalah", "solenoid tidak stabil", "tekanan oli fluktuatif"],
    severity: "medium"
  },
  {
    id: "SYM_21",
    keywords: ["masuk netral sendiri", "ngenetral", "hilang tenaga tiba tiba"],
    possible: ["kampas habis", "tekanan oli hilang", "valve body bermasalah"],
    severity: "high"
  },
  {
    id: "SYM_22",
    keywords: ["bocor oli matic", "oli matic bocor", "rembes oli transmisi"],
    possible: ["seal bocor", "gasket karter bocor", "oil seal as bermasalah"],
    severity: "high"
  },
  {
    id: "SYM_23",
    keywords: ["oli hitam", "oli gosong", "bau terbakar"],
    possible: ["kampas terlalu panas", "slip berkepanjangan", "overheat transmisi"],
    severity: "high"
  },
  {
    id: "SYM_24",
    keywords: ["masuk d ada bunyi", "masuk r ada bunyi", "bunyi saat masuk gigi"],
    possible: ["tekanan oli kasar", "mounting lemah", "komponen internal mulai aus"],
    severity: "medium"
  },
  {
    id: "SYM_25",
    keywords: ["tarikan putus putus", "sendat", "nyentak nyentak"],
    possible: ["solenoid tidak stabil", "sensor throttle/input error", "valve body kotor"],
    severity: "medium"
  },
  {
    id: "SYM_26",
    keywords: ["tidak dingin", "ac tidak dingin saat jalan", "rpm naik ac mati"],
    possible: ["beban transmisi tinggi", "idle drop perlu dicek", "kompresor/ac dan transmisi perlu dipisah diagnosa"],
    severity: "low"
  },
  {
    id: "SYM_27",
    keywords: ["berat di tanjakan", "tidak kuat nanjak", "ngeden di tanjakan"],
    possible: ["kampas selip", "belt cvt lemah", "tekanan oli tidak cukup"],
    severity: "high"
  },
  {
    id: "SYM_28",
    keywords: ["mundur ngempos", "reverse lemah", "mundur berat"],
    possible: ["kampas reverse aus", "tekanan oli reverse lemah", "seal bocor"],
    severity: "high"
  },
  {
    id: "SYM_29",
    keywords: ["maju ngempos", "jalan maju lemah"],
    possible: ["kampas forward aus", "torque converter lemah", "tekanan oli maju rendah"],
    severity: "high"
  },
  {
    id: "SYM_30",
    keywords: ["gigi loncat", "perpindahan aneh", "rasio aneh"],
    possible: ["sensor speed error", "TCM/solenoid bermasalah", "valve body tidak stabil"],
    severity: "medium"
  },
  {
    id: "SYM_31",
    keywords: ["suara nging", "whining", "mendering"],
    possible: ["pompa oli transmisi", "bearing aus", "tekanan oli tinggi/rendah abnormal"],
    severity: "medium"
  },
  {
    id: "SYM_32",
    keywords: ["bergetar saat stop", "getar saat d tahan rem"],
    possible: ["torque converter", "mounting mesin/transmisi", "idle mesin perlu dicek"],
    severity: "medium"
  },
  {
    id: "SYM_33",
    keywords: ["ndut ndutan", "dorong tarik", "nyentak pelan pelan"],
    possible: ["lock-up torque converter tidak stabil", "solenoid lock-up", "sensor pembacaan tidak konsisten"],
    severity: "medium"
  },
  {
    id: "SYM_34",
    keywords: ["cvt selip", "cvt slip", "rpm naik cvt tidak jalan"],
    possible: ["belt cvt aus", "pulley aus", "tekanan oli cvt drop"],
    severity: "high"
  },
  {
    id: "SYM_35",
    keywords: ["lampu check menyala", "check engine dan matic", "dtc transmisi"],
    possible: ["sensor transmisi", "solenoid", "komunikasi ECU/TCM perlu scan"],
    severity: "medium"
  },
  {
    id: "SYM_36",
    keywords: ["gigi masuk tapi jeduk", "keras saat masuk d", "keras saat masuk r"],
    possible: ["mounting lemah", "idle tinggi", "valve body/tekanan oli kasar"],
    severity: "medium"
  },
  {
    id: "SYM_37",
    keywords: ["tidak bisa manual mode", "triptronic tidak jalan", "manual shift tidak respon"],
    possible: ["switch manual mode", "sensor posisi transmisi", "TCM perlu dicek"],
    severity: "low"
  },
  {
    id: "SYM_38",
    keywords: ["stuck di n", "masuk gigi tidak bisa", "tuas normal tapi tidak masuk"],
    possible: ["shift lock / linkage", "switch inhibitor", "tekanan transmisi perlu dicek"],
    severity: "high"
  },
  {
    id: "SYM_39",
    keywords: ["berat pagi", "pagi tidak mau jalan", "dingin telat jalan"],
    possible: ["seal mengeras", "tekanan oli saat dingin lemah", "kampas mulai aus"],
    severity: "medium"
  },
  {
    id: "SYM_40",
    keywords: ["setelah panas slip", "panas baru ngelos", "kalau panas bermasalah"],
    possible: ["tekanan oli drop saat panas", "seal bocor saat temperatur naik", "kampas sudah tipis"],
    severity: "high"
  },
  {
    id: "SYM_41",
    keywords: ["mati saat masuk d", "masuk gigi mesin mati", "stalled saat masuk gigi"],
    possible: ["torque converter lock-up", "idle mesin terlalu rendah", "beban masuk terlalu berat"],
    severity: "medium"
  },
  {
    id: "SYM_42",
    keywords: ["bunyi klik", "bunyi tek tek saat masuk gigi"],
    possible: ["mounting/linkage", "komponen mekanis luar", "perlu cek fisik lebih dulu"],
    severity: "low"
  },
  {
    id: "SYM_43",
    keywords: ["raungan tinggi", "teriak saat jalan", "suara tinggi"],
    possible: ["slip rasio", "belt cvt lemah", "pompa oli / tekanan tidak sesuai"],
    severity: "medium"
  },
  {
    id: "SYM_44",
    keywords: ["masuk gigi lambat setelah servis", "habis ganti oli jadi slip", "setelah kuras bermasalah"],
    possible: ["level oli tidak pas", "jenis oli tidak sesuai", "kondisi kampas lama terangkat setelah servis"],
    severity: "high"
  },
  {
    id: "SYM_45",
    keywords: ["maju mundur dua dua nya lemah", "semua gigi lemah", "semua posisi lemah"],
    possible: ["pompa oli transmisi", "torque converter", "tekanan utama sangat rendah"],
    severity: "high"
  },
  {
    id: "SYM_46",
    keywords: ["rpm naik saat pindah", "flare shift", "pindah gigi rpm naik dulu"],
    possible: ["kampas selip saat shift", "solenoid shift lambat", "tekanan oli transisi kurang"],
    severity: "high"
  },
  {
    id: "SYM_47",
    keywords: ["nyangkut di satu gigi", "stuck gear", "gigi tidak berubah"],
    possible: ["limp mode", "solenoid", "sensor speed / TCM perlu scan"],
    severity: "high"
  },
  {
    id: "SYM_48",
    keywords: ["bunyi saat tanjakan", "tanjakan bunyi", "raung saat nanjak"],
    possible: ["belt cvt lemah", "slip internal", "beban transmisi tinggi"],
    severity: "medium"
  },
  {
    id: "SYM_49",
    keywords: ["jalan normal tapi mundur tidak ada", "reverse hilang", "r hilang"],
    possible: ["kampas reverse habis", "seal reverse bocor", "valve reverse bermasalah"],
    severity: "high"
  },
  {
    id: "SYM_50",
    keywords: ["mobil tidak mau gerak", "tidak bisa jalan", "mati gerak"],
    possible: ["torque converter", "kampas utama habis", "tekanan oli transmisi hilang"],
    severity: "critical"
  }
];

function detectTransmissionSymptoms(text = "") {
  const t = String(text || "").toLowerCase();

  const matches = TRANSMISSION_SYMPTOMS.filter(item =>
    item.keywords.some(k => t.includes(k.toLowerCase()))
  );

  if (!matches.length) return null;

  const top = matches.slice(0, 3);

  const possible = [...new Set(top.flatMap(x => x.possible))].slice(0, 4);
  const severityRank = { low: 1, medium: 2, high: 3, critical: 4 };
  const topSeverity = top.reduce((acc, cur) =>
    severityRank[cur.severity] > severityRank[acc] ? cur.severity : acc
  , "low");

  return {
    matchedIds: top.map(x => x.id),
    possible,
    severity: topSeverity
  };
}

function detectBuyingSignal(text = "") {
  const t = normalizeText(text);

  const patterns = [
    "mau servis",
    "mau cek",
    "bisa hari ini",
    "bisa besok",
    "mau datang",
    "saya datang",
    "datang sekarang",
    "mau booking",
    "booking",
    "jadwal",
    "siap datang",
    "alamat mana",
    "lokasi mana",
    "share lokasi",
    "bisa towing",
    "minta towing",
    "nomor admin",
    "bisa dicek",
    "mau periksa",
    "mau ganti oli",
    "langsung ke sana",
    "bengkel buka jam berapa"
  ];

  const hits = patterns.filter(p => t.includes(p));
  return {
    matched: hits,
    hitCount: hits.length,
    isStrong: hits.length >= 1
  };
}

function detectTireKickerSignal(text = "") {
  const t = normalizeText(text);

  const weakSignals = [
    "cuma tanya",
    "tanya dulu",
    "kira kira",
    "berapa aja",
    "murah gak",
    "bisa murah",
    "diskon",
    "paling murah",
    "sekedar info",
    "sekadar info",
    "buat perbandingan",
    "bengkel lain bilang",
    "cara kerjanya gimana",
    "isi apa saja",
    "komponen apa saja",
    "step by step nya apa",
    "kalau bongkar berapa",
    "belum tentu datang",
    "nanti saya pikir dulu"
  ];

  const hits = weakSignals.filter(p => t.includes(p));
  return {
    matched: hits,
    hitCount: hits.length,
    isDetected: hits.length >= 2
  };
}

async function aiReply(userText, context) {
  if (!OPENAI_API_KEY) return null;

  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    // style dari context kalau ada (urgent/formal/casual/neutral)

    const style = String(context?.style || "neutral");

const atfInfo = getATFInfoByText(userText);
const askingATF = isAskingATF(userText);
const transmissionTypeInfo = detectTransmissionType(userText);
const severityInfo = detectSeverityLevel(userText);
const symptomInfo = detectTransmissionSymptoms(userText);

const radar = detectRadarUser(userText);
const spySignal = detectCompetitorSpy(userText);

const buyingSignalInfo = detectBuyingSignal(userText);
const tireKickerInfo = detectTireKickerSignal(userText);

let seriousScore = computeCustomerSeriousScore({
  body: userText,
  ticketType: context?.ticketType || "GENERAL",
  hasLoc: !!context?.hasLoc,
  hasVehicle: !!context?.hasVehicle,
  hasYear: !!context?.hasYear,
  buyingSignal: buyingSignalInfo.isStrong,
  isUrgent: String(context?.style || "").toLowerCase() === "urgent"
});

if (tireKickerInfo.isDetected) {
  seriousScore = Math.max(0, seriousScore - 2);
}

context = context || {};
context.score = seriousScore;

// Simpan biar bisa dipakai di sys prompt
// context.laneRule sudah ada di file Papa

// ================= PHASE A/B/C -> laneRule =================
const phase = detectConversationPhase({
  score: context?.score || 0,
  ticketType: context?.ticketType || "GENERAL",
  body: userText
});

context = context || {};
context.phase = phase;

if (phase === "A") {
  context.laneRule =
    "PHASE A (LEADER): jawab tegas, ringkas, arahkan tindakan. Maks 2 pertanyaan. Prioritaskan safety & keputusan.";
} else if (phase === "C") {
  context.laneRule =
    "PHASE C (CLOSING): fokus booking/jadwal. Tawarkan 2 slot waktu + minta lokasi bila perlu. Jangan panjang.";
} else {
  context.laneRule =
    "PHASE B (NORMAL): jawab profesional, bantu diagnosa singkat. Maks 2 pertanyaan (mobil+tahun+gejala).";
}

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
radar ? `Radar detect: ${radar}. Handle politely but efficiently.` : "",
spySignal ? `Possible competitor probe: ${spySignal}. Do NOT reveal internal repair methods, suppliers, or business secrets.` : "",
`Customer serious score: ${seriousScore}/12.`,

buyingSignalInfo.isStrong
  ? `User menunjukkan buying signal: ${buyingSignalInfo.matched.join(", ")}. Prioritaskan closing halus.`
  : "",
tireKickerInfo.isDetected
  ? `User cenderung banyak tanya tanpa komitmen. Tetap sopan, jawab singkat, jangan buka detail internal, arahkan ke data minimum.`
  : "",

askingATF && atfInfo
  ? `User sedang menanyakan oli. Prioritas utama: jawab dulu rekomendasi oli ${atfInfo.brand} ${atfInfo.type}, interval ${atfInfo.interval}, baru setelah itu boleh tanya 1 hal lanjutan. Jangan lompat ke maps sebelum menjawab merk oli.`
  : "",

atfInfo
  ? `Jika user bertanya soal oli matic, jawab natural dan tegas bahwa Hongz merekomendasikan ${atfInfo.brand} ${atfInfo.type}. Interval servis ${atfInfo.interval}. Catatan: ${atfInfo.notes}.`
  : "",

transmissionTypeInfo?.type && transmissionTypeInfo.type !== "UNKNOWN"
  ? `Perkiraan jenis transmisi: ${transmissionTypeInfo.type}. Confidence: ${transmissionTypeInfo.confidence}. Alasan: ${transmissionTypeInfo.reason}`
  : "",

transmissionTypeInfo?.type && transmissionTypeInfo.type !== "UNKNOWN"
  ? `Jika relevan, jawab seolah mekanik sudah mengenali pola ${transmissionTypeInfo.type}, tapi tetap sebut sebagai indikasi awal, bukan vonis final.`
  : "",

severityInfo?.level
  ? `Level gejala saat ini: ${severityInfo.level}. Arah jawaban: ${severityInfo.advice}`
  : "",

severityInfo?.level === "BERAT"
  ? "Jika level gejala BERAT, sarankan jangan dipaksakan jalan dan prioritaskan pengecekan langsung."
  : "",

symptomInfo ? `Possible transmission diagnosis: ${symptomInfo.possible.join(", ")}. Severity: ${symptomInfo.severity}. Explain as early diagnosis only, not final verdict.` : "",
      "ATURAN WAJIB:",
"RULE LANE A: jika skor serius tinggi, jawab lebih tegas, fokus solusi, dan arahkan ke booking / cek / datang.",
"RULE LANE B: jika skor sedang, jawab inti dulu lalu minta data minimum: mobil + tahun + gejala.",
"RULE LANE C: jika skor rendah, tetap sopan tapi pendek. Jangan terlalu banyak edukasi gratis. Arahkan ke info minimum atau ajak datang cek.",

seriousInfo.lane === "A"
  ? "User tergolong serius. Fokus closing halus: arahkan ke jadwal, datang, booking, towing, atau voice call admin."
  : "",

seriousInfo.lane === "B"
  ? "User masih penjajakan. Jawab inti dulu, lalu minta data minimum."
  : "",

seriousInfo.lane === "C"
  ? "User low-intent / belum jelas. Jawab singkat, sopan, jangan terlalu panjang, dan jangan buka detail teknis internal."
  : "",

"0) Jika user tanya oli matic / ATF / CVTF / merk oli, WAJIB jawab dulu dengan rekomendasi merek Idemitsu + tipe yang sesuai sebelum pertanyaan lanjutan.",
"0b) Hongz Bengkel menggunakan Idemitsu sebagai standar oli transmisi. Jangan sebut merek lain kecuali user membandingkan langsung.",
"0c) Jangan lompat ke maps, booking, atau lokasi sebelum inti pertanyaan oli terjawab.",
"0d) Jika jenis transmisi bisa dibaca dari teks, gunakan itu untuk memperkuat jawaban tanpa terdengar seperti robot.",
"0e) Jika gejala mengarah ke level BERAT, sarankan jangan dipaksakan jalan.",
"0f) Gejala hanya boleh dijelaskan sebagai indikasi awal, bukan vonis final sebelum unit dicek langsung.",
"0g) Jika user menanyakan oli, jawab langsung rekomendasi oli tanpa kalimat pembuka panjang seperti 'saya pahami kondisinya' atau 'supaya tidak salah langkah'.",
"0) Jika user tanya oli matic / ATF / CVTF / merk oli, WAJIB jawab dulu dengan rekomendasi merek Idemitsu + tipe yang sesuai sebelum pertanyaan lanjutan.",
"0b) Hongz Bengkel menggunakan Idemitsu sebagai standar oli transmisi. Jangan sebut merek lain kecuali user membandingkan langsung.",
"0c) Jangan lompat ke maps, booking, atau lokasi sebelum inti pertanyaan oli terjawab.",

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

text = addSoftAuthority(text, context?.phase);

    if (text.length > 650) text = text.slice(0, 650).trim() + "…";
    return text;
  } catch (e) {
    console.error("OpenAI failed:", e?.message || e);
    return null;
  }
}

// ================= NATURAL ELITE — ST EP 2 HELPERS =================
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

function addSoftAuthority(text, phase) {
  if (phase === "C") {
    return text + "\n\nKalau berkenan, kita kunci jadwal supaya mobil tidak makin berat kondisinya.";
  }
  if (phase === "A") {
    return text + "\n\nLebih cepat ditangani, lebih aman untuk komponen lain.";
  }
  return text;
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

// ================= HONGZ AI RADAR =================
function detectRadarUser(body = "") {
  const t = String(body || "").toLowerCase();

  if (/(berapa harga|kisaran biaya|range biaya)/i.test(t))
    return "PRICE_PROBE";

  if (/(murah|diskon|termurah)/i.test(t))
    return "CHEAP_HUNTER";

  if (/(hanya tanya|cuma nanya|tanya dulu)/i.test(t))
    return "TIME_WASTER";

  if (t.length < 3)
    return "SPAM";

  return null;
}

function computeCustomerSeriousScore({
  body = "",
  ticketType = "GENERAL",
  hasLoc = false,
  hasVehicle = false,
  hasYear = false,
  buyingSignal = false,
  isUrgent = false
}) {
  const t = String(body || "").toLowerCase();
  let score = 0;

  // ada mobil disebut
  if (
    hasVehicle ||
    /(avanza|xenia|rush|terios|innova|camry|yaris|hrv|hr-v|jazz|brio|mobilio|xpander|pajero|fortuner|serena|livina)/i.test(t)
  ) {
    score += 2;
  }

  // ada tahun mobil
  if (hasYear || /\b(19|20)\d{2}\b/.test(t)) {
    score += 2;
  }

  // ada lokasi
  if (hasLoc || /(medan|alamat|share lokasi|kirim lokasi|posisi saya|di jalan)/i.test(t)) {
    score += 1;
  }

  // ada gejala transmisi
  if (
    /(nyentak|jedug|selip|slip|gredek|ngelos|delay|loss|rpm naik|tidak jalan|gak jalan|getar|dengung|kasar|overheat)/i.test(t)
  ) {
    score += 2;
  }

  // ada niat datang / booking
  if (buyingSignal || /(booking|jadwal|hari ini|besok|datang|bisa cek|kapan bisa masuk)/i.test(t)) {
    score += 3;
  }

  // kondisi darurat
  if (
    ticketType === "TOWING" ||
    isUrgent ||
    /(darurat|mogok|tidak bisa jalan|gak bisa jalan|harus towing)/i.test(t)
  ) {
    score += 2;
  }

  // hanya tanya harga tanpa data mobil
  if (/(berapa harga|kisaran biaya|range biaya|murah|diskon|termurah)/i.test(t) && !hasVehicle) {
    score -= 2;
  }

  // chat sangat pendek
  if (/^(halo|hai|tes|test|p)$/i.test(t.trim())) {
    score -= 2;
  }

  return Math.max(0, Math.min(score, 12));
}

// ================= HONGZ AI COMPETITOR SPY DETECTOR =================
function detectCompetitorSpy(body = "") {
  const t = String(body || "").toLowerCase();

  const asksInternalProcess =
    /(step|langkah|proses|alur kerja|cara kerja|bongkar apa saja|isi dalamnya)/i.test(t);

  const asksSensitiveParts =
    /(supplier|vendor|part apa|merek part|oli apa|material apa)/i.test(t);

  const asksBusinessSecrets =
    /(modal|untung|margin|harga modal|markup|rahasia bengkel)/i.test(t);

  const tooManyTechQuestions =
    /(overhaul|cvt|atf|torque converter|solenoid|valve body)/i.test(t) &&
    (t.match(/\?/g) || []).length >= 2;

  if (asksBusinessSecrets) return "BUSINESS_SECRET_PROBE";
  if (asksSensitiveParts) return "SENSITIVE_PARTS_PROBE";
  if (asksInternalProcess || tooManyTechQuestions) return "PROCESS_PROBE";

  return null;
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