/*
 * HONGZ AI SERVER — HYBRID C+ ELITE (ONE FILE) — CLEAN FINAL (STABLE)
 * deps: express, body-parser, twilio, openai (^4)
 * optional: firebase-admin (only if FIRESTORE_ENABLED="true")
 */

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const OpenAI = require("openai");

// ================= ENV (SAFE) =================
const {
  // Twilio
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  ADMIN_WHATSAPP_TO,
  MONITOR_WHATSAPP_TO,

  // Optional
  TWILIO_WEBHOOK_URL = "",

  // OpenAI
  OPENAI_API_KEY,
  OPENAI_MODEL_PRIMARY,
  OPENAI_MODEL_FALLBACK,
  OPENAI_TIMEOUT_MS,
  OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_TEMPERATURE,

  // Storage / cron / debug
  DATA_DIR,
  CRON_KEY,
  DEBUG,
} = process.env;

// ===== SAFE ENV DEFAULTS (BIAR GAK CRASH) =====
const ADMIN_NOTIFY_KEYWORDS = process.env.ADMIN_NOTIFY_KEYWORDS || "";
const ADMIN_NOTIFY_ENABLED = process.env.ADMIN_NOTIFY_ENABLED || "false";
const ADMIN_NOTIFY_MIN_SCORE = process.env.ADMIN_NOTIFY_MIN_SCORE || "5";
const ADMIN_NOTIFY_COOLDOWN_SEC = process.env.ADMIN_NOTIFY_COOLDOWN_SEC || "60";

const MONITOR_LEVEL = process.env.MONITOR_LEVEL || "ALL";
const MONITOR_COOLDOWN_SEC = process.env.MONITOR_COOLDOWN_SEC || "20";

const FOLLOWUP_ENABLED = process.env.FOLLOWUP_ENABLED || "false";
const FOLLOWUP_MAX_PER_CUSTOMER = process.env.FOLLOWUP_MAX_PER_CUSTOMER || "2";
const FOLLOWUP_COOLDOWN_HOURS = process.env.FOLLOWUP_COOLDOWN_HOURS || "24";
const FOLLOWUP_STAGE1_HOURS = process.env.FOLLOWUP_STAGE1_HOURS || "18";
const FOLLOWUP_STAGE2_HOURS = process.env.FOLLOWUP_STAGE2_HOURS || "48";

const ANTI_JEBEH_ENABLED = process.env.ANTI_JEBEH_ENABLED || "true";
const ANTI_JEBEH_STRICT = process.env.ANTI_JEBEH_STRICT || "true";
const ANTI_JEBEH_MIN_INFO_REQUIRED = process.env.ANTI_JEBEH_MIN_INFO_REQUIRED || "true";
const ANTI_JEBEH_STRIKES_LOCK = process.env.ANTI_JEBEH_STRIKES_LOCK || "2";

// ---------- OpenAI defaults ----------
const OPENAI_MODEL_PRIMARY_FINAL = OPENAI_MODEL_PRIMARY || "gpt-4o";
const OPENAI_MODEL_FALLBACK_FINAL = OPENAI_MODEL_FALLBACK || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS_FINAL = Number(OPENAI_TIMEOUT_MS || 9000);
const OPENAI_MAXTOKENS_FINAL = Number(OPENAI_MAX_OUTPUT_TOKENS || 260);
const OPENAI_TEMPERATURE_FINAL = Number(OPENAI_TEMPERATURE || 0.30);

// ---------- Arena / routing ----------
const ARENA_CONTROL_ENABLED = process.env.ARENA_CONTROL_ENABLED || "true";
const PRIORITY_ROUTING = process.env.PRIORITY_ROUTING || "1,2,3,4";
const ARENA_MAX_QUESTIONS = process.env.ARENA_MAX_QUESTIONS || "2";

// ---------- Towing ----------
const TOWING_STYLE = process.env.TOWING_STYLE || "3";

// ---------- Branding ----------
const BIZ_NAME = process.env.BIZ_NAME || "Hongz Bengkel – Spesialis Transmisi Matic";
const BIZ_ADDRESS = process.env.BIZ_ADDRESS || "Jl. M. Yakub No.10B, Medan Perjuangan";
const BIZ_HOURS = process.env.BIZ_HOURS || "Senin–Sabtu 09.00–17.00";
const MAPS_LINK = process.env.MAPS_LINK || "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9";
const WHATSAPP_ADMIN = process.env.WHATSAPP_ADMIN || "https://wa.me/6281375430728";
const WHATSAPP_CS = process.env.WHATSAPP_CS || "https://wa.me/6285752965167";

// ---------- Storage default ----------
const DATA_DIR_FINAL = DATA_DIR || "./data";

// ---------- Debug ----------
const IS_DEBUG = String(DEBUG || "false").toLowerCase() === "true";

// ================= APP =================
const app = express();
app.use(bodyParser.urlencoded({ extended: false })); // Twilio form-urlencoded
app.use(bodyParser.json());

// ================= FIRESTORE OPTIONAL (AIRBAG) =================
let admin = null;
function initFirestore() {
  if (process.env.FIRESTORE_ENABLED !== "true") return null;

  try {
    admin = require("firebase-admin");
  } catch (e) {
    console.warn("[Firestore] firebase-admin not installed. Fallback to JSON file DB.");
    return null;
  }

  try {
    if (admin.apps.length) return admin.firestore();

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      console.warn("[Firestore] Missing FIREBASE_SERVICE_ACCOUNT_JSON. Fallback to JSON file DB.");
      return null;
    }

    const serviceAccount = JSON.parse(raw);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    const db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    return db;
  } catch (e) {
    console.warn("[Firestore] init failed. Fallback to JSON file DB:", e?.message || e);
    return null;
  }
}
const fsdb = initFirestore();

