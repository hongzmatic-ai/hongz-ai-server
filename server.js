/*
 * HONGZ AI SERVER — HYBRID C+ ELITE (ONE FILE) — RAJA MEDAN FINAL (STABLE)
 * deps: express, body-parser, twilio, openai (^4)
 * optional: firebase-admin (only if FIRESTORE_ENABLED="true")
 */

const express = require("express");

// ---- firebase-admin OPTIONAL (biar gak crash kalau belum diinstall) ----
let admin = null;
function initFirestore() {
  if (process.env.FIRESTORE_ENABLED !== "true") return null;

  try {
    // require di dalam try supaya kalau module gak ada -> fallback JSON
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

const fsdb = initFirestore(); // null kalau belum diaktifkan / module belum ada

const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OpenAI = require("openai");

// ---------------- ENV (SAFE) ----------------
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

// ---------- OpenAI defaults ----------
const OPENAI_MODEL_PRIMARY_FINAL  = OPENAI_MODEL_PRIMARY  || "gpt-4o";
const OPENAI_MODEL_FALLBACK_FINAL = OPENAI_MODEL_FALLBACK || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS_FINAL     = Number(OPENAI_TIMEOUT_MS || 9000);
const OPENAI_MAXTOKENS_FINAL      = Number(OPENAI_MAX_OUTPUT_TOKENS || 260);
const OPENAI_TEMPERATURE_FINAL    = Number(OPENAI_TEMPERATURE || 0.30);

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ---------- Arena / routing ----------
const ARENA_CONTROL_ENABLED = process.env.ARENA_CONTROL_ENABLED || "true";
const PRIORITY_ROUTING      = process.env.PRIORITY_ROUTING || "1,2,3,4";
const ARENA_MAX_QUESTIONS   = process.env.ARENA_MAX_QUESTIONS || "2";

// ---------- Towing ----------
const TOWING_STYLE = process.env.TOWING_STYLE || "3";

// ---------- Branding ----------
const BIZ_NAME       = process.env.BIZ_NAME || "Hongz Bengkel – Spesialis Transmisi Matic";
const BIZ_ADDRESS    = process.env.BIZ_ADDRESS || "Jl. M. Yakub No.10b, Medan Perjuangan";
const BIZ_HOURS      = process.env.BIZ_HOURS || "Senin–Sabtu 09.00–17.00";
const MAPS_LINK      = process.env.MAPS_LINK || "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9";
const WHATSAPP_ADMIN = process.env.WHATSAPP_ADMIN || "https://wa.me/6281375430728";
const WHATSAPP_CS    = process.env.WHATSAPP_CS || "https://wa.me/6285752965167";

// ---------- Storage default ----------
const DATA_DIR_FINAL = DATA_DIR || "./data";

// ---------- Debug ----------
const IS_DEBUG = String(DEBUG || "false").toLowerCase() === "true";

// ---------------- APP ----------------
const app = express();
app.use(bodyParser.urlencoded({ extended: false })); // Twilio form-urlencoded
app.use(bodyParser.json());

// ---------------- LOCATION PARSER ----------------
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

// ---------------- STORAGE (FINAL - SAFE) ----------------
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

// Firestore hybrid (airbag)
async function loadDB() {
  if (!fsdb) return loadDBFile();
  const snap = await fsdb.collection("app").doc("db").get();
  return snap.exists ? snap.data() : { customers: {}, tickets: {}, events: [] };
}

async function saveDB(db) {
  if (!fsdb) return saveDBFile(db);
  await fsdb.collection("app").doc("db").set(db, { merge: true });
}

// ---------------- HELPERS (SAFE) ----------------
function nowISO() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }

function sha16(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
}

function escapeXml(unsafe) {
  return String(unsafe ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function replyTwiML(res, text) {
  res.type("text/xml");
  return res.status(200).send(`<Response><Message>${escapeXml(text)}</Message></Response>`);
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

// ---------------- SIGNATURES ----------------
function confidenceLine(style = 'neutral') {
  if (style === 'casual') return '✅ Tenang ya, kita bantu sampai jelas langkahnya 🙂';
  return '✅ Tenang ya, kami bantu sampai jelas langkahnya.';
}

function signatureShort() {
  return [
    `— ${BIZ_NAME}`,
    `🧭 Maps: ${MAPS_LINK}`,
    `⏱ ${BIZ_HOURS}`,
    `📲 Admin: ${WHATSAPP_ADMIN}`,
    `💬 CS: ${WHATSAPP_CS}`,
    `Ketik *JADWAL* (booking) / *TOWING* (darurat)`,
  ].join('\n');
}

function signatureTowing(style = '3') {
  const s = String(style || '3');

  if (s === '2') {
    return [
      `— ${BIZ_NAME}`,
      `📲 Admin cepat: ${WHATSAPP_ADMIN}`,
      `Ketik *TOWING* + kirim *share lokasi*`,
    ].join('\n');
  }

  if (s === '1') {
    return [
      `— ${BIZ_NAME}`,
      `⏱ ${BIZ_HOURS}`,
      `📲 Admin: ${WHATSAPP_ADMIN}`,
      `Jika perlu cepat: klik Admin lalu bisa *telepon/voice call*.`,
    ].join('\n');
  }

  return [
    `— ${BIZ_NAME} (Precision Transmission Center)`,
    `📲 Admin prioritas: ${WHATSAPP_ADMIN}`,
    `⚡ Darurat? Klik Admin untuk *voice call* (lebih cepat koordinasi).`,
  ].join('\n');
}

// ---------------- DETECTORS ----------------
function detectNoStart(body) {
  const t = String(body || '').toLowerCase();
  return /tidak bisa hidup|gak bisa hidup|ga bisa hidup|starter|aki tekor|accu tekor|lampu redup/i.test(t);
}

function detectCantDrive(body) {
  const t = String(body || '').toLowerCase();
  return /tidak bisa jalan|ga bisa jalan|gak bisa jalan|stuck|macet total|rpm naik tapi tidak jalan|towing|evakuasi/i.test(t);
}

function detectAC(body) {
  const t = String(body || '').toLowerCase();
  return /\bac\b|freon|kompresor|blower|evaporator|kondensor|ac tidak dingin|dingin sebentar|panas lagi/i.test(t);
}

function detectPriceOnly(body) {
  return /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget/i.test(String(body || '').toLowerCase());
}

function detectPremium(body) {
  return /alphard|vellfire|lexus|bmw|mercedes|audi|land cruiser|rx350/i.test(String(body || '').toLowerCase());
}

function detectBuyingSignal(body) {
  return /jadwal|booking|bisa masuk|hari ini|besok bisa|jam berapa|alamat|lokasi|maps/i.test(String(body || '').toLowerCase());
}

function hasVehicleInfo(body) {
  const t = String(body || '').toLowerCase();
  const hasYear = /\b(19\d{2}|20\d{2})\b/.test(t);
  const hasBrand = /toyota|honda|nissan|mitsubishi|suzuki|daihatsu|mazda|hyundai|kia|wuling|bmw|mercedes|audi|lexus/i.test(t);
  return hasYear || hasBrand;
}

function hasSymptomInfo(body) {
  const t = String(body || '').toLowerCase();
  return /nendang|selip|jedug|hentak|delay|ngelos|overheat|bau gosong|valve body|torque converter|atf/i.test(t);
}

// ---------------- STYLE ----------------
function detectStyle(body) {
  const t = String(body || '').toLowerCase();

  if (/darurat|tolong|cepat|mogok|bahaya/i.test(t)) return 'urgent';
  if (/mohon|berkenan|terima kasih|bapak|ibu/i.test(t)) return 'formal';
  if (t.length < 20) return 'casual';

  return 'neutral';
}

function composeTone(style) {
  if (style === 'urgent') return 'tenang, sigap, menenangkan';
  if (style === 'formal') return 'sopan, profesional';
  if (style === 'casual') return 'ramah, santai';
  return 'ramah-profesional';
}

// ---------------- ARENA CLASSIFY ----------------
function arenaClassify({ body }) {

  if (detectAC(body)) return { lane: 'AC', reason: 'AC_MODE' };
  if (detectNoStart(body)) return { lane: 'NO_START', reason: 'ENGINE_NO_START' };
  if (detectCantDrive(body)) return { lane: 'URGENT', reason: 'CANT_DRIVE' };
  if (detectBuyingSignal(body)) return { lane: 'BOOKING', reason: 'BOOKING_SIGNAL' };
  if (detectPriceOnly(body)) return { lane: 'PRICE_TEST', reason: 'PRICE_ONLY' };
  if (hasVehicleInfo(body) || hasSymptomInfo(body)) return { lane: 'TECHNICAL', reason: 'VEHICLE_OR_SYMPTOM' };

  return { lane: 'GENERAL', reason: 'DEFAULT' };
}

// ---------------- LEAD SCORE ----------------
function leadScore({ body }) {
  let score = 0;

  if (detectCantDrive(body)) score += 5;
  if (detectPremium(body)) score += 3;
  if (detectBuyingSignal(body)) score += 4;
  if (detectPriceOnly(body) && body.length < 30) score -= 2;

  return Math.max(0, Math.min(10, score));
}

function leadTag(score) {
  if (score >= 8) return '🔴 PRIORITY';
  if (score >= 5) return '🟡 POTENTIAL';
  return '🔵 NORMAL';
}

// ---------------- NOTIFY (Admin & Monitor) ----------------
async function notifyAdmin({ title, ticket, reason, body, locationUrl }) {
  const msg = [
    title,
    `Ticket: ${ticket.id} (${ticket.tag} | Score ${ticket.score}/10 | stage:${ticket.stage} | ${ticket.type})`,
    `Lane: ${ticket?.arena?.lane || '-'} ${ticket?.arena?.reason ? `(${ticket.arena.reason})` : ''}`,
    `Customer: ${ticket.from}`,
    `Nomor: ${ticket.msisdn}`,
    `wa.me: ${ticket.waMe}`,
    reason ? `Alasan: ${reason}` : null,
    locationUrl ? `Lokasi: ${locationUrl}` : null,
    body ? `Pesan: ${String(body).slice(0, 500)}` : null,
    '',
    `Commands: HELP | LIST | STATS | CLAIM ${ticket.id} | CLOSE ${ticket.id} | NOTE ${ticket.id} ...`,
  ].filter(Boolean).join('\n');

  await twilioClient.messages.create({
    from: TWILIO_WHATSAPP_FROM,
    to: ADMIN_WHATSAPP_TO,
    body: msg,
  });
}

function monitorAllowedByLevel(score) {
  const lvl = String(MONITOR_LEVEL || 'ALL').toUpperCase();
  if (lvl === 'PRIORITY') return score >= 8;
  if (lvl === 'POTENTIAL') return score >= 5;
  return true;
}

async function notifyMonitor({ title, ticket, body }) {
  const to = normalizeFrom(MONITOR_WHATSAPP_TO);
  if (!to) return;
  if (normalizeFrom(ADMIN_WHATSAPP_TO).toLowerCase() === to.toLowerCase()) return;

  const cd = Math.max(0, Number(MONITOR_COOLDOWN_SEC || 20)) * 1000;
  const now = nowMs();
  if (cd > 0 && ticket.lastRadarAtMs && (now - ticket.lastRadarAtMs) < cd) return;
  ticket.lastRadarAtMs = now;

  const shortMsg = (body || '').replace(/\s+/g, ' ').slice(0, 140);

  const msg = [
    title,
    `Ticket: ${ticket.id} | ${ticket.tag} | score:${ticket.score}/10 | stage:${ticket.stage} | ${ticket.type}`,
    `Lane: ${ticket?.arena?.lane || '-'} ${ticket?.arena?.reason ? `(${ticket.arena.reason})` : ''}`,
    `From: ${ticket.msisdn}`,
    `wa.me: ${ticket.waMe}`,
    ticket.locationUrl ? `Lokasi: ${ticket.locationUrl}` : null,
    `Msg: ${shortMsg}${(body || '').length > 140 ? '…' : ''}`,
  ].filter(Boolean).join('\n');

  await twilioClient.messages.create({
    from: TWILIO_WHATSAPP_FROM,
    to,
    body: msg,
  });
}

// ---------------- INSTRUCTIONS ----------------
function towingInstruction(ticket, humanStyle) {
  const style = String(TOWING_STYLE || '3');
  const lines = [];

  const premiumDiagnosis =
    'Biasanya kondisi seperti ini bisa terkait tekanan oli transmisi drop, clutch aus, valve body bermasalah, atau torque converter.';
  const suggestionTow =
    'Jika unit sudah tidak bisa bergerak sama sekali, lebih aman dievakuasi (towing) daripada dipaksakan karena bisa menambah kerusakan.';

  if (style === '1') {
    lines.push('Baik Bang, kalau unit sudah *tidak bisa jalan/bergerak*, jangan dipaksakan dulu ya.');
    lines.push(premiumDiagnosis);
    lines.push('Untuk memastikan arah kerusakan, unit perlu dicek langsung oleh teknisi.');
    lines.push(suggestionTow);
    lines.push('');
    lines.push('Kirim *share lokasi* ya — admin bantu arahkan langkah paling aman.');
    lines.push('⚡ Jika perlu cepat, bisa langsung *voice call Admin*:');
    lines.push(WHATSAPP_ADMIN);
  } else if (style === '2') {
    lines.push('Kalau unit sudah tidak bisa jalan/bergerak, jangan dipaksakan.');
    lines.push('Lebih aman evakuasi daripada tambah rusak.');
    lines.push('');
    lines.push('Kirim *share lokasi* — admin koordinasi towing aman.');
    lines.push('⚡ Perlu cepat? Voice call Admin:');
    lines.push(WHATSAPP_ADMIN);
  } else {
    lines.push('Baik Bang.');
    lines.push('Kalau unit sudah *tidak bisa jalan/bergerak*, jangan dipaksakan dulu — bisa memperparah kerusakan.');
    lines.push('');
    lines.push(premiumDiagnosis);
    lines.push('');
    lines.push('Unit seperti ini perlu pemeriksaan presisi secara langsung.');
    lines.push(suggestionTow);
    lines.push('');
    lines.push('Silakan kirim *share lokasi sekarang* — kami prioritaskan koordinasi evakuasi yang aman.');
    lines.push('⚡ Untuk respons tercepat, langsung *voice call Admin*:');
    lines.push(WHATSAPP_ADMIN);
  }

  lines.push('');
  lines.push(confidenceLine(humanStyle));
  lines.push('');
  lines.push(signatureTowing(style));
  return lines.join('\n');
}

function jadwalInstruction(_ticket, humanStyle) {
  const lines = [];
  lines.push('Siap, untuk booking pemeriksaan bisa kirim data singkat ya:');
  lines.push('');
  lines.push('1️⃣ Nama');
  lines.push('2️⃣ Mobil & tahun');
  lines.push('3️⃣ Keluhan utama (singkat)');
  lines.push('4️⃣ Rencana datang (hari & jam)');
  lines.push('');
  lines.push('Setelah data masuk, admin konfirmasi antrian & estimasi waktu pengecekan.');
  lines.push('');
  lines.push('⚡ Jika butuh respons cepat, bisa langsung voice call Admin:');
  lines.push(WHATSAPP_ADMIN);
  lines.push('');
  lines.push(confidenceLine(humanStyle));
  lines.push('');
  lines.push(signatureShort());
  return lines.join('\n');
}

function acInstruction(_ticket, style) {
  return [
    'Siap Bang, saya fokus **AC** dulu ya (bukan matic).',
    'AC-nya: **tidak dingin sama sekali** atau **dingin sebentar lalu panas**?',
    'Blower angin **kencang** atau **lemah**? Ada bunyi kompresor/kipas?',
    'Biar cepat: kirim **tipe mobil + tahun** + video singkat panel AC (kalau bisa).',
    '',
    confidenceLine(style),
    '',
    signatureShort(),
  ].join('\n');
}

function noStartInstruction(_ticket, style) {
  return [
    'Tenang Bang, kita cek cepat ya.',
    'Saat distarter: **cekrek/lemot** atau **muter normal tapi tidak nyala**?',
    'Lampu dashboard: **terang** atau **redup/mati**?',
    'Biar cepat: kirim **video saat distarter** + **tipe mobil & tahun**.',
    '',
    confidenceLine(style),
    '',
    signatureShort(),
  ].join('\n');
}

// ---------------- AI ----------------
function withTimeout(promise, ms, label = 'TIMEOUT') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

function mustMapsOnly(text, userText) {
  const low = String(text || '').toLowerCase();
  const u = String(userText || '').toLowerCase();
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
  const lane = String(ticket?.arena?.lane || 'GENERAL');

  const laneRule =
    lane === 'AC'
      ? 'KONTEKS LANE=AC: Fokus AC. DILARANG membahas transmisi/gearbox kecuali user menyebut transmisi.'
      : (lane === 'NO_START'
          ? 'KONTEKS LANE=NO_START: Fokus mesin tidak hidup (aki/starter/bbm/ignition). DILARANG membahas transmisi.'
          : 'KONTEKS LANE=GENERAL/TECH: Bahas transmisi hanya jika user menyebut gejala transmisi.');

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
      temperature: Number(OPENAI_TEMPERATURE || 0.30),
      max_tokens: Number(OPENAI_MAX_OUTPUT_TOKENS || 260),
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userText },
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
  catch (e) { console.error('OpenAI init failed:', e.message); return null; }

  const timeoutMs = Number(OPENAI_TIMEOUT_MS) || 9000;
  const sys = buildSystemPrompt({ style, stage, ticket, userText, cantDrive, priceOnly });

  try {
    let text = await aiTryModel(client, OPENAI_MODEL_PRIMARY, userText, sys, timeoutMs);
    if (!text && OPENAI_MODEL_FALLBACK && OPENAI_MODEL_FALLBACK !== OPENAI_MODEL_PRIMARY) {
      text = await aiTryModel(client, OPENAI_MODEL_FALLBACK, userText, sys, timeoutMs);
    }
    if (!text) return null;

    text = mustMapsOnly(text, userText);
    if (text.length > 900) text = text.slice(0, 900).trim() + '…';
    return text;
  } catch (e) {
    console.error('OpenAI failed:', e.message);
    return null;
  }
}

// ---------------- ADMIN COMMANDS ----------------
function adminHelp() {
  return [
    '✅ Admin Panel Hongz',
    '',
    'Commands:',
    'HELP / MENU',
    'LIST',
    'STATS',
    'CLAIM T-12345',
    'CLOSE T-12345',
    'NOTE T-12345 isi...',
  ].join('\n');
}

function listTickets(db) {
  const all = Object.values(db.tickets || {});
  const active = all
    .filter(t => t.status !== 'CLOSED')
    .sort((a, b) => (b.lastInboundAtMs || 0) - (a.lastInboundAtMs || 0))
    .slice(0, 12);

  if (!active.length) return 'Tidak ada tiket aktif saat ini.';

  const lines = ['📋 Tiket Aktif (Top 12):'];
  for (const t of active) {
    const shortMsg = (t.lastBody || '').replace(/\s+/g, ' ').slice(0, 28);
    const lane = t?.arena?.lane ? ` | lane:${t.arena.lane}` : '';
    lines.push(`${t.id} | ${t.tag} | ${t.status} | ${t.msisdn} | ${t.type} | stage:${t.stage}${lane} | ${t.locationUrl ? '📍' : '-'} | ${shortMsg}`);
  }
  lines.push('');
  lines.push('Ketik: CLAIM T-xxxxx / CLOSE T-xxxxx / NOTE T-xxxxx ...');
  return lines.join('\n');
}

function statsTickets(db) {
  const all = Object.values(db.tickets || {});
  const active = all.filter(t => t.status !== 'CLOSED');
  const priority = active.filter(t => t.tag.includes('PRIORITY')).length;
  const potential = active.filter(t => t.tag.includes('POTENTIAL')).length;
  const normal = active.length - priority - potential;

  const types = active.reduce((acc, t) => {
    const k = t.type || 'GENERAL';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const typeLines = Object.keys(types).sort().map(k => `- ${k}: ${types[k]}`);

  const lanes = active.reduce((acc, t) => {
    const k = t?.arena?.lane || 'UNKNOWN';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const laneLines = Object.keys(lanes).sort().map(k => `- ${k}: ${lanes[k]}`);

  return [
    '📊 HONGZ SUMMARY',
    `Aktif: ${active.length}`,
    `🔴 PRIORITY: ${priority}`,
    `🟡 POTENTIAL: ${potential}`,
    `🔵 NORMAL: ${normal}`,
    '',
    'Types:',
    ...typeLines,
    '',
    'Arena Lanes:',
    ...laneLines,
  ].join('\n');
}

function findTicket(db, ticketId) {
  const id = String(ticketId || '').trim().toUpperCase();
  return db.tickets?.[id] || null;
}

function handleAdminCommand(db, body) {
  const t = upper(body);

  if (t === 'HELP' || t === 'MENU') return adminHelp();
  if (t === 'LIST') return listTickets(db);
  if (t === 'STATS') return statsTickets(db);

  if (t.startsWith('CLAIM ')) {
    const id = t.split(/\s+/)[1];
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    ticket.status = 'CLAIMED';
    ticket.updatedAt = nowISO();
    return `✅ ${ticket.id} di-CLAIM.\nCustomer: ${ticket.from}\nNomor: ${ticket.msisdn}\nwa.me: ${ticket.waMe}\nLokasi: ${ticket.locationUrl || '(belum ada)'}\nLane: ${ticket?.arena?.lane || '-'}`;
  }

  if (t.startsWith('CLOSE ')) {
    const id = t.split(/\s+/)[1];
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    ticket.status = 'CLOSED';
    ticket.updatedAt = nowISO();
    const cust = db.customers?.[ticket.customerId];
    if (cust && cust.activeTicketId === ticket.id) cust.activeTicketId = '';
    return `✅ ${ticket.id} di-CLOSE.`;
  }

  if (t.startsWith('NOTE ')) {
    const parts = body.split(' ');
    const id = (parts[1] || '').toUpperCase();
    const note = body.split(' ').slice(2).join(' ').trim();
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    if (!note) return `Format: NOTE ${id} isi catatan...`;
    ticket.notes = ticket.notes || [];
    ticket.notes.push({ at: nowISO(), note });
    ticket.updatedAt = nowISO();
    return `📝 Note tersimpan untuk ${ticket.id}.`;
  }

  return 'Perintah tidak dikenal. Ketik HELP.';
}

// ---------------- FOLLOW-UP ----------------
function isDueForFollowup(ticket) {
  if (String(FOLLOWUP_ENABLED).toLowerCase() !== 'true') return false;
  if (!ticket || ticket.status === 'CLOSED') return false;

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
  const lane = String(ticket?.arena?.lane || '');
  const base = ticket.tag.includes('PRIORITY')
    ? 'Kami follow-up sebentar ya, supaya kondisinya tidak melebar.'
    : 'Kami follow-up ya—kalau masih sempat, boleh lanjut sedikit infonya.';

  const ask =
    lane === 'AC'
      ? 'AC-nya sekarang dingin/tidak? Ada bunyi kompresor?'
      : (lane === 'NO_START'
          ? 'Saat distarter sekarang cekrek/lemot atau muter normal?'
          : (ticket.stage <= 0 ? 'Boleh info mobil & tahunnya, plus keluhan yang paling terasa?' : 'Kondisinya masih sama atau ada perubahan?'));

  return [base, ask, 'Jika tidak ingin follow-up lagi, ketik STOP.'].join('\n');
}

// ====== CUSTOMER MEMORY HELPERS ======
function safeStr(x) {
  return (x || "").toString().trim();
}

// ===== Detect AC keywords =====
function detectAC(text) {
  const t = String(text || "").toUpperCase();

  const keywords = [
    "AC",
    "TIDAK DINGIN",
    "DINGIN SEBENTAR",
    "PANAS",
    "KOMPRESOR",
    "FREON",
    "BLOWER",
    "KIPAS",
    "KONDENSOR",
    "EVAPORATOR"
  ];

  return keywords.some(k => t.includes(k));
}

function getCust(db, customerId) {
  if (!db.customers) db.customers = {};
  if (!db.customers[customerId]) return null;
  return db.customers[customerId];
}

// Update profile sederhana dari teks pelanggan
function updateProfileFromText(db, customerId, text) {
  const cust = getCust(db, customerId);
  if (!cust) return;

  if (!cust.profile) cust.profile = {};
  cust.profile.lastSeenAt = nowISO();

  const t = safeStr(text);

  // Deteksi "Mobil: Innova 2012" / "mobil innova 2012"
  const carMatch =
    t.match(/mobil\s*[:\-]?\s*([A-Za-z0-9 \-]{3,30})/i) ||
    t.match(/tipe\s*mobil\s*[:\-]?\s*([A-Za-z0-9 \-]{3,30})/i);

  if (carMatch && carMatch[1]) {
    cust.profile.car = safeStr(carMatch[1]).slice(0, 40);
  }

  // Deteksi "Nama: Budi"
  const nameMatch = t.match(/nama\s*[:\-]?\s*([A-Za-z ]{2,30})/i);
  if (nameMatch && nameMatch[1]) {
    cust.profile.name = safeStr(nameMatch[1]).slice(0, 30);
  }

  // Deteksi "Kota: Medan"
  const cityMatch = t.match(/kota\s*[:\-]?\s*([A-Za-z ]{2,30})/i);
  if (cityMatch && cityMatch[1]) {
    cust.profile.city = safeStr(cityMatch[1]).slice(0, 30);
  }
}

// Simpan ringkasan ticket ke history (max 10)
function pushHistory(db, ticket) {
  if (!ticket) return;
  const customerId = ticket.customerId;
  if (!customerId) return;

  const cust = getCust(db, customerId);
  if (!cust) return;

  if (!Array.isArray(cust.history)) cust.history = [];

  const item = {
    id: ticket.id || "",
    at: nowISO(),
    lane: ticket.lane || "",
    issue: ticket.issue || ticket.summary || "",
    status: ticket.status || "",
  };

  cust.history.unshift(item);
  cust.history = cust.history.slice(0, 10);

  // cache juga di profile biar gampang dipakai prompt
  if (!cust.profile) cust.profile = {};
  cust.profile.lastIssue = item.issue || cust.profile.lastIssue || "";
  cust.profile.lastLane = item.lane || cust.profile.lastLane || "";
  cust.lastSeen = nowISO();
}


function routeCustomerText(text, topic = 'GENERAL') {
  const t = String(text || '').trim().toLowerCase();

// ===== AC STICKY =====
if (topic === 'AC' || /\bac\b|freon|kompresor|blower|extra fan|kipas|dingin|panas/.test(t)) {
  return (
    "Siap Bang. Untuk *AC dingin sebentar lalu panas + kompresor kasar*, saya perlu 3 info:\n" +
    "1) Saat mulai panas, kompresor masih nyambung (klik) atau putus?\n" +
    "2) Extra fan depan radiator nyala kencang atau tidak?\n" +
    "3) Pernah servis AC kapan?\n\n" +
    "Kalau mau cepat beres: ketik *A* untuk booking ya Bang."
  );
}

  // BOOKING
  if (t.includes("jadwal") || t.includes("booking")) {
    return "Siap Bang 🙏 Untuk booking, kirim *tipe mobil + tahun* ya.";
  }

  // TOWING
  if (t.includes("towing") || t.includes("derek")) {
    return "Siap darurat 🚗 Kirim *lokasi live* sekarang ya Bang.";
  }

  // ALAMAT
  if (t.includes("alamat") || t.includes("lokasi")) {
    return "📍 Hongz Bengkel Matic\nJl. Mohammad Yakub No.10B Medan\nBuka Senin–Sabtu 09.00–17.00";
  }

  // ===== AC (topic sticky) =====
  if (topic === 'AC' || /\bac\b|freon|kompresor|blower|extra fan|kipas|dingin|panas/.test(t)) {
    return (
      "Siap Bang. Untuk *AC dingin sebentar lalu panas + kompresor kasar*, saya perlu 3 info:\n" +
      "1) Saat mulai panas, kompresor masih nyambung (klik) atau putus?\n" +
      "2) Extra fan depan radiator nyala kencang atau tidak?\n" +
      "3) Pernah servis AC kapan?\n\n" +
      "Kalau mau cepat beres: ketik *JADWAL* untuk booking ya Bang."
    );
  }

  // TRANSMISI
  if (t.includes("matic") || t.includes("transmisi")) {
    return "Keluhan matic apa Bang?\n• Nendang?\n• Slip?\n• Delay masuk D?\n\nKirim *tipe mobil + tahun* ya.";
  }

  return null; // kalau tidak cocok, lanjut ke GPT
}

// =============================
// MENU CLOSING A,B,C,D (FAST)
// =============================
function routeABCD(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  // kalau user ketik hanya A/B/C/D
  if (t === "a" || t === "a.") {
    return "✅ *A. Booking Service*\nKirim:\n1) *Tipe mobil + tahun*\n2) Keluhan singkat\n3) Mau datang jam berapa (09.00–17.00)\n\nContoh: *Avanza 2015, matic nendang, jam 10.*";
  }

  if (t === "b" || t === "b.") {
    return "✅ *B. Konsultasi Cepat*\nKirim:\n1) *Tipe mobil + tahun*\n2) Gejala (nendang/slip/delay/jedug/bunyi)\n3) Sudah ganti oli matic kapan?\n\nBiar kami arahkan langkah paling cepat.";
  }

  if (t === "c" || t === "c.") {
    return "✅ *C. Alamat & Jam Buka*\n📍 Hongz Bengkel Matic\nJl. Mohammad Yakub No.10B Medan\n🕘 Senin–Sabtu 09.00–17.00\n\nKalau mau, ketik *A* untuk booking.";
  }

  if (t === "d" || t === "d.") {
    return "✅ *D. Darurat / Towing*\nKirim *lokasi live* + patokan (dekat apa) sekarang ya Bang.\nKalau mobil masih bisa jalan pelan, sebutkan *bisa jalan atau tidak*.";
  }

  return null;
}

// Pesan menu utama (dipakai untuk balasan pertama / keyword "menu")
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


// ---------------- MAIN WEBHOOK ----------------

// kecilin log debug biar aman
function dlog(...args) {
  if (String(process.env.DEBUG || "false").toLowerCase() === "true") {
    console.log("[DLOG]", ...args);
  }
}

function envBool(v, def = false) {
  if (v === undefined || v === null || v === "") return def;
  return String(v).toLowerCase() === "true";
}

// Pastikan twilioClient ada (kalau belum dideclare di atas file)
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Pastikan PORT ada
const PORT = Number(process.env.PORT || 3000);

async function webhookHandler(req, res) {
  // ✅ FIX: loadDB harus await
  const db = await loadDB();
  if (!db.customers) db.customers = {};
  if (!db.tickets) db.tickets = {};
  if (!Array.isArray(db.events)) db.events = [];

  const from = normalizeFrom(req.body?.From || "");
  const to = normalizeFrom(req.body?.To || "");
  const body = normText(req.body?.Body || "");
  const customerText = body;

  // ===== SECURITY LAYER =====
  if (customerText.length > 800) {
    return replyTwiML(res, "Pesan terlalu panjang Bang 🙏 Mohon kirim ringkas ya.");
  }

  const safeText = customerText.replace(/[<>`]/g, "");
  if (!safeText.trim()) {
    return replyTwiML(res, "Silakan tulis keluhan mobilnya ya Bang.");
  }

  const textLower = safeText.trim().toLowerCase();

  // ===== MENU ABCD =====
  const abcd = routeABCD(textLower);
  if (abcd) {
    return replyTwiML(res, abcd);
  }

  // ===== KEYWORD MENU =====
  if (["menu", "start", "halo", "hai", "help", "mulai"].includes(textLower)) {
    return replyTwiML(res, mainMenuText());
  }

  const location = extractLocation(req.body || {});
  const style = detectStyle(body);

  dlog("IN", { from, to, body, hasLocation: !!location });

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
    return replyTwiML(res, "Baik. Follow-up dinonaktifkan. Jika ingin aktif lagi, ketik START.");
  }

  if (upper(body) === "START" || upper(body) === "SUBSCRIBE") {
    db.customers[customerId].optOut = false;
    await saveDB(db);
    return replyTwiML(res, "Siap. Follow-up diaktifkan kembali. Silakan tulis keluhan Anda.");
  }

  // ✅ Ticket harus dibuat SEBELUM routing yang butuh ticket.type
  const ticket = getOrCreateTicket(db, customerId, from);

  // ✅ Update memory dari teks pelanggan
  updateProfileFromText(db, customerId, body);

  // 1) ROUTING cepat (tanpa GPT) — dilakukan setelah ticket ada
  const routed = routeCustomerText(customerText, ticket?.type || "GENERAL");
  if (routed) {
    ticket.lastBotAtMs = nowMs();
    await saveDB(db);
    return replyTwiML(res, routed);
  }

  // ---- Commands ----
  const cmdTowing = isCommand(body, "TOWING");
  const cmdJadwal = isCommand(body, "JADWAL");

  // ---- Detections ----
  const acMode = detectAC(body);
  const noStart = detectNoStart(body);
  const cantDrive = detectCantDrive(body);
  const hasLoc = !!location;
  const priceOnly = detectPriceOnly(body);
  const buyingSignal = detectBuyingSignal(body);
  const scheduleAsk = askedForSchedule(body);

  const vInfo = hasVehicleInfo(body);
  const sInfo = hasSymptomInfo(body);

  // ---- Sticky type ----
  if (detectAC(textLower)) updateTicket(ticket, { type: "AC" });
  if (/jadwal|booking|antri|jam berapa/.test(textLower)) updateTicket(ticket, { type: "JADWAL" });
  if (/towing|derek|mogok|gak bisa jalan|stuck/.test(textLower)) updateTicket(ticket, { type: "TOWING" });

  // ---- Lead score/tag ----
  const score = leadScore({ body });
  const tag = leadTag(score);

  // ---- Stage ----
  let stage = Number(ticket.stage || 0);
  if (cmdJadwal || scheduleAsk || buyingSignal) stage = Math.max(stage, 2);
  else if (vInfo || sInfo || acMode || noStart) stage = Math.max(stage, 1);

  // ---- Type ----
  let type = "GENERAL";
  if (cmdJadwal) type = "JADWAL";
  else if (acMode) type = "AC";
  else if (noStart) type = "NO_START";
  else if (cmdTowing || cantDrive || hasLoc) type = "TOWING";

  // ---- Arena ---- (pakai versi arenaClassify yang sederhana)
  const arenaOn = envBool(ARENA_CONTROL_ENABLED, true);
  const arena = arenaOn ? arenaClassify({ body }) : { lane: "OFF", reason: "DISABLED" };

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
  // RULE: maps
  if (/alamat|lokasi|maps|map|di mana|dimana/i.test(body)) {
    await saveDB(db);
    return replyTwiML(res, `Untuk lokasi, silakan buka: ${MAPS_LINK}`);
  }

  // RULE: location received
  if (hasLoc) {
    await saveDB(db);
    return replyTwiML(
      res,
      [
        "Baik, lokasi sudah kami terima ✅",
        "Admin akan follow up untuk langkah berikutnya (termasuk evakuasi/towing bila diperlukan).",
        "",
        confidenceLine(style),
        "",
        signatureTowing(TOWING_STYLE),
      ].join("\n")
    );
  }

  // RULE: AC
  if (acMode || arena.lane === "AC") {
    await saveDB(db);
    return replyTwiML(res, acInstruction(ticket, style));
  }

  // RULE: NO_START
  if (noStart || arena.lane === "NO_START") {
    await saveDB(db);
    return replyTwiML(res, noStartInstruction(ticket, style));
  }

  // RULE: towing/cant drive
  if (cmdTowing || cantDrive || arena.lane === "URGENT") {
    await saveDB(db);
    return replyTwiML(res, towingInstruction(ticket, style));
  }

  // RULE: jadwal
  if (cmdJadwal || arena.lane === "BOOKING") {
    await saveDB(db);
    return replyTwiML(res, jadwalInstruction(ticket, style));
  }

  // ---- DEFAULT: AI reply ----
  const ai = await aiReply({ userText: body, ticket, style, stage, cantDrive, priceOnly });

  let replyText;
  if (ai) {
    replyText = [ai, "", confidenceLine(style), "", signatureShort()].join("\n");
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
    ]
      .filter(Boolean)
      .join("\n");
  }

  ticket.lastBotAtMs = nowMs();
  await saveDB(db);
  return replyTwiML(res, replyText);
}

// ---------------- ROUTES ----------------

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
    return replyTwiML(res, "Maaf ya, sistem lagi padat. Silakan ulangi pesan Anda sebentar lagi 🙏");
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
    if (String(process.env.FOLLOWUP_ENABLED || "false").toLowerCase() !== "true")
      return res.status(200).send("Follow-up disabled");

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
    const arenaOn = String(ARENA_CONTROL_ENABLED).toLowerCase() === "true";
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