// ================= STORAGE (SAFE) =================
function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}
ensureDir(DATA_DIR_FINAL);

const DB_FILE = path.join(DATA_DIR_FINAL, "hongz_enterprise_db.json");

function loadDBFile() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (_) {
    return { customers: {}, tickets: {}, events: [] };
  }
}
function saveDBFile(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("DB save failed:", e?.message || e);
  }
}

async function loadDB() {
  if (!fsdb) return loadDBFile();
  const snap = await fsdb.collection("app").doc("db").get();
  return snap.exists ? snap.data() : { customers: {}, tickets: {}, events: [] };
}
async function saveDB(db) {
  if (!fsdb) return saveDBFile(db);
  await fsdb.collection("app").doc("db").set(db, { merge: true });
}

// ================= HELPERS =================
function nowISO() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }

function sha16(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
}

function normText(s) { return String(s || "").replace(/\u200b/g, "").trim(); }
function upper(s) { return normText(s).toUpperCase(); }

function isCommand(body, cmd) {
  const t = upper(body);
  const c = String(cmd).toUpperCase();
  return t === c || t.startsWith(c + " ") || t.includes("\n" + c) || t.includes(" " + c + " ");
}

function normalizeFrom(v) { return String(v || "").trim(); }

function cleanMsisdn(from) {
  return String(from || "").replace(/^whatsapp:\+?/i, "").replace(/[^\d]/g, "");
}
function toWaMe(from) {
  const n = cleanMsisdn(from);
  return n ? `https://wa.me/${n}` : "-";
}

function isAdmin(from) {
  const a = normalizeFrom(ADMIN_WHATSAPP_TO).toLowerCase();
  const f = normalizeFrom(from).toLowerCase();
  return a && f && a === f;
}
function isMonitor(from) {
  const m = normalizeFrom(MONITOR_WHATSAPP_TO || "").toLowerCase();
  const f = normalizeFrom(from).toLowerCase();
  return !!(m && f && m === f);
}

// ===== TwiML (SINGLE VERSION) =====
function replyTwiML(res, message) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message || "Halo! Ada yang bisa kami bantu?");
  res.type("text/xml");
  return res.status(200).send(twiml.toString());
}

// ================= LOCATION PARSER =================
function extractMapsLink(reqBody) {
  const body = String(reqBody?.Body ?? "").trim();
  if (!body) return null;

  const m = body.match(
    /(https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)[^\s]+)/i
  );
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

// ================= SIGNATURES =================
function confidenceLine(style = "neutral") {
  if (style === "casual") return "✅ Tenang ya Bang, kita bantu sampai jelas langkahnya 🙂";
  return "✅ Tenang ya Bang, kami bantu sampai jelas langkahnya.";
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

function signatureTowing(style = "3") {
  const s = String(style || "3");

  if (s === "2") {
    return [
      `— ${BIZ_NAME}`,
      `📲 Admin cepat: ${WHATSAPP_ADMIN}`,
      `Ketik *TOWING* + kirim *share lokasi*`,
    ].join("\n");
  }

  if (s === "1") {
    return [
      `— ${BIZ_NAME}`,
      `⏱ ${BIZ_HOURS}`,
      `📲 Admin: ${WHATSAPP_ADMIN}`,
      `Jika perlu cepat: klik Admin lalu bisa *telepon/voice call*.`,
    ].join("\n");
  }

  return [
    `— ${BIZ_NAME} (Precision Transmission Center)`,
    `📲 Admin prioritas: ${WHATSAPP_ADMIN}`,
    `⚡ Darurat? Klik Admin untuk *voice call* (lebih cepat koordinasi).`,
  ].join("\n");
}

// ================= DETECTORS (SINGLE SOURCE OF TRUTH) =================
function detectNoStart(body) {
  const t = String(body || "").toLowerCase();
  return /tidak bisa hidup|gak bisa hidup|ga bisa hidup|tidak bisa starter|gak bisa starter|ga bisa starter|starter|aki tekor|accu tekor|lampu redup/i.test(t);
}

function detectCantDrive(body) {
  const t = String(body || "").toLowerCase();
  return /tidak bisa jalan|ga bisa jalan|gak bisa jalan|tidak bisa bergerak|stuck|macet total|rpm naik tapi tidak jalan|d masuk tapi tidak jalan|r masuk tapi tidak jalan|towing|evakuasi/i.test(t);
}

function detectAC(body) {
  const t = String(body || "").toLowerCase();
  return /\bac\b|freon|kompresor|blower|evaporator|kondensor|ac tidak dingin|dingin sebentar|panas lagi/i.test(t);
}

function detectPriceOnly(body) {
  const t = String(body || "").toLowerCase();
  return /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget|ongkos/i.test(t);
}

function detectPremium(body) {
  const t = String(body || "").toLowerCase();
  return /alphard|vellfire|lexus|bmw|mercedes|audi|land cruiser|rx350/i.test(t);
}

function detectBuyingSignal(body) {
  const t = String(body || "").toLowerCase();
  return /jadwal|booking|bisa masuk|hari ini|besok bisa|jam berapa|alamat|lokasi|maps|mau datang|fix datang|oke saya ke sana/i.test(t);
}

function hasVehicleInfo(body) {
  const t = String(body || "").toLowerCase();
  const hasYear = /\b(19\d{2}|20\d{2})\b/.test(t);
  const hasBrand = /toyota|honda|nissan|mitsubishi|suzuki|daihatsu|mazda|hyundai|kia|wuling|bmw|mercedes|audi|lexus/i.test(t);
  return hasYear || hasBrand;
}

function hasSymptomInfo(body) {
  const t = String(body || "").toLowerCase();
  return /nendang|selip|jedug|hentak|delay|ngelos|overheat|bau gosong|valve body|torque converter|atf|oli transmisi/i.test(t);
}

function askedForSchedule(body) {
  const t = String(body || "").toLowerCase();
  return /jadwal|booking|antri|datang jam|bisa hari|bisa besok|hari ini buka|kapan bisa masuk/i.test(t);
}

// ================= STYLE =================
function detectStyle(body) {
  const raw = String(body || "");
  const t = raw.toLowerCase();

  if (/darurat|tolong|cepat|mogok|bahaya|stuck/i.test(t)) return "urgent";
  if (/mohon|berkenan|terima kasih|bapak|ibu|pak|bu/i.test(t)) return "formal";

  const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(raw);
  if (t.length < 20 || hasEmoji) return "casual";

  return "neutral";
}

function composeTone(style) {
  if (style === "urgent") return "tenang, sigap, menenangkan";
  if (style === "formal") return "sopan, profesional";
  if (style === "casual") return "ramah, santai";
  return "ramah-profesional";
}

// ================= ARENA CLASSIFY (PRIORITY FIX) =================
function arenaClassify({ body, hasLoc, cantDrive, cmdTowing, cmdJadwal }) {
  // PRIORITAS keselamatan dulu
  if (cmdTowing || cantDrive || hasLoc) return { lane: "URGENT", reason: "CANT_DRIVE_OR_LOCATION" };
  // lalu booking
  if (cmdJadwal || detectBuyingSignal(body)) return { lane: "BOOKING", reason: "BOOKING_SIGNAL" };
  // baru AC / no start
  if (detectAC(body)) return { lane: "AC", reason: "AC_MODE" };
  if (detectNoStart(body)) return { lane: "NO_START", reason: "ENGINE_NO_START" };
  // harga
  if (detectPriceOnly(body)) return { lane: "PRICE_TEST", reason: "PRICE_ONLY" };
  // teknis
  if (hasVehicleInfo(body) || hasSymptomInfo(body)) return { lane: "TECHNICAL", reason: "VEHICLE_OR_SYMPTOM" };

  return { lane: "GENERAL", reason: "DEFAULT" };
}

// ================= LEAD SCORE =================
function leadScore({ body, hasLocation, isTowingCmd, isJadwalCmd, cantDrive }) {
  let score = 0;
  if (cantDrive || isTowingCmd || hasLocation) score += 5;
  if (detectPremium(body)) score += 3;
  if (detectBuyingSignal(body) || isJadwalCmd) score += 4;
  if (detectPriceOnly(body) && String(body || "").length < 30) score -= 2;
  return Math.max(0, Math.min(10, score));
}

function leadTag(score) {
  if (score >= 8) return "🔴 PRIORITY";
  if (score >= 5) return "🟡 POTENTIAL";
  return "🔵 NORMAL";
}

// ================= TOWING/JADWAL INSTRUCTIONS =================
function towingInstruction(_ticket, humanStyle) {
  const style = String(TOWING_STYLE || "3");
  const lines = [];

  const premiumDiagnosis =
    "Biasanya kondisi seperti ini bisa terkait tekanan oli transmisi drop, clutch aus, valve body bermasalah, atau torque converter.";
  const suggestionTow =
    "Jika unit sudah tidak bisa bergerak sama sekali, lebih aman dievakuasi (towing) daripada dipaksakan karena bisa menambah kerusakan.";

  if (style === "1") {
    lines.push("Baik Bang, kalau unit sudah *tidak bisa jalan/bergerak*, jangan dipaksakan dulu ya.");
    lines.push(premiumDiagnosis);
    lines.push("Untuk memastikan arah kerusakan, unit perlu dicek langsung oleh teknisi.");
    lines.push(suggestionTow);
    lines.push("");
    lines.push("Kirim *share lokasi* ya — admin bantu arahkan langkah paling aman.");
    lines.push("⚡ Jika perlu cepat, bisa langsung *voice call Admin*:");
    lines.push(WHATSAPP_ADMIN);
  } else if (style === "2") {
    lines.push("Kalau unit sudah tidak bisa jalan/bergerak, jangan dipaksakan.");
    lines.push("Lebih aman evakuasi daripada tambah rusak.");
    lines.push("");
    lines.push("Kirim *share lokasi* — admin koordinasi towing aman.");
    lines.push("⚡ Perlu cepat? Voice call Admin:");
    lines.push(WHATSAPP_ADMIN);
  } else {
    lines.push("Baik Bang.");
    lines.push("Kalau unit sudah *tidak bisa jalan/bergerak*, jangan dipaksakan dulu — bisa memperparah kerusakan.");
    lines.push("");
    lines.push(premiumDiagnosis);
    lines.push("");
    lines.push("Unit seperti ini perlu pemeriksaan presisi secara langsung.");
    lines.push(suggestionTow);
    lines.push("");
    lines.push("Silakan kirim *share lokasi sekarang* — kami prioritaskan koordinasi evakuasi yang aman.");
    lines.push("⚡ Untuk respons tercepat, langsung *voice call Admin*:");
    lines.push(WHATSAPP_ADMIN);
  }

  lines.push("");
  lines.push(confidenceLine(humanStyle));
  lines.push("");
  lines.push(signatureTowing(style));
  return lines.join("\n");
}

function jadwalInstruction(_ticket, humanStyle) {
  const lines = [];
  lines.push("Siap, untuk booking pemeriksaan bisa kirim data singkat ya:");
  lines.push("");
  lines.push("1️⃣ Nama");
  lines.push("2️⃣ Mobil & tahun");
  lines.push("3️⃣ Keluhan utama (singkat)");
  lines.push("4️⃣ Rencana datang (hari & jam)");
  lines.push("");
  lines.push("Setelah data masuk, admin konfirmasi antrian & estimasi waktu pengecekan.");
  lines.push("");
  lines.push("⚡ Jika butuh respons cepat, bisa langsung voice call Admin:");
  lines.push(WHATSAPP_ADMIN);
  lines.push("");
  lines.push(confidenceLine(humanStyle));
  lines.push("");
  lines.push(signatureShort());
  return lines.join("\n");
}

function acInstruction(_ticket, style) {
  return [
    "Siap Bang, saya fokus **AC** dulu ya (bukan matic).",
    "AC-nya: **tidak dingin sama sekali** atau **dingin sebentar lalu panas**?",
    "Blower angin **kencang** atau **lemah**? Ada bunyi kompresor/kipas?",
    "Biar cepat: kirim **tipe mobil + tahun** + video singkat panel AC (kalau bisa).",
    "",
    confidenceLine(style),
    "",
    signatureShort(),
  ].join("\n");
}

function noStartInstruction(_ticket, style) {
  return [
    "Tenang Bang, kita cek cepat ya.",
    "Saat distarter: **cekrek/lemot** atau **muter normal tapi tidak nyala**?",
    "Lampu dashboard: **terang** atau **redup/mati**?",
    "Biar cepat: kirim **video saat distarter** + **tipe mobil & tahun**.",
    "",
    confidenceLine(style),
    "",
    signatureShort(),
  ].join("\n");
}

// ================= AI =================
function withTimeout(promise, ms, label = "TIMEOUT") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

function mustMapsOnly(text, userText) {
  const low = String(text || "").toLowerCase();
  const u = String(userText || "").toLowerCase();
  const userAskingLocation = /(alamat|lokasi|maps|map|di mana|dimana)/i.test(u);
  const looksLikeAddress = /(jl\.|jalan\s+\w|no\.|nomor\s+\d|kecamatan|kelurahan|kode pos)/i.test(low);

  if (userAskingLocation && looksLikeAddress) return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
  const aiClearlyInventing = /(jl\.|jalan\s+\w).*(no\.|nomor\s+\d)/i.test(low);
  if (aiClearlyInventing) return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
  return text;
}

function buildSystemPrompt({ style, stage, ticket, userText, cantDrive, priceOnly }) {
  const tone = composeTone(style);
  const maxQ = Math.max(1, Number(ARENA_MAX_QUESTIONS || 2));
  const lane = String(ticket?.arena?.lane || "GENERAL");

  const laneRule =
    lane === "AC"
      ? "KONTEKS LANE=AC: Fokus AC. DILARANG membahas transmisi/gearbox kecuali user menyebut transmisi."
      : (lane === "NO_START"
          ? "KONTEKS LANE=NO_START: Fokus mesin tidak hidup (aki/starter/bbm/ignition). DILARANG membahas transmisi."
          : "KONTEKS LANE=GENERAL/TECH: Bahas transmisi hanya jika user menyebut gejala transmisi.");

  return `
Anda adalah Kepala Bengkel ${BIZ_NAME} di Medan.
Gaya bahasa: ${tone}. Terasa mekanik senior/kepala bengkel, bukan CS.

ATURAN WAJIB:
1) Jangan beri angka harga pasti.
2) Jika user hanya tanya harga tanpa info → arahkan ke diagnosa.
3) Maksimal ${maxQ} pertanyaan dalam 1 balasan.
4) Jangan mengarang alamat. Jika ditanya lokasi, jawab hanya link: ${MAPS_LINK}
5) Jika unit tidak bisa jalan/berisiko → sarankan jangan dipaksakan + minta share lokasi.
6) Jawaban ringkas, tajam, relevan. Hindari cerewet.
7) ${laneRule}

KONTEKS:
- Type: ${ticket.type}
- Stage: ${stage}
- cantDrive: ${cantDrive}
- priceOnly: ${priceOnly}
- Lane: ${lane}
`.trim();
}

async function aiTryModel(client, model, userText, sysPrompt, timeoutMs) {
  const resp = await withTimeout(
    client.chat.completions.create({
      model,
      temperature: OPENAI_TEMPERATURE_FINAL,
      max_tokens: OPENAI_MAXTOKENS_FINAL,
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userText },
      ],
    }),
    timeoutMs,
    `OPENAI_TIMEOUT_${model}`
  );

  let text = resp?.choices?.[0]?.message?.content?.trim();
  if (!text) return null;
  return text;
}

async function aiReply({ userText, ticket, style, stage, cantDrive, priceOnly }) {
  if (!OPENAI_API_KEY || !OpenAI) return null;

  let client;
  try { client = new OpenAI({ apiKey: OPENAI_API_KEY }); }
  catch (e) { console.error("OpenAI init failed:", e.message); return null; }

  const timeoutMs = OPENAI_TIMEOUT_MS_FINAL;
  const sys = buildSystemPrompt({ style, stage, ticket, userText, cantDrive, priceOnly });

  try {
    let text = await aiTryModel(client, OPENAI_MODEL_PRIMARY_FINAL, userText, sys, timeoutMs);
    if (!text && OPENAI_MODEL_FALLBACK_FINAL && OPENAI_MODEL_FALLBACK_FINAL !== OPENAI_MODEL_PRIMARY_FINAL) {
      text = await aiTryModel(client, OPENAI_MODEL_FALLBACK_FINAL, userText, sys, timeoutMs);
    }
    if (!text) return null;

    text = mustMapsOnly(text, userText);
    if (text.length > 900) text = text.slice(0, 900).trim() + "…";
    return text;
  } catch (e) {
    console.error("OpenAI failed:", e.message);
    return null;
  }
}

// ================= ADMIN COMMANDS =================
function adminHelp() {
  return [
    "✅ Admin Panel Hongz",
    "",
    "Commands:",
    "HELP / MENU",
    "LIST",
    "STATS",
    "CLAIM T-12345",
    "CLOSE T-12345",
    "NOTE T-12345 isi...",
  ].join("\n");
}

function listTickets(db) {
  const all = Object.values(db.tickets || {});
  const active = all
    .filter(t => t.status !== "CLOSED")
    .sort((a, b) => (b.lastInboundAtMs || 0) - (a.lastInboundAtMs || 0))
    .slice(0, 12);

  if (!active.length) return "Tidak ada tiket aktif saat ini.";

  const lines = ["📋 Tiket Aktif (Top 12):"];
  for (const t of active) {
    const shortMsg = (t.lastBody || "").replace(/\s+/g, " ").slice(0, 28);
    const lane = t?.arena?.lane ? ` | lane:${t.arena.lane}` : "";
    lines.push(`${t.id} | ${t.tag} | ${t.status} | ${t.msisdn} | ${t.type} | stage:${t.stage}${lane} | ${t.locationUrl ? "📍" : "-"} | ${shortMsg}`);
  }
  lines.push("");
  lines.push("Ketik: CLAIM T-xxxxx / CLOSE T-xxxxx / NOTE T-xxxxx ...");
  return lines.join("\n");
}

function statsTickets(db) {
  const all = Object.values(db.tickets || {});
  const active = all.filter(t => t.status !== "CLOSED");
  const priority = active.filter(t => String(t.tag || "").includes("PRIORITY")).length;
  const potential = active.filter(t => String(t.tag || "").includes("POTENTIAL")).length;
  const normal = active.length - priority - potential;

  const types = active.reduce((acc, t) => {
    const k = t.type || "GENERAL";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const typeLines = Object.keys(types).sort().map(k => `- ${k}: ${types[k]}`);

  const lanes = active.reduce((acc, t) => {
    const k = t?.arena?.lane || "UNKNOWN";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const laneLines = Object.keys(lanes).sort().map(k => `- ${k}: ${lanes[k]}`);

  return [
    "📊 HONGZ SUMMARY",
    `Aktif: ${active.length}`,
    `🔴 PRIORITY: ${priority}`,
    `🟡 POTENTIAL: ${potential}`,
    `🔵 NORMAL: ${normal}`,
    "",
    "Types:",
    ...typeLines,
    "",
    "Arena Lanes:",
    ...laneLines,
  ].join("\n");
}

function findTicket(db, ticketId) {
  const id = String(ticketId || "").trim().toUpperCase();
  return db.tickets?.[id] || null;
}

function handleAdminCommand(db, body) {
  const t = upper(body);

  if (t === "HELP" || t === "MENU") return adminHelp();
  if (t === "LIST") return listTickets(db);
  if (t === "STATS") return statsTickets(db);

  if (t.startsWith("CLAIM ")) {
    const id = t.split(/\s+/)[1];
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    ticket.status = "CLAIMED";
    ticket.updatedAt = nowISO();
    return `✅ ${ticket.id} di-CLAIM.\nCustomer: ${ticket.from}\nNomor: ${ticket.msisdn}\nwa.me: ${ticket.waMe}\nLokasi: ${ticket.locationUrl || "(belum ada)"}\nLane: ${ticket?.arena?.lane || "-"}`;
  }

  if (t.startsWith("CLOSE ")) {
    const id = t.split(/\s+/)[1];
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    ticket.status = "CLOSED";
    ticket.updatedAt = nowISO();
    const cust = db.customers?.[ticket.customerId];
    if (cust && cust.activeTicketId === ticket.id) cust.activeTicketId = "";
    return `✅ ${ticket.id} di-CLOSE.`;
  }

  if (t.startsWith("NOTE ")) {
    const parts = body.split(" ");
    const id = (parts[1] || "").toUpperCase();
    const note = body.split(" ").slice(2).join(" ").trim();
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    if (!note) return `Format: NOTE ${id} isi catatan...`;
    ticket.notes = ticket.notes || [];
    ticket.notes.push({ at: nowISO(), note });
    ticket.updatedAt = nowISO();
    return `📝 Note tersimpan untuk ${ticket.id}.`;
  }

  return "Perintah tidak dikenal. Ketik HELP.";
}

// ================= FOLLOW-UP =================
function isDueForFollowup(ticket) {
  if (String(FOLLOWUP_ENABLED).toLowerCase() !== "true") return false;
  if (!ticket || ticket.status === "CLOSED") return false;

  const maxPer = Number(FOLLOWUP_MAX_PER_CUSTOMER || 2);
  const cooldownH = Number(FOLLOWUP_COOLDOWN_HOURS || 24);
  const stage1H = Number(FOLLOWUP_STAGE1_HOURS || 18);
  const stage2H = Number(FOLLOWUP_STAGE2_HOURS || 48);

  const now = nowMs();
  const lastIn = ticket.lastInboundAtMs || 0;
  const lastFu = ticket.lastFollowupAtMs || 0;
  const count = ticket.followupCount || 0;

  if (count >= maxPer) return false;
  if (lastFu && (now - lastFu) < cooldownH * 3600 * 1000) return false;

  const ageH = (now - lastIn) / (3600 * 1000);
  if (count === 0 && ageH >= stage1H) return true;
  if (count === 1 && ageH >= stage2H) return true;
  return false;
}

function followupFallback(ticket) {
  const lane = String(ticket?.arena?.lane || "");
  const base = String(ticket.tag || "").includes("PRIORITY")
    ? "Kami follow-up sebentar ya Bang, supaya kondisinya tidak melebar."
    : "Kami follow-up ya Bang—kalau masih sempat, boleh lanjut sedikit infonya.";

  const ask =
    lane === "AC"
      ? "AC-nya sekarang dingin/tidak? Ada bunyi kompresor?"
      : (lane === "NO_START"
          ? "Saat distarter sekarang cekrek/lemot atau muter normal?"
          : (Number(ticket.stage || 0) <= 0 ? "Boleh info mobil & tahunnya, plus keluhan yang paling terasa?" : "Kondisinya masih sama atau ada perubahan?"));

  return [base, ask, "Jika tidak ingin follow-up lagi, ketik STOP."].join("\n");
}

// ================= CUSTOMER MEMORY HELPERS =================
function safeStr(x) { return (x || "").toString().trim(); }

function getCust(db, customerId) {
  if (!db.customers) db.customers = {};
  if (!db.customers[customerId]) return null;
  return db.customers[customerId];
}

function updateProfileFromText(db, customerId, text) {
  const cust = getCust(db, customerId);
  if (!cust) return;

  if (!cust.profile) cust.profile = {};
  cust.profile.lastSeenAt = nowISO();

  const t = safeStr(text);

  const carMatch =
    t.match(/mobil\s*[:\-]?\s*([A-Za-z0-9 \-]{3,30})/i) ||
    t.match(/tipe\s*mobil\s*[:\-]?\s*([A-Za-z0-9 \-]{3,30})/i);

  if (carMatch && carMatch[1]) {
    cust.profile.car = safeStr(carMatch[1]).slice(0, 40);
  }

  const nameMatch = t.match(/nama\s*[:\-]?\s*([A-Za-z ]{2,30})/i);
  if (nameMatch && nameMatch[1]) {
    cust.profile.name = safeStr(nameMatch[1]).slice(0, 30);
  }

  const cityMatch = t.match(/kota\s*[:\-]?\s*([A-Za-z ]{2,30})/i);
  if (cityMatch && cityMatch[1]) {
    cust.profile.city = safeStr(cityMatch[1]).slice(0, 30);
  }
}

// ================= MENU ABCD =================
function routeABCD(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  if (t === "a" || t === "a.") {
    return "✅ *A. Booking Service*\nKirim:\n1) *Tipe mobil + tahun*\n2) Keluhan singkat\n3) Mau datang jam berapa (09.00–17.00)\n\nContoh: *Avanza 2015, matic nendang, jam 10.*";
  }
  if (t === "b" || t === "b.") {
    return "✅ *B. Konsultasi Cepat*\nKirim:\n1) *Tipe mobil + tahun*\n2) Gejala (nendang/slip/delay/jedug/bunyi)\n3) Sudah ganti oli matic kapan?\n\nBiar kami arahkan langkah paling cepat.";
  }
  if (t === "c" || t === "c.") {
    return `✅ *C. Alamat & Jam Buka*\n📍 ${BIZ_NAME}\n🧭 Maps: ${MAPS_LINK}\n🕘 ${BIZ_HOURS}\n\nKalau mau, ketik *A* untuk booking.`;
  }
  if (t === "d" || t === "d.") {
    return "✅ *D. Darurat / Towing*\nKirim *lokasi live* + patokan (dekat apa) sekarang ya Bang.\nKalau mobil masih bisa jalan pelan, sebutkan *bisa jalan atau tidak*.";
  }

  return null;
}

function mainMenuText() {
  return (
`Siap Bang 🙏 *Hongz Bengkel Matic*\n` +
`Pilih 1:\n` +
`*A.* Booking Service (langsung jadwal)\n` +
`*B.* Konsultasi Cepat (langsung solusi)\n` +
`*C.* Alamat & Jam Buka\n` +
`*D.* Darurat / Towing\n\n` +
`Balas cukup: *A / B / C / D*`
  );
}

// ================= TICKET SYSTEM =================
function getOrCreateTicket(db, customerId, from) {
  if (!db.tickets) db.tickets = {};

  let ticket = Object.values(db.tickets).find(
    t => t.customerId === customerId && t.status !== "CLOSED"
  );
  if (ticket) return ticket;

  const id = "T-" + Math.floor(10000 + Math.random() * 90000);

  ticket = {
    id,
    customerId,
    from,
    status: "OPEN",
    type: "GENERAL",
    stage: 0,
    score: 0,
    tag: "🔵 NORMAL",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    history: []
  };

  db.tickets[id] = ticket;
  return ticket;
}

function updateTicket(ticket, patch) {
  Object.assign(ticket, patch);
  ticket.updatedAt = nowISO();
}

// ================= MAIN WEBHOOK =================
// kecilin log debug biar aman
function dlog(...args) {
  if (IS_DEBUG) console.log("[DLOG]", ...args);
}

function envBool(v, def = false) {
  if (v === undefined || v === null || v === "") return def;
  return String(v).toLowerCase() === "true";
}

// WAJIB ADA: parsePriorityRouting (biar HEALTH tidak error)
function parsePriorityRouting(csv) {
  if (!csv) return ["1", "2", "3", "4"];
  return String(csv)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ["1", "2", "3", "4"].includes(s));
}

// Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// PORT
const PORT = Number(process.env.PORT || 3000);

// Wrapper leadScore aman
function computeLeadScoreSafe({ body, hasLoc, cmdTowing, cmdJadwal, cantDrive }) {
  try {
    return leadScore({
      body,
      hasLocation: !!hasLoc,
      isTowingCmd: !!cmdTowing,
      isJadwalCmd: !!cmdJadwal,
      cantDrive: !!cantDrive,
    });
  } catch (_) {
    let s = 0;
    if (cantDrive) s += 5;
    if (hasLoc) s += 5;
    if (cmdTowing) s += 4;
    if (cmdJadwal) s += 3;
    if (detectPremium(body)) s += 2;
    if (detectPriceOnly(body) && String(body || "").length < 35) s -= 2;
    return Math.max(0, Math.min(10, s));
  }
}

// Wrapper arenaClassify aman
function classifyArenaSafe(payload) {
  try {
    return arenaClassify(payload);
  } catch (_) {
    return { lane: "GENERAL", reason: "FALLBACK" };
  }
}

async function webhookHandler(req, res) {
  const db = await loadDB();
  if (!db.customers) db.customers = {};
  if (!db.tickets) db.tickets = {};
  if (!Array.isArray(db.events)) db.events = [];

  const from = normalizeFrom(req.body?.From || "");
  const to = normalizeFrom(req.body?.To || "");
  const body = normText(req.body?.Body || "");

  // ===== SECURITY LAYER =====
  if (body.length > 800) {
    return replyTwiML(res, "Pesan terlalu panjang Bang 🙏 Mohon kirim ringkas ya.");
  }

  const safeText = String(body || "").replace(/[<>`]/g, "");
  if (!safeText.trim()) {
    return replyTwiML(res, "Silakan tulis keluhan mobilnya ya Bang.");
  }

  const textLower = safeText.trim().toLowerCase();
  const style = detectStyle(body);
  const location = extractLocation(req.body || {});
  const hasLoc = !!location;

  dlog("IN", { from, to, body, hasLocation: hasLoc });

  // ===== MENU ABCD =====
  const abcd = routeABCD(textLower);
  if (abcd) return replyTwiML(res, abcd);

  // ===== KEYWORD MENU =====
  if (["menu", "start", "halo", "hai", "help", "mulai"].includes(textLower)) {
    return replyTwiML(res, mainMenuText());
  }

  // ---- ADMIN ----
  if (isAdmin(from)) {
    const reply = handleAdminCommand(db, body);
    await saveDB(db);
    return replyTwiML(res, reply);
  }

  // ---- MONITOR ----
  if (isMonitor(from)) {
    await saveDB(db);
    return replyTwiML(res, "✅ Monitor aktif.");
  }

  // ---- Customer Identity ----
  const customerId = sha16(from);

  if (!db.customers[customerId]) {
    db.customers[customerId] = {
      from,
      firstSeen: nowISO(),
      lastSeen: nowISO(),
      activeTicketId: "",
      optOut: false,
      stage: "NEW",
      profile: {
        name: "",
        phone: cleanMsisdn(from),
        car: "",
        city: "",
        notes: "",
        lastIssue: "",
        lastLane: "",
        lastSeenAt: nowISO(),
      },
      history: [],
    };
  } else {
    db.customers[customerId].lastSeen = nowISO();
  }

  // ---- STOP/START follow-up ----
  if (upper(body) === "STOP" || upper(body) === "UNSUBSCRIBE") {
    db.customers[customerId].optOut = true;
    await saveDB(db);
    return replyTwiML(res, "Baik Bang. Follow-up dinonaktifkan. Jika ingin aktif lagi, ketik START.");
  }

  if (upper(body) === "START" || upper(body) === "SUBSCRIBE") {
    db.customers[customerId].optOut = false;
    await saveDB(db);
    return replyTwiML(res, "Siap Bang. Follow-up diaktifkan kembali. Silakan tulis keluhan Anda.");
  }

  // ✅ Ticket dibuat dulu
  const ticket = getOrCreateTicket(db, customerId, from);

  // ✅ Update memory customer
  updateProfileFromText(db, customerId, body);

  // ===== QUICK BOOKING HANDLER (A / 1) — robust =====
  const quick = textLower.trim();
  if (/^(a|1)\b/.test(quick)) {
    updateTicket(ticket, { type: "JADWAL", stage: 3 });
    await saveDB(db);
    return replyTwiML(
      res,
      "Siap Bang ✅\n\nSilakan kirim:\n1) Hari & jam datang\n2) Nomor plat\n\nAdmin akan siapkan slot untuk Anda."
    );
  }

  // ---- Commands ----
  const cmdTowing = isCommand(body, "TOWING");
  const cmdJadwal = isCommand(body, "JADWAL");

  // ---- Detections ----
  const acMode = detectAC(body);
  const noStart = detectNoStart(body);
  const cantDrive = detectCantDrive(body);
  const priceOnly = detectPriceOnly(body);
  const buyingSignal = detectBuyingSignal(body);
  const scheduleAsk = askedForSchedule(body);

  const vInfo = hasVehicleInfo(body);
  const sInfo = hasSymptomInfo(body);
  const suspicious = !!(priceOnly && String(body || "").length < 35);

  // ---- Sticky type ----
  if (acMode) updateTicket(ticket, { type: "AC" });
  if (cmdJadwal || scheduleAsk || buyingSignal) updateTicket(ticket, { type: "JADWAL" });
  if (cmdTowing || cantDrive || hasLoc) updateTicket(ticket, { type: "TOWING" });

  // ---- Lead score/tag ----
  const score = computeLeadScoreSafe({ body, hasLoc, cmdTowing, cmdJadwal, cantDrive });
  const tag = leadTag(score);

  // ---- Stage ----
  let stage = Number(ticket.stage || 0);
  if (cmdJadwal || scheduleAsk || buyingSignal) stage = Math.max(stage, 2);
  else if (vInfo || sInfo || acMode || noStart) stage = Math.max(stage, 1);
  if ((vInfo && sInfo) || cmdJadwal) stage = Math.max(stage, 2);

  // ---- Type (final decision) ----
  let type = "GENERAL";
  if (cmdJadwal) type = "JADWAL";
  else if (acMode) type = "AC";
  else if (noStart) type = "NO_START";
  else if (cmdTowing || cantDrive || hasLoc) type = "TOWING";

  // ---- Arena ----
  const arenaOn = envBool(ARENA_CONTROL_ENABLED, true);
  const arena = arenaOn
    ? classifyArenaSafe({
        body,
        hasLoc,
        cantDrive,
        cmdTowing,
        cmdJadwal,
      })
    : { lane: "OFF", reason: "DISABLED" };

  if (location?.mapsUrl) ticket.locationUrl = location.mapsUrl;

  updateTicket(ticket, {
    lastBody: body,
    lastInboundAtMs: nowMs(),
    score,
    tag,
    waMe: toWaMe(from),
    msisdn: cleanMsisdn(from),
    type,
    stage,
    arena,
  });

  // ---- events ----
  db.events.push({
    t: nowISO(),
    from,
    to,
    body,
    ticketId: ticket.id,
    score,
    tag,
    locationUrl: ticket.locationUrl || "",
    lane: arena.lane,
    laneReason: arena.reason,
  });
  if (db.events.length > 5000) db.events = db.events.slice(-2000);

  // ---- RULES PRIORITY ----
  if (/alamat|lokasi|maps|map|di mana|dimana/i.test(body)) {
    await saveDB(db);
    return replyTwiML(res, `Untuk lokasi, silakan buka: ${MAPS_LINK}`);
  }

  if (hasLoc) {
    await saveDB(db);
    return replyTwiML(
      res,
      [
        "Baik Bang, lokasi sudah kami terima ✅",
        "Admin akan follow up untuk langkah berikutnya (termasuk evakuasi/towing bila diperlukan).",
        "",
        confidenceLine(style),
        "",
        signatureTowing(TOWING_STYLE),
      ].join("\n")
    );
  }

  if (acMode || arena.lane === "AC") {
    await saveDB(db);
    return replyTwiML(res, acInstruction(ticket, style));
  }

  if (noStart || arena.lane === "NO_START") {
    await saveDB(db);
    return replyTwiML(res, noStartInstruction(ticket, style));
  }

  if (cmdTowing || cantDrive || arena.lane === "URGENT") {
    await saveDB(db);
    return replyTwiML(res, towingInstruction(ticket, style));
  }

  if (cmdJadwal || arena.lane === "BOOKING") {
    await saveDB(db);
    return replyTwiML(res, jadwalInstruction(ticket, style));
  }

  // ---- DEFAULT: AI reply ----
  const ai = await aiReply({ userText: body, ticket, style, stage, cantDrive, priceOnly });

  let replyText;
  if (ai) {
    replyText = [ai.trim(), "", confidenceLine(style), "", signatureShort()].join("\n");
  } else {
    const triageQ =
      arena.lane === "TECHNICAL"
        ? "Boleh info mobil & tahunnya + gejala transmisi yang paling terasa (singkat)?"
        : "Boleh info mobil & tahun + keluhan utama (singkat) biar saya arahkan langkahnya?";

    replyText = [
      "Oke Bang, saya bantu arahkan dulu ya.",
      triageQ,
      priceOnly ? "Untuk biaya tergantung penyebabnya—biar akurat, kita pastikan diagnosanya dulu." : "",
      confidenceLine(style),
      "",
      signatureShort(),
    ].filter(Boolean).join("\n");
  }

  ticket.lastBotAtMs = nowMs();
  await saveDB(db);
  return replyTwiML(res, replyText);
}

// ================= ROUTES =================
app.post("/twilio/webhook", async (req, res) => {
  try {
    console.log("[TWILIO HIT] /twilio/webhook", {
      method: req.method,
      contentType: req.headers["content-type"],
      from: req.body?.From,
      body: req.body?.Body,
    });
    return await webhookHandler(req, res);
  } catch (e) {
    console.error("webhook error", e?.message || e);
    return replyTwiML(res, "Maaf ya Bang, sistem lagi padat. Silakan ulangi pesan Anda sebentar lagi 🙏");
  }
});

app.post("/whatsapp/incoming", async (_req, res) => {
  return res.sendStatus(200);
});

// CRON FOLLOW-UP
app.get("/cron/followup", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!CRON_KEY || key !== CRON_KEY) return res.status(403).send("Forbidden");

    if (String(process.env.FOLLOWUP_ENABLED || "false").toLowerCase() !== "true") {
      return res.status(200).send("Follow-up disabled");
    }

    const db = await loadDB();
    const tickets = Object.values(db.tickets || {});
    let sent = 0;

    for (const t of tickets) {
      if (!t.from) continue;

      const cust = db.customers?.[t.customerId];
      if (cust?.optOut) continue;
      if (t.status === "CLOSED") continue;

      if (isDueForFollowup(t)) {
        const msg = followupFallback(t);

        await twilioClient.messages.create({
          from: TWILIO_WHATSAPP_FROM,
          to: t.from,
          body: msg,
        });

        t.followupCount = (t.followupCount || 0) + 1;
        t.lastFollowupAtMs = nowMs();
        t.updatedAt = nowISO();
        sent++;
      }
    }

    await saveDB(db);
    return res.status(200).send(`Follow-up sent: ${sent}`);
  } catch (e) {
    console.error("cron/followup error:", e?.message || e);
    return res.status(500).send("Error");
  }
});

// HEALTH
app.get("/", (_req, res) => {
  try {
    const arenaOn = String(ARENA_CONTROL_ENABLED || "true").toLowerCase() === "true";
    const routingArr = parsePriorityRouting(PRIORITY_ROUTING);
    const routingText = Array.isArray(routingArr) ? routingArr.join(",") : "-";

    const text =
`HONGZ AI SERVER — HYBRID C+ ELITE — OK

ArenaControl: ${arenaOn ? "ON" : "OFF"}
PriorityRouting: ${routingText}
WebhookHint: ${TWILIO_WEBHOOK_URL || "(set TWILIO_WEBHOOK_URL in Render ENV)"}

Routes:
- POST /twilio/webhook
- POST /whatsapp/incoming
- GET  /cron/followup?key=...`;

    return res.status(200).send(text);
  } catch (e) {
    console.error("health error:", e?.message || e);
    return res.status(500).send("Health error");
  }
});

// START
app.listen(PORT, () => {
  console.log("HONGZ AI SERVER — START");
  console.log("Listening on port:", PORT);
  console.log("Webhook routes: /twilio/webhook and /whatsapp/incoming");
});